"use client";

import { memo } from "react";

import { useEngineSelector, useMapEngine } from "@/components/map/MapProvider";
import { MAP_CONFIG } from "@/lib/map/config";
import type { EngineSnapshot, LayerState, LayerSwatch } from "@/lib/map/types";

/**
 * Module scope on purpose. A selector defined inside the component would be a
 * new function every render — harmless here, since what matters is that the
 * *returned value* is stable, but keeping it out here makes the rule obvious:
 * reach for a field, never build a new array.
 */
const selectLayers = (snapshot: EngineSnapshot) => snapshot.layers;

export const LAYER_PANEL_ID = "layer-panel";

/**
 * A Preline slide-over driven by `data-hs-overlay` — no React state for the
 * open/closed part, no `useState` mirroring what the DOM already knows.
 *
 * The contents are a different matter: they read layer rows from the engine
 * snapshot and issue commands back. That is the whole one-way loop — the
 * checkbox never toggles itself, it asks the engine to change the layer and
 * re-renders when the new snapshot says it did.
 */
export function LayerPanel() {
  const engine = useMapEngine();
  const layers = useEngineSelector(selectLayers);

  const visibleCount = layers.filter((layer) => layer.visible).length;
  // The config lists layers bottom-first (draw order); a legend reads
  // top-down, the way the map stacks them. `toReversed` copies — reversing
  // the snapshot array in place would mutate state React is holding.
  const topDown = layers.toReversed();
  const sections = MAP_CONFIG.groups
    .map((group) => ({
      group,
      rows: topDown.filter((layer) => layer.group === group.id),
    }))
    .filter((section) => section.rows.length > 0);

  return (
    <aside
      id={LAYER_PANEL_ID}
      // `[--overlay-backdrop:false]`: a dimmed backdrop would fight the point
      // of the panel, which is watching layers appear and disappear. And with
      // nothing blocked behind it, this is a complementary panel rather than
      // a dialog — hence <aside>, not role="dialog".
      className="hs-overlay hs-overlay-open:translate-x-0 fixed start-0 top-0 z-60 hidden h-full w-full max-w-sm -translate-x-full transform border-e border-gray-200 bg-white transition-all duration-300 [--overlay-backdrop:false]"
      tabIndex={-1}
      aria-labelledby="layer-panel-title"
    >
      <div className="flex h-full flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
          <div>
            <h2 id="layer-panel-title" className="font-semibold text-gray-800">
              Layers
            </h2>
            <p className="text-xs text-gray-500">
              {visibleCount} of {layers.length} shown
            </p>
          </div>

          <div className="flex items-center gap-x-1">
            <button
              type="button"
              onClick={() => engine.setAllLayersVisible(visibleCount !== layers.length)}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 focus:bg-gray-100 focus:outline-hidden"
            >
              {visibleCount === layers.length ? "Hide all" : "Show all"}
            </button>
            <button
              type="button"
              data-hs-overlay={`#${LAYER_PANEL_ID}`}
              aria-label="Close layer panel"
              className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 focus:bg-gray-100 focus:outline-hidden"
            >
              <CloseIcon />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-2">
          {sections.map(({ group, rows }) => (
            <section key={group.id} className="mb-2">
              <h3 className="px-2 py-1.5 text-xs font-medium tracking-wide text-gray-400 uppercase">
                {group.title}
              </h3>
              <ul>
                {rows.map((layer) => (
                  <LayerRow key={layer.id} layer={layer} />
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="border-t border-gray-200 px-4 py-2 text-xs text-gray-400">
          Draw order runs bottom-up: the last layer here sits on top.
        </footer>
      </div>
    </aside>
  );
}

/**
 * `memo` earns its keep because the registry hands back the *same* row object
 * when nothing about that layer changed. Toggle one layer and only that row
 * re-renders; pan the map and none of them do.
 */
const LayerRow = memo(function LayerRow({ layer }: { layer: LayerState }) {
  const engine = useMapEngine();
  const failed = layer.status === "failed";
  const loading = layer.status === "loading" || layer.status === "not-loaded";
  const outOfRange = layer.visible && !failed && !layer.inScaleRange;

  return (
    <li className="rounded-lg px-2 py-2 hover:bg-gray-50">
      <div className="flex items-start gap-x-3">
        <Switch
          checked={layer.visible}
          disabled={failed}
          label={`Show ${layer.title}`}
          onChange={() => engine.toggleLayer(layer.id)}
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-x-2">
            <Swatch swatch={layer.swatch} />
            <span className="truncate text-sm font-medium text-gray-800">{layer.title}</span>
            {loading && <span className="text-xs text-gray-400">loading…</span>}
          </div>

          {failed ? (
            <p className="mt-0.5 text-xs break-words text-red-600">
              Failed to load — {layer.error}
            </p>
          ) : outOfRange ? (
            <p className="mt-0.5 flex items-center gap-x-1.5 text-xs text-amber-600">
              Hidden at this zoom
              <button
                type="button"
                onClick={() => engine.zoomToLayerScale(layer.id)}
                className="font-medium text-emerald-700 underline underline-offset-2 hover:text-emerald-800 focus:outline-hidden"
              >
                Zoom in
              </button>
            </p>
          ) : (
            layer.description && <p className="mt-0.5 text-xs text-gray-500">{layer.description}</p>
          )}

          {layer.visible && !failed && (
            <div className="mt-2 flex items-center gap-x-2">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={layer.opacity}
                aria-label={`${layer.title} opacity`}
                onChange={(event) =>
                  engine.setLayerOpacity(layer.id, event.currentTarget.valueAsNumber)
                }
                className="h-1 w-28 cursor-pointer accent-emerald-600"
              />
              <span className="font-mono text-[10px] text-gray-400 tabular-nums">
                {Math.round(layer.opacity * 100)}%
              </span>

              <span className="ms-auto flex items-center gap-x-1">
                <RowAction onClick={() => engine.isolateLayer(layer.id)}>Only</RowAction>
                <RowAction onClick={() => void engine.zoomToLayer(layer.id)}>Zoom to</RowAction>
              </span>
            </div>
          )}
        </div>
      </div>
    </li>
  );
});

function RowAction({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-gray-500 hover:bg-gray-200 hover:text-gray-700 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
    >
      {children}
    </button>
  );
}

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <label className="relative mt-0.5 inline-flex shrink-0 cursor-pointer items-center has-disabled:cursor-not-allowed has-disabled:opacity-50">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        aria-label={label}
        className="peer sr-only"
      />
      {/* `block` matters: a bare <span> is display:inline, and width/height
          are ignored on inline boxes — the track would render 0×0. */}
      <span className="block h-5 w-9 rounded-full bg-gray-300 transition peer-checked:bg-emerald-600 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500 peer-focus-visible:ring-offset-2" />
      <span className="pointer-events-none absolute start-0.5 size-4 rounded-full bg-white shadow-sm transition peer-checked:translate-x-4" />
    </label>
  );
}

/**
 * The legend, rendered from the same colour constant the ArcGIS renderer uses.
 * No `Legend` widget, no SDK import — just data from the layer definition.
 */
function Swatch({ swatch }: { swatch: LayerSwatch }) {
  if (swatch.kind === "line") {
    return (
      <span
        aria-hidden="true"
        className="inline-block h-0.5 w-4 shrink-0 rounded-full"
        style={{ backgroundColor: swatch.color }}
      />
    );
  }

  if (swatch.kind === "fill") {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-3.5 shrink-0 rounded-sm"
        style={{
          backgroundColor: swatch.color,
          opacity: 0.6,
          outline: swatch.outline ? `1px solid ${swatch.outline}` : undefined,
        }}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{
        backgroundColor: swatch.color,
        boxShadow: swatch.outline ? `0 0 0 1.5px ${swatch.outline}` : undefined,
      }}
    />
  );
}

function CloseIcon() {
  return (
    <svg
      className="size-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}
