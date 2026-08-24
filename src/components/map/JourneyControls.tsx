"use client";

import type { CameraMode } from "./JourneyMap";
import type { TravelPlace } from "@/types/import";

export interface JourneyControlsProps {
  places: TravelPlace[];
  isPlaying: boolean;
  progress: number; // 0 to Math.max(0, places.length - 1)
  speed: number; // 0.5 | 1 | 2
  isTransit: boolean;
  departedStopIndex: number;
  destinationStopIndex: number;
  arrivedStopIndex: number | null;
  animationReady?: boolean;
  cameraMode: CameraMode;
  compact?: boolean;
  isFullscreen?: boolean;
  isExporting?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onReplay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (targetProgress: number) => void;
  onSpeedChange: (speed: number) => void;
  onFollowCamera: () => void;
  onFixedCamera: () => void;
  onToggleFullscreen?: () => void;
  onExportVideo?: () => void;
}

export function JourneyControls({
  places,
  isPlaying,
  progress,
  speed,
  isTransit,
  departedStopIndex,
  destinationStopIndex,
  arrivedStopIndex,
  animationReady = true,
  cameraMode,
  compact = false,
  isFullscreen = false,
  isExporting = false,
  onPlay,
  onPause,
  onReplay,
  onPrev,
  onNext,
  onSeek,
  onSpeedChange,
  onFollowCamera,
  onFixedCamera,
  onToggleFullscreen,
  onExportVideo,
}: JourneyControlsProps) {
  const totalStops = places.length;
  const isSingleStop = totalStops <= 1;
  const maxProgress = Math.max(0, totalStops - 1);
  const isControlDisabled = isSingleStop || !animationReady;

  // Active display place: target destination during transit, or arrived stop
  const displayIndex = isTransit
    ? destinationStopIndex
    : arrivedStopIndex ?? Math.min(totalStops - 1, Math.floor(progress));
  const activePlace = places[displayIndex] ?? places[0];

  const formattedDate = activePlace?.visitedAt
    ? new Date(activePlace.visitedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : null;

  const compactLabel = isTransit
    ? `${places[departedStopIndex]?.name ?? ""} → ${places[destinationStopIndex]?.name ?? ""}`
    : activePlace?.name ?? "";

  return (
    <div className={`journey-controls-panel ${compact ? "compact" : ""}`}>
      {compact ? (
        activePlace && <p className="compact-current-place">{compactLabel}</p>
      ) : (
        <>
          {/* Current Stop Header Card */}
          {activePlace && (
            <div className="current-stop-card">
              <div className="stop-badge">
                <span className={`stop-index ${isTransit ? "in-transit" : ""}`}>
                  {isSingleStop
                    ? "Stop 1 of 1"
                    : isTransit
                    ? `Traveling to Stop ${destinationStopIndex + 1} of ${totalStops}`
                    : `Stop ${(arrivedStopIndex ?? displayIndex) + 1} of ${totalStops}`}
                </span>
                {formattedDate && <span className="stop-date">{formattedDate}</span>}
              </div>
              <div className="stop-details">
                <h3 className="stop-name">{activePlace.name}</h3>
                {activePlace.address && (
                  <p className="stop-address">{activePlace.address}</p>
                )}
              </div>
            </div>
          )}

          {/* Scrubber Timeline */}
          <div className="timeline-container">
            <div className="timeline-labels">
              <span>{places[0]?.name ?? "Start"}</span>
              <span>{places[totalStops - 1]?.name ?? "End"}</span>
            </div>
            <div className="timeline-track-wrap">
              <input
                type="range"
                min={0}
                max={Math.max(1, maxProgress)}
                step={0.005}
                value={isSingleStop ? 0 : progress}
                onChange={(e) => onSeek(parseFloat(e.target.value))}
                disabled={isControlDisabled}
                aria-label="Journey timeline scrubber"
                className="timeline-slider"
                style={
                  {
                    "--progress-pct": isSingleStop
                      ? "100%"
                      : `${(progress / maxProgress) * 100}%`,
                  } as React.CSSProperties
                }
              />
              <div className="timeline-stop-dots" aria-hidden="true">
                {places.map((place, idx) => {
                  const isReached = isTransit
                    ? idx <= departedStopIndex
                    : idx <= (arrivedStopIndex ?? displayIndex);
                  const isActive = isTransit
                    ? idx === destinationStopIndex
                    : idx === (arrivedStopIndex ?? displayIndex);
                  const isTarget = isTransit && idx === destinationStopIndex;

                  return (
                    <span
                      key={place.id}
                      className={`timeline-dot ${isReached ? "reached" : ""} ${
                        isActive ? "active" : ""
                      } ${isTarget ? "target-dot" : ""}`}
                      style={{
                        left:
                          maxProgress === 0
                            ? "50%"
                            : `${(idx / maxProgress) * 100}%`,
                      }}
                      title={`${idx + 1}. ${place.name}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}

      {/* Main Buttons and Speed */}
      <div className="controls-action-bar">
        <div className="primary-playback-btns">
          {/* Replay */}
          <button
            type="button"
            className="ctrl-btn"
            onClick={onReplay}
            disabled={!animationReady}
            title="Replay from beginning"
            aria-label="Replay journey from beginning"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
            <span className="ctrl-btn-text">Replay</span>
          </button>

          {!compact && (
            <>
              {/* Previous */}
              <button
                type="button"
                className="ctrl-btn"
                onClick={onPrev}
                disabled={isControlDisabled || progress <= 0}
                title="Previous destination"
                aria-label="Jump to previous destination"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="19 20 9 12 19 4 19 20" />
                  <line x1="5" y1="19" x2="5" y2="5" />
                </svg>
              </button>
            </>
          )}

          {/* Play / Pause */}
          <button
            type="button"
            className={`ctrl-btn play-pause-btn ${isPlaying ? "playing" : ""}`}
            onClick={isPlaying ? onPause : onPlay}
            disabled={isControlDisabled}
            title={isPlaying ? "Pause" : "Play"}
            aria-label={isPlaying ? "Pause animation" : "Play journey animation"}
          >
            {isPlaying ? (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <rect x="6" y="4" width="4" height="16" rx="1" />
                <rect x="14" y="4" width="4" height="16" rx="1" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <polygon points="6 4 20 12 6 20 6 4" />
              </svg>
            )}
            <span>{isPlaying ? "Pause" : "Play"}</span>
          </button>

          {!compact && (
            <>
              {/* Next */}
              <button
                type="button"
                className="ctrl-btn"
                onClick={onNext}
                disabled={isControlDisabled || progress >= maxProgress}
                title="Next destination"
                aria-label="Jump to next destination"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
                  <polygon points="5 4 15 12 5 20 5 4" />
                  <line x1="19" y1="5" x2="19" y2="19" />
                </svg>
              </button>
            </>
          )}
        </div>

        {/* Speed Selector & Secondary Actions */}
        <div className="secondary-controls">
          <div className="speed-selector" role="group" aria-label="Playback speed">
            {!compact && <span className="speed-label">Speed:</span>}
            {[0.5, 1, 2].map((s) => (
              <button
                key={s}
                type="button"
                className={`speed-btn ${speed === s ? "active" : ""}`}
                onClick={() => onSpeedChange(s)}
                aria-pressed={speed === s}
                aria-label={`Playback speed ${s}x`}
              >
                {s}×
              </button>
            ))}
          </div>

          {/* Camera mode: follow the traveler, or hold the whole journey in view */}
          <div className="camera-mode-selector" role="group" aria-label="Camera mode">
            <button
              type="button"
              className={`camera-mode-btn ${cameraMode === "follow" ? "active" : ""}`}
              onClick={onFollowCamera}
              disabled={!animationReady}
              aria-pressed={cameraMode === "follow"}
              title="Camera follows the traveler"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 2v3m0 14v3M2 12h3m14 0h3" />
              </svg>
              <span>Follow Camera</span>
            </button>
            <button
              type="button"
              className={`camera-mode-btn ${cameraMode === "fixed" ? "active" : ""}`}
              onClick={onFixedCamera}
              disabled={!animationReady}
              aria-pressed={cameraMode === "fixed"}
              title="Hold the whole journey in view"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
              </svg>
              <span>Fixed Map</span>
            </button>
          </div>

          {!compact && (
            <>
              {/* Export Video */}
              {onExportVideo && (
                <button
                  type="button"
                  className={`ctrl-btn export-btn ${isExporting ? "exporting" : ""}`}
                  onClick={onExportVideo}
                  disabled={isControlDisabled || isExporting}
                  title="Export journey as a video"
                  aria-label="Export journey animation as a video"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="5" width="15" height="14" rx="2" />
                    <path d="M17 9.5 22 6v12l-5-3.5" />
                  </svg>
                  <span>{isExporting ? "Exporting…" : "Export Video"}</span>
                </button>
              )}
            </>
          )}

          {/* Fullscreen toggle */}
          {onToggleFullscreen && (
            <button
              type="button"
              className="ctrl-btn fullscreen-btn"
              onClick={onToggleFullscreen}
              disabled={!animationReady}
              title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
              aria-label={isFullscreen ? "Exit fullscreen mode" : "Enter fullscreen mode"}
            >
              {isFullscreen ? (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 3v4a2 2 0 0 1-2 2H3m18 0h-4a2 2 0 0 1-2-2V3m0 18v-4a2 2 0 0 1 2-2h4M3 15h4a2 2 0 0 1 2 2v4" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                </svg>
              )}
              <span>{isFullscreen ? "Exit Fullscreen" : "Fullscreen"}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
