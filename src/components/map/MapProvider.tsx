"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { MAP_CONFIG } from "@/lib/map/config";
import { MapEngine } from "@/lib/map/MapEngine";
import type { EngineSnapshot } from "@/lib/map/types";

const MapEngineContext = createContext<MapEngine | null>(null);

/**
 * Context carries the engine *instance* — a stable reference that never
 * changes, so putting it in context never causes a re-render. State flows
 * separately, through `useEngineSnapshot` below.
 */
export function MapProvider({ children }: { children: ReactNode }) {
  const [engine] = useState(() => new MapEngine(MAP_CONFIG));

  useEffect(() => () => engine.destroy(), [engine]);

  return <MapEngineContext value={engine}>{children}</MapEngineContext>;
}

/** The engine itself, for issuing commands (`engine.zoomIn()` etc.). */
export function useMapEngine(): MapEngine {
  const engine = useContext(MapEngineContext);
  if (!engine) {
    throw new Error("useMapEngine must be used inside <MapProvider>.");
  }
  return engine;
}

/**
 * The engine's current state as an immutable snapshot. Components that call
 * this re-render exactly when the snapshot object is replaced — never because
 * of anything React-side.
 */
export function useEngineSnapshot(): EngineSnapshot {
  const engine = useMapEngine();
  return useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    // On the server (and first client render) the constructor's initial
    // snapshot is returned, so SSR output and hydration always agree.
    engine.getSnapshot,
  );
}
