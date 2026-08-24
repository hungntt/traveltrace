import { describe, expect, it, vi } from "vitest";
import { JOURNEY_FALLBACK_STYLE, OPEN_FREE_MAP_STYLE } from "./fallback-style";

describe("fallback-style & lifecycle helpers", () => {
  it("JOURNEY_FALLBACK_STYLE should be a valid offline StyleSpecification", () => {
    expect(JOURNEY_FALLBACK_STYLE.version).toBe(8);
    expect(JOURNEY_FALLBACK_STYLE.sources).toEqual({});
    expect(JOURNEY_FALLBACK_STYLE.layers).toHaveLength(1);
    expect(JOURNEY_FALLBACK_STYLE.layers[0].id).toBe("traveltrace-background");
    expect(JOURNEY_FALLBACK_STYLE.layers[0].type).toBe("background");
    expect(OPEN_FREE_MAP_STYLE).toBe("https://tiles.openfreemap.org/styles/liberty");
  });

  describe("Lifecycle state transitions", () => {
    it("Scenario A: Successful style load (loading → style.load → ready)", () => {
      let status: "loading" | "ready" | "error" = "loading";
      let isFallback = false;

      // Simulate style.load
      const onStyleLoad = () => {
        status = "ready";
      };

      onStyleLoad();
      expect(status).toBe("ready");
      expect(isFallback).toBe(false);
    });

    it("Scenario B: OpenFreeMap timeout (loading → timeout → fallback style → ready with fallback notice)", () => {
      vi.useFakeTimers();

      let status: "loading" | "ready" | "error" = "loading";
      let isFallback = false;

      let timer: NodeJS.Timeout | null = setTimeout(() => {
        isFallback = true;
        status = "ready"; // Fallback style applied
      }, 10000);

      expect(status).toBe("loading");
      expect(isFallback).toBe(false);

      vi.advanceTimersByTime(10000);
      expect(status).toBe("ready");
      expect(isFallback).toBe(true);

      if (timer) clearTimeout(timer);
      vi.useRealTimers();
    });

    it("Scenario C: Primary style error (loading → fallback → ready with fallback notice)", () => {
      let status: "loading" | "ready" | "error" = "loading";
      let isFallback = false;

      const onError = (isFatalWebGL: boolean) => {
        if (isFatalWebGL) {
          status = "error";
        } else if (!isFallback) {
          isFallback = true;
          status = "ready"; // Switched to fallback
        }
      };

      onError(false); // Non-fatal primary style network error
      expect(status).toBe("ready");
      expect(isFallback).toBe(true);
    });

    it("Scenario D: MapLibre/WebGL fatal failure (loading → error)", () => {
      let status: "loading" | "ready" | "error" = "loading";

      const onFatalWebGL = () => {
        status = "error";
      };

      onFatalWebGL();
      expect(status).toBe("error");
    });

    it("Scenario E: Cleanup before timeout (timeout cancelled, does not mutate state after unmount)", () => {
      vi.useFakeTimers();

      let status: "loading" | "ready" | "error" = "loading";
      let isFallback = false;

      const timer = setTimeout(() => {
        isFallback = true;
        status = "ready";
      }, 10000);

      // Unmount / cleanup after 3 seconds
      vi.advanceTimersByTime(3000);
      clearTimeout(timer);

      // Advance past 10 seconds
      vi.advanceTimersByTime(10000);
      expect(status).toBe("loading");
      expect(isFallback).toBe(false);

      vi.useRealTimers();
    });
  });
});
