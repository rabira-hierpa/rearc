"use client";

import { useEngineSelector } from "@/components/map/MapProvider";
import type { EngineSnapshot } from "@/lib/map/types";

import { LAYER_PANEL_ID } from "./LayerPanel";

/**
 * Opening the panel is Preline's job (`data-hs-overlay`), so this component is
 * a client component for one reason only: the badge.
 *
 * The selector returns a *number*, which makes it the cheapest possible
 * subscriber — `Object.is(3, 3)` is true, so panning, zooming, changing the
 * basemap and dragging an opacity slider all leave it alone. It re-renders
 * when a layer is switched on or off, and at no other time.
 */
const selectVisibleCount = (snapshot: EngineSnapshot) =>
  snapshot.layers.reduce((count, layer) => count + (layer.visible ? 1 : 0), 0);

export function LayersButton() {
  const visibleCount = useEngineSelector(selectVisibleCount);

  return (
    <button
      type="button"
      data-hs-overlay={`#${LAYER_PANEL_ID}`}
      aria-label="Open layer panel"
      className="absolute bottom-8 left-24 z-10 inline-flex h-10 items-center gap-x-2 rounded-lg bg-white px-3 text-gray-600 shadow-lg shadow-gray-900/10 ring-1 ring-gray-900/5 hover:text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
    >
      <LayersIcon />
      <span className="text-sm font-medium max-sm:hidden">Layers</span>
      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-emerald-50 px-1.5 text-xs font-medium text-emerald-700 tabular-nums">
        {visibleCount}
      </span>
    </button>
  );
}

function LayersIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </svg>
  );
}
