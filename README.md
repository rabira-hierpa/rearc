# ReArc

A Google-Maps-style transport network analysis app, built as a blog series on
[rz-codes.com](https://blog.rz-codes.com). This is the companion repo — each
part of the series is a tagged milestone you can check out and run.

**Stack:** [Next.js 16](https://nextjs.org) · [React 19](https://react.dev) ·
[ArcGIS Maps SDK for JavaScript 5](https://developers.arcgis.com/javascript/latest/) ·
[Tailwind CSS v4](https://tailwindcss.com) · [Preline UI](https://preline.co) ·
[TanStack Query](https://tanstack.com/query/latest) · [oxlint + oxfmt](https://oxc.rs)

## Quick start

```bash
git clone https://github.com/rabira-hierpa/rearc.git
cd rearc
npm install
npm run dev
```

Open <http://localhost:3000>. No ArcGIS account or API key is needed — the app
runs on public Esri sample services. One feature is key-gated: **place search**
(geocoding) is a paid Esri service, so it is skipped unless you copy
`.env.example` to `.env.local` and set `NEXT_PUBLIC_ARCGIS_API_KEY`. Layer and
feature search work without it.

## The architecture in one paragraph

Everything imperative, mutable, and event-driven — the `MapView`, layers,
watchers, and (later) selections and highlights — lives in a plain TypeScript
class, [`MapEngine`](src/lib/map/MapEngine.ts), delegating layer work to
[`LayerRegistry`](src/lib/map/LayerRegistry.ts). Neither imports React.
React holds a single stable reference to the engine in context and reads
immutable state snapshots through `useSyncExternalStore`. The two worlds meet
in exactly one place: [`MapCanvas`](src/components/map/MapCanvas.tsx) hands the
engine a DOM node in an effect. No ArcGIS object ever enters React state, so
there are no re-render storms and no stale closures over live views.

```
┌─ React (declarative, thin) ─────────────────────────────┐
│  MapProvider ── context: engine instance (never changes)│
│  useEngineSnapshot() ── whole snapshot                  │
│  useEngineSelector() ── one slice (LayerPanel uses this)│
│  TanStack Query ── the search candidate list (async)    │
│  SearchBar · MapControls · BasemapToggle · LayerPanel   │
└──────────────┬────────────────────────▲─────────────────┘
     commands  │                        │  snapshots (immutable)
┌──────────────▼────────────────────────┴─────────────────┐
│  MapEngine (imperative core — zero React imports)       │
│  owns: MapView · reactiveUtils watchers · search pin    │
│  emits: "change" → new EngineSnapshot                   │
│    ├─ LayerRegistry — live layers ⇄ immutable rows      │
│    │  prefs (user intent, survives remount)             │
│    │  runtime (live layers, rebuilt on attach)          │
│    └─ SearchService — layers · features · places        │
└──────────────────────────────────────────────────────────┘
```

State lives on one side or the other by a single test: **if two components
would disagree when it changes, it belongs in the snapshot; if only the asker
cares, it belongs to the asker.** The search term, the open dropdown and the
candidate list are React's. The result you commit to is the engine's.

## Project layout

```
src/
  lib/map/            The framework-free core
    MapEngine.ts        View lifecycle, commands, snapshot publishing
    LayerRegistry.ts    Live layers ⇄ immutable rows, structural sharing
    SearchService.ts    Strategy fan-out: layers, features, geocoded places
    *.test.mts          Run in plain Node — no DOM, no network, no map
    emitter.ts          Typed event emitter (the useSyncExternalStore contract)
    config.ts           Basemaps, initial camera, layer definitions
    types.ts            EngineSnapshot and friends
  components/
    map/                The React ↔ engine bridge
      MapProvider.tsx     Context + useMapEngine + useEngineSnapshot/Selector
      MapCanvas.tsx       The one place React hands the engine a DOM node
    providers/          QueryProvider (TanStack Query client)
    shell/              Google-Maps-style chrome (Preline + Tailwind)
      SearchBar.tsx       APG combobox: debounce, cancellation, grouped results
      AppMenu.tsx         Server component, passed through SearchBar as a prop
      LayerPanel.tsx      Preline slide-over: toggles, opacity, isolate
    preline/            Preline re-init on App Router navigation
  app/                  Next.js App Router entry
```

## Scripts

| Command             | What it does                        |
| ------------------- | ----------------------------------- |
| `npm run dev`       | Dev server (Turbopack)              |
| `npm run build`     | Production build                    |
| `npm test`          | Node test runner (needs Node 22.6+) |
| `npm run lint`      | oxlint                              |
| `npm run fmt`       | oxfmt (writes in place)             |
| `npm run typecheck` | `tsc --noEmit`                      |

## The series

| Part | Topic                                                  | Status       |
| ---- | ------------------------------------------------------ | ------------ |
| 1    | Foundations — the hybrid pattern, a map on screen      | ✅ done      |
| 2    | Layer registry & toggling                              | ✅ done      |
| 3    | Search: layers, features, geocoding (+ TanStack Query) | ✅ this code |
| 4    | Highlight & selection                                  | soon         |
| 5    | Filtering: definition expressions & client-side        | soon         |
| 6    | Mass edit with a Command stack (undo/redo)             | soon         |
| 7    | Reports (+ GraphQL)                                    | soon         |
| 8    | Network analysis on the Addis Ababa transit network    | soon         |

## License

[MIT](LICENSE). Map data comes from Esri's public sample services and is
subject to Esri's terms of use; place search uses Esri's World Geocoding
Service under your own API key.
