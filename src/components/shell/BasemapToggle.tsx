"use client";

import { useEngineSnapshot, useMapEngine } from "@/components/map/MapProvider";

/**
 * Google-Maps-style basemap switcher: the card always previews the basemap
 * you would switch *to*. The active basemap lives in the engine snapshot, so
 * this component holds no state of its own.
 */
export function BasemapToggle() {
  const engine = useMapEngine();
  const { basemapId, status } = useEngineSnapshot();

  const next = basemapId === "streets" ? "satellite" : "streets";
  const label = next === "satellite" ? "Satellite" : "Map";

  return (
    <button
      type="button"
      onClick={() => void engine.setBasemap(next)}
      disabled={status !== "ready"}
      aria-label={`Switch to ${label.toLowerCase()} basemap`}
      className="group absolute bottom-8 left-4 z-10 size-16 overflow-hidden rounded-lg shadow-lg shadow-gray-900/10 ring-2 ring-white transition hover:ring-emerald-500 focus:outline-hidden focus:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50"
    >
      <span
        aria-hidden="true"
        className={
          next === "satellite"
            ? "absolute inset-0 bg-linear-to-br from-slate-700 via-emerald-950 to-slate-900"
            : "absolute inset-0 bg-linear-to-br from-emerald-100 via-amber-50 to-sky-100"
        }
      />
      <span
        className={`absolute inset-x-0 bottom-0 py-1 text-center text-[10px] font-medium ${
          next === "satellite" ? "bg-black/40 text-white" : "bg-white/70 text-gray-700"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
