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
 *
 * The ArcGIS SDK is loaded with dynamic imports inside `attach`, so the
 * ~2 MB of map code stays out of the initial bundle and out of the server
 * build entirely.
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
