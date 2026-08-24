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
  buildProgressRouteGeoJSON,
  calculateTotalRouteDistance,
  formatDistance,
  getJourneyBounds,
  getTravelerState,
} from "@/lib/map/build-route";
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

  // Directional navigation pointer icon
  const pointer = document.createElement("div");
  pointer.className = "traveler-pointer";
  pointer.innerHTML = `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="white">
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

const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function JourneyMap() {
  const [importResult, setImportResult] = useState<PlaceImportResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [mapStatus, setMapStatus] = useState<"loading" | "ready" | "error">("loading");
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

  // Animation and camera tracking refs
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(1);
  const pauseRemainingMsRef = useRef(0);
  const lastCameraSegmentRef = useRef<number | null>(null);
  const userInteractedRef = useRef(false);

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

  // Total route distance
  const totalDistanceKm = useMemo(() => {
    return calculateTotalRouteDistance(places);
  }, [places]);

  // Current traveler status
  const travelerState = useMemo(() => {
    return getTravelerState(places, progress);
  }, [places, progress]);

  // Initialize MapLibre GL
  useEffect(() => {
    if (!loaded || !places.length || !mapContainerRef.current) return;

    setMapStatus("loading");
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
    } catch {
      setMapStatus("error");
      return;
    }

    const map = mapInstance;
    map.addControl(
      new NavigationControl({ showCompass: true, showZoom: true }),
      "top-right"
    );

    // Track user manual pan/zoom to avoid fighting user camera interactions
    const markUserInteracted = () => {
      userInteractedRef.current = true;
    };
    map.on("dragstart", markUserInteracted);
    map.on("zoomstart", markUserInteracted);
    map.on("rotatestart", markUserInteracted);
    map.on("pitchstart", markUserInteracted);

    // Map error listener (only report fatal error before style is ready)
    map.on("error", (e) => {
      if (!map.isStyleLoaded()) {
        // Genuine style or initialization error
        console.warn("Map style load error:", e);
        setMapStatus("error");
      }
    });

    map.on("load", () => {
      setMapStatus("ready");

      // 1. Add Future / Full Route Line Layer
      const fullRouteGeoJson = buildFullRouteFeatureCollection(places);
      map.addSource("full-route", {
        type: "geojson",
        data: fullRouteGeoJson,
      });

      // Background subtle route line
      map.addLayer({
        id: "full-route-casing",
        type: "line",
        source: "full-route",
        paint: {
          "line-color": "#8fa898",
          "line-width": 3,
          "line-opacity": 0.4,
          "line-dasharray": [2, 2],
        },
      });

      // 2. Add Completed Route Layer
      map.addSource("completed-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "completed-route-line",
        type: "line",
        source: "completed-route",
        paint: {
          "line-color": "#1f6249", // TravelTrace dark green
          "line-width": 3,
          "line-opacity": 0.85,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });

      // 3. Add Active Segment Layer
      map.addSource("active-segment", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "active-segment-line",
        type: "line",
        source: "active-segment",
        paint: {
          "line-color": "#df7443", // TravelTrace orange
          "line-width": 4,
          "line-opacity": 0.95,
        },
        layout: {
          "line-cap": "round",
          "line-join": "round",
        },
      });

      // 4. Add Numbered Stop Markers with Safe Popups
      stopMarkersRef.current = places.map((place, idx) => {
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

      // 5. Add Directional Traveler Marker
      const { container: travelerEl, pointer: travelerPointer } = createTravelerElement();
      const initialPos: [number, number] = [places[0].longitude, places[0].latitude];
      const travelerMarker = new Marker({
        element: travelerEl,
        anchor: "center",
      })
        .setLngLat(initialPos)
        .addTo(map);

      travelerMarkerRef.current = travelerMarker;
      travelerPointerRef.current = travelerPointer;
      mapRef.current = map;

      // Update initial visual state
      updateMapVisuals(0);
    });

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      stopMarkersRef.current.forEach(({ marker }) => marker.remove());
      stopMarkersRef.current = [];
      travelerMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [loaded, places, mapRetryKey]);

  // Update route layers, traveler marker, bearing orientation, and stop marker states
  const updateMapVisuals = (currentProg: number) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || places.length === 0) return;

    // 1. Update traveler marker position & bearing rotation
    const state = getTravelerState(places, currentProg);
    if (state && travelerMarkerRef.current) {
      travelerMarkerRef.current.setLngLat(state.position);
      if (travelerPointerRef.current) {
        travelerPointerRef.current.style.transform = `rotate(${state.bearing}deg)`;
      }
    }

    // 2. Update GeoJSON route sources
    const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(places, currentProg);

    const completedSource = map.getSource("completed-route") as GeoJSONSource | undefined;
    if (completedSource) {
      completedSource.setData(completedGeoJson);
    }

    const activeSource = map.getSource("active-segment") as GeoJSONSource | undefined;
    if (activeSource) {
      activeSource.setData(activeGeoJson);
    }

    // 3. Update stop marker classes with correct arrival semantics
    const isTransit = state?.isTransit ?? false;
    const departedIdx = state?.departedStopIndex ?? 0;
    const destIdx = state?.destinationStopIndex ?? 0;
    const arrivedIdx = state?.arrivedStopIndex ?? 0;
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
  };

  // Calm camera tracking (one smooth transition per segment, suspended on user interaction)
  const updateCameraForProgress = (currentProg: number) => {
    const map = mapRef.current;
    if (!map || places.length < 2 || userInteractedRef.current) return;

    // Respect prefers-reduced-motion
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
        duration: 1200 / speedRef.current,
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
      // Restart from 0 if already at the end
      progressRef.current = 0;
      setProgress(0);
      lastCameraSegmentRef.current = null;
      userInteractedRef.current = false;
    }

    // Segment base flight duration in milliseconds
    const BASE_SEGMENT_DURATION_MS = 2800;
    const STOP_PAUSE_DURATION_MS = 900;

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
        // Snap precisely to the stop and trigger brief pause
        nextProgress = nextStopFloor;
        pauseRemainingMsRef.current = STOP_PAUSE_DURATION_MS / speedRef.current;
      }

      if (nextProgress >= maxProg) {
        nextProgress = maxProg;
        progressRef.current = nextProgress;
        setProgress(nextProgress);
        updateMapVisuals(nextProgress);
        setIsPlaying(false);
        isPlayingRef.current = false;
        return;
      }

      progressRef.current = nextProgress;
      setProgress(nextProgress);
      updateMapVisuals(nextProgress);
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
  }, [isPlaying, places]);

  // Controls Handlers
  const handlePlay = () => {
    if (places.length <= 1) return;
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
    if (places.length > 1) {
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

    // Smoothly ease camera to the selected stop
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
    setMapStatus("loading");
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
                <p className="error-title">The map could not be loaded.</p>
                <p className="error-desc">
                  We could not connect to the map tile server. Check your network
                  connection.
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
