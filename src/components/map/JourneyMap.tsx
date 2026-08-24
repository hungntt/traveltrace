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
  buildFullRouteFeatureCollection,
  buildOptimizedProgressRoute,
  calculateTotalRouteDistance,
  formatDistance,
  getJourneyBounds,
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

// Directional Traveler custom SVG icon
function createTravelerElement(): { container: HTMLDivElement; pointer: HTMLElement } {
  const container = document.createElement("div");
  container.className = "traveler-marker-pin";
  container.setAttribute("aria-label", "Current traveler position");

  const pulse = document.createElement("div");
  pulse.className = "traveler-pulse";
  container.appendChild(pulse);

  const avatar = document.createElement("div");
  avatar.className = "traveler-avatar";

  // Distinct directional plane/arrow icon with outline
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

// Clean, minimal destination dot HTML marker (no visible numbers)
function createStopMarkerElement(stopNumber: number, placeName: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "journey-stop-marker";
  el.dataset.stop = String(stopNumber);
  el.setAttribute("aria-label", placeName);
  el.title = placeName;

  return el;
}

// Safe DOM Popup Content (No HTML injection)
function createStopPopupContent(stopNum: number, place: TravelPlace): HTMLElement {
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

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const travelerMarkerRef = useRef<Marker | null>(null);
  const travelerPointerRef = useRef<HTMLElement | null>(null);
  const stopMarkersRef = useRef<{ marker: Marker; element: HTMLDivElement }[]>([])  // Animation and lifecycle tracking refs
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(1);
  const pauseRemainingMsRef = useRef(0);
  const lastCameraSegmentRef = useRef<number | null>(null);
  const lastCompletedSegmentRef = useRef<number>(-1);
  const lastActiveUpdateTimestampRef = useRef<number>(0);
  const lastUiSyncRef = useRef<number>(0);
  const lastDiagnosticLogRef = useRef<number>(0);
  const userInteractedRef = useRef(false);
  const initTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isFallbackRef = useRef(false);

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

  // Update route layers, traveler marker, bearing orientation, and stop marker states.
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

    // 2. Update traveler marker position & bearing (every frame)
    if (travelerMarkerRef.current) {
      travelerMarkerRef.current.setLngLat(state.position);
      if (travelerPointerRef.current) {
        travelerPointerRef.current.style.transform = `rotate(${state.bearing}deg)`;
      }
    } else {
      return false;
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
    }

    if (options?.updateActive !== false) {
      activeSource.setData(activeGeoJson);
    }

    // 6. Update stop marker classes with correct arrival semantics
    const isTransit = state.isTransit;
    const departedIdx = state.departedStopIndex;
    const destIdx = state.destinationStopIndex;
    const arrivedIdx = state.arrivedStopIndex ?? 0;
    const isFinal = currentProg >= places.length - 1;

    stopMarkersRef.current.forEach(({ element }, idx) => {
      const isCompleted = isFinal
        ? true
        : isTransit
        ? idx <= departedIdx
        : idx <= arrivedIdx;

      if (isCompleted) {
        element.classList.add("completed");
      } else {
        element.classList.remove("completed");
      }

      if (isTransit && idx === destIdx) {
        element.classList.add("target-destination");
      } else {
        element.classList.remove("target-destination");
      }

      if (!isTransit && idx === arrivedIdx) {
        element.classList.add("active");
      } else {
        element.classList.remove("active");
      }
    });

    return true;
  };

  // Guarded helper to initialize TravelTrace GeoJSON sources, layers, and markers.
  // Returns true only when all sources, layers, markers, and initial visuals are verified ready.
  const initializeJourneyLayers = (
    map: MapLibreMap,
    currentPlaces: TravelPlace[]
  ): boolean => {
    if (!map || currentPlaces.length === 0) return false;

    try {
      // 1. Add Future / Full Route Line Layer (static during playback)
      const fullRouteGeoJson = buildFullRouteFeatureCollection(currentPlaces);
      if (!map.getSource("full-route")) {
        map.addSource("full-route", {
          type: "geojson",
          data: fullRouteGeoJson,
        });
      } else {
        (map.getSource("full-route") as GeoJSONSource).setData(fullRouteGeoJson);
      }

      if (!map.getLayer("full-route-casing")) {
        map.addLayer({
          id: "full-route-casing",
          type: "line",
          source: "full-route",
          paint: {
            "line-color": "#8fa898",
            "line-width": 2.5,
            "line-opacity": 0.5,
            "line-dasharray": [2, 2],
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
          paint: {
            "line-color": "#1f6249", // TravelTrace dark green
            "line-width": 4,
            "line-opacity": 0.95,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
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
          paint: {
            "line-color": "#df7443", // TravelTrace orange
            "line-width": 4.5,
            "line-opacity": 0.98,
          },
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
        });
      }

      // Ensure active line layer sits on top
      if (map.getLayer("active-segment-line")) {
        map.moveLayer("active-segment-line");
      }

      // 4. Add Destination Dot Markers with Safe Popups
      stopMarkersRef.current.forEach(({ marker }) => marker.remove());
      stopMarkersRef.current = currentPlaces.map((place, idx) => {
        const stopNum = idx + 1;
        const el = createStopMarkerElement(stopNum, place.name);

        const popup = new Popup({
          offset: 12,
          closeButton: false,
          className: "custom-map-popup",
        }).setDOMContent(createStopPopupContent(stopNum, place));

        const marker = new Marker({ element: el })
          .setLngLat([place.longitude, place.latitude])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener("click", () => {
          userInteractedRef.current = false;
          seekTo(idx);
        });

        return { marker, element: el };
      });

      // 5. Add Directional Traveler Marker with Subpixel Positioning
      travelerMarkerRef.current?.remove();
      const { container: travelerEl, pointer: travelerPointer } = createTravelerElement();
      const initialPos: [number, number] = [
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

      // Verify ALL required sources, markers, and initial visual state exist
      const hasFullRoute = Boolean(map.getSource("full-route"));
      const hasCompletedRoute = Boolean(map.getSource("completed-route"));
      const hasActiveSegment = Boolean(map.getSource("active-segment"));
      const hasTraveler = Boolean(travelerMarkerRef.current);
      const hasAllStops = stopMarkersRef.current.length === currentPlaces.length;

      if (!hasFullRoute || !hasCompletedRoute || !hasActiveSegment || !hasTraveler || !hasAllStops) {
        console.warn("[TravelTrace map] Layer initialization incomplete - missing source/marker.");
        return false;
      }

      // Initial visual sync
      const visualUpdated = updateMapVisuals(progressRef.current, {
        updateActive: true,
        forceCompleted: true,
      });

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
    userInteractedRef.current = false;
    lastCameraSegmentRef.current = null;
    lastCompletedSegmentRef.current = -1;

    const bounds = getJourneyBounds(places);

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

    // Track real user pointer interactions on the DOM container (ignoring programmatic camera events)
    const containerEl = mapContainerRef.current;
    const onUserGesture = () => {
      userInteractedRef.current = true;
    };

    containerEl.addEventListener("pointerdown", onUserGesture);
    containerEl.addEventListener("touchstart", onUserGesture, { passive: true });
    containerEl.addEventListener("wheel", onUserGesture, { passive: true });

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
      containerEl.removeEventListener("pointerdown", onUserGesture);
      containerEl.removeEventListener("touchstart", onUserGesture);
      containerEl.removeEventListener("wheel", onUserGesture);

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
      map.remove();
      mapRef.current = null;
      setAnimationReady(false);
    };
  }, [loaded, places, mapRetryKey]);

  // Calm camera tracking: one smooth transition per segment
  const updateCameraForProgress = (currentProg: number) => {
    const map = mapRef.current;
    if (!map || places.length < 2 || userInteractedRef.current) return;

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) return;

    const segmentIdx = Math.min(Math.floor(currentProg), places.length - 2);

    // Trigger camera transition once when entering a new segment
    if (segmentIdx !== lastCameraSegmentRef.current) {
      lastCameraSegmentRef.current = segmentIdx;
      const p1 = places[segmentIdx];
      const p2 = places[segmentIdx + 1];
      const segmentBounds = getJourneyBounds([p1, p2]);

      map.fitBounds(segmentBounds, {
        padding: { top: 90, bottom: 100, left: 80, right: 80 },
        maxZoom: 10,
        duration: Math.round(700 / speedRef.current),
        essential: false,
      });
    }
  };

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
      lastCameraSegmentRef.current = null;
      lastCompletedSegmentRef.current = -1;
      userInteractedRef.current = false;
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
        updateCameraForProgress(nextProgress);
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

      // Update traveler marker, bearing, stop states, and growing active orange route smoothly every frame
      updateMapVisuals(nextProgress, {
        updateActive: true,
        forceCompleted: false,
      });

      updateCameraForProgress(nextProgress);

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
          travelerPosition: travelerMarkerRef.current?.getLngLat(),
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

  // Controls Handlers
  const handlePlay = () => {
    if (places.length <= 1 || !animationReady) return;
    setIsPlaying(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
  };

  const handleReplay = () => {
    progressRef.current = 0;
    setProgress(0);
    pauseRemainingMsRef.current = 0;
    lastCameraSegmentRef.current = null;
    lastCompletedSegmentRef.current = -1;
    userInteractedRef.current = false;
    updateMapVisuals(0, { updateActive: true, forceCompleted: true });
    fitWholeJourney();
    if (places.length > 1 && animationReady) {
      setIsPlaying(true);
    }
  };

  const handlePrev = () => {
    setIsPlaying(false);
    userInteractedRef.current = false;
    const prevStop = Math.max(0, Math.floor(progressRef.current - 0.05));
    seekTo(prevStop);
  };

  const handleNext = () => {
    setIsPlaying(false);
    userInteractedRef.current = false;
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
    lastCameraSegmentRef.current = null;
    updateMapVisuals(clamped, { updateActive: true, forceCompleted: true });
  };

  const handleSpeedChange = (newSpeed: number) => {
    setSpeed(newSpeed);
  };

  const fitWholeJourney = () => {
    userInteractedRef.current = false;
    if (!mapRef.current || places.length === 0) return;
    const bounds = getJourneyBounds(places);
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

          {/* Map Viewer Container */}
          <div className="map-viewport-card">
            <div
              ref={mapContainerRef}
              className="maplibre-canvas-container"
              aria-label="Interactive travel journey map"
            />

            {/* Non-blocking Fallback Notice */}
            {isFallback && mapStatus === "ready" && (
              <div className="map-fallback-notice" role="status">
                <span className="notice-icon">ℹ</span>
                <span>Basemap unavailable — showing journey-only view.</span>
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

            {/* Floating Controls Overlay */}
            {mapStatus === "ready" && (
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
                onPlay={handlePlay}
                onPause={handlePause}
                onReplay={handleReplay}
                onPrev={handlePrev}
                onNext={handleNext}
                onSeek={seekTo}
                onSpeedChange={handleSpeedChange}
                onFitJourney={fitWholeJourney}
              />
            )}
          </div>
        </section>
      )}
    </main>
  );
}
