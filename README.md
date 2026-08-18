# ReArc

A Google-Maps-style transport network analysis app, built as a blog series on
[rz-codes.com](https://blog.rz-codes.com). This is the companion repo — each
part of the series is a tagged milestone you can check out and run.

**Stack:** [Next.js 16](https://nextjs.org) · [React 19](https://react.dev) ·
[ArcGIS Maps SDK for JavaScript 5](https://developers.arcgis.com/javascript/latest/) ·
[Tailwind CSS v4](https://tailwindcss.com) · [Preline UI](https://preline.co) ·
[oxlint + oxfmt](https://oxc.rs)

## Quick start

```bash
git clone https://github.com/rabira-hierpa/rearc.git
cd rearc
npm install
npm run dev
```

Open <http://localhost:3000>. No ArcGIS account or API key is needed — Parts 1–2
use public Esri sample services. (An optional key slot exists in
`.env.example` for the premium services used from Part 3 onwards.)

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
│  SearchBar · MapControls · BasemapToggle · LayerPanel   │
└──────────────┬────────────────────────▲─────────────────┘
     commands  │                        │  snapshots (immutable)
┌──────────────▼────────────────────────┴─────────────────┐
│  MapEngine (imperative core — zero React imports)       │
│  owns: MapView · reactiveUtils watchers                 │
│  emits: "change" → new EngineSnapshot                   │
│    └─ LayerRegistry — live layers ⇄ immutable rows      │
│       prefs (user intent, survives remount)             │
│       runtime (live layers, rebuilt on attach)          │
└──────────────────────────────────────────────────────────┘
```

## Project layout

```
src/
  lib/map/            The framework-free core
    MapEngine.ts        View lifecycle, commands, snapshot publishing
    LayerRegistry.ts    Live layers ⇄ immutable rows, structural sharing
    LayerRegistry.test.mts  Runs in plain Node — no DOM, no network
    emitter.ts          Typed event emitter (the useSyncExternalStore contract)
    config.ts           Basemaps, initial camera, layer definitions
    types.ts            EngineSnapshot and friends
  components/
    map/                The React ↔ engine bridge
      MapProvider.tsx     Context + useMapEngine + useEngineSnapshot/Selector
      MapCanvas.tsx       The one place React hands the engine a DOM node
    shell/              Google-Maps-style chrome (Preline + Tailwind)
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
| 2    | Layer registry & toggling                              | ✅ this code |
| 3    | Search: layers, features, geocoding (+ TanStack Query) | soon         |
| 4    | Highlight & selection                                  | soon         |
| 5    | Filtering: definition expressions & client-side        | soon         |
| 6    | Mass edit with a Command stack (undo/redo)             | soon         |
| 7    | Reports (+ GraphQL)                                    | soon         |
| 8    | Network analysis on the Addis Ababa transit network    | soon         |

## License

[MIT](LICENSE). Map data in Parts 1–2 comes from Esri's public sample services
and is subject to Esri's terms of use.
