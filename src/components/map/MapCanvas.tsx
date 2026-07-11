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
