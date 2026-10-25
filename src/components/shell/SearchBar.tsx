"use client";

/*
 * Three a11y rules are switched off for this file, deliberately — unlike the
 * role="dialog" complaint in Part 2, these ones are wrong here.
 *
 * This is the WAI-ARIA Authoring Practices combobox: a text input paired with
 * a `listbox` of `option`s, navigated with `aria-activedescendant` while focus
 * stays in the input. The rules suggest `<select>`/`<datalist>` instead, which
 * cannot render two-line results with icons, cannot be filled from an async
 * query, and cannot be styled. They also want key handlers on each option —
 * but in this pattern options are never focused; the input owns the keyboard.
 *
 * (One directive per comment: oxlint ignores extra ones sharing a comment.)
 */
// oxlint-disable jsx-a11y/prefer-tag-over-role
// oxlint-disable jsx-a11y/no-noninteractive-element-to-interactive-role
// oxlint-disable jsx-a11y/click-events-have-key-events

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { useEngineSelector, useMapEngine } from "@/components/map/MapProvider";
import { MAP_CONFIG } from "@/lib/map/config";
import type { EngineSnapshot, SearchResult, SearchResultKind } from "@/lib/map/types";

import { useDebouncedValue } from "./useDebouncedValue";

const selectPin = (snapshot: EngineSnapshot) => snapshot.pin;

const SECTIONS: { kind: SearchResultKind; label: string }[] = [
  { kind: "layer", label: "Layers" },
  { kind: "feature", label: "Features" },
  { kind: "place", label: "Places" },
];

/**
 * The search pill, and the one place in this app where React owns async state.
 *
 * The engine exposes `search(term, signal)` — a plain async function, not
 * snapshot state. The candidate list below belongs to this component: nothing
 * else in the app needs to know what you have half-typed. What *is* shared —
 * the result you commit to — goes back through `engine.goToResult`, lands in
 * the snapshot as `pin`, and is drawn on the map for everyone.
 */
export function SearchBar({ menu }: { menu: ReactNode }) {
  const engine = useMapEngine();
  const pin = useEngineSelector(selectPin);

  const [term, setTerm] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 250 ms: long enough that typing "trailhead" is one round trip instead of
  // nine, short enough that it still feels like the list is keeping up.
  const debouncedTerm = useDebouncedValue(term, 250);
  const enabled = debouncedTerm.trim().length >= MAP_CONFIG.search.minTermLength;

  const { data, isFetching, isError, error } = useQuery({
    queryKey: ["search", debouncedTerm.trim().toLowerCase()],
    // `signal` comes from TanStack Query and is aborted when the key changes
    // or the component unmounts — it flows all the way to queryFeatures and
    // the geocoder, so superseded requests die at the network layer.
    queryFn: ({ signal }) => engine.search(debouncedTerm, signal),
    enabled,
    // Keep the previous list on screen while the next one loads, so the
    // dropdown doesn't blank out on every keystroke.
    placeholderData: keepPreviousData,
  });

  const results = data?.results ?? [];
  const failures = data?.failures ?? [];
  const showPanel = open && enabled;

  function commit(result: SearchResult) {
    setTerm(result.title);
    setOpen(false);
    void engine.goToResult(result);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (results.length === 0) return;
      setOpen(true);
      setActiveIndex((index) => {
        const next = event.key === "ArrowDown" ? index + 1 : index - 1;
        return (next + results.length) % results.length;
      });
      return;
    }
    if (event.key === "Enter") {
      const result = results[activeIndex];
      if (showPanel && result) {
        event.preventDefault();
        commit(result);
      }
    }
  }

  return (
    <div className="absolute top-4 left-4 z-30 w-[min(92vw,25rem)]">
      <div
        ref={containerRef}
        onBlur={(event) => {
          // Closing on blur, but not when focus moved to a result inside us.
          if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
        }}
      >
        <div className="flex items-center gap-x-1 rounded-full bg-white py-1.5 pr-2 pl-1.5 shadow-lg shadow-gray-900/10 ring-1 ring-gray-900/5">
          {menu}

          <input
            type="text"
            value={term}
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={
              showPanel && results[activeIndex] ? `${listId}-${activeIndex}` : undefined
            }
            placeholder="Search layers, features and places"
            aria-label="Search the map"
            autoComplete="off"
            onChange={(event) => {
              setTerm(event.currentTarget.value);
              setActiveIndex(0);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            // Focus alone isn't enough: after Escape the input is still
            // focused, so only a click can ask for the list back.
            onClick={() => setOpen(true)}
            onKeyDown={onKeyDown}
            className="min-w-0 flex-1 bg-transparent text-sm text-gray-800 placeholder:text-gray-400 focus:outline-hidden"
          />

          {term && (
            <button
              type="button"
              onClick={() => {
                setTerm("");
                setOpen(false);
                engine.clearPin();
              }}
              aria-label="Clear search"
              className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-hidden"
            >
              <CloseIcon />
            </button>
          )}

          <span className="inline-flex size-9 shrink-0 items-center justify-center text-gray-400">
            {isFetching && enabled ? <Spinner /> : <SearchIcon />}
          </span>
        </div>

        {showPanel && (
          <div className="mt-2 max-h-[min(60vh,28rem)] overflow-y-auto rounded-xl bg-white p-1 shadow-xl ring-1 ring-gray-900/5">
            {isError && (
              <p className="px-3 py-2 text-sm text-red-600">
                Search failed — {error instanceof Error ? error.message : "unknown error"}
              </p>
            )}

            {!isError && results.length === 0 && !isFetching && (
              <p className="px-3 py-2 text-sm text-gray-500">No matches for “{debouncedTerm}”.</p>
            )}

            <ul id={listId} role="listbox" aria-label="Search results">
              {SECTIONS.map(({ kind, label }) => {
                const section = results.filter((result) => result.kind === kind);
                if (section.length === 0) return null;

                return (
                  <li key={kind} role="group" aria-label={label}>
                    <p
                      aria-hidden="true"
                      className="px-3 pt-2 pb-1 text-xs font-medium tracking-wide text-gray-400 uppercase"
                    >
                      {label}
                    </p>
                    <ul role="none">
                      {section.map((result) => {
                        const index = results.indexOf(result);
                        return (
                          <ResultRow
                            key={result.id}
                            id={`${listId}-${index}`}
                            result={result}
                            active={index === activeIndex}
                            onPointerEnter={() => setActiveIndex(index)}
                            onSelect={() => commit(result)}
                          />
                        );
                      })}
                    </ul>
                  </li>
                );
              })}
            </ul>

            {failures.map((failure) => (
              <p key={failure.kind} className="px-3 py-2 text-xs text-amber-600">
                {sourceLabel(failure.kind)} unavailable — {failure.message}
              </p>
            ))}

            {!MAP_CONFIG.apiKey && (
              <p className="border-t border-gray-100 px-3 py-2 text-xs text-gray-400">
                Place search needs an ArcGIS API key — set{" "}
                <code className="font-mono">NEXT_PUBLIC_ARCGIS_API_KEY</code>.
              </p>
            )}
          </div>
        )}
      </div>

      {pin && !showPanel && (
        <div className="mt-2 inline-flex max-w-full items-center gap-x-2 rounded-full bg-white py-1 pr-1 pl-3 text-sm shadow-lg shadow-gray-900/10 ring-1 ring-gray-900/5">
          <span className="size-2 shrink-0 rounded-full bg-teal-600" aria-hidden="true" />
          <span className="truncate text-gray-700">{pin.title}</span>
          <button
            type="button"
            onClick={() => engine.clearPin()}
            aria-label="Clear the map marker"
            className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-hidden"
          >
            <CloseIcon />
          </button>
        </div>
      )}
    </div>
  );
}

function ResultRow({
  id,
  result,
  active,
  onPointerEnter,
  onSelect,
}: {
  id: string;
  result: SearchResult;
  active: boolean;
  onPointerEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <li
      id={id}
      role="option"
      aria-selected={active}
      onPointerEnter={onPointerEnter}
      // Keep focus in the input so typing never breaks; the click still fires.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={`flex cursor-pointer items-center gap-x-3 rounded-lg px-3 py-2 ${
        active ? "bg-emerald-50" : ""
      }`}
    >
      <ResultIcon kind={result.kind} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm text-gray-800">{result.title}</span>
        {result.subtitle && (
          <span className="block truncate text-xs text-gray-500">{result.subtitle}</span>
        )}
      </span>
    </li>
  );
}

function sourceLabel(kind: SearchResultKind): string {
  return SECTIONS.find((section) => section.kind === kind)?.label ?? kind;
}

function ResultIcon({ kind }: { kind: SearchResultKind }) {
  const paths: Record<SearchResultKind, ReactNode> = {
    layer: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 13 9 5 9-5" />
      </>
    ),
    feature: (
      <>
        <circle cx="12" cy="10" r="3" />
        <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11Z" />
      </>
    ),
    place: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3.6 9h16.8M3.6 15h16.8M12 3a16 16 0 0 1 0 18a16 16 0 0 1 0-18Z" />
      </>
    ),
  };

  return (
    <svg
      className="size-4 shrink-0 text-gray-400"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}

function SearchIcon() {
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
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function Spinner() {
  return (
    <output
      aria-label="Searching"
      className="size-4 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent"
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
