import type { FeatureLayerProperties } from "@arcgis/core/layers/FeatureLayer";

export type EngineStatus = "idle" | "loading" | "ready" | "error";

export type BasemapId = "streets" | "satellite";

export interface LonLat {
  lon: number;
  lat: number;
}

export interface CameraState {
  center: LonLat;
  zoom: number;
}

/** Anything with a `remove()` — ArcGIS watch handles, our own subscriptions. */
export interface WatchHandle {
  remove(): void;
}

/** Mirrors the SDK's `Loadable.loadStatus`, kept as our own type on purpose. */
export type LayerStatus = "not-loaded" | "loading" | "loaded" | "failed";

/** Where a search result came from. Also the display order of the sections. */
export type SearchResultKind = "layer" | "feature" | "place";

/**
 * A location as plain numbers. Geometry is converted to degrees inside the
 * engine, so no ArcGIS `Point` or `Extent` ever reaches React — the same rule
 * that keeps `MapView` out of the snapshot.
 */
export interface SearchTarget {
  center: LonLat;
  /** [west, south, east, north] in degrees, when the result has an extent. */
  extent?: readonly [number, number, number, number];
  /** Fallback scale for a point with no extent of its own. */
  scale?: number;
}

export interface SearchResult {
  /** Stable within a result set — used as the React key and the active id. */
  id: string;
  kind: SearchResultKind;
  title: string;
  subtitle?: string;
  /** The layer a feature came from, or the layer a "layer" result names. */
  layerId?: string;
  /** Absent for layer results: those resolve through `layerId` instead. */
  target?: SearchTarget;
}

/** One source failing is not the search failing — see `SearchService`. */
export interface SearchFailure {
  kind: SearchResultKind;
  message: string;
}

export interface SearchResponse {
  results: readonly SearchResult[];
  failures: readonly SearchFailure[];
}

/**
 * The result the user committed to. Unlike the candidate list — which belongs
 * to whichever component asked — this is map state: it moves the camera and
 * puts a marker on it, so it lives in the snapshot where anyone can see it.
 */
export interface SearchPin {
  title: string;
  subtitle?: string;
  kind: SearchResultKind;
  center: LonLat;
}

/**
 * How React draws a layer's legend chip. Declared as data so the shell can
 * render a legend without importing a single byte of the ArcGIS SDK.
 */
export type LayerSwatch =
  | { kind: "point"; color: string; outline?: string }
  | { kind: "line"; color: string; dashed?: boolean }
  | { kind: "fill"; color: string; outline?: string };

/** A panel section. Groups are ordered as declared in the config. */
export interface LayerGroup {
  id: string;
  title: string;
}

/**
 * App-level metadata plus the SDK properties, kept apart on purpose.
 *
 * `properties` is handed to the `FeatureLayer` constructor untouched;
 * everything outside it exists for the UI and never reaches the SDK. Mixing
 * the two is how layer configs turn into soup — the panel starts reading
 * renderer internals, and swapping the data source breaks the chrome.
 */
export interface LayerDefinition {
  id: string;
  title: string;
  /** Id of the `LayerGroup` this layer belongs to. */
  group: string;
  /** One line of context, shown under the title in the panel. */
  description?: string;
  swatch: LayerSwatch;
  /** Visible on first load. Defaults to `true`. */
  visible?: boolean;
  /** 0–1, defaults to 1. */
  opacity?: number;
  /**
   * Fields a text search runs against. Leave it out and the service's own
   * `displayField` is used — which is the honest default when you don't
   * control the schema.
   */
  searchFields?: string[];
  /** Set false to keep a layer out of search results entirely. */
  searchable?: boolean;
  properties: FeatureLayerProperties;
}

/**
 * One row of the layer panel — the only thing React ever learns about a layer.
 *
 * The registry preserves object identity across snapshots for rows whose
 * values did not change, so a component reading `snapshot.layers` re-renders
 * only when a layer actually changes.
 */
export interface LayerState {
  id: string;
  title: string;
  group: string;
  description?: string;
  swatch: LayerSwatch;
  /** The user's intent: is this layer switched on? */
  visible: boolean;
  opacity: number;
  status: LayerStatus;
  /** Set only when `status` is "failed". */
  error: string | null;
  /**
   * False when a visible layer is outside its scale range and therefore not
   * drawn. The toggle says "on", the map shows nothing — the panel needs to
   * be able to explain that.
   */
  inScaleRange: boolean;
}

/**
 * An immutable snapshot of everything React is allowed to know about the map.
 *
 * The engine replaces this object wholesale on every change, so React can use
 * reference equality (`useSyncExternalStore`) to decide when to re-render.
 * Live ArcGIS objects (MapView, layers, graphics) never appear here.
 */
export interface EngineSnapshot {
  status: EngineStatus;
  /** Human-readable message, set only when status is "error". */
  error: string | null;
  basemapId: BasemapId;
  /** Last settled camera position — updated when the view stops moving. */
  camera: CameraState;
  /** Bottom-to-top draw order, same order as `MapConfig.layers`. */
  layers: readonly LayerState[];
  /** The committed search result, or null. Drawn on the map as a marker. */
  pin: SearchPin | null;
}

export interface SearchConfig {
  /**
   * Esri's World Geocoding Service. Geocoding is a paid service, so place
   * search is skipped entirely when no API key is configured — the other two
   * sources keep working.
   */
  geocodeUrl: string;
  /** Results kept per source, per layer for features. */
  limitPerSource: number;
  /** Shortest term worth sending to a server. */
  minTermLength: number;
}

export interface MapConfig {
  /** ArcGIS Location Platform key. Optional — the default basemaps work without one. */
  apiKey?: string;
  /** Well-known basemap ids, keyed by the app-level basemap name. */
  basemaps: Record<BasemapId, string>;
  initialBasemap: BasemapId;
  initialCamera: CameraState;
  /** Panel sections, in display order. */
  groups: LayerGroup[];
  /** Draw order, bottom first — the order the SDK expects. */
  layers: LayerDefinition[];
  search: SearchConfig;
}
