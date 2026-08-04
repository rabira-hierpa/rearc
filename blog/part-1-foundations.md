# Getting Started with Web Maps: ArcGIS Maps SDK 5, Next.js 16, Tailwind v4 and Preline — Part 1: Foundations

> This is a ground-up rewrite of my 2025 post ["Getting started with web maps: Next.js 15, React 19 and ArcGIS TypeScript SDK 4.32"](https://blog.rz-codes.com/442/web-dev/getting-started-with-web-maps-next-js-15-react-19-and-arcgis-typescript-sdk-4-32/). Enough has changed in a year that patching the old post would have been dishonest. This is also Part 1 of a new series: we're going to build a **transport network analysis app with the UI/UX of Google Maps** — layer toggling, search, feature highlighting, filtering, mass editing with undo/redo, reports, and finally network analysis on the Addis Ababa transit network.
>
> All code is on GitHub: [github.com/rabira-hierpa/rearc](https://github.com/rabira-hierpa/rearc). Every part of the series is a tagged milestone you can check out and run.

## Why a rewrite? The stack shifted under us

If you followed my old post, here's what moved:

| Then (2025 post)                         | Now (July 2026)                                                                                                                         |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js 15                               | **Next.js 16.2** — Turbopack is the default bundler, explicit caching via Cache Components. Next 15 hits end of support in October 2026 |
| ArcGIS JS SDK 4.32                       | **ArcGIS Maps SDK 5.1** — the SDK now follows semantic versioning                                                                       |
| Prettier + `prettier-plugin-tailwindcss` | **oxfmt** — Prettier-compatible, ~30× faster, Tailwind class sorting and import sorting built in                                        |
| ESLint                                   | **oxlint** — same story, Rust-fast, with React/Next.js/a11y plugins                                                                     |
| Tailwind v3, `tailwind.config.js`        | **Tailwind v4** — CSS-first config, `@source`, no config file                                                                           |
| Hand-rolled UI                           | **Preline UI 4.2** — Tailwind-native components                                                                                         |

One of these changes isn't cosmetic. **As of SDK 5.0, all classic ArcGIS widgets are deprecated and will be removed in 6.0** (expected early 2027). `LayerList`, `Search`, `FeatureTable`, `BasemapGallery` as you knew them are on death row — even the view's `DefaultUI` carries a deprecation notice pointing you at the `arcgis-map` web component. A tutorial series written against widgets today would age out in six months.

That deprecation forces a decision the old post never had to make: either go **web-components-first** (`@arcgis/map-components`) or **core-API-only** (`@arcgis/core`, no Esri UI at all). We're going core-API-only for the map itself, and here's why that's actually good news.

## The architecture: a hybrid OOP/React pattern

### The problem every ArcGIS + React tutorial gets wrong

The ArcGIS Maps SDK is a big, stateful, event-driven, _mutable_ object graph. A `MapView` mutates itself sixty times a second while the user pans. React is the opposite: it wants immutable snapshots and pure renders.

Most tutorials shove the `MapView` into `useState` or a context value and then spend the rest of their lives fighting the consequences: re-render storms when view properties change, stale closures over destroyed views, effects that run twice in Strict Mode and create two maps. If you've ever seen a React ArcGIS app where panning the map makes unrelated components flicker, this is why.

### The rule that fixes it

> **Anything imperative, mutable, or event-driven lives in plain TypeScript classes. React only ever reads immutable snapshots.**

Concretely, the app has two worlds and one bridge:

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

- **The OOP core**: a `MapEngine` class owns the `MapView`, the layers, every `reactiveUtils.watch` handle, and (in later parts) highlight handles and selection sets. It emits events. It never imports React. You can unit-test it in Node without a DOM.
- **The React shell**: context carries only the _engine instance_ — a stable reference that never triggers a re-render. Components subscribe to state slices via **`useSyncExternalStore`**, React's purpose-built hook for exactly this situation: an external, mutable store that React should observe but not own.
- **The bridge**: exactly one component (`MapCanvas`) hands the engine a DOM node inside an effect. That's the only place the two worlds touch.

This isn't just tidiness. Each classic design pattern maps onto a feature we'll build later:

| Pattern               | Where it shows up in this series                                 |
| --------------------- | ---------------------------------------------------------------- |
| **Observer**          | The engine's event bus feeding React (this post)                 |
| **Registry / Facade** | Layer toggling and search (Parts 2–3)                            |
| **Strategy**          | Filter expressions — attribute vs. spatial vs. temporal (Part 5) |
| **Command**           | Mass edit with undo/redo — a `CommandStack` class (Part 6)       |

### Why not Esri's UI, and why not _only_ Preline?

Esri ships the Calcite Design System, and it's good — but build your chrome with it and you get "an Esri viewer", not "Google Maps". Preline gives us Tailwind-native app chrome. The line I draw: **anything the user sees and navigates by is Preline** (search bar, panels, modals, tables); **anything doing heavy map-domain lifting stays Esri** (sketch, editor, print — when we get there). In Part 1, that means the map has _zero_ Esri UI except the legally required attribution.

---

## Step 1: Scaffold the project

You need Node 20.9+ (I'm on 22). Scaffold with the current create-next-app:

```bash
npx create-next-app@latest rearc \
  --ts --tailwind --app --src-dir --turbopack \
  --no-eslint --import-alias "@/*" --use-npm
cd rearc
```

Flags worth explaining:

- `--no-eslint` — deliberate. We're replacing ESLint with oxlint in step 2, so we don't want the ESLint boilerplate.
- `--src-dir` — everything lives under `src/`, which keeps the repo root for config.
- `--turbopack` — the default in Next 16 anyway, but explicit is better. (Remember this flag. There's a whole war story about Turbopack at the end of this post.)

This gives you Next 16.2, React 19.2, and Tailwind v4 — note what it _doesn't_ give you: there's no `tailwind.config.js` anymore. Tailwind v4 is configured from CSS. We'll use that in step 3.

Then the two libraries this series is about:

```bash
npm install @arcgis/core preline
```

At the time of writing that resolves to `@arcgis/core@5.1.12` and `preline@4.2.0`.

## Step 2: Tooling — oxfmt and oxlint instead of Prettier and ESLint

The [Oxc project](https://oxc.rs) rewrote the JS toolchain in Rust. The practical wins for this repo:

- **oxfmt** is Prettier-compatible output-wise, formats this whole repo in ~200ms, and — the killer feature for us — has **Tailwind class sorting built in**. With Prettier you needed `prettier-plugin-tailwindcss`; here it's zero-config.
- **oxlint** ships the important React, Next.js, import, and jsx-a11y rules without the ESLint plugin dependency jungle.

```bash
npm install -D oxfmt oxlint
npx oxfmt --init
```

`.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["typescript", "unicorn", "oxc", "react", "nextjs", "import", "jsx-a11y"],
  "categories": {
    "correctness": "error",
    "suspicious": "warn"
  },
  "rules": {
    "react/react-in-jsx-scope": "off",
    "import/no-unassigned-import": ["warn", { "allow": ["**/*.css"] }]
  },
  "env": { "browser": true, "es2024": true },
  "ignorePatterns": [".next", "node_modules", "next-env.d.ts"]
}
```

Two rule tweaks, both earned the hard way: `react-in-jsx-scope` predates the automatic JSX runtime (React 17+) and just produces noise; and side-effect CSS imports (`import "./globals.css"`) are idiomatic in Next, so we allowlist them.

And the scripts:

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "oxlint",
  "fmt": "oxfmt",
  "fmt:check": "oxfmt --check",
  "typecheck": "tsc --noEmit"
}
```

Fun fact: oxlint actually caught a real thing while I wrote this — it flagged a defensive `[...set]` spread I'd written in the event emitter as useless, and it was right: JavaScript `Set` explicitly tolerates deletion during iteration, so listeners can unsubscribe themselves mid-emit without a copy.

## Step 3: Tailwind v4 + Preline, CSS-first

Tailwind v4 configuration happens in `src/app/globals.css`. Here's ours, annotated:

```css
@import "tailwindcss";
@import "../../node_modules/preline/variants.css";

/* Preline's plugins toggle classes from JS, so Tailwind must scan its dist
   files to know those classes exist. This is the v4 replacement for the old
   `content` array in tailwind.config.js. */
@source "../../node_modules/preline/dist/*.js";

@theme inline {
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
}

html,
body {
  height: 100%;
  overscroll-behavior: none;
}

body {
  font-family: var(--font-sans), system-ui, sans-serif;
}

/* Let our Tailwind font stack flow into ArcGIS-rendered UI (attribution,
   popups) so the seam between the two worlds doesn't show. */
.esri-view {
  font-family: var(--font-sans), system-ui, sans-serif;
}
```

Three things to understand here:

1. **`@source`** tells Tailwind's scanner to also read Preline's compiled JS. Preline's plugins add and remove classes like `hs-dropdown-open:opacity-100` at runtime; if Tailwind never _sees_ those class names in a scanned file, it never generates the CSS for them and your dropdowns silently don't animate.
2. **`variants.css`** registers Preline's custom variants (`hs-dropdown-open:`, etc.) with Tailwind v4's variant system.
3. Conspicuously absent: the ArcGIS theme CSS. The old post imported `@arcgis/core/assets/esri/themes/light/main.css` right here, and the natural 2026 translation of that line nearly killed this project. Full story at the end; the short version is that the theme CSS is loaded as a CDN `<link>` in the layout instead.

### The Preline re-init gotcha

Preline is a JS-plugin library: on load it scans the DOM once and wires up every `data-hs-*` component it finds. The App Router swaps DOM _without page loads_, so anything rendered after that initial scan is inert — your dropdown renders but nothing happens on click. The fix is a tiny client component that re-runs Preline's scanner on every route change:

```tsx
// src/components/preline/PrelineLoader.tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function PrelineLoader() {
  const pathname = usePathname();

  useEffect(() => {
    async function init() {
      await import("preline");
      window.HSStaticMethods.autoInit();
    }
    void init();
  }, [pathname]);

  return null;
}
```

Mount it once at the end of `<body>` in the root layout. Two details: the dynamic `import("preline")` keeps Preline's JS out of the server bundle entirely (it touches `window` at module scope), and keying the effect on `pathname` is what makes it re-run per navigation.

TypeScript doesn't know about `window.HSStaticMethods`, so declare it once:

```ts
// src/types/global.d.ts
interface Window {
  /** Injected by the `preline` module (loaded in PrelineLoader). */
  HSStaticMethods: {
    autoInit(collection?: string | string[]): void;
  };
}
```

## Step 4: The engine — plain TypeScript, zero React

Everything in this section lives in `src/lib/map/` and could be published as a framework-agnostic package tomorrow. That's not an accident; it's the test of whether the boundary is real.

### 4.1 The snapshot contract (`types.ts`)

```ts
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

/**
 * An immutable snapshot of everything React is allowed to know about the map.
 */
export interface EngineSnapshot {
  status: EngineStatus;
  error: string | null;
  basemapId: BasemapId;
  /** Last settled camera position — updated when the view stops moving. */
  camera: CameraState;
}

export interface MapConfig {
  apiKey?: string;
  basemaps: Record<BasemapId, string>;
  initialBasemap: BasemapId;
  initialCamera: CameraState;
  layers: FeatureLayerProperties[];
}
```

`EngineSnapshot` is the entire API surface React gets. No `MapView`, no `FeatureLayer`, no live object ever crosses the line. The engine replaces the snapshot object wholesale on every change, which means React can use _reference equality_ to decide whether to re-render — the cheapest possible check.

Notice the type-only import from `@arcgis/core`. SDK 5 exports proper `FeatureLayerProperties` interfaces (in 4.x you were often stuck with the `__esri` global namespace). Type imports are erased at compile time, so this file costs nothing at runtime.

### 4.2 The observer (`emitter.ts`)

```ts
type Listener<TPayload> = (payload: TPayload) => void;

/**
 * A minimal typed event emitter — the only "framework" the map core depends on.
 * `on` returns an unsubscribe function, which is exactly the contract
 * `useSyncExternalStore` expects on the React side.
 */
export class Emitter<TEvents extends Record<string, unknown>> {
  private readonly listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  on<TName extends keyof TEvents>(name: TName, listener: Listener<TEvents[TName]>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as Listener<never>);
    return () => {
      set.delete(listener as Listener<never>);
    };
  }

  emit<TName extends keyof TEvents>(name: TName, payload: TEvents[TName]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    // Sets tolerate deletion during iteration, so listeners may safely
    // unsubscribe themselves mid-emit.
    for (const listener of set) {
      (listener as Listener<TEvents[TName]>)(payload);
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
```

Thirty lines, fully typed, no dependency. The important design decision is the return value of `on`: an unsubscribe function. Keep that shape in mind for when we wire up React.

### 4.3 Configuration as data (`config.ts`)

Part 1 uses a public Esri sample service (LA-area trailheads), so the repo runs with **zero setup — no ArcGIS account, no API key**. When the series switches to the Addis Ababa GTFS network in a later part, this file is the only thing that changes.

```ts
import type { MapConfig } from "./types";

export const MAP_CONFIG: MapConfig = {
  apiKey: process.env.NEXT_PUBLIC_ARCGIS_API_KEY,
  basemaps: {
    streets: "streets-navigation-vector",
    satellite: "hybrid",
  },
  initialBasemap: "streets",
  initialCamera: {
    center: { lon: -118.7, lat: 34.09 },
    zoom: 11,
  },
  layers: [
    {
      id: "trailheads",
      title: "Trailheads",
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Trailheads/FeatureServer/0",
      outFields: ["TRL_NAME", "PARK_NAME", "ELEV_FT", "PARKING"],
      popupTemplate: {
        title: "{TRL_NAME}",
        content: [
          {
            type: "fields",
            fieldInfos: [
              { fieldName: "PARK_NAME", label: "Park" },
              { fieldName: "ELEV_FT", label: "Elevation (ft)" },
              { fieldName: "PARKING", label: "Parking" },
            ],
          },
        ],
      },
      renderer: {
        type: "simple",
        symbol: {
          type: "simple-marker",
          size: 8,
          color: [16, 185, 129, 0.9],
          outline: { color: [255, 255, 255, 1], width: 1.5 },
        },
      },
    },
  ],
};
```

The `layers` array is typed as `FeatureLayerProperties[]`, so the renderer and popup template are plain autocast objects — the SDK turns them into class instances on construction. No `new SimpleRenderer()` ceremony.

### 4.4 The engine itself (`MapEngine.ts`)

This is the heart of the post. Read the comments — every one of them is a scar.

```ts
import type EsriMap from "@arcgis/core/Map";
import type MapView from "@arcgis/core/views/MapView";

import { Emitter } from "./emitter";
import type { BasemapId, EngineSnapshot, MapConfig } from "./types";

type EngineEvents = {
  change: EngineSnapshot;
};

interface WatchHandle {
  remove(): void;
}

/**
 * The imperative core of the app. Owns the ArcGIS Map and MapView, every
 * reactiveUtils watcher, and (in later posts) selection sets and highlight
 * handles. It never imports React.
 *
 * React interacts with it through exactly three surfaces:
 *   - `subscribe` / `getSnapshot` — the `useSyncExternalStore` contract
 *   - commands (`zoomIn`, `setBasemap`, …) — fire-and-forget imperative calls
 *   - `attach` / `detach` — lifecycle, called from a single effect
 */
export class MapEngine {
  private readonly config: MapConfig;
  private readonly emitter = new Emitter<EngineEvents>();
  private snapshot: EngineSnapshot;

  private map: EsriMap | null = null;
  private view: MapView | null = null;
  private watchHandles: WatchHandle[] = [];

  /**
   * Incremented on every attach/detach. Async work started under an older
   * generation discards its results — this is what makes the engine safe
   * under React Strict Mode's mount → unmount → mount replay.
   */
  private generation = 0;

  constructor(config: MapConfig) {
    this.config = config;
    this.snapshot = {
      status: "idle",
      error: null,
      basemapId: config.initialBasemap,
      camera: config.initialCamera,
    };
  }

  /** Stable identity — safe to hand straight to `useSyncExternalStore`. */
  readonly subscribe = (onChange: () => void): (() => void) =>
    this.emitter.on("change", () => onChange());

  readonly getSnapshot = (): EngineSnapshot => this.snapshot;

  /** Create the view inside `container` and load the configured layers. */
  async attach(container: HTMLDivElement): Promise<void> {
    const generation = ++this.generation;
    this.patch({ status: "loading", error: null });

    try {
      const [
        esriConfig,
        { default: EsriMap },
        { default: MapView },
        { default: FeatureLayer },
        reactiveUtils,
      ] = await Promise.all([
        import("@arcgis/core/config.js"),
        import("@arcgis/core/Map.js"),
        import("@arcgis/core/views/MapView.js"),
        import("@arcgis/core/layers/FeatureLayer.js"),
        import("@arcgis/core/core/reactiveUtils.js"),
      ]);
      if (generation !== this.generation) return;

      if (this.config.apiKey) {
        esriConfig.default.apiKey = this.config.apiKey;
      }

      const map = new EsriMap({
        basemap: this.config.basemaps[this.snapshot.basemapId],
        layers: this.config.layers.map((layer) => new FeatureLayer(layer)),
      });

      const { center, zoom } = this.snapshot.camera;
      const view = new MapView({
        container,
        map,
        center: [center.lon, center.lat],
        zoom,
        constraints: { snapToZoom: false },
        // The app shell provides its own controls; keep only Esri attribution,
        // which is part of the view itself as of SDK 5.0.
        ui: { components: [] },
      });

      this.map = map;
      this.view = view;

      this.watchHandles.push(
        reactiveUtils.watch(
          () => view.stationary,
          (stationary) => {
            if (stationary) this.syncCamera();
          },
        ),
      );

      await view.when();
      if (generation !== this.generation) return;

      this.patch({ status: "ready" });
      this.syncCamera();
    } catch (error) {
      if (generation !== this.generation) return;
      this.patch({ status: "error", error: toMessage(error) });
    }
  }

  /** Tear down the view. The engine can be re-attached afterwards. */
  detach(): void {
    this.generation++;
    for (const handle of this.watchHandles) handle.remove();
    this.watchHandles = [];
    this.view?.destroy();
    this.map?.destroy();
    this.view = null;
    this.map = null;
    this.patch({ status: "idle" });
  }

  /** Full teardown — detach and drop all subscribers. */
  destroy(): void {
    this.detach();
    this.emitter.clear();
  }

  zoomIn(): void {
    this.zoomBy(1);
  }

  zoomOut(): void {
    this.zoomBy(-1);
  }

  /** Animate back to the configured initial camera. */
  goHome(): void {
    const view = this.view;
    if (!view) return;
    const { center, zoom } = this.config.initialCamera;
    view
      .goTo({ center: [center.lon, center.lat], zoom }, { duration: 400 })
      .catch(ignoreViewInterruption);
  }

  async setBasemap(id: BasemapId): Promise<void> {
    const map = this.map;
    if (!map || id === this.snapshot.basemapId) return;

    const { default: Basemap } = await import("@arcgis/core/Basemap.js");
    const basemap = Basemap.fromId(this.config.basemaps[id]);
    if (!basemap) {
      throw new Error(`Unknown basemap id "${this.config.basemaps[id]}".`);
    }
    map.basemap = basemap;
    this.patch({ basemapId: id });
  }

  private zoomBy(delta: number): void {
    const view = this.view;
    if (!view) return;
    view.goTo({ zoom: view.zoom + delta }, { duration: 200 }).catch(ignoreViewInterruption);
  }

  private syncCamera(): void {
    const view = this.view;
    if (!view?.center) return;
    this.patch({
      camera: {
        center: {
          lon: view.center.longitude ?? this.snapshot.camera.center.lon,
          lat: view.center.latitude ?? this.snapshot.camera.center.lat,
        },
        zoom: view.zoom ?? this.snapshot.camera.zoom,
      },
    });
  }

  private patch(partial: Partial<EngineSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...partial };
    this.emitter.emit("change", this.snapshot);
  }
}

/** `view.goTo` rejects when a newer navigation interrupts it — that's normal. */
function ignoreViewInterruption(error: unknown): void {
  const name = (error as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "view:goto-interrupted") return;
  console.error(error);
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
```

Five decisions deserve a closer look:

**1. Dynamic imports inside `attach`.** The top of the file imports only _types_ from `@arcgis/core`; the runtime modules load via `import()` when the map actually mounts. This buys three things at once: the multi-megabyte SDK stays out of the initial page bundle (your shell paints instantly); the SDK never evaluates during server rendering (it's a browser library); and — foreshadowing the war story below — the bundler treats it as a split point.

**2. The `generation` counter.** React 18+ Strict Mode deliberately mounts, unmounts, and remounts every component in development. A naive `attach` would be mid-`await` when the unmount's `detach` runs, then finish constructing a `MapView` into a container React has abandoned — the classic zombie map. Every `await` in `attach` is followed by `if (generation !== this.generation) return;`. Detach bumps the generation; stale async work notices and abandons itself. No booleans, no `isMounted` hacks, works for any number of interleaved attach/detach cycles.

**3. `patch` replaces, never mutates.** `this.snapshot = { ...this.snapshot, ...partial }` — a new object every time. This is load-bearing: `useSyncExternalStore` decides "did the store change?" by comparing what `getSnapshot` returns with `Object.is`. Mutate the snapshot in place and React never re-renders; replace it and React re-renders exactly once per change.

**4. Camera sync only when `stationary`.** We _could_ watch `view.center` and publish sixty snapshots a second while the user pans. Instead we watch `view.stationary` and publish once when the map settles. React does zero work during the pan itself — the SDK renders the map on its own canvas — and one render at the end. If you take one performance idea from this post, take this one: _choose the granularity at which React needs to know things._

**5. `subscribe` and `getSnapshot` are arrow-function class fields.** Their identity never changes, so they can be passed straight into `useSyncExternalStore` without memoization. If they were ordinary methods you'd need `.bind` or a wrapper, and getting that wrong causes resubscribe loops.

## Step 5: The React bridge

### 5.1 Provider and hooks (`src/components/map/MapProvider.tsx`)

```tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { MAP_CONFIG } from "@/lib/map/config";
import { MapEngine } from "@/lib/map/MapEngine";
import type { EngineSnapshot } from "@/lib/map/types";

const MapEngineContext = createContext<MapEngine | null>(null);

/**
 * Context carries the engine *instance* — a stable reference that never
 * changes, so putting it in context never causes a re-render. State flows
 * separately, through `useEngineSnapshot` below.
 */
export function MapProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new MapEngine(MAP_CONFIG));

  useEffect(() => () => engine.destroy(), [engine]);

  return <MapEngineContext value={engine}>{children}</MapEngineContext>;
}

/** The engine itself, for issuing commands (`engine.zoomIn()` etc.). */
export function useMapEngine(): MapEngine {
  const engine = useContext(MapEngineContext);
  if (!engine) {
    throw new Error("useMapEngine must be used inside <MapProvider>.");
  }
  return engine;
}

/**
 * The engine's current state as an immutable snapshot. Components that call
 * this re-render exactly when the snapshot object is replaced — never because
 * of anything React-side.
 */
export function useEngineSnapshot(): EngineSnapshot {
  const engine = useMapEngine();
  return useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    // On the server (and first client render) the constructor's initial
    // snapshot is returned, so SSR output and hydration always agree.
    engine.getSnapshot,
  );
}
```

Things to notice:

- **`useState(() => new MapEngine(...))`** — the lazy initializer runs once per provider lifetime. The engine's constructor is deliberately side-effect-free (no DOM, no ArcGIS objects — those wait for `attach`), so it's safe even during server rendering of this client component.
- **`<MapEngineContext value={engine}>`** — React 19 lets you render a context directly as a provider. Small thing, but it's 2026.
- **`useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)`** — this hook _is_ the architecture. `subscribe` is the emitter's `on` (returns an unsubscribe function — told you that shape would matter). `getSnapshot` returns the current immutable snapshot. The third argument keeps server rendering and hydration consistent. If you've been reaching for `useState` + `useEffect` + context to observe external objects, this hook replaces all three with fewer bugs.

### 5.2 The bridge component (`src/components/map/MapCanvas.tsx`)

```tsx
"use client";

import { useEffect, useRef } from "react";

import { useEngineSnapshot, useMapEngine } from "./MapProvider";

/**
 * The single point where React's declarative world hands a real DOM node to
 * the imperative engine. Everything ArcGIS-related happens on the other side
 * of `engine.attach`.
 */
export function MapCanvas() {
  const engine = useMapEngine();
  const { status, error } = useEngineSnapshot();
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    void engine.attach(container);
    return () => engine.detach();
  }, [engine]);

  return (
    <div className="absolute inset-0">
      <div
        ref={containerRef}
        role="application"
        aria-label="Interactive map"
        className="size-full [&_.esri-view-surface]:outline-none"
      />

      {status === "loading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="flex flex-col items-center gap-3">
            <output
              className="size-8 animate-spin rounded-full border-3 border-emerald-600 border-t-transparent"
              aria-label="Loading map"
            />
            <p className="text-sm text-gray-500">Loading map…</p>
          </div>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 p-4">
          <div className="w-full max-w-sm rounded-xl border border-red-200 bg-white p-5 shadow-lg">
            <h2 className="font-semibold text-gray-800">The map failed to load</h2>
            <p className="mt-1 text-sm break-words text-gray-500">{error}</p>
            <button
              type="button"
              onClick={() => {
                const container = containerRef.current;
                if (container) void engine.attach(container);
              }}
              className="mt-4 inline-flex items-center gap-x-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

One effect, one attach, one detach. Loading and error states come from the snapshot — the component doesn't track them itself. The retry button is just `engine.attach` again; the generation counter makes that safe by construction.

## Step 6: The Google-Maps-style shell

Four components make up the chrome. They share a theme (white cards, `rounded-full`/`rounded-lg`, soft shadows, emerald accents) and an important property: **none of them import anything from `@arcgis/core`.**

### The search pill — a _server_ component, on purpose

The floating search bar (hamburger menu + input + search icon) is pure markup: Preline's dropdown is driven entirely by `data-hs-*` attributes and classes, no React state. That means the whole component can stay a **server component** — it ships zero JS. The input is disabled with a "(Part 3)" placeholder because faking a working search would be worse than being honest. See [`src/components/shell/SearchBar.tsx`](https://github.com/rabira-hierpa/rearc/blob/main/src/components/shell/SearchBar.tsx) for the full markup — the interesting part is what's _not_ there.

### The controls — commands in, snapshots out

`MapControls` (zoom +/− and home, bottom right) shows the command side of the architecture:

```tsx
const engine = useMapEngine();
const { status } = useEngineSnapshot();
const ready = status === "ready";
// ...
<button onClick={() => engine.zoomIn()} disabled={!ready} aria-label="Zoom in">
```

Handlers call engine commands and read _nothing back_. The buttons enable themselves when the snapshot says the view is ready.

`BasemapToggle` (bottom left, Google-Maps-style card that previews the basemap you'd switch _to_) is the same idea: `engine.setBasemap(next)`, with the active basemap read from the snapshot — the component holds no state of its own.

And `CameraReadout` (bottom center) is the proof the whole thing works:

```tsx
export function CameraReadout() {
  const { camera, status } = useEngineSnapshot();
  if (status !== "ready") return null;

  return (
    <output className="...">
      {camera.center.lat.toFixed(4)}, {camera.center.lon.toFixed(4)} · z{camera.zoom.toFixed(1)}
    </output>
  );
}
```

This component knows nothing about ArcGIS — no imports, no view, no events — yet it tracks the map camera. Pan the map and watch it update when the view settles. That's `useSyncExternalStore` earning its keep.

### Assembling the page

```tsx
// src/app/page.tsx — a server component
import { MapCanvas } from "@/components/map/MapCanvas";
import { MapProvider } from "@/components/map/MapProvider";
import { BasemapToggle } from "@/components/shell/BasemapToggle";
import { CameraReadout } from "@/components/shell/CameraReadout";
import { MapControls } from "@/components/shell/MapControls";
import { SearchBar } from "@/components/shell/SearchBar";

export default function HomePage() {
  return (
    <MapProvider>
      <main className="relative h-dvh w-full overflow-hidden">
        <MapCanvas />
        <SearchBar />
        <MapControls />
        <BasemapToggle />
        <CameraReadout />
      </main>
    </MapProvider>
  );
}
```

`h-dvh` (dynamic viewport height) instead of `h-screen` — on mobile, `100vh` hides content behind the browser chrome; `100dvh` tracks the actually-visible viewport.

`npm run dev`, open localhost:3000, and you have a full-bleed map with a Google-Maps-style shell.

---

## The build that never finished: a Turbopack war story

I promised production-ready, so before publishing I ran `npm run build`. It never finished. Not "slow" — _never_. Here's the investigation, step by step, because the methodology transfers to any build that hangs.

### Step 1: Is it hung or is it working?

```bash
ps -o pid,etime,%cpu,rss,command -p $(pgrep -f "next build")
```

```
  PID  ELAPSED  %CPU     RSS  COMMAND
80175    04:49  191.5  1425216  node .../next build
```

191% CPU and 1.4 GB RSS after five minutes: not deadlocked — _churning_. Meanwhile `vm_stat` showed the 16 GB machine down to ~60 MB of free pages. And an earlier attempt had died with **exit code 137** — that's `128 + 9`, SIGKILL. At that moment I read it the way everyone reads it: the OS out-of-memory killer got it. Hold that thought, because it's only half right, and the other half is the best lesson in this post.

`.next/diagnostics/build-diagnostics.json` confirmed where: `"buildStage": "compile"` — it never got past compilation.

### Step 2: Is this a known problem?

Searching turned up an [Esri community thread](https://community.esri.com/t5/arcgis-javascript-maps-sdk-questions/arcgis-core-with-next-js-build-in-docker-fails-due/td-p/1046490) where a Next.js + `@arcgis/core` Docker build only succeeded after raising the container's memory to **8.5 GB**, and a [Next.js discussion](https://github.com/vercel/next.js/discussions/93451) reporting Turbopack using **~7 GB where webpack used ~3 GB** on the same project. So: `@arcgis/core` is a famously huge module graph, Turbopack on Next 16.2 is memory-hungry at build time, and I'd combined them on a 16 GB laptop. (Next 16.3's Turbopack can spill its build cache to disk — its changelog claims ~90% memory reduction — but 16.3 is still canary as I write this.)

Known problem class, but "add RAM" isn't a fix I can ship to readers. Which _part_ of the integration was the problem?

### Step 3: Bisect the build

Two suspects: the JS side (`import("@arcgis/core/views/MapView.js")` pulls in a graph of thousands of modules) and the CSS side (`@import "@arcgis/core/assets/esri/themes/light/main.css"` — 350 KB of CSS with 87 `url()` asset references, run through Tailwind v4's PostCSS pipeline _and_ Turbopack's CSS handling). So: four builds, each with one variable flipped, each measured with `/usr/bin/time -l` for peak memory.

| Build        | ArcGIS JS graph | ArcGIS theme CSS | Result                                                       |
| ------------ | --------------- | ---------------- | ------------------------------------------------------------ |
| A            | stubbed         | removed          | ✅ compiled in **3.4 min**, peak 2.7 GB                      |
| B            | real            | removed          | ✅ compiled in **11.7 min**, peak 2.8 GB                     |
| C            | stubbed         | imported         | ✅ compiled in **11.5 min**                                  |
| D (original) | real            | imported         | ✅ compiled in **12.5 min** (18 min wall clock), peak 3.1 GB |

Read that table again, because it surprised me twice.

**Surprise #1: the "never-finishing" build finishes.** With nothing else competing for memory, the original build completes in 12.5 minutes. So what had been killing it? I went back to the earlier failures with fresh eyes. Exit code 137 is `128 + 9` — SIGKILL. I had read that as "the OOM killer got it," and under memory pressure (the machine was down to ~60 MB free at one point, racking up 54 _million_ involuntary context switches during the successful run) it genuinely can be. But **SIGKILL is also exactly what every timeout reaper sends**: my CLI tool's 10-minute command timeout, CI step timeouts, Docker health checks. A 12.5-minute compile in a world of 10-minute timeouts _is_ "a build that never finishes" — every observer kills it just before the finish line, and the corpse looks identical to an OOM kill. Lesson: exit 137 tells you _someone_ sent SIGKILL, not _who_. Check `dmesg`/system logs before blaming memory.

**Surprise #2: the cost isn't additive.** JS alone adds ~8 minutes. CSS alone adds ~8 minutes. Both together add… ~9 minutes. If the two import paths did independent work, D should have taken ~20 minutes. It didn't — which says the dominant cost is Turbopack ingesting and tracing the `@arcgis/core` package _at all_ (thousands of internal modules, an 83 MB asset tree), and it pays that price once whether the package enters through a JS import, a CSS import, or both. Bisecting didn't find a villain; it found a fixed toll booth at the package boundary.

### Step 4: The fix — stop bundling CSS that doesn't need bundling

The JS graph has to be bundled — that's the app. But the theme CSS? Turbopack was inhaling 350 KB of third-party CSS, resolving 87 asset URLs against an 11,000-file, 83 MB assets folder... for a stylesheet that Esri already serves, byte-identical, from the same CDN the SDK loads its runtime assets from by default (`@arcgis/core`'s `defaultAssetsPath` points at `js.arcgis.com`).

So: delete the `@import` from `globals.css`, add a versioned `<link>` in the root layout's body — React 19 hoists it into `<head>` (the `precedence` prop is what opts a stylesheet into hoisting and deduplication):

```tsx
// src/app/layout.tsx
<link
  rel="stylesheet"
  precedence="default"
  href="https://js.arcgis.com/5.1/esri/themes/light/main.css"
/>
```

Pin the major.minor to match your installed `@arcgis/core` version so the CSS and the SDK's DOM structures never drift apart.

Given surprise #2, I'll be honest about what this buys, with measurements: on my machine the compile dropped from **12.5 to 8.7 minutes (~30%)**, while peak RSS stayed at ~3 GB. It does **not** halve the build — the package toll is paid on the JS side regardless — and it didn't move the quiet-run memory peak. What you're really buying is the bundler no longer doing five minutes of work whose output already sits on a CDN, plus one less multi-hundred-megabyte processing pipeline active during the phase where pressured machines and small CI boxes (remember the 8.5 GB Docker thread) tip over.

The honest survival guide for `@arcgis/core` on Turbopack (Next 16.2), in order of importance:

1. **Expect ~10–15 minutes of production compile on a 16 GB machine, and set every timeout accordingly** — CI step timeouts, deploy health checks, your own patience. Most "the build hangs" reports are timeouts wearing a trench coat.
2. **Don't bundle the theme CSS** — CDN `<link>` as above; ~30% faster compile and one less heavyweight pipeline running during the risky phase.
3. **`next build --webpack`** — Next 16 still ships the webpack pipeline behind a flag, and community numbers put its build memory well below Turbopack's on 16.2. A fine fallback for memory-tight CI boxes.
4. **Watch for Next 16.3** — its Turbopack can spill build cache to disk (the changelog claims ~90% memory reduction). Still canary as I write; this repo will upgrade when it's stable.

If you take one thing from this section: when a build "hangs," check `%CPU`, RSS, and the exit code _before_ reading a single line of config. 191% CPU means working-not-stuck; climbing RSS on a starved machine means memory pressure; exit 137 means SIGKILL — from the OOM killer _or from any timeout_. Everything after those three numbers was just controlled experiments.

---

## What we have, and what's next

At the end of Part 1 you have:

- A Next.js 16 + React 19 app with Tailwind v4 and Preline configured the 2026 way (CSS-first, `@source`, re-init on navigation)
- oxfmt + oxlint replacing Prettier + ESLint, ~30× faster, with Tailwind class sorting for free
- A `MapEngine` core with a hard React boundary: commands in, immutable snapshots out via `useSyncExternalStore`, Strict-Mode-safe lifecycle via a generation counter, and the ArcGIS SDK loaded lazily so it never bloats the shell
- A Google-Maps-style UI shell — search pill, zoom/home controls, basemap toggle, live camera readout — where not a single chrome component imports ArcGIS
- A production build that actually finishes, and a debugging story for when yours doesn't

In **Part 2** the layer registry arrives: multiple feature layers, a `LayerRegistry` class behind the engine facade, a Preline slide-over layer panel with toggles, and the first real payoff of the snapshot pattern — layer visibility state that flows one way. See you there.

_The full source for this part is tagged [`part-1`](https://github.com/rabira-hierpa/rearc/tree/part-1) in the repo. Found a problem or have a better pattern? Open an issue — this series is as much a lab notebook as a tutorial._
