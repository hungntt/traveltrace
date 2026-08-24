"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Map as MapLibreMap,
  Marker,
  Popup,
  NavigationControl,
  type GeoJSONSource,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

import { JOURNEY_SESSION_KEY } from "@/lib/journey-storage";
import { getOrderedPlaces } from "@/lib/map/order";
import {
  buildPreparedFullRouteFeatureCollection,
  buildOptimizedProgressRoute,
  calculateTotalRouteDistance,
  formatDistance,
  getPreparedRouteBounds,
  getTravelerState,
  prepareSegments,
  type PreparedSegment,
} from "@/lib/map/build-route";
import {
  JOURNEY_FALLBACK_STYLE,
  OPEN_FREE_MAP_STYLE,
} from "@/lib/map/fallback-style";
import type { PlaceImportResult, TravelPlace } from "@/types/import";
import { JourneyControls } from "./JourneyControls";

function CompassMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="20" />
      <path d="m30.8 16.4-4.2 10.2-10.2 4.2 4.2-10.2Z" />
      <circle cx="24" cy="24" r="2.2" />
    </svg>
  );
}

// Directional Traveler DOM marker. DOM elements render reliably via CSS regardless of the
// WebGL rendering pipeline, so this is what users actually see; a mirrored MapLibre GL
// layer (traveler-point/traveler-dot) exists solely so canvas.captureStream() can record it.
function createTravelerElement(): { container: HTMLDivElement; pointer: HTMLElement } {
  const container = document.createElement("div");
  container.className = "traveler-marker-pin";
  container.setAttribute("aria-label", "Current traveler position");

  const pulse = document.createElement("div");
  pulse.className = "traveler-pulse";
  container.appendChild(pulse);

  const avatar = document.createElement("div");
  avatar.className = "traveler-avatar";

  const pointer = document.createElement("div");
  pointer.className = "traveler-pointer";
  pointer.innerHTML = `
    <svg viewBox="0 0 24 24" width="20" height="20" fill="#ffffff" filter="drop-shadow(0px 1px 2px rgba(0,0,0,0.35))">
      <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71L12 2z" />
    </svg>
  `;
  avatar.appendChild(pointer);
  container.appendChild(avatar);

  return { container, pointer };
}

// Clean, minimal destination dot DOM marker (no visible numbers). Rendered as a DOM element
// for the same reliability reason as the traveler marker above.
function createStopMarkerElement(stopNumber: number, placeName: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "journey-stop-marker";
  el.dataset.stop = String(stopNumber);
  el.setAttribute("aria-label", placeName);
  el.title = placeName;

  return el;
}

// Safe DOM Popup Content (No HTML injection)
function createStopPopupContent(place: TravelPlace): HTMLElement {
  const card = document.createElement("div");
  card.className = "map-popup-card";

  const title = document.createElement("strong");
  title.className = "popup-title";
  title.textContent = place.name;
  card.appendChild(title);

  if (place.address) {
    const address = document.createElement("p");
    address.className = "popup-address";
    address.textContent = place.address;
    card.appendChild(address);
  }

  if (place.visitedAt) {
    const date = document.createElement("span");
    date.className = "popup-date";
    date.textContent = `📅 ${place.visitedAt}`;
    card.appendChild(date);
  }

  return card;
}

// Cross-browser Fullscreen API helpers
type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  msFullscreenElement?: Element | null;
  msExitFullscreen?: () => Promise<void> | void;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
  msRequestFullscreen?: () => Promise<void> | void;
};

function getFullscreenElementCompat(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? doc.msFullscreenElement ?? null;
}

function requestFullscreenCompat(el: HTMLElement): Promise<void> {
  const target = el as FullscreenElement;
  if (target.requestFullscreen) return target.requestFullscreen();
  if (target.webkitRequestFullscreen) return Promise.resolve(target.webkitRequestFullscreen());
  if (target.msRequestFullscreen) return Promise.resolve(target.msRequestFullscreen());
  return Promise.reject(new Error("Fullscreen API is not supported in this browser."));
}

function exitFullscreenCompat(): Promise<void> {
  const doc = document as FullscreenDocument;
  if (document.exitFullscreen) return document.exitFullscreen();
  if (doc.webkitExitFullscreen) return Promise.resolve(doc.webkitExitFullscreen());
  if (doc.msExitFullscreen) return Promise.resolve(doc.msExitFullscreen());
  return Promise.resolve();
}

// Video export helpers
const EXPORT_MIME_CANDIDATES = [
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  return EXPORT_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

function tryCaptureCanvasStream(map: MapLibreMap): MediaStream | null {
  try {
    return map.getCanvas().captureStream(30);
  } catch {
    return null;
  }
}

const EXPORT_ONLY_LAYER_IDS = [
  "full-route-halo",
  "full-route-line",
  "completed-route-line",
  "active-segment-line",
  "destination-dots",
  "traveler-halo",
  "traveler-dot",
];

// All the journey GL layers are hidden during normal interactive use — a canvas2D overlay
// (drawTraceOverlay) and DOM markers render the trace/dots/traveler reliably instead, since
// WebGL line/circle layers can silently fail to paint in constrained/software-rendered
// environments. These GL layers exist solely so canvas.captureStream() has something to
// record; flip them on only while a video export is recording.
function setExportLayersVisible(map: MapLibreMap, visible: boolean): void {
  const visibility = visible ? "visible" : "none";
  for (const layerId of EXPORT_ONLY_LAYER_IDS) {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, "visibility", visibility);
    }
  }
}

function waitForStyleLoad(map: MapLibreMap): Promise<void> {
  return new Promise((resolve) => {
    if (map.isStyleLoaded()) {
      resolve();
      return;
    }
    const onLoad = () => {
      map.off("style.load", onLoad);
      resolve();
    };
    map.on("style.load", onLoad);
  });
}

export function JourneyMap() {
  const [importResult, setImportResult] = useState<PlaceImportResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
  const [animationReady, setAnimationReady] = useState(false);
  const [isFallback, setIsFallback] = useState(false);
  const [mapErrorMessage, setMapErrorMessage] = useState<string | null>(null);
  const [mapRetryKey, setMapRetryKey] = useState(0);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1); // 0.5 | 1 | 2

  // Fullscreen state
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Video export state
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatusText, setExportStatusText] = useState<string | null>(null);

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapViewportRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const travelerMarkerRef = useRef<Marker | null>(null);
  const travelerPointerRef = useRef<HTMLElement | null>(null);
  const stopMarkersRef = useRef<{ marker: Marker; element: HTMLDivElement }[]>([]);
  // Canvas2D trace overlay — draws the same preparedSegments geometry the GL layers use,
  // but via 2D canvas drawing so it renders reliably regardless of WebGL pipeline issues.
  const traceOverlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const traceGeometryRef = useRef<{
    full: [number, number][][];
    completed: [number, number][][];
    active: [number, number][][];
  }>({ full: [], completed: [], active: [] });
  // Animation and lifecycle tracking refs
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(1);
  const pauseRemainingMsRef = useRef(0);
  const lastCompletedSegmentRef = useRef<number>(-1);
  const lastStopSignatureRef = useRef<string | null>(null);
  const lastActiveUpdateTimestampRef = useRef<number>(0);
  const lastUiSyncRef = useRef<number>(0);
  const lastDiagnosticLogRef = useRef<number>(0);
  const routeReadyLogKeyRef = useRef<string | null>(null);
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFallbackRef = useRef(false);

  // Video export refs
  const isExportingRef = useRef(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const exportMimeTypeRef = useRef<string | null>(null);
  const exportForcedFallbackRef = useRef(false);

  // Sync state to refs
  progressRef.current = progress;
  isPlayingRef.current = isPlaying;
  speedRef.current = speed;

  // Load session storage
  useEffect(() => {
    const stored = sessionStorage.getItem(JOURNEY_SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as PlaceImportResult;
        setImportResult(parsed);
      } catch {
        sessionStorage.removeItem(JOURNEY_SESSION_KEY);
      }
    }
    setLoaded(true);
  }, []);

  // Ordered places according to user's chosen ordering mode ("manual" | "date")
  const places: TravelPlace[] = useMemo(() => {
    if (!importResult?.places) return [];
    return getOrderedPlaces(importResult.places, importResult.orderMode ?? "manual");
  }, [importResult]);

  // Precomputed geodesic segment geometry
  const preparedSegments: PreparedSegment[] = useMemo(() => {
    return prepareSegments(places);
  }, [places]);

  // Total route distance
  const totalDistanceKm = useMemo(() => {
    return calculateTotalRouteDistance(places);
  }, [places]);

  // Current traveler status (for UI controls)
  const travelerState = useMemo(() => {
    return getTravelerState(places, progress, preparedSegments);
  }, [places, progress, preparedSegments]);

  // Builds the destination-dot coordinate for a stop from the exact same
  // sampled geometry used for the route and traveler (no separate geometry source).
  const stopCoordinate = (idx: number, place: TravelPlace): [number, number] => {
    return idx === 0
      ? preparedSegments[0]?.unwrappedSamples[0] ?? [place.longitude, place.latitude]
      : preparedSegments[idx - 1]?.unwrappedSamples.at(-1) ?? [place.longitude, place.latitude];
  };

  // Redraws the trace overlay canvas by projecting preparedSegments coordinates through the
  // map's current camera (map.project). This is what users actually see for the route —
  // reliable regardless of WebGL layer rendering — while the mirrored GL line layers stay
  // hidden except during video export.
  const drawTraceOverlay = () => {
    const map = mapRef.current;
    const canvas = traceOverlayCanvasRef.current;
    if (!map || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const targetWidth = Math.max(1, Math.round(width * dpr));
    const targetHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const strokeLines = (
      lines: [number, number][][],
      color: string,
      lineWidth: number,
      opacity: number
    ) => {
      if (lines.length === 0) return;
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = opacity;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (const line of lines) {
        if (line.length < 2) continue;
        ctx.beginPath();
        line.forEach((coord, i) => {
          const p = map.project(coord);
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const { full, completed, active } = traceGeometryRef.current;
    strokeLines(full, "#fffdf8", 7, 0.7); // halo, under everything
    strokeLines(full, "#537864", 3.75, 0.75); // full/future trace
    strokeLines(completed, "#1f6249", 4, 1); // completed trace
    strokeLines(active, "#df7443", 5, 1); // active trace
  };

  // Update route layers, traveler point, and destination dot states.
  // Returns true if visual objects exist and were successfully updated.
  const updateMapVisuals = (
    currentProg: number,
    options?: { updateActive?: boolean; forceCompleted?: boolean }
  ): boolean => {
    const map = mapRef.current;
    if (!map || places.length === 0) return false;

    // 1. Calculate traveler state (uses precomputed samples, zero Turf)
    const state = getTravelerState(places, currentProg, preparedSegments);
    if (!state) return false;

    // 2. Update the DOM traveler marker (every frame) — this is what users actually see,
    // rendered via CSS/DOM so it is unaffected by WebGL rendering hiccups.
    if (travelerMarkerRef.current) {
      travelerMarkerRef.current.setLngLat(state.position);
      if (travelerPointerRef.current) {
        travelerPointerRef.current.style.transform = `rotate(${state.bearing}deg)`;
      }
    } else {
      return false;
    }

    // 2b. Mirror the traveler position into the MapLibre GL point source too, so
    // canvas.captureStream() picks it up during video export.
    const travelerSource = map.getSource("traveler-point") as GeoJSONSource | undefined;
    if (travelerSource) {
      travelerSource.setData({
        type: "Feature",
        properties: { bearing: state.bearing },
        geometry: { type: "Point", coordinates: state.position },
      });
    }

    // 3. Verify GeoJSON route sources exist
    const completedSource = map.getSource("completed-route") as GeoJSONSource | undefined;
    const activeSource = map.getSource("active-segment") as GeoJSONSource | undefined;

    if (!completedSource || !activeSource) {
      return false;
    }

    // 4. Update route layers using precomputed segment geometry
    const { completedGeoJson, activeGeoJson } = buildOptimizedProgressRoute(
      preparedSegments,
      currentProg
    );

    const completedUntil = Math.floor(currentProg);
    const needCompletedUpdate =
      options?.forceCompleted ||
      completedUntil !== lastCompletedSegmentRef.current ||
      currentProg >= places.length - 1 ||
      currentProg === 0;

    if (needCompletedUpdate) {
      completedSource.setData(completedGeoJson);
      lastCompletedSegmentRef.current = completedUntil;
      traceGeometryRef.current.completed = completedGeoJson.features.map(
        (f) => f.geometry.coordinates as [number, number][]
      );
    }

    if (options?.updateActive !== false) {
      activeSource.setData(activeGeoJson);
      traceGeometryRef.current.active = activeGeoJson.features.map(
        (f) => f.geometry.coordinates as [number, number][]
      );
    }

    drawTraceOverlay();

    // 5. Update destination dot states (only rebuild when the state actually changes)
    const isTransit = state.isTransit;
    const departedIdx = state.departedStopIndex;
    const destIdx = state.destinationStopIndex;
    const arrivedIdx = state.arrivedStopIndex ?? 0;
    const isFinal = currentProg >= places.length - 1;

    const stopSignature = `${departedIdx}:${destIdx}:${arrivedIdx}:${isTransit}:${isFinal}`;
    if (lastStopSignatureRef.current !== stopSignature) {
      lastStopSignatureRef.current = stopSignature;

      // DOM stop marker classes — what users actually see.
      stopMarkersRef.current.forEach(({ element }, idx) => {
        const isCompleted = isFinal ? true : isTransit ? idx <= departedIdx : idx <= arrivedIdx;

        element.classList.toggle("completed", isCompleted);
        element.classList.toggle("target-destination", isTransit && idx === destIdx);
        element.classList.toggle("active", !isTransit && idx === arrivedIdx);
      });

      // Mirror the same state into the MapLibre GL destination-dots source for video export.
      const destSource = map.getSource("destination-points") as GeoJSONSource | undefined;
      if (destSource) {
        destSource.setData({
          type: "FeatureCollection",
          features: places.map((place, idx) => {
            const completed = isFinal
              ? true
              : isTransit
              ? idx <= departedIdx
              : idx <= arrivedIdx;
            const isTarget = isTransit && idx === destIdx;

            return {
              type: "Feature",
              properties: { idx, completed, isTarget },
              geometry: { type: "Point", coordinates: stopCoordinate(idx, place) },
            };
          }),
        });
      }
    }

    return true;
  };

  // Guarded helper to initialize TravelTrace GeoJSON sources and layers.
  // Returns true only when all sources, layers, and initial visuals are verified ready.
  const initializeJourneyLayers = (
    map: MapLibreMap,
    currentPlaces: TravelPlace[]
  ): boolean => {
    if (!map || currentPlaces.length === 0) return false;

    try {
      // 1. Add Future / Full Route Line Layer (static during playback)
      const fullRouteGeoJson = buildPreparedFullRouteFeatureCollection(preparedSegments);
      traceGeometryRef.current.full = fullRouteGeoJson.features.map(
        (f) => f.geometry.coordinates as [number, number][]
      );
      if (!map.getSource("full-route")) {
        map.addSource("full-route", {
          type: "geojson",
          data: fullRouteGeoJson,
        });
      } else {
        (map.getSource("full-route") as GeoJSONSource).setData(fullRouteGeoJson);
      }

      if (!map.getLayer("full-route-halo")) {
        map.addLayer({
          id: "full-route-halo",
          type: "line",
          source: "full-route",
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: "none",
          },
          paint: {
            "line-color": "#fffdf8",
            "line-width": 7,
            "line-opacity": 0.7,
          },
        });
      }

      if (!map.getLayer("full-route-line")) {
        map.addLayer({
          id: "full-route-line",
          type: "line",
          source: "full-route",
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: "none",
          },
          paint: {
            "line-color": "#537864",
            "line-width": 3.75,
            "line-opacity": 0.75,
          },
        });
      }

      // 2. Add Completed Route Layer
      if (!map.getSource("completed-route")) {
        map.addSource("completed-route", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      if (!map.getLayer("completed-route-line")) {
        map.addLayer({
          id: "completed-route-line",
          type: "line",
          source: "completed-route",
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: "none",
          },
          paint: {
            "line-color": "#1f6249", // TravelTrace dark green
            "line-width": 4,
            "line-opacity": 1,
          },
        });
      }

      // 3. Add Active Segment Layer
      if (!map.getSource("active-segment")) {
        map.addSource("active-segment", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      if (!map.getLayer("active-segment-line")) {
        map.addLayer({
          id: "active-segment-line",
          type: "line",
          source: "active-segment",
          layout: {
            "line-cap": "round",
            "line-join": "round",
            visibility: "none",
          },
          paint: {
            "line-color": "#df7443", // TravelTrace orange
            "line-width": 5,
            "line-opacity": 1,
          },
        });
      }

      // 4. Add Destination Dot Layer. Hidden by default — the DOM stop markers below are
      // what users see; this layer is switched to visible only while recording a video
      // export, so canvas.captureStream() has something to record.
      if (!map.getSource("destination-points")) {
        map.addSource("destination-points", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }

      if (!map.getLayer("destination-dots")) {
        map.addLayer({
          id: "destination-dots",
          type: "circle",
          source: "destination-points",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 5,
            "circle-color": [
              "case",
              ["==", ["get", "isTarget"], true],
              "#df7443", // orange — current target
              ["==", ["get", "completed"], true],
              "#1f6249", // dark green — completed
              "#fffdf8", // cream — upcoming
            ],
            "circle-stroke-color": "#1f6249",
            "circle-stroke-width": 1.5,
          },
        });
      }

      // 5. Add Traveler Point Layer (circle glow + dot). Also hidden by default for the
      // same reason — the DOM traveler marker below is the reliable, visible one.
      if (!map.getSource("traveler-point")) {
        map.addSource("traveler-point", {
          type: "geojson",
          data: {
            type: "Feature",
            properties: { bearing: 0 },
            geometry: {
              type: "Point",
              coordinates: preparedSegments[0]?.unwrappedSamples[0] ?? [
                currentPlaces[0].longitude,
                currentPlaces[0].latitude,
              ],
            },
          },
        });
      }

      if (!map.getLayer("traveler-halo")) {
        map.addLayer({
          id: "traveler-halo",
          type: "circle",
          source: "traveler-point",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 14,
            "circle-color": "#df7443",
            "circle-opacity": 0.25,
          },
        });
      }

      if (!map.getLayer("traveler-dot")) {
        map.addLayer({
          id: "traveler-dot",
          type: "circle",
          source: "traveler-point",
          layout: { visibility: "none" },
          paint: {
            "circle-radius": 7,
            "circle-color": "#df7443",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      }

      // Explicitly restore the journey stack above every basemap layer, in order.
      for (const layerId of [
        "full-route-halo",
        "full-route-line",
        "completed-route-line",
        "active-segment-line",
        "destination-dots",
        "traveler-halo",
        "traveler-dot",
      ]) {
        if (map.getLayer(layerId)) {
          map.moveLayer(layerId);
        }
      }

      // 6. Add Destination Dot DOM Markers with Safe Popups — the reliable, visible stops.
      stopMarkersRef.current.forEach(({ marker }) => marker.remove());
      stopMarkersRef.current = currentPlaces.map((place, idx) => {
        const stopNum = idx + 1;
        const el = createStopMarkerElement(stopNum, place.name);

        const popup = new Popup({
          offset: 12,
          closeButton: false,
          className: "custom-map-popup",
        }).setDOMContent(createStopPopupContent(place));

        const marker = new Marker({ element: el })
          .setLngLat(stopCoordinate(idx, place))
          .setPopup(popup)
          .addTo(map);

        el.addEventListener("click", () => {
          seekTo(idx);
        });

        return { marker, element: el };
      });

      // 7. Add Directional Traveler DOM Marker — the reliable, visible traveler.
      travelerMarkerRef.current?.remove();
      const { container: travelerEl, pointer: travelerPointer } = createTravelerElement();
      const initialPos: [number, number] = preparedSegments[0]?.unwrappedSamples[0] ?? [
        currentPlaces[0].longitude,
        currentPlaces[0].latitude,
      ];

      const travelerMarker = new Marker({
        element: travelerEl,
        anchor: "center",
      });

      if (
        typeof (
          travelerMarker as unknown as {
            setSubpixelPositioning?: (v: boolean) => Marker;
          }
        ).setSubpixelPositioning === "function"
      ) {
        (
          travelerMarker as unknown as {
            setSubpixelPositioning: (v: boolean) => Marker;
          }
        ).setSubpixelPositioning(true);
      }

      travelerMarker.setLngLat(initialPos).addTo(map);

      travelerMarkerRef.current = travelerMarker;
      travelerPointerRef.current = travelerPointer;

      // Verify every required source, layer, and marker.
      const hasFullRoute = Boolean(map.getSource("full-route"));
      const hasFullRouteLine = Boolean(map.getLayer("full-route-line"));
      const hasCompletedRoute = Boolean(map.getSource("completed-route"));
      const hasActiveSegment = Boolean(map.getSource("active-segment"));
      const hasDestinationPoints = Boolean(map.getSource("destination-points"));
      const hasTraveler = Boolean(map.getSource("traveler-point"));
      const hasTravelerMarker = Boolean(travelerMarkerRef.current);
      const hasAllStopMarkers = stopMarkersRef.current.length === currentPlaces.length;

      if (
        !hasFullRoute ||
        !hasFullRouteLine ||
        !hasCompletedRoute ||
        !hasActiveSegment ||
        !hasDestinationPoints ||
        !hasTraveler ||
        !hasTravelerMarker ||
        !hasAllStopMarkers
      ) {
        console.warn("[TravelTrace map] Layer initialization incomplete - missing source, layer, or marker.");
        return false;
      }

      lastStopSignatureRef.current = null;
      const visualUpdated = updateMapVisuals(progressRef.current, {
        updateActive: true,
        forceCompleted: true,
      });

      if (process.env.NODE_ENV !== "production") {
        const expectedSegments = currentPlaces.length - 1;
        const everyFeatureHasLine = fullRouteGeoJson.features.every(
          (feature) => feature.geometry.coordinates.length >= 2
        );

        console.assert(
          preparedSegments.length === expectedSegments,
          "[TravelTrace route] Prepared segment count does not match stop count."
        );
        console.assert(hasFullRoute, "[TravelTrace route] full-route source is missing.");
        console.assert(hasFullRouteLine, "[TravelTrace route] full-route-line layer is missing.");
        console.assert(
          fullRouteGeoJson.features.length === expectedSegments,
          "[TravelTrace route] Full-route feature count does not match stop count."
        );
        console.assert(
          everyFeatureHasLine,
          "[TravelTrace route] Every route feature must have at least two coordinates."
        );

        const routeLogKey = currentPlaces
          .map((place) => [place.id, place.longitude, place.latitude].join(":"))
          .join("|");
        if (routeReadyLogKeyRef.current !== routeLogKey) {
          const firstFeature = fullRouteGeoJson.features[0];
          const lastFeature = fullRouteGeoJson.features.at(-1);
          routeReadyLogKeyRef.current = routeLogKey;
          console.info("[TravelTrace route ready]", {
            stops: currentPlaces.length,
            segments: preparedSegments.length,
            firstCoordinate: firstFeature?.geometry.coordinates[0],
            lastCoordinate: lastFeature?.geometry.coordinates.at(-1),
            bounds: getPreparedRouteBounds(preparedSegments, currentPlaces),
          });
        }
      }

      return visualUpdated;
    } catch (err) {
      console.error("[TravelTrace map] Failed to initialize journey layers:", err);
      return false;
    }
  };

  // Initialize MapLibre GL instance
  useEffect(() => {
    if (!loaded || !places.length || !mapContainerRef.current) return;

    setMapStatus("loading");
    setAnimationReady(false);
    setIsFallback(false);
    isFallbackRef.current = false;
    setMapErrorMessage(null);
    lastCompletedSegmentRef.current = -1;
    lastStopSignatureRef.current = null;

    const bounds = getPreparedRouteBounds(preparedSegments, places);

    let mapInstance: MapLibreMap | null = null;

    try {
      mapInstance = new MapLibreMap({
        container: mapContainerRef.current,
        style: OPEN_FREE_MAP_STYLE,
        bounds: bounds,
        fitBoundsOptions: {
          padding: { top: 70, bottom: 90, left: 70, right: 70 },
          maxZoom: 13,
        },
        attributionControl: { compact: true },
      });
      mapRef.current = mapInstance;
      if (process.env.NODE_ENV !== "production") {
        (window as unknown as { __travelTraceMap?: MapLibreMap }).__travelTraceMap = mapInstance;
      }
    } catch (err) {
      console.error("[TravelTrace map] Failed to instantiate MapLibre:", err);
      setMapErrorMessage("Your browser could not start the interactive map.");
      setMapStatus("error");
      return;
    }

    const map = mapInstance;
    map.addControl(
      new NavigationControl({ showCompass: true, showZoom: true }),
      "top-right"
    );

    // Keep the canvas2D trace overlay in sync with the camera during pan/zoom/fitBounds,
    // not just during playback animation frames.
    map.on("move", drawTraceOverlay);
    map.on("resize", drawTraceOverlay);

    // Style load handler (fired for primary style and any fallback style)
    const handleStyleLoad = () => {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }
      try {
        const ready = initializeJourneyLayers(map, places);
        if (ready) {
          setAnimationReady(true);
          setMapStatus("ready");
          requestAnimationFrame(() => {
            map.resize();
            drawTraceOverlay();
          });
        } else {
          setAnimationReady(false);
          console.warn("[TravelTrace map] Layer initialization returned false after style load.");
        }
      } catch (layerErr) {
        console.error("[TravelTrace map] Error initializing journey layers:", layerErr);
        setMapStatus("error");
      }
    };

    map.on("style.load", handleStyleLoad);

    // Map error listener with automatic fallback
    map.on("error", (e) => {
      console.error("[TravelTrace map] error", {
        error: e.error,
        styleLoaded: map.isStyleLoaded(),
      });

      const isFatalWebGL =
        e.error?.message?.toLowerCase().includes("webgl") ||
        e.error?.message?.toLowerCase().includes("context");

      if (isFatalWebGL) {
        setMapErrorMessage("Your browser could not start the interactive map.");
        setMapStatus("error");
        return;
      }

      // If primary style failed to load before becoming ready, switch to fallback
      if (!map.isStyleLoaded() && !isFallbackRef.current) {
        console.warn("[TravelTrace map] Primary style error, switching to fallback style");
        isFallbackRef.current = true;
        setIsFallback(true);
        try {
          map.setStyle(JOURNEY_FALLBACK_STYLE);
        } catch (styleErr) {
          console.error("[TravelTrace map] Fallback setStyle failed:", styleErr);
          setMapStatus("error");
        }
      }
    });

    // 10-second initialization timeout fallback
    initTimeoutRef.current = setTimeout(() => {
      if (!map.isStyleLoaded() && !isFallbackRef.current) {
        console.warn("[TravelTrace map] Primary style timeout (10s), switching to fallback style");
        isFallbackRef.current = true;
        setIsFallback(true);
        try {
          map.setStyle(JOURNEY_FALLBACK_STYLE);
        } catch {
          setMapStatus("error");
        }
      }
    }, 10000);

    return () => {
      if (initTimeoutRef.current) {
        clearTimeout(initTimeoutRef.current);
        initTimeoutRef.current = null;
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      stopMarkersRef.current.forEach(({ marker }) => marker.remove());
      stopMarkersRef.current = [];
      travelerMarkerRef.current?.remove();
      travelerMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
      setAnimationReady(false);
    };
  }, [loaded, places, mapRetryKey]);

  // Fullscreen change tracking (handles Escape and the Exit Fullscreen button alike)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const fsEl = getFullscreenElementCompat();
      const active = Boolean(fsEl && fsEl === mapViewportRef.current);
      setIsFullscreen(active);
      requestAnimationFrame(() => {
        mapRef.current?.resize();
        drawTraceOverlay();
      });
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
    };
  }, []);

  // Main animation frame loop
  useEffect(() => {
    if (!isPlaying || places.length <= 1) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastTimestampRef.current = null;
      return;
    }

    const maxProg = places.length - 1;
    if (progressRef.current >= maxProg) {
      progressRef.current = 0;
      setProgress(0);
      lastCompletedSegmentRef.current = -1;
    }

    // Fast, energetic flight duration: ~1.8s per segment at 1x speed
    const BASE_SEGMENT_DURATION_MS = 1800;
    const STOP_PAUSE_DURATION_MS = 200;

    const animate = (timestamp: number) => {
      if (!isPlayingRef.current) return;

      if (!lastTimestampRef.current) {
        lastTimestampRef.current = timestamp;
      }
      const deltaMs = Math.min(100, timestamp - lastTimestampRef.current);
      lastTimestampRef.current = timestamp;

      // Handle pause at reached stops
      if (pauseRemainingMsRef.current > 0) {
        pauseRemainingMsRef.current -= deltaMs;
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      const segmentDuration = BASE_SEGMENT_DURATION_MS / speedRef.current;
      const progressDelta = deltaMs / segmentDuration;
      let nextProgress = progressRef.current + progressDelta;

      // Check if we crossed a whole integer stop boundary
      const prevStopFloor = Math.floor(progressRef.current);
      const nextStopFloor = Math.floor(nextProgress);

      if (nextStopFloor > prevStopFloor && nextStopFloor < places.length) {
        nextProgress = nextStopFloor;
        pauseRemainingMsRef.current = STOP_PAUSE_DURATION_MS / speedRef.current;
        progressRef.current = nextProgress;
        updateMapVisuals(nextProgress, { updateActive: true, forceCompleted: true });
        setProgress(nextProgress); // Immediate sync at stop
        animationFrameRef.current = requestAnimationFrame(animate);
        return;
      }

      if (nextProgress >= maxProg) {
        nextProgress = maxProg;
        progressRef.current = nextProgress;
        updateMapVisuals(nextProgress, { updateActive: true, forceCompleted: true });
        setProgress(nextProgress); // Immediate sync on journey end
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      progressRef.current = nextProgress;

      // Update traveler point, active orange route, and stop dot states smoothly every frame
      updateMapVisuals(nextProgress, {
        updateActive: true,
        forceCompleted: false,
      });

      // Throttle React progress updates to ~10 FPS (100ms)
      if (timestamp - lastUiSyncRef.current >= 100) {
        setProgress(nextProgress);
        lastUiSyncRef.current = timestamp;
      }

      // Dev-only diagnostic logging (max once per second)
      if (process.env.NODE_ENV !== "production" && timestamp - lastDiagnosticLogRef.current >= 1000) {
        lastDiagnosticLogRef.current = timestamp;
        console.debug("[TravelTrace Animation Diagnostic]", {
          progressRef: progressRef.current,
          reactProgress: progressRef.current,
          animationReady,
          activeSourceExists: Boolean(mapRef.current?.getSource("active-segment")),
          completedSourceExists: Boolean(mapRef.current?.getSource("completed-route")),
          mapLoaded: mapRef.current?.loaded(),
          styleLoaded: mapRef.current?.isStyleLoaded(),
        });
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isPlaying, places, preparedSegments]);

  // Stop the recorder automatically once the animation loop finishes (or is halted) during export
  useEffect(() => {
    if (!isExporting || isPlaying) return;
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    const stopTimer = window.setTimeout(() => {
      recorder.stop();
    }, 250);
    return () => window.clearTimeout(stopTimer);
  }, [isPlaying, isExporting]);

  // Keep the export status label current while recording
  useEffect(() => {
    if (!isExporting || !travelerState) return;
    const totalStops = places.length;
    const label = travelerState.isTransit
      ? `Recording — heading to stop ${travelerState.destinationStopIndex + 1} of ${totalStops}`
      : `Recording — stop ${(travelerState.arrivedStopIndex ?? 0) + 1} of ${totalStops}`;
    setExportStatusText(label);
  }, [isExporting, travelerState, places.length]);

  // Controls Handlers
  const handlePlay = () => {
    if (places.length <= 1 || !animationReady) return;
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const resetProgressToStart = () => {
    progressRef.current = 0;
    setProgress(0);
    pauseRemainingMsRef.current = 0;
    lastCompletedSegmentRef.current = -1;
    updateMapVisuals(0, { updateActive: true, forceCompleted: true });
  };

  const handleReplay = () => {
    resetProgressToStart();
    fitWholeJourney();
    if (places.length > 1 && animationReady) {
      setIsPlaying(true);
    }
  };

  const handlePrev = () => {
    setIsPlaying(false);
    const prevStop = Math.max(0, Math.floor(progressRef.current - 0.05));
    seekTo(prevStop);
  };

  const handleNext = () => {
    setIsPlaying(false);
    const maxProg = Math.max(0, places.length - 1);
    const nextStop = Math.min(maxProg, Math.floor(progressRef.current + 1.05));
    seekTo(nextStop);
  };

  const seekTo = (targetProg: number) => {
    const maxProg = Math.max(0, places.length - 1);
    const clamped = Math.max(0, Math.min(maxProg, targetProg));
    progressRef.current = clamped;
    setProgress(clamped);
    pauseRemainingMsRef.current = 0;
    updateMapVisuals(clamped, { updateActive: true, forceCompleted: true });
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
  };

  const fitWholeJourney = () => {
    if (!mapRef.current || places.length === 0) return;
    const bounds = getPreparedRouteBounds(preparedSegments, places);
    mapRef.current.fitBounds(bounds, {
      padding: { top: 70, bottom: 90, left: 70, right: 70 },
      maxZoom: 13,
      duration: 1000,
    });
  };

  const handleRetryMap = () => {
    if (initTimeoutRef.current) {
      clearTimeout(initTimeoutRef.current);
      initTimeoutRef.current = null;
    }
    setAnimationReady(false);
    setMapStatus("loading");
    setIsFallback(false);
    setMapErrorMessage(null);
    setMapRetryKey((k) => k + 1);
  };

  const handleToggleFullscreen = () => {
    const fsEl = getFullscreenElementCompat();
    if (fsEl) {
      exitFullscreenCompat().catch(() => {});
    } else if (mapViewportRef.current) {
      requestFullscreenCompat(mapViewportRef.current).catch(() => {});
    }
  };

  // Video export: reset to the start, record the animated map canvas, and download the result.
  const handleExportVideo = async () => {
    const map = mapRef.current;
    if (!map || isExportingRef.current || places.length < 2 || !animationReady) return;

    isExportingRef.current = true;
    setIsExporting(true);
    setExportStatusText("Preparing recorder…");
    setIsPlaying(false);
    isPlayingRef.current = false;
    resetProgressToStart();

    let stream = tryCaptureCanvasStream(map);

    // Some basemap tile/glyph responses can taint the canvas and block captureStream().
    // Fall back to the local, CORS-safe style and retry once.
    if (!stream && !isFallbackRef.current) {
      exportForcedFallbackRef.current = true;
      isFallbackRef.current = true;
      setIsFallback(true);
      try {
        map.setStyle(JOURNEY_FALLBACK_STYLE);
        await waitForStyleLoad(map);
      } catch {
        // fall through; the capture attempt below will fail gracefully
      }
      resetProgressToStart();
      stream = tryCaptureCanvasStream(map);
    }

    // The dots/traveler are normally DOM-only; switch on their GL mirror layers so the
    // recorded canvas actually shows them.
    setExportLayersVisible(map, true);

    const mimeType = stream ? pickSupportedMimeType() : null;

    if (!stream || !mimeType) {
      setExportLayersVisible(map, false);
      setExportStatusText("Video export is not supported in this browser.");
      window.setTimeout(() => setExportStatusText(null), 3000);
      setIsExporting(false);
      isExportingRef.current = false;
      return;
    }

    recordedChunksRef.current = [];
    exportMimeTypeRef.current = mimeType;

    const recorder = new MediaRecorder(stream, { mimeType });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      const finalMimeType = exportMimeTypeRef.current ?? mimeType;
      const blob = new Blob(recordedChunksRef.current, { type: finalMimeType });
      const url = URL.createObjectURL(blob);
      const extension = finalMimeType.startsWith("video/mp4") ? "mp4" : "webm";
      const link = document.createElement("a");
      link.href = url;
      link.download = `traveltrace.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 4000);
      setExportLayersVisible(map, false);

      mediaRecorderRef.current = null;
      recordedChunksRef.current = [];
      setIsExporting(false);
      isExportingRef.current = false;
      setExportStatusText(null);
      setIsPlaying(false);
      isPlayingRef.current = false;

      // Restore the primary basemap if we were forced onto the fallback for the export
      if (exportForcedFallbackRef.current) {
        exportForcedFallbackRef.current = false;
        isFallbackRef.current = false;
        setIsFallback(false);
        try {
          map.setStyle(OPEN_FREE_MAP_STYLE);
        } catch {
          // keep the fallback style if switching back fails
        }
      }
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setExportStatusText(`Recording stop 1 of ${places.length}`);
    setIsPlaying(true);
    isPlayingRef.current = true;
  };

  return (
    <main className="map-page-shell">
      {/* Navigation */}
      <nav className="nav">
        <Link href="/" className="wordmark">
          <CompassMark />
          <span>TravelTrace</span>
        </Link>
        <div className="review-steps" aria-label="Journey creation progress">
          <Link href="/" className="done">
            <i>✓</i> Import
          </Link>
          <b />
          <Link href="/journey" className="done">
            <i>✓</i> Review
          </Link>
          <b />
          <span className="active">
            <i>3</i> Map
          </span>
        </div>
      </nav>

      {!loaded ? (
        <section className="review-loading" aria-live="polite">
          <span className="spinner dark" />
          <p>Loading your journey…</p>
        </section>
      ) : !importResult || places.length === 0 ? (
        <section className="review-empty">
          <p className="overline">
            <span /> No journey found
          </p>
          <h1>Import your saved places first.</h1>
          <p>
            Your journey data is kept private in this browser session. Start by
            importing a public Google Maps list.
          </p>
          <Link href="/">
            Return to importer <b>→</b>
          </Link>
        </section>
      ) : (
        <section className="map-main-content">
          {/* Header & Stats */}
          <header className="map-page-header">
            <div>
              <p className="overline">
                <span /> Step 3 · Interactive Visualization
              </p>
              <h1 className="map-page-title">{importResult.listName}</h1>
            </div>
            <div className="map-stats-badge">
              <div className="stat-pill">
                <strong>{places.length}</strong>
                <span>{places.length === 1 ? "place" : "places"}</span>
              </div>
              <div className="stat-pill">
                <strong>{formatDistance(totalDistanceKm)}</strong>
                <span>total distance</span>
              </div>
            </div>
          </header>

          {/* Map Viewer Container (also the Fullscreen API target element) */}
          <div
            ref={mapViewportRef}
            className={`map-viewport-card ${isFullscreen ? "is-fullscreen" : ""}`}
          >
            <div
              ref={mapContainerRef}
              className="maplibre-canvas-container"
              aria-label="Interactive travel journey map"
            />
            {/* Renders the route trace reliably via 2D canvas drawing (see drawTraceOverlay) */}
            <canvas ref={traceOverlayCanvasRef} className="trace-overlay-canvas" aria-hidden="true" />

            {/* Non-blocking Fallback Notice */}
            {isFallback && mapStatus === "ready" && !isExporting && (
              <div className="map-fallback-notice" role="status">
                <span className="notice-icon">ℹ</span>
                <span>Basemap unavailable — showing journey-only view.</span>
              </div>
            )}

            {/* Video export status (DOM overlay only — never captured by canvas.captureStream) */}
            {isExporting && (
              <div className="export-status-overlay" role="status" aria-live="polite">
                <span className="spinner" />
                <p>
                  Generating video…
                  {exportStatusText && (
                    <span className="export-status-detail"> {exportStatusText}</span>
                  )}
                </p>
              </div>
            )}

            {/* Map Loading Overlay */}
            {mapStatus === "loading" && (
              <div className="map-card-loading-overlay" aria-live="polite">
                <span className="spinner dark" />
                <p>Loading map view…</p>
              </div>
            )}

            {/* Map Error Overlay */}
            {mapStatus === "error" && (
              <div className="map-card-error-overlay" role="alert">
                <p className="error-title">
                  {mapErrorMessage ?? "The map could not be loaded."}
                </p>
                <p className="error-desc">
                  We could not initialize the interactive map canvas. Check your
                  browser settings or try again.
                </p>
                <button
                  type="button"
                  className="retry-map-btn"
                  onClick={handleRetryMap}
                >
                  Retry map
                </button>
              </div>
            )}

            {/* Compact controls float over the map only while in fullscreen (per the
                Fullscreen API, only this element and its descendants stay visible then). */}
            {mapStatus === "ready" && isFullscreen && (
              <div className={isExporting ? "controls-disabled" : undefined}>
                <JourneyControls
                  places={places}
                  isPlaying={isPlaying}
                  progress={progress}
                  speed={speed}
                  isTransit={travelerState?.isTransit ?? false}
                  departedStopIndex={travelerState?.departedStopIndex ?? 0}
                  destinationStopIndex={travelerState?.destinationStopIndex ?? 0}
                  arrivedStopIndex={travelerState?.arrivedStopIndex ?? 0}
                  animationReady={animationReady}
                  compact
                  isFullscreen
                  isExporting={isExporting}
                  onPlay={handlePlay}
                  onPause={handlePause}
                  onReplay={handleReplay}
                  onPrev={handlePrev}
                  onNext={handleNext}
                  onSeek={seekTo}
                  onSpeedChange={handleSpeedChange}
                  onFitJourney={fitWholeJourney}
                  onToggleFullscreen={handleToggleFullscreen}
                  onExportVideo={handleExportVideo}
                />
              </div>
            )}
          </div>

          {/* Normal (non-fullscreen) controls live below the map, not overlapping it. */}
          {mapStatus === "ready" && !isFullscreen && (
            <div className={isExporting ? "controls-disabled" : undefined}>
              <JourneyControls
                places={places}
                isPlaying={isPlaying}
                progress={progress}
                speed={speed}
                isTransit={travelerState?.isTransit ?? false}
                departedStopIndex={travelerState?.departedStopIndex ?? 0}
                destinationStopIndex={travelerState?.destinationStopIndex ?? 0}
                arrivedStopIndex={travelerState?.arrivedStopIndex ?? 0}
                animationReady={animationReady}
                isExporting={isExporting}
                onPlay={handlePlay}
                onPause={handlePause}
                onReplay={handleReplay}
                onPrev={handlePrev}
                onNext={handleNext}
                onSeek={seekTo}
                onSpeedChange={handleSpeedChange}
                onFitJourney={fitWholeJourney}
                onToggleFullscreen={handleToggleFullscreen}
                onExportVideo={handleExportVideo}
              />
            </div>
          )}
        </section>
      )}
    </main>
  );
}
