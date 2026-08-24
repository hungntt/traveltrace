"use client";

import { JOURNEY_SESSION_KEY } from "@/lib/journey-storage";
import type { PlaceImportResult } from "@/types/import";
import Link from "next/link";
import { useEffect, useState } from "react";

function buildGoogleMapsUrl(places: PlaceImportResult["places"]) {
  const ordered = [...places].sort((a, b) => a.journeyIndex - b.journeyIndex);
  if (ordered.length === 0) return "https://www.google.com/maps";
  if (ordered.length === 1) {
    const { latitude, longitude } = ordered[0];
    return "https://www.google.com/maps/search/?api=1&query=" + latitude + "," + longitude;
  }

  const params = new URLSearchParams({
    api: "1",
    origin: ordered[0].latitude + "," + ordered[0].longitude,
    destination: ordered[ordered.length - 1].latitude + "," + ordered[ordered.length - 1].longitude,
    travelmode: "driving",
  });
  if (ordered.length > 2) {
    params.set("waypoints", ordered.slice(1, -1).slice(0, 9).map(({ latitude, longitude }) => latitude + "," + longitude).join("|"));
  }
  return "https://www.google.com/maps/dir/?" + params.toString();
}

function CompassMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="20"/><path d="m30.8 16.4-4.2 10.2-10.2 4.2 4.2-10.2Z"/><circle cx="24" cy="24" r="2.2"/></svg>;
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

  return (
    <main className="review-page">
      <nav className="nav">
        <Link href="/" className="wordmark"><CompassMark /><span>TravelTrace</span></Link>
        <div className="review-steps" aria-label="Journey creation progress">
          <span className="done"><i>✓</i> Import</span><b /><span className="active"><i>2</i> Review</span><b /><span><i>3</i> Map</span>
        </div>
      </nav>

      {!loaded ? (
        <section className="review-loading" aria-live="polite"><span className="spinner dark" /><p>Loading your imported places…</p></section>
      ) : !result ? (
        <section className="review-empty">
          <p className="overline"><span /> Nothing to review yet</p>
          <h1>Import a journey first.</h1>
          <p>Your imported places live only in this browser tab, so they may be gone after closing it.</p>
          <Link href="/">Return to importer <b>→</b></Link>
        </section>
      ) : (
        <section className="review-content">
          <header className="review-heading">
            <div><p className="overline"><span /> Step 2 · Review</p><h1>{result.listName}</h1><p>Check the places extracted from your Google Maps list before building the map.</p></div>
            <div className="review-stats"><div><strong>{result.places.length}</strong><span>Places ready</span></div><div><strong>{result.issues.length}</strong><span>Need attention</span></div></div>
          </header>

          <div className="review-card">
            <div className="review-card-head"><div><span>Your locations</span><strong>{result.places.length} imported places</strong></div><Link href="/">← Import another list</Link></div>
            <div className="review-list">
              {result.places.map((place) => (
                <article key={place.id} className="review-row">
                  <span className="row-number">{String(place.journeyIndex + 1).padStart(2, "0")}</span>
                  <span className="location-dot" />
                  <div><strong>{place.name}</strong><p>{place.address ?? "Address not provided"}</p></div>
                  <code>{place.latitude.toFixed(4)}, {place.longitude.toFixed(4)}</code>
                  {place.googleMapsUrl ? <a href={place.googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${place.name} in Google Maps`}>↗</a> : <span />}
                </article>
              ))}
            </div>
            <footer className="review-footer"><p><strong>Next:</strong> open these places in their imported order.</p><a href={buildGoogleMapsUrl(result.places)} target="_blank" rel="noreferrer">Continue to map <span>→</span></a></footer>
          </div>
        </section>
      )}
    </main>
  );
}
