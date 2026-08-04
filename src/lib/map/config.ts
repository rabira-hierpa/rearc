import type { MapConfig } from "./types";

/**
 * Part 1 uses a public Esri sample service (LA-area trailheads) so the repo
 * runs with zero setup. Later posts swap in the Addis Ababa GTFS network and
 * this file is the only place that changes.
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
  layers: [
    {
      id: "trailheads",
      title: "Trailheads",
      url: "https://services3.arcgis.com/GVgbJbqm8hXASVYi/arcgis/rest/services/Trailheads/FeatureServer/0",
      outFields: ["TRL_NAME", "PARK_NAME", "ELEV_FT", "PARKING"],
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
          color: [16, 185, 129, 0.9],
          outline: { color: [255, 255, 255, 1], width: 1.5 },
        },
      },
    },
  ],
};
