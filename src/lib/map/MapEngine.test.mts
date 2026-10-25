import assert from "node:assert/strict";
import test from "node:test";

import { MapEngine } from "./MapEngine.ts";
import { MAP_CONFIG } from "./config.ts";
import type { SearchResult } from "./types.ts";

/**
 * The engine's constructor is deliberately side-effect-free — no DOM, no
 * ArcGIS objects, nothing until `attach`. That is what lets these run in
 * plain Node, and it is worth a test of its own: the day someone creates a
 * `MapView` in the constructor, server rendering breaks and this goes red.
 */
test("a fresh engine has a usable snapshot before attach", () => {
  const engine = new MapEngine(MAP_CONFIG);
  const snapshot = engine.getSnapshot();

  assert.equal(snapshot.status, "idle");
  assert.equal(snapshot.pin, null);
  assert.equal(snapshot.layers.length, MAP_CONFIG.layers.length);
});

test("committing a layer result switches that layer back on", async () => {
  const engine = new MapEngine(MAP_CONFIG);
  const visible = (id: string) => engine.getSnapshot().layers.find((l) => l.id === id)?.visible;

  engine.setLayerVisible("trails", false);
  assert.equal(visible("trails"), false);

  const result: SearchResult = {
    id: "layer:trails",
    kind: "layer",
    title: "Trails",
    layerId: "trails",
  };
  // No view yet, so the camera move is a no-op — but the visibility is not.
  // Zooming to a layer the user cannot see would be a magic trick.
  await engine.goToResult(result);

  assert.equal(visible("trails"), true);
  assert.equal(engine.getSnapshot().pin, null, "a layer result pins nothing");
});

test("a search below the minimum term length resolves empty, not rejected", async () => {
  const engine = new MapEngine(MAP_CONFIG);
  assert.deepEqual(await engine.search("t"), { results: [], failures: [] });
});

test("layer search works with no map attached at all", async () => {
  const engine = new MapEngine(MAP_CONFIG);
  const { results, failures } = await engine.search("trail");

  assert.deepEqual(failures, [], "no live layers means nothing to fail");
  assert.deepEqual(
    results.map((r) => r.id),
    ["layer:trails", "layer:trailheads"],
    "the in-memory source answers before any service does",
  );
});

test("clearing a pin that was never set publishes nothing", () => {
  const engine = new MapEngine(MAP_CONFIG);
  let changes = 0;
  engine.subscribe(() => changes++);

  engine.clearPin();
  assert.equal(changes, 0);
});
