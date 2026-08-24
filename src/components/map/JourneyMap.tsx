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

// Traveler custom SVG icon (traveler silhouette / compass voyager pin)
function createTravelerElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "traveler-marker-pin";
  el.setAttribute("aria-label", "Current traveler position");
  el.innerHTML = `
    <div class="traveler-pulse"></div>
    <div class="traveler-avatar">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="7" r="4" fill="#df7443" stroke="#fff" stroke-width="1.5" />
        <path d="M5.5 21a6.5 6.5 0 0 1 13 0" fill="#df7443" stroke="#fff" stroke-width="1.5" />
      </svg>
    </div>
  `;
  return el;
}

// Stop custom HTML marker
function createStopMarkerElement(stopNumber: number, placeName: string): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "journey-stop-marker";
  el.setAttribute("data-stop", String(stopNumber));
  el.setAttribute("title", `${stopNumber}. ${placeName}`);
  el.innerHTML = `<span class="marker-number">${stopNumber}</span>`;
  return el;
}

const OPEN_FREE_MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

export function JourneyMap() {
  const [importResult, setImportResult] = useState<PlaceImportResult | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speed, setSpeed] = useState(1); // 0.5 | 1 | 2

  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const travelerMarkerRef = useRef<Marker | null>(null);
  const stopMarkersRef = useRef<{ marker: Marker; element: HTMLDivElement }[]>([]);

  // Animation refs to avoid stale closures in requestAnimationFrame
  const animationFrameRef = useRef<number | null>(null);
  const lastTimestampRef = useRef<number | null>(null);
  const progressRef = useRef(0);
  const isPlayingRef = useRef(false);
  const speedRef = useRef(1);
  const pauseRemainingMsRef = useRef(0);
  const lastCameraSegmentRef = useRef<number | null>(null);

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

  // Ordered places
  const places: TravelPlace[] = useMemo(() => {
    if (!importResult?.places) return [];
    return getOrderedPlaces(importResult.places);
  }, [importResult]);

  // Unique country count
  const countryCount = useMemo(() => {
    const countries = new Set(
      places.map((p) => p.country || p.countryCode).filter(Boolean)
    );
    return countries.size;
  }, [places]);

  const currentStopIndex = Math.min(
    places.length - 1,
    Math.max(0, Math.round(progress))
  );

  // Initialize MapLibre GL
  useEffect(() => {
    if (!loaded || !places.length || !mapContainerRef.current) return;

    const bounds = getJourneyBounds(places);

    const map = new MapLibreMap({
      container: mapContainerRef.current,
      style: OPEN_FREE_MAP_STYLE,
      bounds: bounds,
      fitBoundsOptions: {
        padding: { top: 70, bottom: 90, left: 70, right: 70 },
        maxZoom: 14,
      },
      attributionControl: { compact: true },
    });

    map.addControl(new NavigationControl({ showCompass: true, showZoom: true }), "top-right");

    map.on("load", () => {
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

      // 4. Add Numbered Stop Markers
      stopMarkersRef.current = places.map((place, idx) => {
        const stopNum = idx + 1;
        const el = createStopMarkerElement(stopNum, place.name);

        const popupContent = `
          <div class="map-popup-card">
            <span class="popup-stop-tag">Stop ${stopNum}</span>
            <strong class="popup-title">${place.name}</strong>
            ${place.address ? `<p class="popup-address">${place.address}</p>` : ""}
            ${place.visitedAt ? `<span class="popup-date">📅 ${place.visitedAt}</span>` : ""}
          </div>
        `;

        const popup = new Popup({
          offset: 16,
          closeButton: false,
          className: "custom-map-popup",
        }).setHTML(popupContent);

        const marker = new Marker({ element: el })
          .setLngLat([place.longitude, place.latitude])
          .setPopup(popup)
          .addTo(map);

        el.addEventListener("click", () => {
          // Jump progress to this stop on click
          seekTo(idx);
        });

        return { marker, element: el };
      });

      // 5. Add Traveler Marker
      const travelerEl = createTravelerElement();
      const initialPos: [number, number] = [places[0].longitude, places[0].latitude];
      const travelerMarker = new Marker({
        element: travelerEl,
        anchor: "center",
      })
        .setLngLat(initialPos)
        .addTo(map);

      travelerMarkerRef.current = travelerMarker;
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
  }, [loaded, places]);

  // Helper to update route layers, traveler marker, and marker highlight styles
  const updateMapVisuals = (currentProg: number) => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded() || places.length === 0) return;

    // 1. Update traveler marker position
    const travelerState = getTravelerState(places, currentProg);
    if (travelerState && travelerMarkerRef.current) {
      travelerMarkerRef.current.setLngLat(travelerState.position);
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

    // 3. Update stop marker classes
    const activeIdx = Math.round(currentProg);
    stopMarkersRef.current.forEach(({ element }, idx) => {
      if (idx < currentProg) {
        element.classList.add("completed");
      } else {
        element.classList.remove("completed");
      }

      if (idx === activeIdx) {
        element.classList.add("active");
      } else {
        element.classList.remove("active");
      }
    });
  };

  // Smooth camera tracking
  const updateCameraForProgress = (currentProg: number) => {
    const map = mapRef.current;
    if (!map || places.length === 0) return;

    // Check prefers-reduced-motion
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion) return;

    const segmentIdx = Math.min(Math.floor(currentProg), places.length - 2);
    if (places.length < 2) return;

    // Trigger camera transition when entering a new segment
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
    if (!isPlaying) {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      lastTimestampRef.current = null;
      return;
    }

    const maxProg = Math.max(0, places.length - 1);
    if (progressRef.current >= maxProg) {
      // If at the end, restart from 0
      progressRef.current = 0;
      setProgress(0);
      lastCameraSegmentRef.current = null;
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

      // Handle pause at stops
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
        // Snap precisely to the stop and pause
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
    updateMapVisuals(0);
    fitWholeJourney();
    setIsPlaying(true);
  };

  const handlePrev = () => {
    setIsPlaying(false);
    const prevStop = Math.max(0, Math.floor(progress - 0.05));
    seekTo(prevStop);
  };

  const handleNext = () => {
    setIsPlaying(false);
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

    // Smoothly pan to the selected stop
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
    if (!mapRef.current || places.length === 0) return;
    const bounds = getJourneyBounds(places);
    mapRef.current.fitBounds(bounds, {
      padding: { top: 70, bottom: 90, left: 70, right: 70 },
      maxZoom: 14,
      duration: 1000,
    });
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
              {countryCount > 0 && (
                <div className="stat-pill">
                  <strong>{countryCount}</strong>
                  <span>{countryCount === 1 ? "country" : "countries"}</span>
                </div>
              )}
            </div>
          </header>

          {/* Map Viewer Container */}
          <div className="map-viewport-card">
            <div
              ref={mapContainerRef}
              className="maplibre-canvas-container"
              aria-label="Interactive travel journey map"
            />

            {/* Floating Controls Overlay */}
            <JourneyControls
              places={places}
              isPlaying={isPlaying}
              progress={progress}
              speed={speed}
              currentStopIndex={currentStopIndex}
              onPlay={handlePlay}
              onPause={handlePause}
              onReplay={handleReplay}
              onPrev={handlePrev}
              onNext={handleNext}
              onSeek={seekTo}
              onSpeedChange={handleSpeedChange}
              onFitJourney={fitWholeJourney}
            />
          </div>
        </section>
      )}
    </main>
  );
}
