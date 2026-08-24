"use client";

import { movePlace, sortPlacesByDate, updatePlaceDate } from "@/lib/map/order";
import { JOURNEY_SESSION_KEY } from "@/lib/journey-storage";
import type { PlaceImportResult, TravelPlace } from "@/types/import";
import Link from "next/link";
import { useEffect, useState } from "react";

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

  useEffect(() => {
    const stored = sessionStorage.getItem(JOURNEY_SESSION_KEY);
    if (stored) {
      try {
        setResult(JSON.parse(stored) as PlaceImportResult);
      } catch {
        sessionStorage.removeItem(JOURNEY_SESSION_KEY);
      }
    }
    setLoaded(true);
  }, []);

  const savePlaces = (updatedPlaces: TravelPlace[]) => {
    if (!result) return;
    const updatedResult: PlaceImportResult = {
      ...result,
      places: updatedPlaces,
    };
    setResult(updatedResult);
    sessionStorage.setItem(JOURNEY_SESSION_KEY, JSON.stringify(updatedResult));
  };

  const handleMoveUp = (index: number) => {
    if (!result || index <= 0) return;
    const updated = movePlace(result.places, index, index - 1);
    savePlaces(updated);
  };

  const handleMoveDown = (index: number) => {
    if (!result || index >= result.places.length - 1) return;
    const updated = movePlace(result.places, index, index + 1);
    savePlaces(updated);
  };

  const handleDateChange = (placeId: string, value: string) => {
    if (!result) return;
    const updated = updatePlaceDate(result.places, placeId, value);
    savePlaces(updated);
  };

  const handleSortByDate = () => {
    if (!result) return;
    const updated = sortPlacesByDate(result.places);
    savePlaces(updated);
  };

  const hasAnyDates = result?.places.some((p) => Boolean(p.visitedAt));

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
                before building the map.
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
                {hasAnyDates && (
                  <button
                    type="button"
                    className="sort-date-btn"
                    onClick={handleSortByDate}
                    title="Sort places chronologically by assigned visit dates"
                  >
                    Sort by date
                  </button>
                )}
                <Link href="/">← Import another list</Link>
              </div>
            </div>
            <div className="review-list">
              {result.places.map((place, index) => (
                <article key={place.id} className="review-row">
                  <span className="row-number">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="row-reorder">
                    <button
                      type="button"
                      onClick={() => handleMoveUp(index)}
                      disabled={index === 0}
                      aria-label={`Move ${place.name} up in order`}
                      title="Move up"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveDown(index)}
                      disabled={index === result.places.length - 1}
                      aria-label={`Move ${place.name} down in order`}
                      title="Move down"
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
                <strong>Next:</strong> Visualize your journey in interactive 3D travel animation.
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
