"use client";

import { useEngineSnapshot } from "@/components/map/MapProvider";

/**
 * The proof that the architecture works: this component knows nothing about
 * ArcGIS, yet it tracks the map camera. Pan or zoom and watch it update —
 * the engine publishes a new snapshot each time the view settles.
 */
export function CameraReadout() {
  const { camera, status } = useEngineSnapshot();
  if (status !== "ready") return null;

  return (
    <output className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 font-mono text-xs text-gray-600 shadow-sm ring-1 ring-gray-900/5 backdrop-blur-sm max-sm:hidden">
      {camera.center.lat.toFixed(4)}, {camera.center.lon.toFixed(4)} · z{camera.zoom.toFixed(1)}
    </output>
  );
}
