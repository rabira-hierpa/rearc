"use client";

import { useEngineSnapshot, useMapEngine } from "@/components/map/MapProvider";

/**
 * Zoom and home controls, Google Maps style. Note what these handlers do:
 * they call engine commands and read nothing back — the camera readout
 * updates on its own through the snapshot subscription.
 */
export function MapControls() {
  const engine = useMapEngine();
  const { status } = useEngineSnapshot();
  const ready = status === "ready";

  return (
    <div className="absolute right-4 bottom-8 z-10 flex flex-col gap-y-2">
      <button
        type="button"
        onClick={() => engine.goHome()}
        disabled={!ready}
        aria-label="Reset view"
        className={buttonClass}
      >
        <HomeIcon />
      </button>

      <div className="flex flex-col divide-y divide-gray-200 overflow-hidden rounded-lg bg-white shadow-lg shadow-gray-900/10 ring-1 ring-gray-900/5">
        <button
          type="button"
          onClick={() => engine.zoomIn()}
          disabled={!ready}
          aria-label="Zoom in"
          className={groupButtonClass}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          onClick={() => engine.zoomOut()}
          disabled={!ready}
          aria-label="Zoom out"
          className={groupButtonClass}
        >
          <MinusIcon />
        </button>
      </div>
    </div>
  );
}

const buttonClass =
  "inline-flex size-10 items-center justify-center rounded-lg bg-white text-gray-600 shadow-lg shadow-gray-900/10 ring-1 ring-gray-900/5 hover:text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50";

const groupButtonClass =
  "inline-flex size-10 items-center justify-center bg-white text-gray-600 hover:text-gray-900 focus:outline-hidden focus:ring-2 focus:ring-inset focus:ring-emerald-500 disabled:pointer-events-none disabled:opacity-50";

function PlusIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg
      className="size-5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
    </svg>
  );
}

function HomeIcon() {
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
      <path d="m3 10.5 9-7.5 9 7.5" />
      <path d="M5 9.5V20h14V9.5" />
    </svg>
  );
}
