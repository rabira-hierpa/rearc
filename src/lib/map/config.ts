import type { MapConfig } from "./types";

/**
 * One source of truth per colour: the ArcGIS renderer and the legend chip in
 * the layer panel both read it. Duplicating the value would mean the map and
 * the legend can drift, which is the classic legend bug.
 */
const COLORS = {
  trailhead: "#059669",
  trail: "#0284c7",
  park: "#65a30d",
} as const;

const SERVICES = "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services";

/**
 * Parts 1–2 use public Esri sample services (LA-area trails) so the repo runs
 * with zero setup. Later posts swap in the Addis Ababa GTFS network and this
 * file is the only place that changes.
 */
export const MAP_CONFIG: MapConfig = {
  apiKey: process.env.NEXT_PUBLIC_ARCGIS_API_KEY,
  basemaps: {
    streets: "streets-navigation-vector",
    satellite: "hybrid",
  },
  initialBasemap: "streets",
  initialCamera: {
    center: { lon: -118.7, lat: 34.09 },
    zoom: 11,
  },
  groups: [
    { id: "network", title: "Network" },
    { id: "context", title: "Context" },
  ],
  // Draw order, bottom first — the order `Map.layers` expects. The panel
  // reverses it, because a legend reads top-down like the map does.
  layers: [
    {
      id: "parks",
      title: "Parks & open space",
      group: "context",
      description: "Protected land the network runs through",
      swatch: { kind: "fill", color: COLORS.park, outline: "#3f6212" },
      opacity: 0.45,
      properties: {
        url: `${SERVICES}/Parks_and_Open_Space/FeatureServer/0`,
        outFields: ["*"],
        renderer: {
          type: "simple",
          symbol: {
            type: "simple-fill",
            color: COLORS.park,
            outline: { color: "#3f6212", width: 0.5 },
          },
        },
      },
    },
    {
      id: "trails",
      title: "Trails",
      group: "network",
      description: "The edges of the network",
      swatch: { kind: "line", color: COLORS.trail },
      properties: {
        url: `${SERVICES}/Trails/FeatureServer/0`,
        outFields: ["*"],
        renderer: {
          type: "simple",
          symbol: { type: "simple-line", color: COLORS.trail, width: 1.5 },
        },
      },
    },
    {
      id: "trailheads",
      title: "Trailheads",
      group: "network",
      description: "The nodes — visible from zoom 11 in",
      swatch: { kind: "point", color: COLORS.trailhead, outline: "#ffffff" },
      properties: {
        url: `${SERVICES}/Trailheads/FeatureServer/0`,
        outFields: ["TRL_NAME", "PARK_NAME", "ELEV_FT", "PARKING"],
        // Points turn to mush when zoomed out. `minScale` is the smallest
        // (most zoomed-out) scale that still draws them; the panel explains
        // the resulting "on but not drawn" state instead of hiding it.
        //
        // Zoom 11 ≈ 1:288,895 and zoom 10 ≈ 1:577,791, so 400,000 sits
        // comfortably between them: on at the initial camera, off after one
        // zoom out. Picking a threshold a few percent from the starting scale
        // makes the layer flicker in and out on the first drag.
        minScale: 400_000,
        popupTemplate: {
          title: "{TRL_NAME}",
          content: [
            {
              type: "fields",
              fieldInfos: [
                { fieldName: "PARK_NAME", label: "Park" },
                { fieldName: "ELEV_FT", label: "Elevation (ft)" },
                { fieldName: "PARKING", label: "Parking" },
              ],
            },
          ],
        },
        renderer: {
          type: "simple",
          symbol: {
            type: "simple-marker",
            size: 8,
            color: COLORS.trailhead,
            outline: { color: "#ffffff", width: 1.5 },
          },
        },
      },
    },
  ],
};
