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

// Safe Stop custom HTML marker (No HTML injection)
function createStopMarkerElement(stopNumber: number, placeName: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "journey-stop-marker";
  el.dataset.stop = String(stopNumber);
  el.title = `${stopNumber}. ${placeName}`;

  const numSpan = document.createElement("span");
  numSpan.className = "marker-number";
  numSpan.textContent = String(stopNumber);
  el.appendChild(numSpan);

  return el;
}

// Safe DOM Popup Content (No HTML injection)
function createStopPopupContent(stopNum: number, place: TravelPlace): HTMLElement {
  const card = document.createElement("div");
  card.className = "map-popup-card";

  const tag = document.createElement("span");
  tag.className = "popup-stop-tag";
  tag.textContent = `Stop ${stopNum}`;
  card.appendChild(tag);

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
  const stopMarkersRef = useRef<{ marker: Marker; element: HTMLDivElement }[]>([]);

  // Animation and lifecycle tracking refs
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(1);
  const pauseRemainingMsRef = useRef(0);
  const lastCameraSegmentRef = useRef<number | null>(null);
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

  // Current traveler status
  const travelerState = useMemo(() => {
    return getTravelerState(places, progress, preparedSegments);
  }, [places, progress, preparedSegments]);

  // Update route layers, traveler marker, bearing orientation, and stop marker states.
  // Returns true if visual objects exist and were successfully updated.
  const updateMapVisuals = (currentProg: number): boolean => {
    const map = mapRef.current;
    if (!map || places.length === 0) return false;

    // 1. Calculate traveler state
    const state = getTravelerState(places, currentProg, preparedSegments);
    if (!state) return false;

    // 2. Update traveler marker position & bearing
    if (travelerMarkerRef.current) {
      travelerMarkerRef.current.setLngLat(state.position);
      if (travelerPointerRef.current) {
        travelerPointerRef.current.style.transform = `rotate(${state.bearing}deg)`;
      }
    } else {
      return false;
    }

    // 3. Update GeoJSON route sources
    const { completedGeoJson, activeGeoJson } = buildOptimizedProgressRoute(
      preparedSegments,
      currentProg
    );

    const completedSource = map.getSource("completed-route") as GeoJSONSource | undefined;
    const activeSource = map.getSource("active-segment") as GeoJSONSource | undefined;

    if (!completedSource || !activeSource) {
      return false;
    }

    completedSource.setData(completedGeoJson);
    activeSource.setData(activeGeoJson);

    // 4. Update stop marker classes with correct arrival semantics
    const isTransit = state.isTransit;
    const departedIdx = state.departedStopIndex;
    const destIdx = state.destinationStopIndex;
    const arrivedIdx = state.arrivedStopIndex ?? 0;
    const isFinal = currentProg >= places.length - 1;

    stopMarkersRef.current.forEach(({ element }, idx) => {
      // Completed: stops that have been fully arrived at
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

      // Target destination (while traveling in transit)
      if (isTransit && idx === destIdx) {
        element.classList.add("target-destination");
      } else {
        element.classList.remove("target-destination");
      }

      // Arrived active stop (stationary at exact destination)
      if (!isTransit && idx === arrivedIdx) {
        element.classList.add("active");
      } else {
        element.classList.remove("active");
      }
    });

    // Request immediate map render refresh
    map.triggerRepaint();

    return true;
  };

  // Guarded helper to initialize TravelTrace GeoJSON sources, layers, and markers
  const initializeJourneyLayers = (map: MapLibreMap, currentPlaces: TravelPlace[]) => {
    if (!map.isStyleLoaded() || currentPlaces.length === 0) return;

    // 1. Add Future / Full Route Line Layer
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
          "line-opacity": 0.45,
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
          "line-width": 3.5,
          "line-opacity": 0.9,
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
          "line-opacity": 0.95,
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

    // 4. Add Numbered Stop Markers with Safe Popups
    stopMarkersRef.current.forEach(({ marker }) => marker.remove());
    stopMarkersRef.current = currentPlaces.map((place, idx) => {
      const stopNum = idx + 1;
      const el = createStopMarkerElement(stopNum, place.name);

      const popup = new Popup({
        offset: 16,
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

    if (typeof (travelerMarker as unknown as { setSubpixelPositioning?: (v: boolean) => Marker }).setSubpixelPositioning === "function") {
      (travelerMarker as unknown as { setSubpixelPositioning: (v: boolean) => Marker }).setSubpixelPositioning(true);
    }

    travelerMarker.setLngLat(initialPos).addTo(map);

    travelerMarkerRef.current = travelerMarker;
    travelerPointerRef.current = travelerPointer;

    // Update initial visuals and mark animation readiness
    updateMapVisuals(progressRef.current);
    setAnimationReady(true);
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
        initializeJourneyLayers(map, places);
        setMapStatus("ready");
        requestAnimationFrame(() => {
          map.resize();
        });
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
        duration: Math.round(1200 / speedRef.current),
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
      userInteractedRef.current = false;
    }

    // Segment flight duration in milliseconds at 1x speed
    const BASE_SEGMENT_DURATION_MS = 3800;
    const STOP_PAUSE_DURATION_MS = 800;

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
      }

      if (nextProgress >= maxProg) {
        nextProgress = maxProg;
        progressRef.current = nextProgress;
        const visualUpdated = updateMapVisuals(nextProgress);
        if (visualUpdated) {
          setProgress(nextProgress);
        }
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      progressRef.current = nextProgress;
      const visualUpdated = updateMapVisuals(nextProgress);
      if (visualUpdated) {
        setProgress(nextProgress);
      }
      updateCameraForProgress(nextProgress);

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
    userInteractedRef.current = false;
    updateMapVisuals(0);
    fitWholeJourney();
    if (places.length > 1 && animationReady) {
      setIsPlaying(true);
    }
  };

  const handlePrev = () => {
    setIsPlaying(false);
    userInteractedRef.current = false;
    const prevStop = Math.max(0, Math.floor(progress - 0.05));
    seekTo(prevStop);
  };

  const handleNext = () => {
    setIsPlaying(false);
    userInteractedRef.current = false;
    const maxProg = Math.max(0, places.length - 1);
    const nextStop = Math.min(maxProg, Math.floor(progress + 1.05));
    seekTo(nextStop);
  };

  const seekTo = (targetProg: number) => {
    const maxProg = Math.max(0, places.length - 1);
    const clamped = Math.max(0, Math.min(maxProg, targetProg));
    progressRef.current = clamped;
    setProgress(clamped);
    pauseRemainingMsRef.current = 0;
    lastCameraSegmentRef.current = null;
    updateMapVisuals(clamped);

    const targetPlace = places[Math.round(clamped)];
    if (targetPlace && mapRef.current) {
      mapRef.current.easeTo({
        center: [targetPlace.longitude, targetPlace.latitude],
        duration: 800,
      });
    }
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
