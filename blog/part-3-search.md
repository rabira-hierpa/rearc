# Getting Started with Web Maps: ArcGIS Maps SDK 5, Next.js 16, Tailwind v4 and Preline — Part 3: Search

> This is Part 3 of a series building a **transport network analysis app with the UI/UX of Google Maps**. [Part 1](https://blog.rz-codes.com/) built the engine and the React boundary; [Part 2](https://blog.rz-codes.com/) added the layer registry and the panel.
>
> This part adds **search across three completely different sources** — the layers themselves, features in the services, and geocoded places — behind one combobox, with **TanStack Query** doing the debouncing, cancellation and caching. It also answers the question Part 2 ended on: what happens to "React only reads snapshots" when React owns state the engine knows nothing about?
>
> All code is on GitHub: [github.com/rabira-hierpa/rearc](https://github.com/rabira-hierpa/rearc), tagged [`part-3`](https://github.com/rabira-hierpa/rearc/tree/part-3).

## The uncomfortable question

Two parts of this series have been built on one rule: **anything imperative, mutable or event-driven lives in a plain TypeScript class, and React only reads immutable snapshots.** It has paid for itself twice — no re-render storms when the camera moves, no layer panel disagreeing with the map.

Search breaks the symmetry. A search box has state the engine has no business knowing: what you have half-typed, whether the dropdown is open, which row the arrow keys are on, whether the last request is still in flight. Push all of that into the snapshot and the engine becomes a React store with a map attached. Keep all of it in React and you have to ask what happens when you _pick_ a result — because that moves the camera, which is the engine's job.

So the rule needs a second half, and it turns out to be a question you can ask about any piece of state:

> **If two components would disagree when it changes, it belongs in the snapshot. If only the asker cares, it belongs to the asker.**

Run the search box through that test:

| State                         | Who else cares?                                       | Where it lives              |
| ----------------------------- | ----------------------------------------------------- | --------------------------- |
| The term you're typing        | Nobody                                                | `useState` in the component |
| Whether the dropdown is open  | Nobody                                                | `useState`                  |
| The active row for arrow keys | Nobody                                                | `useState`                  |
| The candidate list            | Nobody — it's a question, not an answer               | TanStack Query cache        |
| **The result you commit to**  | The map, the marker, any future "what's selected?" UI | **The engine snapshot**     |

That last row is the whole design. The engine exposes search as a _plain async function_, not as snapshot state, and only the committed result crosses back into the snapshot as a `pin`. Everything above the line is a view concern, and view concerns belong to the view.

## Step 1: The contract

```ts
// MapEngine
search(term: string, signal?: AbortSignal): Promise<SearchResponse> {
  return this.searchService.search(term, signal);
}
```

One method, no state. This is the part that surprised me when I wrote it, because the obvious design — `engine.setSearchTerm(term)`, results arrive in the snapshot — is what every "put it in the store" instinct reaches for. Three things go wrong with it:

1. **Two search boxes.** The moment anything else searches (a "find a stop near here" panel in Part 8, say) two components are fighting over one slot in the snapshot.
2. **Cancellation becomes your problem.** With a promise, the caller already has the handle — TanStack Query aborts it for you. With snapshot state you're writing your own request-id bookkeeping to discard stale responses.
3. **Caching becomes your problem.** The snapshot holds one value: the latest. Backspacing from "trailhead" to "trail" would re-run a search you ran four keystrokes ago.

Returning a promise hands all three to a library whose entire job is those three things.

Note what the response carries:

```ts
export interface SearchResponse {
  results: readonly SearchResult[];
  failures: readonly SearchFailure[];
}
```

Both, not either. That shape comes straight from Part 2's per-layer failure handling: a geocoder that is down is not a search that failed.

## Step 2: Three sources, one interface

Part 1's table promised Strategy would show up for search, and here it is:

```ts
export interface SearchSource {
  readonly kind: SearchResultKind;
  search(term: string, context: SearchContext): Promise<SearchResult[]>;
}
```

Three implementations, which have almost nothing in common:

- **`LayerSearchSource`** filters the config in memory. No network, no await that matters. It is why the dropdown has something in it before the first keystroke reaches a server.
- **`FeatureSearchSource`** fires one `queryFeatures` per loaded layer.
- **`PlaceSearchSource`** calls Esri's World Geocoding Service.

And the fan-out:

```ts
const settled = await Promise.allSettled(
  this.sources.map((source) => source.search(trimmed, context)),
);
```

`allSettled`, not `all` — the distinction is the entire user experience. With `all`, a geocoder returning 403 because the API key is missing would throw away the layer matches sitting in memory. With `allSettled`, each source reports for itself:

```ts
for (const [index, outcome] of settled.entries()) {
  const source = this.sources[index];
  if (outcome.status === "fulfilled") {
    results.push(...outcome.value);
  } else if (!isAbort(outcome.reason)) {
    failures.push({ kind: source.kind, message: toMessage(outcome.reason) });
  }
}
```

The `isAbort` check matters more than it looks. Cancellation is _normal_ here — every keystroke supersedes the last request — so an `AbortError` must not be reported to the user as a broken source. Forget this and your search box spends its life apologising for working correctly.

The same structure repeats one level down, inside the feature source: one layer's service being down must not empty the other layers' matches. Nesting `allSettled` inside `allSettled` feels excessive right up until you watch three services and one of them is having a bad afternoon.

### The sources don't go looking for trouble

```ts
getSearchable(): { definition: LayerDefinition; layer: FeatureLayer }[] {
  // …only layers whose status is "loaded"
}
```

Part 2's registry already tracks per-layer load status, so feature search simply never queries a service it knows is broken. I got to watch this work by blocking the feature services entirely:

```
options with services down: [ 'Trails | Layer' ]
failure notices: []
```

Layer search still answers instantly, and — the part I like — there is no error message, because nothing failed. Nothing was attempted. State you already track is state you don't have to handle twice.

## Step 3: The term is user input, and `where` is SQL

Here is the line that does feature search:

```ts
const featureSet = await layer.queryFeatures(
  { where, outFields, returnGeometry: true, num: context.limit },
  { signal: context.signal },
);
```

And here is where `where` comes from:

```ts
export function buildWhere(fields: readonly string[], term: string): string {
  const literal = term.toUpperCase().replaceAll("'", "''");
  return fields.map((field) => `UPPER(${field}) LIKE '%${literal}%'`).join(" OR ");
}
```

ArcGIS `where` clauses are SQL, evaluated by the service. The term is whatever the user typed. If you have written a web app in the last twenty years you know where this is going, and yet every second ArcGIS search tutorial interpolates the raw term.

Type `O'Brien` into an unescaped version and the single quote closes the string literal, leaving `Brien%'` to be parsed as SQL — at best a 400 from the service, at worst something more interesting on a service that allows more than `SELECT`. Doubling the quote is the standard escape, and it is one `replaceAll`.

It's also the easiest thing in this series to assert:

```ts
const injection = buildWhere(["NAME"], "x' OR '1'='1");
assert.equal(
  injection,
  "UPPER(NAME) LIKE '%X'' OR ''1''=''1%'",
  "every quote is doubled, so the whole term stays one literal",
);
```

Two notes while we're being honest about this clause. `%` and `_` are still LIKE wildcards, so searching for `50%` matches more than you meant — harmless here, worth escaping with an `ESCAPE` clause if your data has literal percent signs. And `UPPER()` on both sides is what makes matching case-insensitive on services that would otherwise compare case-sensitively; it also means the service can't use a plain index on that column, which is fine at sample-data scale and something to revisit at a million rows.

## Step 4: Let the service tell you what to search

Which field do you search? Part 1 pinned down the trailheads schema, so that one is configured:

```ts
searchFields: ["TRL_NAME", "PARK_NAME"],
```

For the other two layers I genuinely don't know the schema — and neither will you, the first time you point this app at a service somebody else published. The fallback is to ask the service:

```ts
export function searchFieldsFor(definition, layer) {
  if (definition.searchable === false) return [];
  if (definition.searchFields?.length) return definition.searchFields;
  return layer.displayField ? [layer.displayField] : [];
}
```

`displayField` is the field the service itself nominates as the human-readable one — it's what the SDK falls back to for popup titles. Using it means a new layer in the config gets working search with no schema archaeology, and a layer with an unusual schema can still override. The observed queries, straight from the network log:

```
UPPER(TRL_NAME) LIKE '%ECHO%' OR UPPER(PARK_NAME) LIKE '%ECHO%'   ← configured
UPPER(NAME) LIKE '%ECHO%'                                          ← displayField
```

A layer with neither returns no fields and is skipped. Not an error — there is simply nothing to search on, and pretending otherwise would mean sending a query that can only fail.

## Step 5: Converting geometry at the boundary

A feature result has to tell the camera where to go. The temptation is to put the `Graphic` — or its `geometry` — on the result object and let the UI hand it back later. That's the same mistake as putting `MapView` in React state, one level down: a live SDK object with a spatial reference, a `clone()` method and opinions.

So results carry numbers:

```ts
export interface SearchTarget {
  center: LonLat;
  /** [west, south, east, north] in degrees, when the result has an extent. */
  extent?: readonly [number, number, number, number];
  scale?: number;
}
```

and the engine converts on the way out. For points the SDK does the work — `Point.longitude` and `Point.latitude` convert from Web Mercator automatically and return `null` for a spatial reference they can't handle:

```ts
function toLonLat(geometry: unknown): LonLat | null {
  const point = asPoint(geometry) ?? asPoint((geometry as { extent?: unknown } | null)?.extent);
  if (!point) return null;
  const { longitude, latitude } = point;
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  …
}
```

Returning `null` is a decision, not a gap: **a result we cannot place is a result we drop.** The alternative — defaulting to 0,0, or shipping raw projected coordinates to a UI that will treat them as degrees — puts a pin in the Atlantic. There's a test for exactly that, because it's the kind of thing a future refactor "fixes" by adding a fallback.

Extents need one more trick. An `Extent` has no `longitude` accessors, but its `center` is a `Point`, which does — so collapsing a clone to one corner gives you that corner as a convertible point:

```ts
function cornerPoint(extent: ExtentLike, corner: "min" | "max"): PointLike | null {
  const clone = extent.clone?.();
  if (!clone) return null;
  if (corner === "min") {
    clone.xmax = clone.xmin;
    clone.ymax = clone.ymin;
  } else {
    clone.xmin = clone.xmax;
    clone.ymin = clone.ymax;
  }
  return clone.center ?? null;
}
```

Slightly cheeky, no dependency on the `projection` module, and it means a trail zooms to its full length instead of to a point in the middle of it. Anything outside WGS84 and Web Mercator needs the real projection engine; no sample service in this series uses one, and saying so beats pretending the two-line version is general.

## Step 6: TanStack Query, and what it actually buys

```tsx
const { data, isFetching, isError, error } = useQuery({
  queryKey: ["search", debouncedTerm.trim().toLowerCase()],
  queryFn: ({ signal }) => engine.search(debouncedTerm, signal),
  enabled,
  placeholderData: keepPreviousData,
});
```

Five lines, four features:

**The key is the term.** Normalised — trimmed and lowercased — so `Echo`, `echo ` and `echo` are one cache entry rather than three.

**`signal` comes from the library.** TanStack Query aborts it when the key changes or the component unmounts, and it flows all the way through `engine.search` into `queryFeatures` and the geocoder. Superseded requests die at the network layer, not in a `if (requestId === latest)` check you wrote by hand.

**`keepPreviousData`** keeps the old list on screen while the next one loads. Without it the dropdown blanks between keystrokes, which reads as flicker.

**`staleTime: 5 * 60_000`** in the provider means backspacing hits the cache. Measured, with every outgoing query logged:

```
queries on repeat search (cached): 0
options on repeat search: 1
```

Zero. The same search a minute later costs nothing.

### Debounce is not `useDeferredValue`

The hook is eight lines:

```ts
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
```

and I want to be precise about why it isn't `useDeferredValue`, because they look interchangeable and aren't. `useDeferredValue` keeps _rendering_ responsive: React finishes the urgent render first and catches up with the deferred value after. It still gives you every value, just later. A search box needs the opposite — values that were superseded should never be used **at all**, because each one costs a request per layer plus a geocode. Only a timer throws values away.

With the dev server logging every outgoing query, typing `echo` one character at a time (faster than the 250 ms window):

```
queries sent while typing 'echo': 3
distinct where: [
  "UPPER(NAME) LIKE '%ECHO%'",
  "UPPER(TRL_NAME) LIKE '%ECHO%' OR UPPER(PARK_NAME) LIKE '%ECHO%'"
]
```

Three requests — one round across three layers — instead of twelve. 250 ms is the number I settled on: long enough that a typed word is one round trip, short enough that the list still feels like it's keeping up.

The debounce also makes `enabled` meaningful. Below `minTermLength` the query never runs, and the service never sees `t` matching half of California.

## Step 7: The combobox, and a linter that's wrong this time

Preline has a combobox plugin. I didn't use it, and the reason is the same one from Part 2's "don't go half-Preline": its combobox initialises from the DOM it finds, and this list is replaced on every keystroke from an async source. Driving a DOM-scanning plugin from React state means two things believing they own the same list.

So the dropdown is the [WAI-ARIA Authoring Practices combobox](https://www.w3.org/WAI/ARIA/apg/patterns/combobox/): a text input with `role="combobox"`, a `listbox` of `option`s, and — the key detail — **focus never leaves the input**. The active row is communicated by `aria-activedescendant`:

```tsx
aria-activedescendant={
  showPanel && results[activeIndex] ? `${listId}-${activeIndex}` : undefined
}
```

Arrow keys move `activeIndex` with a wrap-around, Enter commits, Escape closes. Verified by walking the list in a browser:

```
activedescendant walk: [ '…-1', '…-2', '…-3', '…-0' ]   ← wraps
after ArrowUp: '…-3'
```

Mouse and keyboard have to agree, which takes one unobvious line:

```tsx
// Keep focus in the input so typing never breaks; the click still fires.
onMouseDown={(event) => event.preventDefault()}
```

Without it, pressing the mouse on a result blurs the input, the blur handler closes the dropdown, and the click lands on nothing.

Now the linter. In Part 2, oxlint objected to `role="dialog"` and **was right** — the panel wasn't modal and `<aside>` was the honest element. Here it objects to `role="listbox"` and `role="option"`:

```
jsx-a11y(prefer-tag-over-role): Prefer `datalist, select` over `role` attribute `listbox`
jsx-a11y(click-events-have-key-events): …must have one of `keyup`, `keydown`, or `keypress`
```

and it is wrong on both counts. `<select>` and `<datalist>` cannot render two-line results with icons, cannot be filled from an async query, and cannot be styled; and in this pattern options are _never focused_, so key handlers on them would be dead code — the input owns the keyboard, which is what `aria-activedescendant` means. This is the documented pattern for exactly this widget.

So the rules go off for this file, with the reasoning written down next to them:

```ts
// oxlint-disable jsx-a11y/prefer-tag-over-role
// oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role
// oxlint-disable jsx-a11y/click-events-have-key-events
```

One oxlint quirk worth saving you ten minutes: **one directive per comment.** Three `oxlint-disable` lines inside a single `/* */` block silently suppress only the first. I found that out by writing a three-file probe to isolate it, having stared at an unchanged lint report twice.

The point of the contrast with Part 2 isn't that linters are unreliable. It's that a rule is a heuristic about a situation, and you owe it the five minutes it takes to work out which situation you're in. The grep that settled it — does Preline's overlay read `role`? does this widget focus its options? — took less time than arguing with myself about it.

### The bug the browser found

Part 2's switch rendered 0×0 and only a real browser caught it. This part's equivalent: after pressing **Escape**, clicking the search box did nothing. The input was already focused, so no `focus` event fired, so `open` stayed false — the dropdown was shut and the only way back in was to type.

The fix is one line, and the reason it was missing is that in manual testing you always _type_ after clicking:

```tsx
onFocus={() => setOpen(true)}
// Focus alone isn't enough: after Escape the input is still
// focused, so only a click can ask for the list back.
onClick={() => setOpen(true)}
```

## Step 8: One component stays on the server

Part 1 made a point of the search pill being a server component: Preline's dropdown is driven by data attributes, so the menu shipped zero JavaScript. Part 3 turns the search bar into a client component — it has four pieces of state and a query — and that would normally drag the menu's markup along with it.

It doesn't have to. `page.tsx` is a server component, so it can render the menu and pass it _through_ the client component as a prop:

```tsx
<SearchBar menu={<AppMenu />} />
```

`AppMenu` renders on the server; `SearchBar` receives it as opaque `ReactNode` and drops it into the pill. The rule is that a client component can't _import_ a server component, but it can happily render one it was handed. It's the cheapest win in this post: a component became interactive without making its neighbour interactive too.

## Step 9: Degrading honestly

Geocoding is a paid Esri service and refuses anonymous requests, so place search is the first thing in this series that needs the API key slot `.env.example` has been carrying since Part 1. Without a key, the source doesn't fail — it declines to run:

```ts
// Geocoding is billable and refuses anonymous requests, so without a key
// we skip the source rather than letting every search report an error.
if (!this.deps.hasApiKey) return [];
```

and the dropdown says so once, quietly, instead of showing an error per search:

> Place search needs an ArcGIS API key — set `NEXT_PUBLIC_ARCGIS_API_KEY`.

Three degradation levels, all reachable, none of them a broken app:

| Situation             | What still works                                      |
| --------------------- | ----------------------------------------------------- |
| No API key            | Layers and features; a one-line notice about places   |
| A service is down     | Everything else; a per-source line naming what failed |
| Every service is down | Layer search, instantly, with no error at all         |

That last column is the argument for the in-memory source existing at all. It costs nothing and it means the search box is never dead.

## Testing: 24 tests, still no browser

The suite from Part 2 grew from 9 tests to 24, still on Node's built-in runner, still with no DOM, no network and no map. The new ones divide in two.

**Pure logic**, which needs no fakes at all — the SQL escaping, the field fallback, the `allSettled` behaviour, the abort-isn't-a-failure rule. And **the engine itself**, which turns out to be testable without any SDK:

```ts
test("committing a layer result switches that layer back on", async () => {
  const engine = new MapEngine(MAP_CONFIG);
  engine.setLayerVisible("trails", false);

  await engine.goToResult({
    id: "layer:trails",
    kind: "layer",
    title: "Trails",
    layerId: "trails",
  });

  assert.equal(visible("trails"), true);
  assert.equal(engine.getSnapshot().pin, null, "a layer result pins nothing");
});
```

No `attach`, no view, no map — the camera move is a no-op and the visibility change isn't. That works only because Part 1 insisted the constructor be side-effect-free, so there's now a test asserting that too. The day someone creates a `MapView` in the constructor, server rendering breaks and that test goes red first.

### The Node resolver gotcha

Adding engine tests broke the suite in a way worth writing down:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'/home/user/rearc/src/lib/map/emitter' imported from …/MapEngine.ts
```

Part 2's registry tested fine, because every relative import in it is **type-only** and type-only imports are erased before Node sees them. `MapEngine.ts` has real runtime imports, and Node's ESM resolver — unlike a bundler — wants the extension:

```ts
import { Emitter } from "./emitter.ts";
import { LayerRegistry } from "./LayerRegistry.ts";
```

`allowImportingTsExtensions` (already in `tsconfig.json` since Part 2) makes TypeScript accept it, and Turbopack doesn't care either way. It looks unusual in app code and it is the price of the thing we keep claiming: that this core is plain TypeScript, runnable anywhere, no framework required. A claim you can't run is just a comment.

---

## What we have, and what's next

At the end of Part 3:

- Search across **three sources behind one Strategy interface** — layers in memory, features via `queryFeatures`, places via the World Geocoding Service — merged with `allSettled` so one failure never hides the others' results
- A **rule for where state lives**: the candidate list belongs to whoever asked, the committed result belongs to the snapshot. Search is a promise; the pin is engine state
- **TanStack Query** doing debouncing (250 ms: four keystrokes became one round of three queries), cancellation (the `signal` reaches `queryFeatures`), and caching (a repeated search costs zero requests)
- SQL `where` clauses with **escaped literals**, and a test that says so in the shape of an injection attempt
- Field selection that **asks the service** via `displayField` when you don't control the schema
- Geometry **converted to degrees at the boundary**, with results we can't place dropped rather than faked
- An **APG combobox** with `aria-activedescendant` keyboard navigation, and three lint rules switched off with the reasoning written down
- Honest degradation at three levels, down to "every service is dead and layer search still answers"
- 24 tests in plain Node, now covering the engine itself

In **Part 4**, selection and highlighting: clicking a feature, keeping a selection set that survives panning, and `highlight` handles — which are the most leak-prone objects in the SDK and belong to the engine for exactly that reason. The pin we just built is the one-item version of a problem that gets much more interesting when the user can pick fifty. See you there.

_The full source for this part is tagged [`part-3`](https://github.com/rabira-hierpa/rearc/tree/part-3). Found a problem or have a better pattern? Open an issue — this series is as much a lab notebook as a tutorial._
