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
}

export interface MapConfig {
  /** ArcGIS Location Platform key. Optional — the default basemaps work without one. */
  apiKey?: string;
  /** Well-known basemap ids, keyed by the app-level basemap name. */
  basemaps: Record<BasemapId, string>;
  initialBasemap: BasemapId;
  initialCamera: CameraState;
  layers: FeatureLayerProperties[];
}
