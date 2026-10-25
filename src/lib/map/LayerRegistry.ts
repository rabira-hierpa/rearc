import type EsriMap from "@arcgis/core/Map";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer";

import type { LayerDefinition, LayerState, LayerStatus, WatchHandle } from "./types";

/**
 * The pieces of the SDK the registry needs. The engine loads them with dynamic
 * imports and passes them in, so this file — like every other file under
 * `lib/map/` except the engine — imports nothing from `@arcgis/core` at
 * runtime, only types.
 */
export interface LayerSdk {
  FeatureLayer: typeof FeatureLayer;
  reactiveUtils: typeof import("@arcgis/core/core/reactiveUtils.js");
}

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

/**
 * Owns the live `FeatureLayer` instances and turns them into immutable
 * `LayerState` rows for React.
 *
 * Two collections, and the split is the whole design:
 *
 *   - `prefs` — the user's intent (on/off, opacity). Created from the config,
 *     updated by commands and by watchers, and **kept across attach/detach**.
 *   - `runtime` — the live layers and their load status. Built in `build()`,
 *     dropped in `teardown()`.
 *
 * A `MapView` is disposable: Strict Mode throws it away, an error boundary
 * recreates it, Part 4 will rebuild it. What the user switched off must not
 * come back on because React remounted a component.
 */
export class LayerRegistry {
  private readonly definitions: readonly LayerDefinition[];
  private readonly notify: () => void;
  private readonly prefs = new Map<string, LayerPrefs>();
  private readonly runtime = new Map<string, LayerRuntime>();

  private handles: WatchHandle[] = [];
  /** Current view scale. 0 means "no view yet" — treat every layer as in range. */
  private scale = 0;
  private states: readonly LayerState[];

  constructor(definitions: readonly LayerDefinition[], notify: () => void) {
    this.definitions = definitions;
    this.notify = notify;
    for (const definition of definitions) {
      this.prefs.set(definition.id, {
        visible: definition.visible ?? true,
        opacity: definition.opacity ?? 1,
      });
    }
    this.states = this.computeStates();
  }

  /** The current rows. Identity is stable while nothing changes — see `reconcile`. */
  getStates(): readonly LayerState[] {
    return this.states;
  }

  /** The live layer, for engine-level work (zooming to an extent, querying). */
  getLayer(id: string): FeatureLayer | null {
    return this.runtime.get(id)?.layer ?? null;
  }

  /**
   * Loaded layers paired with the definitions that configured them — what
   * feature search runs against. Layers that failed, haven't loaded yet, or
   * opted out are left out, so search never queries a service it knows is
   * broken.
   */
  getSearchable(): { definition: LayerDefinition; layer: FeatureLayer }[] {
    const searchable: { definition: LayerDefinition; layer: FeatureLayer }[] = [];
    for (const definition of this.definitions) {
      if (definition.searchable === false) continue;
      const runtime = this.runtime.get(definition.id);
      if (runtime?.status === "loaded") {
        searchable.push({ definition, layer: runtime.layer });
      }
    }
    return searchable;
  }

  /**
   * Construct every configured layer, apply the remembered prefs, add them to
   * the map in draw order, and start watching them.
   */
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

      this.runtime.set(definition.id, { layer, status: "not-loaded", error: null });
      layers.push(layer);

      // Watch the layer, not our own commands. Anything that flips visibility
      // — our toggles, a popup action, the SDK itself — lands in the snapshot
      // through this one path, so the panel can never disagree with the map.
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
            runtime.error =
              status === "failed" ? (layer.loadError?.message ?? "Unknown error") : null;
            this.reconcile();
          },
          { initial: true },
        ),
      );
    }

    // Index 0 is the bottom of the stack, which is why the config lists
    // layers bottom-first and only the panel reverses them.
    map.addMany(layers);

    // Load explicitly instead of waiting for the view to get around to it:
    // a layer that is switched off would otherwise sit at "not-loaded" and a
    // broken service would never report itself. The rejection is handled by
    // the loadStatus watcher above; this catch only keeps it from becoming an
    // unhandled rejection.
    for (const layer of layers) {
      layer.load().catch(() => {});
    }

    this.reconcile();
  }

  /** Drop the live layers and their watchers. Prefs survive. */
  teardown(): void {
    for (const handle of this.handles) handle.remove();
    this.handles = [];
    // The engine destroys the Map, which destroys the layers with it.
    this.runtime.clear();
    this.scale = 0;
    this.reconcile();
  }

  /** Called from the engine's view-scale watcher. */
  setScale(scale: number): void {
    if (scale === this.scale) return;
    this.scale = scale;
    this.reconcile();
  }

  setVisible(id: string, visible: boolean): void {
    const prefs = this.prefs.get(id);
    if (!prefs || prefs.visible === visible) return;

    prefs.visible = visible;
    const runtime = this.runtime.get(id);
    if (runtime) runtime.layer.visible = visible;
    this.reconcile();
  }

  toggle(id: string): void {
    const prefs = this.prefs.get(id);
    if (prefs) this.setVisible(id, !prefs.visible);
  }

  setAllVisible(visible: boolean): void {
    for (const definition of this.definitions) this.setVisible(definition.id, visible);
  }

  /** Show one layer and hide every other — the panel's "Only" action. */
  isolate(id: string): void {
    for (const definition of this.definitions) {
      this.setVisible(definition.id, definition.id === id);
    }
  }

  setOpacity(id: string, opacity: number): void {
    const prefs = this.prefs.get(id);
    if (!prefs) return;

    const clamped = Math.min(1, Math.max(0, opacity));
    if (prefs.opacity === clamped) return;

    prefs.opacity = clamped;
    const runtime = this.runtime.get(id);
    if (runtime) runtime.layer.opacity = clamped;
    this.reconcile();
  }

  /**
   * Recompute the rows and publish only if something actually changed.
   *
   * Rows whose values are unchanged keep their previous object identity, and
   * if every row is unchanged the whole array keeps its identity too. That is
   * what lets `useEngineSelector(selectLayers)` ignore the snapshot churn from
   * camera movement: the engine publishes a new snapshot, but `snapshot.layers`
   * is the same array, so the panel does not re-render.
   */
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

  private computeStates(): LayerState[] {
    return this.definitions.map((definition) => {
      const prefs = this.prefs.get(definition.id);
      const runtime = this.runtime.get(definition.id);

      return {
        id: definition.id,
        title: definition.title,
        group: definition.group,
        description: definition.description,
        swatch: definition.swatch,
        visible: prefs?.visible ?? true,
        opacity: prefs?.opacity ?? 1,
        status: runtime?.status ?? "not-loaded",
        error: runtime?.error ?? null,
        inScaleRange: this.isInScaleRange(definition),
      };
    });
  }

  /**
   * ArcGIS scale ranges read backwards until they click: `minScale` is the
   * *smallest* scale number the layer draws at — i.e. the most zoomed-out —
   * and 0 means "no limit" at either end.
   */
  private isInScaleRange(definition: LayerDefinition): boolean {
    if (this.scale === 0) return true;
    const { minScale = 0, maxScale = 0 } = definition.properties;
    if (minScale > 0 && this.scale > minScale) return false;
    if (maxScale > 0 && this.scale < maxScale) return false;
    return true;
  }
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
