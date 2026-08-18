# Getting Started with Web Maps: ArcGIS Maps SDK 5, Next.js 16, Tailwind v4 and Preline — Part 2: The Layer Registry

> This is Part 2 of a series building a **transport network analysis app with the UI/UX of Google Maps**. [Part 1](https://blog.rz-codes.com/) set up Next.js 16, Tailwind v4, Preline and oxlint, and established the architecture: a `MapEngine` class owns everything imperative, React reads immutable snapshots through `useSyncExternalStore`.
>
> This part earns that architecture back. We add a **layer registry**, a **Preline slide-over panel** with toggles, opacity, isolate and zoom-to, per-layer **load failure** handling, and **scale-range** awareness — and the payoff is that panning the map re-renders none of it.
>
> All code is on GitHub: [github.com/rabira-hierpa/rearc](https://github.com/rabira-hierpa/rearc), tagged [`part-2`](https://github.com/rabira-hierpa/rearc/tree/part-2).

## Where Part 1 left off

One layer, hard-coded, always visible. That was enough to prove the engine pattern, but a network analysis app is layers: routes, stops, corridors, catchments, plus whatever context makes the map readable. Part 2 goes to three — trails (the edges), trailheads (the nodes), parks (context) — and builds the machinery that makes going to thirty a config change rather than a refactor.

Here's what we're building:

```
Layers                                    [Hide all] [×]
──────────────────────────────────────────────────────
NETWORK
  ●───  Trailheads          The nodes — visible from zoom 11 in
        ▓▓▓▓▓▓▓▓░░ 100%              Only   Zoom to
  ●───  Trails              The edges of the network
        ▓▓▓▓▓▓▓▓░░ 100%              Only   Zoom to
CONTEXT
  ●───  Parks & open space  Protected land the network runs through
        ▓▓▓▓▓░░░░░  45%              Only   Zoom to
──────────────────────────────────────────────────────
Draw order runs bottom-up: the last layer here sits on top.
```

## The three ways layer toggling goes wrong

Almost every React + ArcGIS layer panel I've read has at least one of these bugs. They're worth naming before we write code, because each one is a design constraint in disguise.

**1. Mirrored state drifts.** The panel keeps `const [visible, setVisible] = useState(true)` and the click handler does two things: `setVisible(next)` and `layer.visible = next`. Now the truth lives in two places. The day anything else touches `layer.visible` — a popup action, a "show me the route" button, the selection code we write in Part 4 — the checkbox says one thing and the map does another. There is no bug report more annoying than "the toggle is out of sync" because it reproduces only after a specific sequence.

**2. Remounts reset the user.** The layer objects are created inside the effect that builds the view. React Strict Mode unmounts and remounts that component in development; an error boundary can do it in production. New `MapView`, new `FeatureLayer`s, all back to their configured defaults — and the three layers the user carefully switched off come roaring back.

**3. The panel re-renders on every pan.** This is the one the architecture from Part 1 makes tempting. `useEngineSnapshot()` gives you the whole snapshot, and the snapshot changes when the camera settles. Subscribe your layer panel to it and every pan re-renders every row, every legend swatch, every slider. It's not fatal at three layers. At thirty, with a legend image per row, it is.

The fixes are, in order: **don't mirror state, derive it**; **separate what the user wants from what the SDK currently has**; and **give React a slice that only changes when it actually changes**. That's the whole post.

---

## Step 1: Layer definitions — app metadata and SDK properties, kept apart

Part 1's config typed layers as `FeatureLayerProperties[]` — straight SDK objects. That stops working the moment the UI needs to know something the SDK doesn't care about: which panel section a layer belongs to, what to write under its title, what colour chip to draw next to it.

The temptation is to bolt those onto the SDK object and pass the whole thing to `new FeatureLayer(...)`. Don't — the SDK ignores unknown keys today, and you've quietly created a config where nobody can tell which fields are load-bearing. Instead, one level of nesting:

```ts
// src/lib/map/types.ts
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
  properties: FeatureLayerProperties;
}
```

Everything outside `properties` is ours; `properties` goes to the constructor untouched. The line is enforceable by reading, which is the only kind of enforcement that survives a year.

`LayerSwatch` deserves a note, because it's how we get a legend without Esri's `Legend` widget (deprecated in SDK 5, remember):

```ts
export type LayerSwatch =
  | { kind: "point"; color: string; outline?: string }
  | { kind: "line"; color: string; dashed?: boolean }
  | { kind: "fill"; color: string; outline?: string };
```

It's data, so the shell renders it with three `<span>`s and zero ArcGIS imports. And the colour comes from the same constant the renderer uses:

```ts
// src/lib/map/config.ts
const COLORS = {
  trailhead: "#059669",
  trail: "#0284c7",
  park: "#65a30d",
} as const;
```

That's not tidiness either. A legend whose colours are typed out a second time is a legend that will eventually lie to you — someone tweaks the renderer, nobody tweaks the swatch, and the map says blue while the panel says teal.

The layer array itself is now ordered and grouped:

```ts
export const MAP_CONFIG: MapConfig = {
  // …
  groups: [
    { id: "network", title: "Network" },
    { id: "context", title: "Context" },
  ],
  // Draw order, bottom first — the order `Map.layers` expects. The panel
  // reverses it, because a legend reads top-down like the map does.
  layers: [
    { id: "parks", title: "Parks & open space", group: "context" /* … */ },
    { id: "trails", title: "Trails", group: "network" /* … */ },
    { id: "trailheads", title: "Trailheads", group: "network" /* … */ },
  ],
};
```

Two orderings, one array. `Map.layers` index 0 is the _bottom_ of the stack, so parks (polygons) go first, then trails (lines), then trailheads (points) — the classic polygon → line → point cascade that stops the big shapes burying the small ones. The panel shows the reverse, because every map legend in existence reads top-down. Getting this backwards produces a panel that feels subtly wrong and takes an embarrassingly long time to diagnose.

## Step 2: `LayerRegistry` — two collections and a rule

Here's the class the whole part is named after. The design is one idea:

```ts
/** What the user asked for. Survives teardown; the layer objects do not. */
interface LayerPrefs {
  visible: boolean;
  opacity: number;
}

/** What the SDK currently says. Exists only while the engine is attached. */
interface LayerRuntime {
  layer: FeatureLayer;
  status: LayerStatus;
  error: string | null;
}
```

`prefs` is created in the constructor from the config, mutated by commands and by watchers, and **kept across attach/detach**. `runtime` is built in `build()` and dropped in `teardown()`. That split is the answer to failure mode 2: a `MapView` is disposable, and what the user switched off is not.

Construction applies the remembered prefs rather than the config defaults:

```ts
build(map: EsriMap, sdk: LayerSdk): void {
  const { FeatureLayer, reactiveUtils } = sdk;
  const layers: FeatureLayer[] = [];

  for (const definition of this.definitions) {
    const prefs = this.prefs.get(definition.id);
    if (!prefs) continue;

    const layer = new FeatureLayer({
      ...definition.properties,
      id: definition.id,
      title: definition.title,
      visible: prefs.visible,
      opacity: prefs.opacity,
    });
    // …watchers, see below
  }

  map.addMany(layers);
}
```

Note the SDK arrives as an argument. The engine already loads `FeatureLayer` and `reactiveUtils` with dynamic imports inside `attach` (Part 1, decision 1); passing them down means `LayerRegistry.ts` has **no runtime import from `@arcgis/core` at all** — only types, which are erased. That's what makes it testable in plain Node, which we'll cash in at the end of this post.

### The rule: watch the layer, not your own command

This is the fix for failure mode 1, and it's three watchers per layer:

```ts
this.handles.push(
  reactiveUtils.watch(
    () => layer.visible,
    (visible) => {
      prefs.visible = visible;
      this.reconcile();
    },
  ),
  reactiveUtils.watch(
    () => layer.opacity,
    (opacity) => {
      prefs.opacity = opacity;
      this.reconcile();
    },
  ),
  reactiveUtils.watch(
    () => layer.loadStatus,
    (status) => {
      const runtime = this.runtime.get(definition.id);
      if (!runtime) return;
      runtime.status = status;
      runtime.error = status === "failed" ? (layer.loadError?.message ?? "Unknown error") : null;
      this.reconcile();
    },
    { initial: true },
  ),
);
```

The command side is deliberately dumb:

```ts
setVisible(id: string, visible: boolean): void {
  const prefs = this.prefs.get(id);
  if (!prefs || prefs.visible === visible) return;

  prefs.visible = visible;
  const runtime = this.runtime.get(id);
  if (runtime) runtime.layer.visible = visible;
  this.reconcile();
}
```

It writes to the layer and lets the watcher do the publishing. Anything else that changes `layer.visible` — SDK internals, a popup action, Part 4's selection code, a colleague's stray line in a debugging session — takes exactly the same path into the snapshot. The panel physically cannot disagree with the map, because there is only one road.

The `prefs.visible === visible` early return isn't just an optimisation; it's what makes `setAllVisible` and `isolate` cheap. `isolate` calls `setVisible` for every layer, and the untouched ones bail out before doing any work.

`{ initial: true }` on the `loadStatus` watcher matters more than it looks. Watchers don't fire for the value a property already has, and a layer can reach `loaded` before we finish wiring up — without `initial`, the row sits at "not-loaded" forever.

### Loading on purpose

```ts
// Load explicitly instead of waiting for the view to get around to it:
// a layer that is switched off would otherwise sit at "not-loaded" and a
// broken service would never report itself.
for (const layer of layers) {
  layer.load().catch(() => {});
}
```

A layer the user has switched off may never be loaded by the view — reasonable of the view, unhelpful for us, because "is this service alive?" is a question the panel wants to answer for every row, not just the visible ones. The empty `catch` looks careless and isn't: the `loadStatus` watcher is what turns the failure into UI. This line exists purely so a failed load doesn't surface as an unhandled promise rejection.

## Step 3: Structural sharing, or why identity is the whole game

Now failure mode 3. React's rule for `useSyncExternalStore` is simple: it calls `getSnapshot()`, compares the result to the previous one with `Object.is`, and re-renders if they differ. So the question "does the layer panel re-render when the camera moves?" is entirely a question about **object identity**.

The engine publishes a new snapshot object on every change — that's Part 1's `patch`, and it's correct. But a spread copies references, so `snapshot.layers` survives untouched:

```ts
private patch(partial: Partial<EngineSnapshot>): void {
  this.snapshot = { ...this.snapshot, ...partial };
  this.emitter.emit("change", this.snapshot);
}
```

Which means a component that selects _just that field_ can sit out the camera churn entirely:

```tsx
export function useEngineSelector<T>(select: (snapshot: EngineSnapshot) => T): T {
  const engine = useMapEngine();
  const read = () => select(engine.getSnapshot());
  return useSyncExternalStore(engine.subscribe, read, read);
}
```

Eight lines, and it comes with one rule you must not break:

> **The selector must return a referentially stable value.**

Write `useEngineSelector((s) => s.layers.filter((l) => l.visible))` and you get a fresh array on every call, so `Object.is` is always false, so React re-reads, and re-reads, and eventually gives up with _"The result of getSnapshot should be cached to avoid an infinite loop."_ The selector reaches for a field; it never builds a collection. The caching belongs on the engine side — which brings us to the interesting half.

### `reconcile`

Producing `LayerState[]` fresh on every change would defeat the whole thing: a new array every time means a new identity every time. So the registry computes the new rows, then puts back the old objects wherever nothing changed:

```ts
private reconcile(): void {
  const previous = this.states;
  const next = this.computeStates();

  let changed = next.length !== previous.length;
  for (let index = 0; index < next.length; index++) {
    const before = previous[index];
    if (before && isUnchanged(before, next[index])) {
      next[index] = before;
    } else {
      changed = true;
    }
  }

  if (!changed) return;
  this.states = next;
  this.notify();
}

/** Only these five fields can change; the rest come straight from the config. */
function isUnchanged(a: LayerState, b: LayerState): boolean {
  return (
    a.visible === b.visible &&
    a.opacity === b.opacity &&
    a.status === b.status &&
    a.error === b.error &&
    a.inScaleRange === b.inScaleRange
  );
}
```

Two levels of sharing, and both pay:

- **Nothing changed** → `notify()` is never called, so the engine never patches the snapshot, so React never hears about it. This is what makes the high-frequency watchers in the next section free.
- **One row changed** → the array is new (the panel re-renders) but the other rows are the _same objects_, so `memo` on the row component means only the row that actually changed re-renders.

That second one is why `LayerRow` is wrapped in `memo`:

```tsx
const LayerRow = memo(function LayerRow({ layer }: { layer: LayerState }) {
  /* … */
});
```

`memo` is usually cargo cult — it compares props that were freshly allocated anyway and never skips anything. Here the producer guarantees stable props, so it does real work. Memoisation without a stable producer is just a slower render.

## Step 4: Scale ranges, or "it's on but I can't see it"

Points turn to mush when you zoom out, so trailheads get a scale limit:

```ts
// Zoom 11 ≈ 1:288,895 and zoom 10 ≈ 1:577,791, so 400,000 sits
// comfortably between them: on at the initial camera, off after one
// zoom out.
minScale: 400_000,
```

ArcGIS scale ranges read backwards until they click: **`minScale` is the smallest scale number the layer draws at** — that is, the most zoomed _out_ — and `0` means "no limit" at either end. Web Mercator scale at zoom _z_ is roughly `591,657,527 / 2^z`, hence the numbers above.

The UX problem this creates is worse than the rendering problem it solves: the toggle says on, the map shows nothing, and the user concludes your app is broken. So `inScaleRange` is part of every row, and the panel says so out loud:

```tsx
) : outOfRange ? (
  <p className="mt-0.5 flex items-center gap-x-1.5 text-xs text-amber-600">
    Hidden at this zoom
    <button type="button" onClick={() => engine.zoomToLayerScale(layer.id)}>
      Zoom in
    </button>
  </p>
) : (
```

Now the granularity question. `view.scale` changes _continuously_ while zooming — dozens of updates per gesture. Part 1's lesson was to watch `view.stationary` instead of `view.center` for exactly this reason, but here we can do better than throttling, because the thing React cares about is a boolean:

```ts
reactiveUtils.watch(
  () => view.scale,
  (scale) => this.registry.setScale(scale),
  { initial: true },
),
```

Every one of those calls hits `reconcile`, and `reconcile` compares the _derived_ values. Scale moving from 250,000 to 260,000 changes nothing anyone can observe, so no row changes, so nothing is published and React does no work at all. Crossing 400,000 changes one boolean on one row, and exactly one render happens.

That's the general principle, and it's more useful than any debounce: **publish derived state, not raw state, and let the derivation decide when anyone needs to know.** A debounce delays the noise; deriving first deletes it.

One number worth choosing carefully: the threshold. I first set `minScale: 300_000`, which is only ~4% away from the initial camera's 1:288,895 — close enough that the layer sat right on the boundary, and the first small zoom flicked it in and out. Pick a threshold that lands between two zoom levels, not next to the one you start on.

## Step 5: One dead service shouldn't kill the map

Part 1's error handling is all-or-nothing: anything thrown inside `attach` sets `status: "error"` and replaces the map with an error card. That's right for "the SDK failed to load" and much too aggressive for "one of five feature services is having a bad day" — which, if you've shipped a map against services you don't control, is a Tuesday.

Per-layer status makes the failure local. `status` and `error` live on the row, the switch disables itself, and the rest of the map carries on:

```tsx
{failed ? (
  <p className="mt-0.5 text-xs break-words text-red-600">
    Failed to load — {layer.error}
  </p>
) : /* … */}
```

I got to test this for free, because the machine I built this on couldn't reach `services3.arcgis.com` at all. Every row reported itself and nothing else broke:

```
ROW: "Trailheads | Failed to load — Failed to fetch"   switch disabled: true
ROW: "Trails | Failed to load — Failed to fetch"       switch disabled: true
ROW: "Parks & open space | Failed to load — Failed to fetch"  switch disabled: true
```

Three dead layers, a live app, and an error message per row instead of a modal covering the map. Whether a failed layer's toggle _should_ be disabled is a genuine judgement call — I disable it because toggling a layer that will never draw is a lie — but keep the message: the failure belongs on the row it happened to.

## Step 6: The panel — Preline, and two bugs on the way

The slide-over is a Preline overlay, driven entirely by data attributes:

```tsx
<aside
  id={LAYER_PANEL_ID}
  className="hs-overlay hs-overlay-open:translate-x-0 fixed start-0 top-0 z-60 hidden h-full
             w-full max-w-sm -translate-x-full transform border-e border-gray-200 bg-white
             transition-all duration-300 [--overlay-backdrop:false]"
  tabIndex={-1}
  aria-labelledby="layer-panel-title"
>
```

and opened from anywhere by a button carrying `data-hs-overlay="#layer-panel"`. No `useState` for open/closed, no state to get out of sync with the DOM, and Escape-to-close and focus handling come with the plugin.

`[--overlay-backdrop:false]` is Preline reading a CSS custom property off the element (its overlay plugin looks up `--overlay-backdrop` and skips building a backdrop when it's `false`). A dimmed backdrop would defeat the point of the panel, which is watching layers appear and disappear on the map while you toggle them.

### The linter was right about `role="dialog"`

I wrote the panel as `<div role="dialog">`, copying the shape of every Preline overlay example. oxlint's jsx-a11y plugin objected — `prefer-tag-over-role`, use the semantic element — and my first instinct was to silence it, since `<dialog>` and a Preline-controlled overlay do not mix (native `<dialog>` is `display:none` without the `open` _attribute_; Preline toggles an `open` _class_).

Then I checked what Preline actually keys off, which took one grep: the `hs-overlay` class and `data-hs-overlay` triggers. Nothing in the plugin reads `role`. And once you notice there's no backdrop and nothing behind the panel is blocked, the honest conclusion is that this isn't a dialog at all — it's a complementary side panel. `<aside aria-labelledby>` is both more accurate and lint-clean. The linter wasn't complaining about the tag; it was complaining that I'd claimed modal semantics I didn't implement.

### The switch that rendered 0×0

The visibility toggle is a checkbox with two spans — the classic Tailwind switch:

```tsx
<label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer items-center …">
  <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
  <span className="block h-5 w-9 rounded-full bg-gray-300 peer-checked:bg-emerald-600 …" />
  <span
    className="pointer-events-none absolute start-0.5 size-4 rounded-full bg-white
                   peer-checked:translate-x-4 …"
  />
</label>
```

The `block` on the track is load-bearing, and I shipped it without. A `<span>` is `display: inline`, and **width and height do not apply to non-replaced inline boxes** — so `h-5 w-9` did nothing, the track rendered at 0×0, and the switch was invisible. The row still had a hit target (the label), the checkbox still worked with a keyboard, and the panel looked like it had a blank column.

What's interesting is how it was caught. It's invisible to TypeScript, invisible to the linter, invisible in a snapshot test, and easy to miss in a screenshot you're not staring at. It fell out of driving the panel with a real browser: the click failed with `element is not visible`, and the diagnostic said everything:

```
label styles: { display: 'flex', visibility: 'visible', w: 0, h: 0 }
```

The knob span escaped the same bug by accident — `absolute` blockifies an element, so `size-4` applied. Two spans, same class of mistake, one victim.

### The rest of the row

Rows come from the selector, defined at module scope so the "return a field, not a collection" rule is visible:

```tsx
const selectLayers = (snapshot: EngineSnapshot) => snapshot.layers;
```

Grouping and reversal happen inside the render, where they're free:

```tsx
// `toReversed` copies — reversing the snapshot array in place would mutate
// state React is holding.
const topDown = layers.toReversed();
```

`toReversed` instead of `[...layers].reverse()` is oxlint's `unicorn/no-array-reverse` rule, and it's worth taking seriously here rather than anywhere else: `reverse()` mutates, and the array it would be mutating is a snapshot React is holding. The spread makes it safe; `toReversed` makes it obviously safe.

The opacity slider writes straight through on every change:

```tsx
onChange={(event) => engine.setLayerOpacity(layer.id, event.currentTarget.valueAsNumber)}
```

No debounce, deliberately. Dragging it produces a render per step, but the only subscriber that re-renders is the panel — the map redraws on the SDK's own schedule, and every other component is either selecting a different field or memoised behind an unchanged row. The architecture is what makes the naive version fine.

The layers button gets the cheapest subscription in the app:

```tsx
const selectVisibleCount = (snapshot: EngineSnapshot) =>
  snapshot.layers.reduce((count, layer) => count + (layer.visible ? 1 : 0), 0);
```

It returns a _number_. `Object.is(3, 3)` is true, so panning, zooming, changing the basemap and dragging an opacity slider all leave it alone; it re-renders when a layer is switched on or off, and at no other time.

## The Preline race nobody mentions

Part 1 covered Preline's re-init problem on App Router navigation: the plugin scans the DOM once, so anything rendered later is inert, and `PrelineLoader` fixes it by re-running `autoInit()` on every route change. Part 2 hit the same problem from the other end, and it's worth its own warning.

Driving the app in a headless browser, the very first thing I did was click the Layers button and read the panel. The panel never opened. Its class list explained why:

```
hs-overlay … hidden -translate-x-full …          ← no `open`, no `opened`
```

`PrelineLoader` does `await import("preline")` inside an effect. Until that dynamic import resolves and `autoInit()` runs, **`data-hs-overlay` buttons are ordinary buttons** — they render, they focus, they highlight on hover, and they do nothing. Wait for `window.HSStaticMethods` to exist and the same click works perfectly:

```
panel classes: … [--overlay-backdrop:false] open opened
label box: { x: 16, y: 193.5, width: 36, height: 20 }
```

For a real user this is a few hundred milliseconds on a cold load, and a second click fixes it — which is exactly why it never shows up in bug reports and always shows up in automated tests. Know which trade you're making:

- **Keep Preline** (what this repo does): free focus management, Escape-to-close, backdrop control, and one keystroke of markup — at the cost of a short window after first paint where triggers are inert.
- **Control the panel from React**: no race, at the cost of writing Escape handling, focus return, and the open/close transition yourself, plus a piece of state that duplicates what the DOM already knows.

If you take the second route for a panel like this, take it for the _whole_ panel — half-Preline, half-React overlays are the worst of both.

## Testing the registry in plain Node

Part 1 claimed the engine "could be published as a framework-agnostic package tomorrow" and that you can "unit-test it in Node without a DOM". Part 2 is where that claim gets cashed, because `LayerRegistry` is the first piece with enough logic to be worth testing — and it imports nothing from `@arcgis/core` at runtime.

No test framework, no bundler, no jsdom. Node 22's built-in runner plus type stripping:

```json
"test": "node --experimental-strip-types --test \"src/**/*.test.mts\""
```

The fake SDK is about forty lines: a `FakeFeatureLayer` whose properties are plain fields, and a `reactiveUtils.watch` that records `(read, callback)` pairs and re-reads them when the test says to flush. That's all `reactiveUtils` _is_, from the registry's point of view.

The nine tests are the specification for everything above:

| Test                                                         | What it pins down                                                         |
| ------------------------------------------------------------ | ------------------------------------------------------------------------- |
| initial states come from the config before any SDK exists    | The snapshot is meaningful before `attach` — which is what makes SSR work |
| toggling writes through to the live layer and publishes once | Commands reach the SDK; exactly one publish                               |
| setting the same value publishes nothing                     | The early return, and array identity survives                             |
| unchanged rows keep object identity                          | Structural sharing — the `memo` guarantee                                 |
| scale changes only publish when a layer crosses its range    | Derived-state granularity                                                 |
| the user's choices survive teardown and rebuild              | The prefs/runtime split, i.e. Strict Mode safety                          |
| external mutation of a layer flows back into the snapshot    | "Watch the layer, not your own command"                                   |
| isolate shows exactly one layer                              | —                                                                         |
| load failure lands on the row, not on the app                | Per-layer error handling                                                  |

The identity test is the one I'd keep if I could only keep one, because it's the assertion nobody writes and everybody breaks:

```ts
const before = registry.getStates();
registry.setVisible("trails", false);
const after = registry.getStates();

assert.notEqual(row(before, "trails"), row(after, "trails"), "changed row is a new object");
assert.equal(row(before, "parks"), row(after, "parks"), "untouched row is the SAME object");
```

Six months from now, someone adds a field to `LayerState`, forgets to add it to `isUnchanged`, and this test goes red before the panel starts re-rendering on every pan for reasons nobody can reproduce. That's the entire value of testing a producer of immutable state: the performance property becomes an assertion instead of a rumour.

Note what this suite does _not_ need: no browser, no network, no map. `npm test` runs in about 200 ms. The boundary Part 1 drew is what buys that, and a test suite that runs this fast is a test suite people actually run.

---

## What we have, and what's next

At the end of Part 2:

- Three feature layers, grouped, ordered, and configured as data — `LayerDefinition` keeps app metadata and SDK properties apart, and one colour constant feeds both the renderer and the legend
- A `LayerRegistry` behind the engine facade, splitting **the user's intent** from **the SDK's current state**, so a Strict Mode remount rebuilds the layers without resetting the panel
- One road into the snapshot: watchers on the layers themselves, so the panel cannot disagree with the map no matter who changed what
- Structural sharing in `reconcile` plus a `useEngineSelector` hook, so panning the map re-renders nothing, toggling one layer re-renders one row, and the layers badge re-renders only when a count changes
- Scale-range awareness, including telling the user when a layer is on but not drawn — and doing it without a render per zoom frame
- Per-layer load failures that stay on their row instead of killing the map
- A Preline slide-over with toggles, opacity, isolate and zoom-to, built with `<aside>` semantics the linter agrees with
- Nine tests that run in plain Node in 200 ms and pin down the identity guarantees

In **Part 3**, search arrives, and with it the first async user-facing work in the series: searching layers, searching features across a service, and geocoding — three different data sources behind one Preline combobox. That means debouncing, cancellation, and caching, which is where **TanStack Query** enters the stack and where we have to answer an uncomfortable question: what happens to the "React only reads snapshots" rule when React owns state the engine knows nothing about? See you there.

_The full source for this part is tagged [`part-2`](https://github.com/rabira-hierpa/rearc/tree/part-2). Found a problem or have a better pattern? Open an issue — this series is as much a lab notebook as a tutorial._
