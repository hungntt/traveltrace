"use client";

import { FormEvent, useEffect, useState } from "react";
import type { ImportApiError, PlaceImportResult } from "@/types/import";
import { JOURNEY_SESSION_KEY } from "@/lib/journey-storage";
import { useRouter } from "next/navigation";

type ImportState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: PlaceImportResult }
  | { status: "error"; error: ImportApiError["error"] };

const progressMessages = ["Following the shared link", "Reading saved places", "Normalizing location data"];

function LinkIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.7 13.3a4.4 4.4 0 0 0 6.2.1l2.5-2.5a4.4 4.4 0 0 0-6.2-6.2l-1.4 1.4M13.3 10.7a4.4 4.4 0 0 0-6.2-.1l-2.5 2.5a4.4 4.4 0 0 0 6.2 6.2l1.4-1.4"/></svg>;
}

export function GoogleMapsInput() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<ImportState>({ status: "idle" });
  const [progressIndex, setProgressIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (state.status !== "loading") return;
    setProgressIndex(0);
    const timer = window.setInterval(() => setProgressIndex((current) => Math.min(current + 1, progressMessages.length - 1)), 1_100);
    return () => window.clearInterval(timer);
  }, [state.status]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submittedUrl = String(new FormData(event.currentTarget).get("url") ?? "").trim();
    if (!submittedUrl) return;
    setUrl(submittedUrl);
    setState({ status: "loading" });
    setCopied(false);
    try {
      const response = await fetch("/api/import/google-maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: submittedUrl }),
      });
      const payload = await response.json() as { data?: PlaceImportResult } & Partial<ImportApiError>;
      if (!response.ok || !payload.data) {
        setState({ status: "error", error: payload.error ?? { code: "UNKNOWN", message: "The list could not be imported." } });
        return;
      }
      setState({ status: "success", result: payload.data });
    } catch {
      setState({ status: "error", error: { code: "NETWORK_ERROR", message: "The importer couldn’t be reached.", recovery: "Check your connection and try again." } });
    }
  }

  async function copyJson() {
    if (state.status !== "success") return;
    await navigator.clipboard.writeText(JSON.stringify(state.result.places, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  function continueToReview() {
    if (state.status !== "success") return;
    sessionStorage.setItem(JOURNEY_SESSION_KEY, JSON.stringify(state.result));
    router.push("/journey");
  }

  return (
    <section className="import-shell" aria-labelledby="import-title">
      <div className="import-card">
        <div className="phase-label"><span>01</span> Import your places</div>
        <h2 id="import-title">Paste a public Google Maps list</h2>
        <p className="card-copy">We’ll extract the place names, addresses, and coordinates. Nothing is saved.</p>
        <form onSubmit={submit}>
          <label htmlFor="maps-url">Google Maps shared-list URL</label>
          <div className={`url-field ${state.status === "error" ? "has-error" : ""}`}>
            <LinkIcon />
            <input
              id="maps-url"
              name="url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://maps.app.goo.gl/..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              disabled={state.status === "loading"}
              required
            />
            <button type="submit" disabled={state.status === "loading"}>
              {state.status === "loading" ? <span className="spinner" /> : "Extract places"}
              {state.status !== "loading" && <span aria-hidden="true">→</span>}
            </button>
          </div>
          <p className="field-hint">In Google Maps: Saved → open a list → Share → Anyone with the link</p>
        </form>

        {state.status === "loading" && (
          <div className="progress-card" role="status" aria-live="polite">
            <div className="progress-route">
              {progressMessages.map((message, index) => <span key={message} className={index <= progressIndex ? "active" : ""}><i>{index < progressIndex ? "✓" : index + 1}</i>{message}</span>)}
            </div>
            <div className="progress-line"><i style={{ width: `${((progressIndex + 1) / progressMessages.length) * 100}%` }} /></div>
          </div>
        )}

        {state.status === "error" && (
          <div className="error-card" role="alert">
            <span aria-hidden="true">!</span>
            <div><strong>{state.error.message}</strong>{state.error.recovery && <p>{state.error.recovery}</p>}<code>{state.error.code}</code></div>
          </div>
        )}
      </div>

      {state.status === "success" && (
        <ImportResult result={state.result} copied={copied} onCopy={copyJson} onContinue={continueToReview} />
      )}
    </section>
  );
}

function ImportResult({
  result,
  copied,
  onCopy,
  onContinue,
}: {
  result: PlaceImportResult;
  copied: boolean;
  onCopy: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="result-card">
      <header className="result-header">
        <div>
          <p className="result-eyebrow">Import complete</p>
          <h3>{result.listName}</h3>
          {result.owner && <span>Shared by {result.owner}</span>}
        </div>
        <div className="result-actions">
          <button onClick={onCopy}>{copied ? "Copied" : "Copy JSON"}</button>
          <div className="result-count"><strong>{result.places.length}</strong><span>of {result.totalFound} places ready</span></div>
        </div>
      </header>
      {result.issues.length > 0 && (
        <div className="attention"><span>!</span><p><strong>{result.issues.length} {result.issues.length === 1 ? "location needs" : "locations need"} attention</strong> Missing or invalid coordinates were left out without failing the import.</p></div>
      )}
      <div className="table-wrap">
        <table>
          <thead><tr><th>#</th><th>Place</th><th>Address</th><th>Latitude</th><th>Longitude</th><th>Place ID</th></tr></thead>
          <tbody>
            {result.places.map((place) => (
              <tr key={place.id}>
                <td>{String(place.journeyIndex + 1).padStart(2, "0")}</td>
                <td><strong>{place.name}</strong></td>
                <td>{place.address ?? <em>Not provided</em>}</td>
                <td><code>{place.latitude.toFixed(5)}</code></td>
                <td><code>{place.longitude.toFixed(5)}</code></td>
                <td>{place.googlePlaceId ? <code>{place.googlePlaceId}</code> : <em>Not provided</em>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="phase-gate">
        <div><span>Phase 1 complete</span><p>Your normalized places are ready for the review step.</p></div>
        <button className="continue-button" onClick={onContinue}>Continue to review <b aria-hidden="true">→</b></button>
      </footer>
    </div>
  );
}
