import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";

import type {
  LayerDefinition,
  LonLat,
  SearchConfig,
  SearchFailure,
  SearchResponse,
  SearchResult,
  SearchResultKind,
  SearchTarget,
} from "./types";

export interface SearchContext {
  signal?: AbortSignal;
  limit: number;
}

/**
 * The Strategy from Part 1's table. Three very different things — an in-memory
 * filter, a REST query per layer, a geocoding call — behind one method, so the
 * UI never learns there is more than one kind of search.
 */
export interface SearchSource {
  readonly kind: SearchResultKind;
  search(term: string, context: SearchContext): Promise<SearchResult[]>;
}

/** A live layer paired with the definition that configured it. */
export interface SearchableLayer {
  definition: LayerDefinition;
  layer: FeatureLayer;
}

export interface PlaceSearchDeps {
  /** The engine owns SDK loading; the source only gets a loader. */
  loadLocator: () => Promise<typeof import("@arcgis/core/rest/locator.js")>;
  /** Converts a point in any spatial reference to degrees. */
  toLonLat: (geometry: unknown) => LonLat | null;
  url: string;
  hasApiKey: boolean;
}

export interface FeatureSearchDeps {
  /** Resolved per call: layers come and go with attach/detach. */
  getLayers: () => SearchableLayer[];
  toLonLat: (geometry: unknown) => LonLat | null;
  toExtent: (geometry: unknown) => SearchTarget["extent"];
}

/**
 * Fans a term out to every source and merges the results.
 *
 * The fan-out is `allSettled`, not `all`: geocoding being down must not hide
 * the layer matches sitting in memory. Same rule as Part 2's layer panel —
 * a failure belongs to the row it happened in, not to the whole feature.
 */
export class SearchService {
  private readonly sources: readonly SearchSource[];
  private readonly config: SearchConfig;

  constructor(sources: readonly SearchSource[], config: SearchConfig) {
    this.sources = sources;
    this.config = config;
  }

  async search(term: string, signal?: AbortSignal): Promise<SearchResponse> {
    const trimmed = term.trim();
    if (trimmed.length < this.config.minTermLength) {
      return { results: [], failures: [] };
    }

    const context: SearchContext = { signal, limit: this.config.limitPerSource };
    const settled = await Promise.allSettled(
      this.sources.map((source) => source.search(trimmed, context)),
    );

    const results: SearchResult[] = [];
    const failures: SearchFailure[] = [];

    for (const [index, outcome] of settled.entries()) {
      const source = this.sources[index];
      if (outcome.status === "fulfilled") {
        results.push(...outcome.value);
      } else if (!isAbort(outcome.reason)) {
        // An aborted source is not a broken source: the user typed another
        // character and this request was cancelled on purpose.
        failures.push({ kind: source.kind, message: toMessage(outcome.reason) });
      }
    }

    return { results, failures };
  }
}

/**
 * Layers themselves, matched in memory. No network, no await that matters —
 * which is why the dropdown has something in it before the first keystroke
 * reaches a server.
 */
export class LayerSearchSource implements SearchSource {
  readonly kind = "layer" as const;
  private readonly definitions: readonly LayerDefinition[];

  constructor(definitions: readonly LayerDefinition[]) {
    this.definitions = definitions;
  }

  search(term: string, context: SearchContext): Promise<SearchResult[]> {
    const needle = term.toLowerCase();
    const results = this.definitions
      .filter((definition) => {
        const haystack = `${definition.title} ${definition.description ?? ""}`.toLowerCase();
        return haystack.includes(needle);
      })
      .slice(0, context.limit)
      .map<SearchResult>((definition) => ({
        id: `layer:${definition.id}`,
        kind: "layer",
        title: definition.title,
        subtitle: "Layer",
        layerId: definition.id,
      }));

    return Promise.resolve(results);
  }
}

/**
 * Features, queried straight from the feature services, one request per layer.
 */
export class FeatureSearchSource implements SearchSource {
  readonly kind = "feature" as const;
  private readonly deps: FeatureSearchDeps;

  constructor(deps: FeatureSearchDeps) {
    this.deps = deps;
  }

  async search(term: string, context: SearchContext): Promise<SearchResult[]> {
    const layers = this.deps.getLayers();
    if (layers.length === 0) return [];

    const perLayer = await Promise.allSettled(
      layers.map((entry) => this.searchLayer(entry, term, context)),
    );

    const results: SearchResult[] = [];
    for (const outcome of perLayer) {
      if (outcome.status === "fulfilled") results.push(...outcome.value);
      else if (isAbort(outcome.reason)) throw outcome.reason;
      // One dead service shouldn't empty the other layers' matches.
    }
    return results;
  }

  private async searchLayer(
    { definition, layer }: SearchableLayer,
    term: string,
    context: SearchContext,
  ): Promise<SearchResult[]> {
    const fields = searchFieldsFor(definition, layer);
    if (fields.length === 0) return [];

    const where = buildWhere(fields, term);
    const outFields = [...new Set([...fields, layer.objectIdField].filter(Boolean))] as string[];

    const featureSet = await layer.queryFeatures(
      {
        where,
        outFields,
        returnGeometry: true,
        num: context.limit,
        // Geometry comes back in the layer's own spatial reference; we
        // convert to degrees below rather than letting it reach React.
      },
      { signal: context.signal },
    );

    return featureSet.features.flatMap<SearchResult>((feature, index) => {
      const attributes = (feature.attributes ?? {}) as Record<string, unknown>;
      const label = firstNonEmpty(fields.map((field) => attributes[field]));
      if (!label) return [];

      const center = this.deps.toLonLat(feature.geometry);
      if (!center) return [];

      const objectId = layer.objectIdField ? attributes[layer.objectIdField] : undefined;
      return [
        {
          id: `feature:${definition.id}:${objectId ?? index}`,
          kind: "feature",
          title: label,
          subtitle: definition.title,
          layerId: definition.id,
          target: { center, extent: this.deps.toExtent(feature.geometry) },
        },
      ];
    });
  }
}

/** Addresses and places, via Esri's World Geocoding Service. */
export class PlaceSearchSource implements SearchSource {
  readonly kind = "place" as const;
  private readonly deps: PlaceSearchDeps;

  constructor(deps: PlaceSearchDeps) {
    this.deps = deps;
  }

  async search(term: string, context: SearchContext): Promise<SearchResult[]> {
    // Geocoding is billable and refuses anonymous requests, so without a key
    // we skip the source rather than letting every search report an error.
    if (!this.deps.hasApiKey) return [];

    const locator = await this.deps.loadLocator();
    const candidates = await locator.addressToLocations(
      this.deps.url,
      { address: { SingleLine: term }, maxLocations: context.limit, outFields: ["*"] },
      { signal: context.signal },
    );

    return candidates.flatMap<SearchResult>((candidate, index) => {
      const center = this.deps.toLonLat(candidate.location);
      if (!center || !candidate.address) return [];
      return [
        {
          id: `place:${index}:${candidate.address}`,
          kind: "place",
          title: candidate.address,
          subtitle: "Place",
          target: { center, scale: 5000 },
        },
      ];
    });
  }
}

/** Configured fields win; otherwise ask the service what it displays. */
export function searchFieldsFor(
  definition: LayerDefinition,
  layer: Pick<FeatureLayer, "displayField">,
): string[] {
  if (definition.searchable === false) return [];
  if (definition.searchFields?.length) return definition.searchFields;
  return layer.displayField ? [layer.displayField] : [];
}

/**
 * ArcGIS `where` is SQL, and the term is whatever the user typed.
 *
 * A single quote would otherwise end the string literal and leave the rest of
 * the input to be parsed as SQL — doubling it is the standard escape, and the
 * only thing standing between a search box and a service-side syntax error
 * (or worse, on a service that allows more than SELECT).
 */
export function buildWhere(fields: readonly string[], term: string): string {
  const literal = term.toUpperCase().replaceAll("'", "''");
  return fields.map((field) => `UPPER(${field}) LIKE '%${literal}%'`).join(" OR ");
}

function firstNonEmpty(values: readonly unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return null;
}

function isAbort(error: unknown): boolean {
  const name = (error as { name?: string } | null)?.name;
  return name === "AbortError";
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
