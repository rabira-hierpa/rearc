import type EsriMap from "@arcgis/core/Map";
import type GraphicsLayer from "@arcgis/core/layers/GraphicsLayer";
import type MapView from "@arcgis/core/views/MapView";
import type { GoToTarget2D } from "@arcgis/core/views/types";

import { Emitter } from "./emitter.ts";
import { LayerRegistry } from "./LayerRegistry.ts";
import {
  FeatureSearchSource,
  LayerSearchSource,
  PlaceSearchSource,
  SearchService,
} from "./SearchService.ts";
import type {
  BasemapId,
  EngineSnapshot,
  LonLat,
  MapConfig,
  SearchResponse,
  SearchResult,
  SearchTarget,
  WatchHandle,
} from "./types";

type EngineEvents = {
  change: EngineSnapshot;
};

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
 *
 * Layer work lives in `LayerRegistry`; the engine is the facade in front of
 * it, so React never learns there is a second class back here.
 */
export class MapEngine {
  private readonly config: MapConfig;
  private readonly emitter = new Emitter<EngineEvents>();
  private readonly registry: LayerRegistry;
  private readonly searchService: SearchService;
  private snapshot: EngineSnapshot;

  private map: EsriMap | null = null;
  private view: MapView | null = null;
  private pinLayer: GraphicsLayer | null = null;
  private watchHandles: WatchHandle[] = [];

  /**
   * Incremented on every attach/detach. Async work started under an older
   * generation discards its results — this is what makes the engine safe
   * under React Strict Mode's mount → unmount → mount replay.
   */
  private generation = 0;

  constructor(config: MapConfig) {
    this.config = config;
    // The registry calls back when a layer row actually changes — never on
    // every watcher tick. See LayerRegistry.reconcile.
    this.registry = new LayerRegistry(config.layers, () => {
      this.patch({ layers: this.registry.getStates() });
    });
    this.snapshot = {
      status: "idle",
      error: null,
      basemapId: config.initialBasemap,
      camera: config.initialCamera,
      layers: this.registry.getStates(),
      pin: null,
    };

    // The sources are built once and read the engine lazily, so they keep
    // working across attach/detach without being rebuilt.
    this.searchService = new SearchService(
      [
        new LayerSearchSource(config.layers),
        new FeatureSearchSource({
          getLayers: () => this.registry.getSearchable(),
          toLonLat: toLonLat,
          toExtent: toExtent,
        }),
        new PlaceSearchSource({
          loadLocator: () => import("@arcgis/core/rest/locator.js"),
          toLonLat: toLonLat,
          url: config.search.geocodeUrl,
          hasApiKey: Boolean(config.apiKey),
        }),
      ],
      config.search,
    );
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
        { default: GraphicsLayer },
        reactiveUtils,
      ] = await Promise.all([
        import("@arcgis/core/config.js"),
        import("@arcgis/core/Map.js"),
        import("@arcgis/core/views/MapView.js"),
        import("@arcgis/core/layers/FeatureLayer.js"),
        import("@arcgis/core/layers/GraphicsLayer.js"),
        import("@arcgis/core/core/reactiveUtils.js"),
      ]);
      if (generation !== this.generation) return;

      if (this.config.apiKey) {
        esriConfig.default.apiKey = this.config.apiKey;
      }

      const map = new EsriMap({
        basemap: this.config.basemaps[this.snapshot.basemapId],
      });

      // The registry builds the layers, applying whatever the user had
      // switched on before this attach — a remount must not reset the panel.
      this.registry.build(map, { FeatureLayer, reactiveUtils });

      // Added last, so the search marker draws above every feature layer.
      const pinLayer = new GraphicsLayer({ id: "search-pin", listMode: "hide" });
      map.add(pinLayer);
      this.pinLayer = pinLayer;

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
        // Scale changes continuously while zooming, but the registry only
        // publishes when a layer crosses in or out of its scale range, so
        // React sees a handful of updates rather than one per frame.
        reactiveUtils.watch(
          () => view.scale,
          (scale) => this.registry.setScale(scale),
          { initial: true },
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
    // Before destroying the map: the registry's watchers point at layers that
    // are about to be torn down with it.
    this.registry.teardown();
    this.view?.destroy();
    this.map?.destroy();
    this.view = null;
    this.map = null;
    this.pinLayer = null;
    // The pin is map state, and there is no map now. The search box keeps its
    // text — that belongs to React — but the marker is gone either way.
    this.patch({ status: "idle", pin: null });
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

  // --- Layer commands ------------------------------------------------------
  // Thin delegation on purpose: React talks to one object, and the registry
  // stays replaceable (Part 5 gives it filters, Part 6 an undo stack).

  setLayerVisible(id: string, visible: boolean): void {
    this.registry.setVisible(id, visible);
  }

  toggleLayer(id: string): void {
    this.registry.toggle(id);
  }

  setAllLayersVisible(visible: boolean): void {
    this.registry.setAllVisible(visible);
  }

  isolateLayer(id: string): void {
    this.registry.isolate(id);
  }

  setLayerOpacity(id: string, opacity: number): void {
    this.registry.setOpacity(id, opacity);
  }

  /** Frame the layer's full extent. Needs the view, so it lives here. */
  async zoomToLayer(id: string): Promise<void> {
    const view = this.view;
    const layer = this.registry.getLayer(id);
    if (!view || !layer) return;

    await layer.when();
    if (!layer.fullExtent) return;
    view.goTo(layer.fullExtent, { duration: 500 }).catch(ignoreViewInterruption);
  }

  /**
   * Zoom to where a scale-limited layer starts drawing. Without this, "on but
   * invisible" leaves the user hunting for the right zoom level by hand.
   */
  zoomToLayerScale(id: string): void {
    const view = this.view;
    const definition = this.config.layers.find((layer) => layer.id === id);
    if (!view || !definition) return;

    const { minScale = 0, maxScale = 0 } = definition.properties;
    // A 10% margin keeps us clear of the boundary the layer is judged against.
    let target = view.scale;
    if (minScale > 0 && view.scale > minScale) target = minScale * 0.9;
    else if (maxScale > 0 && view.scale < maxScale) target = maxScale * 1.1;
    else return;

    view.goTo({ scale: target }, { duration: 400 }).catch(ignoreViewInterruption);
  }

  // --- Search --------------------------------------------------------------

  /**
   * Run a term past every search source.
   *
   * Deliberately a plain async function rather than snapshot state: the
   * candidate list belongs to whoever asked for it. Only the result the user
   * commits to — the pin, below — becomes map state. React drives the async
   * lifecycle (debounce, cancellation, caching); the engine just answers.
   */
  search(term: string, signal?: AbortSignal): Promise<SearchResponse> {
    return this.searchService.search(term, signal);
  }

  /** Commit to a result: move the camera, and mark the spot. */
  async goToResult(result: SearchResult): Promise<void> {
    if (result.kind === "layer" && result.layerId) {
      // Zooming to a layer the user can't see would be a magic trick.
      this.setLayerVisible(result.layerId, true);
      await this.zoomToLayer(result.layerId);
      return;
    }

    const view = this.view;
    const target = result.target;
    if (!view || !target) return;

    await this.drawPin(target.center);
    this.patch({
      pin: {
        title: result.title,
        subtitle: result.subtitle,
        kind: result.kind,
        center: target.center,
      },
    });

    view.goTo(await this.goToTarget(target), { duration: 500 }).catch(ignoreViewInterruption);
  }

  clearPin(): void {
    this.pinLayer?.removeAll();
    if (this.snapshot.pin) this.patch({ pin: null });
  }

  /** An extent frames a trail properly; a point needs a scale to land at. */
  private async goToTarget(target: SearchTarget): Promise<GoToTarget2D> {
    const { center, extent, scale } = target;
    if (extent && extent[2] > extent[0] && extent[3] > extent[1]) {
      const { default: Extent } = await import("@arcgis/core/geometry/Extent.js");
      return new Extent({
        xmin: extent[0],
        ymin: extent[1],
        xmax: extent[2],
        ymax: extent[3],
        spatialReference: { wkid: 4326 },
      });
    }
    return { center: [center.lon, center.lat], scale: scale ?? 5000 };
  }

  private async drawPin(center: LonLat): Promise<void> {
    const pinLayer = this.pinLayer;
    if (!pinLayer) return;

    const { default: Graphic } = await import("@arcgis/core/Graphic.js");
    pinLayer.removeAll();
    pinLayer.add(
      new Graphic({
        geometry: { type: "point", longitude: center.lon, latitude: center.lat },
        symbol: {
          type: "simple-marker",
          style: "circle",
          size: 14,
          color: [15, 118, 110, 0.25],
          outline: { color: "#0f766e", width: 2 },
        },
      }),
    );
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

/** `view.goTo` rejects when a newer navigation interrupts it — that's normal. */ function ignoreViewInterruption(
  error: unknown,
): void {
  const name = (error as { name?: string } | null)?.name;
  if (name === "AbortError" || name === "view:goto-interrupted") return;
  console.error(error);
}

function toMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/**
 * Geometry in, plain degrees out — the conversion that keeps ArcGIS objects
 * on this side of the boundary.
 *
 * A `Point`'s `longitude`/`latitude` accessors do the work for WGS84 and Web
 * Mercator and return null for anything else, which is exactly the behaviour
 * we want: a result we cannot place is a result we drop. Reprojecting an
 * arbitrary spatial reference needs the `projection` module, and no sample
 * service in this series uses one.
 */
function toLonLat(geometry: unknown): LonLat | null {
  const point = asPoint(geometry) ?? asPoint((geometry as { extent?: unknown } | null)?.extent);
  if (!point) return null;
  const { longitude, latitude } = point;
  if (typeof longitude !== "number" || typeof latitude !== "number") return null;
  if (Number.isNaN(longitude) || Number.isNaN(latitude)) return null;
  return { lon: longitude, lat: latitude };
}

/** The bounding box of a line or polygon, in degrees, or undefined. */
function toExtent(geometry: unknown): SearchTarget["extent"] {
  const extent = (geometry as { extent?: ExtentLike } | null)?.extent;
  if (!extent) return undefined;

  const min = toLonLat(cornerPoint(extent, "min"));
  const max = toLonLat(cornerPoint(extent, "max"));
  if (!min || !max) return undefined;
  return [min.lon, min.lat, max.lon, max.lat] as const;
}

interface PointLike {
  longitude?: number | null;
  latitude?: number | null;
}

interface ExtentLike {
  xmin: number;
  ymin: number;
  xmax: number;
  ymax: number;
  center?: PointLike | null;
  clone?: () => ExtentLike;
}

function asPoint(value: unknown): PointLike | null {
  if (!value || typeof value !== "object") return null;
  if ("longitude" in value || "latitude" in value) return value as PointLike;
  const center = (value as ExtentLike).center;
  return center ?? null;
}

/**
 * An `Extent` exposes no longitude accessors, but collapsing it to one corner
 * produces an extent whose `center` *is* that corner — and `center` is a
 * `Point`, which does convert.
 */
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
