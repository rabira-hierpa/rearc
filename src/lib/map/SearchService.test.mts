import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWhere,
  FeatureSearchSource,
  LayerSearchSource,
  searchFieldsFor,
  SearchService,
  type SearchSource,
} from "./SearchService.ts";
import { MAP_CONFIG } from "./config.ts";
import type { LayerDefinition, SearchResult } from "./types.ts";

const CONFIG = { geocodeUrl: "https://example.invalid", limitPerSource: 5, minTermLength: 2 };

function source(kind: "layer" | "feature" | "place", impl: () => Promise<SearchResult[]>) {
  return { kind, search: impl } as SearchSource;
}

const definitionFor = (id: string): LayerDefinition => ({
  id,
  title: id,
  group: "network",
  swatch: { kind: "line", color: "#000" },
  properties: {},
});

const result = (id: string): SearchResult => ({ id, kind: "feature", title: id });

test("a term shorter than the minimum never reaches a source", async () => {
  let calls = 0;
  const service = new SearchService(
    [
      source("place", () => {
        calls++;
        return Promise.resolve([]);
      }),
    ],
    CONFIG,
  );

  assert.deepEqual(await service.search("a"), { results: [], failures: [] });
  assert.deepEqual(await service.search("   "), { results: [], failures: [] });
  assert.equal(calls, 0, "no request for a one-character term");
});

test("one source failing does not lose the others' results", async () => {
  const service = new SearchService(
    [
      source("layer", () => Promise.resolve([result("kept")])),
      source("place", () => Promise.reject(new Error("403 Forbidden"))),
    ],
    CONFIG,
  );

  const response = await service.search("trail");
  assert.deepEqual(
    response.results.map((r) => r.id),
    ["kept"],
  );
  assert.deepEqual(response.failures, [{ kind: "place", message: "403 Forbidden" }]);
});

test("an aborted source is not reported as a failure", async () => {
  const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
  const service = new SearchService(
    [
      source("layer", () => Promise.resolve([result("kept")])),
      source("feature", () => Promise.reject(abort)),
    ],
    CONFIG,
  );

  const response = await service.search("trail");
  assert.deepEqual(response.failures, [], "superseded requests are not errors");
  assert.equal(response.results.length, 1);
});

test("layer search matches titles and descriptions without a network", async () => {
  const layers = new LayerSearchSource(MAP_CONFIG.layers);

  const byTitle = await layers.search("trailhead", { limit: 5 });
  assert.deepEqual(
    byTitle.map((r) => r.layerId),
    ["trailheads"],
  );

  const byDescription = await layers.search("edges", { limit: 5 });
  assert.deepEqual(
    byDescription.map((r) => r.layerId),
    ["trails"],
    "description text is searchable too",
  );

  const capitals = await layers.search("TRAILS", { limit: 5 });
  assert.equal(capitals.length, 1, "matching is case-insensitive");
});

test("a single quote in the term cannot break out of the SQL literal", () => {
  const where = buildWhere(["NAME"], "O'Brien");
  assert.equal(where, "UPPER(NAME) LIKE '%O''BRIEN%'");

  const injection = buildWhere(["NAME"], "x' OR '1'='1");
  assert.equal(
    injection,
    "UPPER(NAME) LIKE '%X'' OR ''1''=''1%'",
    "every quote is doubled, so the whole term stays one literal",
  );
  // The clause has exactly one unescaped quote on each end of the literal.
  assert.equal(injection.split("'").length - 1 - 8, 2);
});

test("several fields become an OR across all of them", () => {
  assert.equal(
    buildWhere(["TRL_NAME", "PARK_NAME"], "echo"),
    "UPPER(TRL_NAME) LIKE '%ECHO%' OR UPPER(PARK_NAME) LIKE '%ECHO%'",
  );
});

test("search fields fall back to the service's displayField", () => {
  const base: LayerDefinition = {
    id: "x",
    title: "X",
    group: "g",
    swatch: { kind: "line", color: "#000" },
    properties: {},
  };

  assert.deepEqual(searchFieldsFor(base, { displayField: "NAME" }), ["NAME"]);
  assert.deepEqual(
    searchFieldsFor({ ...base, searchFields: ["TRL_NAME"] }, { displayField: "NAME" }),
    ["TRL_NAME"],
    "configured fields win",
  );
  assert.deepEqual(searchFieldsFor(base, { displayField: null }), [], "nothing to search on");
  assert.deepEqual(
    searchFieldsFor({ ...base, searchable: false }, { displayField: "NAME" }),
    [],
    "opted out",
  );
});

test("feature search queries each layer and maps the rows it gets back", async () => {
  const queries: { where: string; num: number | undefined }[] = [];
  const fakeLayer = {
    displayField: "NAME",
    objectIdField: "OBJECTID",
    queryFeatures(query: { where: string; num?: number }) {
      queries.push({ where: query.where, num: query.num });
      return Promise.resolve({
        features: [
          { attributes: { NAME: "Echo Mountain", OBJECTID: 7 }, geometry: { type: "point" } },
          { attributes: { NAME: "   ", OBJECTID: 8 }, geometry: { type: "point" } },
        ],
      });
    },
  };

  const definition: LayerDefinition = {
    id: "trails",
    title: "Trails",
    group: "network",
    swatch: { kind: "line", color: "#000" },
    properties: {},
  };

  const features = new FeatureSearchSource({
    getLayers: () => [{ definition, layer: fakeLayer as never }],
    toLonLat: () => ({ lon: -118.1, lat: 34.2 }),
    toExtent: () => undefined,
  });

  const results = await features.search("echo", { limit: 5 });

  assert.deepEqual(queries, [{ where: "UPPER(NAME) LIKE '%ECHO%'", num: 5 }]);
  assert.equal(results.length, 1, "the blank-label row is dropped");
  assert.deepEqual(results[0], {
    id: "feature:trails:7",
    kind: "feature",
    title: "Echo Mountain",
    subtitle: "Trails",
    layerId: "trails",
    target: { center: { lon: -118.1, lat: 34.2 }, extent: undefined },
  });
});

test("a result with geometry we cannot place is dropped, not faked", async () => {
  const definition: LayerDefinition = {
    id: "trails",
    title: "Trails",
    group: "network",
    swatch: { kind: "line", color: "#000" },
    properties: {},
  };

  const features = new FeatureSearchSource({
    getLayers: () => [
      {
        definition,
        layer: {
          displayField: "NAME",
          objectIdField: "OBJECTID",
          queryFeatures: () =>
            Promise.resolve({
              features: [{ attributes: { NAME: "Somewhere", OBJECTID: 1 }, geometry: {} }],
            }),
        } as never,
      },
    ],
    // Stands in for an unsupported spatial reference.
    toLonLat: () => null,
    toExtent: () => undefined,
  });

  assert.deepEqual(await features.search("some", { limit: 5 }), []);
});

test("one broken layer does not empty the other layers' matches", async () => {
  const features = new FeatureSearchSource({
    getLayers: () => [
      {
        definition: definitionFor("broken"),
        layer: {
          displayField: "NAME",
          objectIdField: "OBJECTID",
          queryFeatures: () => Promise.reject(new Error("Service unavailable")),
        } as never,
      },
      {
        definition: definitionFor("working"),
        layer: {
          displayField: "NAME",
          objectIdField: "OBJECTID",
          queryFeatures: () =>
            Promise.resolve({
              features: [{ attributes: { NAME: "Found", OBJECTID: 2 }, geometry: {} }],
            }),
        } as never,
      },
    ],
    toLonLat: () => ({ lon: 0, lat: 0 }),
    toExtent: () => undefined,
  });

  const results = await features.search("f", { limit: 5 });
  assert.deepEqual(
    results.map((r) => r.title),
    ["Found"],
  );
});
