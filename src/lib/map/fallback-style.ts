import type { StyleSpecification } from "maplibre-gl";

export const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export const JOURNEY_FALLBACK_STYLE: StyleSpecification = {
  version: 8,
  sources: {},
  layers: [
    {
      id: "traveltrace-background",
      type: "background",
      paint: {
        "background-color": "#f5f1e7",
      },
    },
  ],
};
