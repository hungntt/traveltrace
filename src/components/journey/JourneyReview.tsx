"use client";

import { getOrderedPlaces, movePlace, updatePlaceDate } from "@/lib/map/order";
import { JOURNEY_SESSION_KEY } from "@/lib/journey-storage";
import type { PlaceImportResult, TravelPlace } from "@/types/import";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function CompassMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="20" />
      <path d="m30.8 16.4-4.2 10.2-10.2 4.2 4.2-10.2Z" />
      <circle cx="24" cy="24" r="2.2" />
    </svg>
  );
}

export function JourneyReview() {
  const [result, setResult] = useState<PlaceImportResult | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [orderMode, setOrderMode] = useState<"manual" | "date">("manual");

  useEffect(() => {
    const stored = sessionStorage.getItem(JOURNEY_SESSION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as PlaceImportResult;
        setResult(parsed);
        if (parsed.orderMode) {
          setOrderMode(parsed.orderMode);
        }
      } catch {
        sessionStorage.removeItem(JOURNEY_SESSION_KEY);
      }
    }
    setLoaded(true);
  }, []);

  const saveJourneyData = (
    updatedPlaces: TravelPlace[],
    mode: "manual" | "date" = orderMode
  ) => {
    if (!result) return;
    const updatedResult: PlaceImportResult = {
      ...result,
      places: updatedPlaces,
      orderMode: mode,
    };
    setResult(updatedResult);
    sessionStorage.setItem(JOURNEY_SESSION_KEY, JSON.stringify(updatedResult));
  };

  const handleOrderModeChange = (newMode: "manual" | "date") => {
    setOrderMode(newMode);
    if (result) {
      saveJourneyData(result.places, newMode);
    }
  };

  const handleMoveUp = (index: number) => {
    if (!result || index <= 0 || orderMode === "date") return;
    const updated = movePlace(result.places, index, index - 1);
    saveJourneyData(updated);
  };

  const handleMoveDown = (index: number) => {
    if (!result || index >= result.places.length - 1 || orderMode === "date") return;
    const updated = movePlace(result.places, index, index + 1);
    saveJourneyData(updated);
  };

  const handleDateChange = (placeId: string, value: string) => {
    if (!result) return;
    const updated = updatePlaceDate(result.places, placeId, value);
    saveJourneyData(updated);
  };

  // Compute displayed places according to the active orderMode
  const displayedPlaces = useMemo(() => {
    if (!result?.places) return [];
    return getOrderedPlaces(result.places, orderMode);
  }, [result?.places, orderMode]);

  return (
    <main className="review-page">
      <nav className="nav">
        <Link href="/" className="wordmark">
          <CompassMark />
          <span>TravelTrace</span>
        </Link>
        <div className="review-steps" aria-label="Journey creation progress">
          <span className="done">
            <i>✓</i> Import
          </span>
          <b />
          <span className="active">
            <i>2</i> Review
          </span>
          <b />
          <span>
            <i>3</i> Map
          </span>
        </div>
      </nav>

      {!loaded ? (
        <section className="review-loading" aria-live="polite">
          <span className="spinner dark" />
          <p>Loading your imported places…</p>
        </section>
      ) : !result ? (
        <section className="review-empty">
          <p className="overline">
            <span /> Nothing to review yet
          </p>
          <h1>Import a journey first.</h1>
          <p>
            Your imported places live only in this browser tab, so they may be
            gone after closing it.
          </p>
          <Link href="/">
            Return to importer <b>→</b>
          </Link>
        </section>
      ) : (
        <section className="review-content">
          <header className="review-heading">
            <div>
              <p className="overline">
                <span /> Step 2 · Review
              </p>
              <h1>{result.listName}</h1>
              <p>
                Check and arrange the places extracted from your Google Maps list
                before visualizing the journey.
              </p>
            </div>
            <div className="review-stats">
              <div>
                <strong>{result.places.length}</strong>
                <span>Places ready</span>
              </div>
              <div>
                <strong>{result.issues.length}</strong>
                <span>Need attention</span>
              </div>
            </div>
          </header>

          <div className="review-card">
            <div className="review-card-head">
              <div>
                <span>Your locations</span>
                <strong>{result.places.length} imported places</strong>
              </div>
              <div className="review-head-actions">
                {/* Explicit Order Mode Switcher */}
                <div className="order-mode-selector" role="group" aria-label="Journey ordering mode">
                  <span className="order-mode-label">Order:</span>
                  <button
                    type="button"
                    className={`order-mode-btn ${orderMode === "manual" ? "active" : ""}`}
                    onClick={() => handleOrderModeChange("manual")}
                    aria-pressed={orderMode === "manual"}
                  >
                    Manual
                  </button>
                  <button
                    type="button"
                    className={`order-mode-btn ${orderMode === "date" ? "active" : ""}`}
                    onClick={() => handleOrderModeChange("date")}
                    aria-pressed={orderMode === "date"}
                  >
                    Visit date
                  </button>
                </div>
                <Link href="/" className="import-another-link">← Import another list</Link>
              </div>
            </div>

            {orderMode === "date" && (
              <div className="order-mode-banner" role="status">
                <span className="banner-icon">ℹ</span>
                <p>
                  Visualization order is determined chronologically by your assigned
                  visit dates. Places without dates appear at the end.
                </p>
              </div>
            )}

            <div className="review-list">
              {displayedPlaces.map((place, index) => (
                <article key={place.id} className="review-row">
                  <span className="row-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="row-reorder">
                    <button
                      type="button"
                      onClick={() => handleMoveUp(index)}
                      disabled={orderMode === "date" || index === 0}
                      aria-label={`Move ${place.name} up in order`}
                      title={orderMode === "date" ? "Ordering by date" : "Move up"}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveDown(index)}
                      disabled={
                        orderMode === "date" || index === displayedPlaces.length - 1
                      }
                      aria-label={`Move ${place.name} down in order`}
                      title={orderMode === "date" ? "Ordering by date" : "Move down"}
                    >
                      ▼
                    </button>
                  </div>
                  <span className="location-dot" />
                  <div className="row-details">
                    <strong>{place.name}</strong>
                    <p>{place.address ?? "Address not provided"}</p>
                  </div>
                  <div className="row-date-picker">
                    <label htmlFor={`date-${place.id}`} className="sr-only">
                      Visit date for {place.name}
                    </label>
                    <input
                      id={`date-${place.id}`}
                      type="date"
                      value={place.visitedAt ?? ""}
                      onChange={(e) => handleDateChange(place.id, e.target.value)}
                      placeholder="Visit date"
                      title="Optional visit date"
                      aria-label={`Optional visit date for ${place.name}`}
                    />
                  </div>
                  <code>
                    {place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}
                  </code>
                  {place.googleMapsUrl ? (
                    <a
                      href={place.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Open ${place.name} in Google Maps`}
                    >
                      ↗
                    </a>
                  ) : (
                    <span />
                  )}
                </article>
              ))}
            </div>
            <footer className="review-footer">
              <p>
                <strong>Next:</strong> Visualize your journey in an interactive animated travel map.
              </p>
              <Link href="/map" className="continue-button">
                Visualize journey <span>→</span>
              </Link>
            </footer>
          </div>
        </section>
      )}
    </main>
  );
}
