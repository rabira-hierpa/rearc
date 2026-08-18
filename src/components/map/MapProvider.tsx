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

/**
 * Subscribe to one slice of the snapshot instead of all of it.
 *
 * `useEngineSnapshot` re-renders on *any* engine change — including the camera
 * update that fires every time the map settles. A layer panel does not care
 * about the camera, so it selects `snapshot.layers` and re-renders only when
 * that array is replaced.
 *
 * The rule this depends on: **the selector must return a referentially stable
 * value.** React compares consecutive `getSnapshot()` results with `Object.is`
 * and, if a selector builds a new object or array each call, loops until it
 * gives up with "The result of getSnapshot should be cached to avoid an
 * infinite loop". Reach for a field, never a computed collection — the engine
 * is the side that does the caching (see `LayerRegistry.reconcile`).
 */
export function useEngineSelector<T>(select: (snapshot: EngineSnapshot) => T): T {
  const engine = useMapEngine();
  const read = () => select(engine.getSnapshot());
  return useSyncExternalStore(engine.subscribe, read, read);
}
