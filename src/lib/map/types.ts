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

/** Anything with a `remove()` — ArcGIS watch handles, our own subscriptions. */
export interface WatchHandle {
  remove(): void;
}

/** Mirrors the SDK's `Loadable.loadStatus`, kept as our own type on purpose. */
export type LayerStatus = "not-loaded" | "loading" | "loaded" | "failed";

/**
 * How React draws a layer's legend chip. Declared as data so the shell can
 * render a legend without importing a single byte of the ArcGIS SDK.
 */
export type LayerSwatch =
  | { kind: "point"; color: string; outline?: string }
  | { kind: "line"; color: string; dashed?: boolean }
  | { kind: "fill"; color: string; outline?: string };

/** A panel section. Groups are ordered as declared in the config. */
export interface LayerGroup {
  id: string;
  title: string;
}

/**
 * App-level metadata plus the SDK properties, kept apart on purpose.
 *
 * `properties` is handed to the `FeatureLayer` constructor untouched;
 * everything outside it exists for the UI and never reaches the SDK. Mixing
 * the two is how layer configs turn into soup — the panel starts reading
 * renderer internals, and swapping the data source breaks the chrome.
 */
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

/**
 * One row of the layer panel — the only thing React ever learns about a layer.
 *
 * The registry preserves object identity across snapshots for rows whose
 * values did not change, so a component reading `snapshot.layers` re-renders
 * only when a layer actually changes.
 */
export interface LayerState {
  id: string;
  title: string;
  group: string;
  description?: string;
  swatch: LayerSwatch;
  /** The user's intent: is this layer switched on? */
  visible: boolean;
  opacity: number;
  status: LayerStatus;
  /** Set only when `status` is "failed". */
  error: string | null;
  /**
   * False when a visible layer is outside its scale range and therefore not
   * drawn. The toggle says "on", the map shows nothing — the panel needs to
   * be able to explain that.
   */
  inScaleRange: boolean;
}

/**
 * An immutable snapshot of everything React is allowed to know about the map.
 *
 * The engine replaces this object wholesale on every change, so React can use
 * reference equality (`useSyncExternalStore`) to decide when to re-render.
 * Live ArcGIS objects (MapView, layers, graphics) never appear here.
 */
export interface EngineSnapshot {
  status: EngineStatus;
  /** Human-readable message, set only when status is "error". */
  error: string | null;
  basemapId: BasemapId;
  /** Last settled camera position — updated when the view stops moving. */
  camera: CameraState;
  /** Bottom-to-top draw order, same order as `MapConfig.layers`. */
  layers: readonly LayerState[];
}

export interface MapConfig {
  /** ArcGIS Location Platform key. Optional — the default basemaps work without one. */
  apiKey?: string;
  /** Well-known basemap ids, keyed by the app-level basemap name. */
  basemaps: Record<BasemapId, string>;
  initialBasemap: BasemapId;
  initialCamera: CameraState;
  /** Panel sections, in display order. */
  groups: LayerGroup[];
  /** Draw order, bottom first — the order the SDK expects. */
  layers: LayerDefinition[];
}
