import assert from "node:assert/strict";
import test from "node:test";

import { LayerRegistry } from "./LayerRegistry.ts";
import { MAP_CONFIG } from "./config.ts";

/** A fake SDK: property setters notify watchers, like reactiveUtils does. */
function makeSdk() {
  const watchers: { read: () => unknown; cb: (v: never) => void; last: unknown }[] = [];

  const flush = () => {
    for (const w of watchers) {
      const value = w.read();
      if (value !== w.last) {
        w.last = value;
        (w.cb as (v: unknown) => void)(value);
      }
    }
  };

  class FakeFeatureLayer {
    id: string;
    title: string;
    visible: boolean;
    opacity: number;
    loadStatus = "not-loaded";
    loadError: { message: string } | null = null;
    fullExtent = { xmin: 0 };
    constructor(props: Record<string, unknown>) {
      this.id = props.id as string;
      this.title = props.title as string;
      this.visible = props.visible as boolean;
      this.opacity = props.opacity as number;
    }
    async load() {
      this.loadStatus = "loaded";
      flush();
      return this;
    }
    async when() {
      return this;
    }
  }

  const reactiveUtils = {
    watch(read: () => unknown, cb: (v: never) => void, options?: { initial?: boolean }) {
      const entry = { read, cb, last: read() };
      watchers.push(entry);
      if (options?.initial) (cb as (v: unknown) => void)(entry.last);
      return {
        remove() {
          watchers.splice(watchers.indexOf(entry), 1);
        },
      };
    },
  };

  const added: FakeFeatureLayer[] = [];
  const map = {
    addMany(layers: FakeFeatureLayer[]) {
      added.push(...layers);
    },
  };

  return { sdk: { FeatureLayer: FakeFeatureLayer, reactiveUtils }, map, added, flush };
}

const row = (states: readonly { id: string }[], id: string) => states.find((s) => s.id === id);

function setup() {
  let notifications = 0;
  const registry = new LayerRegistry(MAP_CONFIG.layers, () => {
    notifications++;
  });
  const harness = makeSdk();
  return { registry, harness, count: () => notifications };
}

test("initial states come from the config before any SDK exists", () => {
  const { registry } = setup();
  const states = registry.getStates();
  assert.equal(states.length, 3);
  assert.deepEqual(
    states.map((s) => s.id),
    ["parks", "trails", "trailheads"],
  );
  assert.equal(
    states.every((s) => s.status === "not-loaded"),
    true,
  );
  assert.equal(
    states.every((s) => s.inScaleRange),
    true,
    "no view yet ⇒ everything in range",
  );
  assert.equal(states.find((s) => s.id === "parks")?.opacity, 0.45);
});

test("toggling writes through to the live layer and publishes once", async () => {
  const { registry, harness, count } = setup();
  registry.build(harness.map as never, harness.sdk as never);
  await Promise.resolve();

  const before = count();
  const beforeStates = registry.getStates();
  registry.setVisible("trails", false);

  assert.equal(harness.added.find((l) => l.id === "trails")?.visible, false, "SDK layer updated");
  assert.equal(registry.getStates().find((s) => s.id === "trails")?.visible, false);
  assert.equal(count(), before + 1, "exactly one publish");
  assert.notEqual(registry.getStates(), beforeStates, "array identity changed");
});

test("setting the same value publishes nothing", () => {
  const { registry, harness, count } = setup();
  registry.build(harness.map as never, harness.sdk as never);
  const before = count();
  const states = registry.getStates();

  registry.setVisible("trails", true); // already true
  registry.setOpacity("parks", 0.45); // already 0.45

  assert.equal(count(), before, "no publish");
  assert.equal(registry.getStates(), states, "same array identity");
});

test("unchanged rows keep object identity (structural sharing)", () => {
  const { registry, harness } = setup();
  registry.build(harness.map as never, harness.sdk as never);

  const before = registry.getStates();
  registry.setVisible("trails", false);
  const after = registry.getStates();

  assert.notEqual(row(before, "trails"), row(after, "trails"), "changed row is a new object");
  assert.equal(row(before, "parks"), row(after, "parks"), "untouched row is the SAME object");
  assert.equal(row(before, "trailheads"), row(after, "trailheads"));
});

test("scale changes only publish when a layer crosses its range", () => {
  const { registry, harness, count } = setup();
  registry.build(harness.map as never, harness.sdk as never);

  registry.setScale(288_895); // z11 — trailheads (minScale 300k) in range
  const inRange = registry.getStates();
  assert.equal(inRange.find((s) => s.id === "trailheads")?.inScaleRange, true);

  const before = count();
  registry.setScale(250_000); // still inside the range
  assert.equal(count(), before, "scale moved, nothing crossed ⇒ no publish");
  assert.equal(registry.getStates(), inRange, "same array ⇒ React does not re-render");

  registry.setScale(577_790); // z10 — now outside
  assert.equal(count(), before + 1, "crossing the boundary publishes once");
  assert.equal(registry.getStates().find((s) => s.id === "trailheads")?.inScaleRange, false);
  assert.equal(
    registry.getStates().find((s) => s.id === "trails")?.inScaleRange,
    true,
    "layers with no scale limit are unaffected",
  );
});

test("the user's choices survive teardown and rebuild", () => {
  const { registry, harness } = setup();
  registry.build(harness.map as never, harness.sdk as never);

  registry.setVisible("trails", false);
  registry.setOpacity("parks", 0.2);

  registry.teardown();
  assert.equal(registry.getStates().find((s) => s.id === "trails")?.visible, false);

  // Strict Mode remount: a brand-new map and brand-new layers.
  const second = makeSdk();
  registry.build(second.map as never, second.sdk as never);

  assert.equal(second.added.find((l) => l.id === "trails")?.visible, false, "layer rebuilt off");
  assert.equal(second.added.find((l) => l.id === "parks")?.opacity, 0.2);
  assert.equal(registry.getStates().find((s) => s.id === "trails")?.visible, false);
});

test("external mutation of a layer flows back into the snapshot", () => {
  const { registry, harness } = setup();
  registry.build(harness.map as never, harness.sdk as never);

  // Something other than our commands turns a layer off (a popup action, the
  // SDK, Part 4's selection code).
  const layer = harness.added.find((l) => l.id === "parks");
  layer!.visible = false;
  harness.flush();

  assert.equal(registry.getStates().find((s) => s.id === "parks")?.visible, false);
});

test("isolate shows exactly one layer", () => {
  const { registry, harness } = setup();
  registry.build(harness.map as never, harness.sdk as never);

  registry.isolate("trails");
  assert.deepEqual(
    registry.getStates().map((s) => [s.id, s.visible]),
    [
      ["parks", false],
      ["trails", true],
      ["trailheads", false],
    ],
  );
});

test("load failure lands on the row, not on the app", async () => {
  const { registry, harness } = setup();
  registry.build(harness.map as never, harness.sdk as never);

  const layer = harness.added.find((l) => l.id === "trails")!;
  layer.loadStatus = "failed";
  layer.loadError = { message: "Service unavailable" };
  harness.flush();

  const states = registry.getStates();
  assert.equal(states.find((s) => s.id === "trails")?.status, "failed");
  assert.equal(states.find((s) => s.id === "trails")?.error, "Service unavailable");
  assert.equal(states.find((s) => s.id === "parks")?.status, "loaded", "others unaffected");
});
