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

Open <http://localhost:3000>. No ArcGIS account or API key is needed — Part 1
uses a public Esri sample service. (An optional key slot exists in
`.env.example` for the premium services used from Part 3 onwards.)

## The architecture in one paragraph

Everything imperative, mutable, and event-driven — the `MapView`, layers,
watchers, and (later) selections and highlights — lives in a plain TypeScript
class, [`MapEngine`](src/lib/map/MapEngine.ts), which never imports React.
React holds a single stable reference to the engine in context and reads
immutable state snapshots through `useSyncExternalStore`. The two worlds meet
in exactly one place: [`MapCanvas`](src/components/map/MapCanvas.tsx) hands the
engine a DOM node in an effect. No ArcGIS object ever enters React state, so
there are no re-render storms and no stale closures over live views.

```
┌─ React (declarative, thin) ─────────────────────────────┐
│  MapProvider ── context: engine instance (never changes)│
│  useEngineSnapshot() ── useSyncExternalStore            │
│  SearchBar · MapControls · BasemapToggle · CameraReadout│
└──────────────┬────────────────────────▲─────────────────┘
     commands  │                        │  snapshots (immutable)
┌──────────────▼────────────────────────┴─────────────────┐
│  MapEngine (imperative core — zero React imports)       │
│  owns: MapView · layers · reactiveUtils watchers        │
│  emits: "change" → new EngineSnapshot                   │
└──────────────────────────────────────────────────────────┘
```

## Project layout

```
src/
  lib/map/            The framework-free core
    MapEngine.ts        View lifecycle, commands, snapshot publishing
    emitter.ts          Typed event emitter (the useSyncExternalStore contract)
    config.ts           Basemaps, initial camera, layer definitions
    types.ts            EngineSnapshot and friends
  components/
    map/                The React ↔ engine bridge
      MapProvider.tsx     Context + useMapEngine + useEngineSnapshot
      MapCanvas.tsx       The one place React hands the engine a DOM node
    shell/              Google-Maps-style chrome (Preline + Tailwind)
    preline/            Preline re-init on App Router navigation
  app/                  Next.js App Router entry
```

## Scripts

| Command             | What it does            |
| ------------------- | ----------------------- |
| `npm run dev`       | Dev server (Turbopack)  |
| `npm run build`     | Production build        |
| `npm run lint`      | oxlint                  |
| `npm run fmt`       | oxfmt (writes in place) |
| `npm run typecheck` | `tsc --noEmit`          |

## The series

| Part | Topic                                                  | Status       |
| ---- | ------------------------------------------------------ | ------------ |
| 1    | Foundations — the hybrid pattern, a map on screen      | ✅ this code |
| 2    | Layer registry & toggling                              | soon         |
| 3    | Search: layers, features, geocoding (+ TanStack Query) | soon         |
| 4    | Highlight & selection                                  | soon         |
| 5    | Filtering: definition expressions & client-side        | soon         |
| 6    | Mass edit with a Command stack (undo/redo)             | soon         |
| 7    | Reports (+ GraphQL)                                    | soon         |
| 8    | Network analysis on the Addis Ababa transit network    | soon         |

## License

[MIT](LICENSE). Map data in Part 1 comes from Esri's public sample services
and is subject to Esri's terms of use.
