import { describe, expect, it } from "vitest";
import type { TravelPlace } from "@/types/import";
import {
  buildFullRouteFeatureCollection,
  buildGreatCircleSegment,
  buildProgressRouteGeoJSON,
  calculateBearing,
  getJourneyBounds,
  getTravelerState,
  intermediatePoint,
} from "./build-route";

const samplePlaces: TravelPlace[] = [
  {
    id: "p1",
    name: "Tokyo",
    latitude: 35.6762,
    longitude: 139.6503,
    originalIndex: 0,
    journeyIndex: 0,
  },
  {
    id: "p2",
    name: "Paris",
    latitude: 48.8566,
    longitude: 2.3522,
    originalIndex: 1,
    journeyIndex: 1,
  },
  {
    id: "p3",
    name: "New York",
    latitude: 40.7128,
    longitude: -74.006,
    originalIndex: 2,
    journeyIndex: 2,
  },
];

describe("build-route utilities", () => {
  describe("intermediatePoint", () => {
    it("should return start point at f=0 and end point at f=1", () => {
      const p1: [number, number] = [139.6503, 35.6762];
      const p2: [number, number] = [2.3522, 48.8566];

      const start = intermediatePoint(p1, p2, 0);
      expect(start[0]).toBeCloseTo(p1[0], 4);
      expect(start[1]).toBeCloseTo(p1[1], 4);

      const end = intermediatePoint(p1, p2, 1);
      expect(end[0]).toBeCloseTo(p2[0], 4);
      expect(end[1]).toBeCloseTo(p2[1], 4);
    });

    it("should handle identical points without crashing", () => {
      const p1: [number, number] = [10, 20];
      const mid = intermediatePoint(p1, p1, 0.5);
      expect(mid[0]).toBe(10);
      expect(mid[1]).toBe(20);
    });

    it("should calculate midpoint along great circle", () => {
      const p1: [number, number] = [0, 0];
      const p2: [number, number] = [0, 10];
      const mid = intermediatePoint(p1, p2, 0.5);
      expect(mid[0]).toBeCloseTo(0, 4);
      expect(mid[1]).toBeCloseTo(5, 4);
    });
  });

  describe("calculateBearing", () => {
    it("should calculate cardinal bearings correctly", () => {
      // Due North
      expect(calculateBearing([0, 0], [0, 10])).toBeCloseTo(0, 1);
      // Due East
      expect(calculateBearing([0, 0], [10, 0])).toBeCloseTo(90, 1);
      // Due South
      expect(calculateBearing([0, 0], [0, -10])).toBeCloseTo(180, 1);
      // Due West
      expect(calculateBearing([0, 0], [-10, 0])).toBeCloseTo(270, 1);
    });
  });

  describe("buildGreatCircleSegment", () => {
    it("should create line segment for short distance", () => {
      const seg = buildGreatCircleSegment([10, 10], [10.0001, 10.0001], 0);
      expect(seg.geometry.type).toBe("LineString");
      expect(seg.properties?.segmentIndex).toBe(0);
    });

    it("should create great circle arc for long distance", () => {
      const seg = buildGreatCircleSegment([139.65, 35.67], [2.35, 48.85], 0);
      expect(["LineString", "MultiLineString"]).toContain(seg.geometry.type);
    });
  });

  describe("buildFullRouteFeatureCollection", () => {
    it("should return empty features for 0 or 1 place", () => {
      expect(buildFullRouteFeatureCollection([]).features).toHaveLength(0);
      expect(buildFullRouteFeatureCollection([samplePlaces[0]]).features).toHaveLength(0);
    });

    it("should return N-1 segment features for N places", () => {
      const collection = buildFullRouteFeatureCollection(samplePlaces);
      expect(collection.features).toHaveLength(2);
      expect(collection.features[0].properties?.segmentIndex).toBe(0);
      expect(collection.features[1].properties?.segmentIndex).toBe(1);
    });
  });

  describe("buildProgressRouteGeoJSON", () => {
    it("should handle progress 0", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 0);
      expect(completedGeoJson.features).toHaveLength(0);
      expect(activeGeoJson.features).toHaveLength(0);
    });

    it("should handle mid-segment progress (e.g. 0.5)", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 0.5);
      expect(completedGeoJson.features).toHaveLength(0);
      expect(activeGeoJson.features).toHaveLength(1);
    });

    it("should handle multi-segment progress (e.g. 1.5)", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 1.5);
      expect(completedGeoJson.features).toHaveLength(1); // segment 0 completed
      expect(activeGeoJson.features).toHaveLength(1); // segment 1 active
    });
  });

  describe("getTravelerState", () => {
    it("should return null for empty places", () => {
      expect(getTravelerState([], 0)).toBeNull();
    });

    it("should return stationary state for 1 place", () => {
      const state = getTravelerState([samplePlaces[0]], 0);
      expect(state).not.toBeNull();
      expect(state?.position).toEqual([samplePlaces[0].longitude, samplePlaces[0].latitude]);
      expect(state?.currentStopIndex).toBe(0);
      expect(state?.isAtStop).toBe(true);
    });

    it("should calculate traveler state at fractional progress", () => {
      const state = getTravelerState(samplePlaces, 0.5);
      expect(state).not.toBeNull();
      expect(state?.progress).toBeCloseTo(0.5, 4);
      expect(state?.bearing).toBeGreaterThanOrEqual(0);
      expect(state?.bearing).toBeLessThanOrEqual(360);
    });
  });

  describe("getJourneyBounds", () => {
    it("should return default world bounds for empty array", () => {
      expect(getJourneyBounds([])).toEqual([
        [-180, -85],
        [180, 85],
      ]);
    });

    it("should return padded bounds for single place", () => {
      const bounds = getJourneyBounds([samplePlaces[0]]);
      expect(bounds[0][0]).toBeLessThan(samplePlaces[0].longitude);
      expect(bounds[1][0]).toBeGreaterThan(samplePlaces[0].longitude);
    });

    it("should enclose all places", () => {
      const [[minLng, minLat], [maxLng, maxLat]] = getJourneyBounds(samplePlaces);
      for (const p of samplePlaces) {
        expect(p.longitude).toBeGreaterThanOrEqual(minLng);
        expect(p.longitude).toBeLessThanOrEqual(maxLng);
        expect(p.latitude).toBeGreaterThanOrEqual(minLat);
        expect(p.latitude).toBeLessThanOrEqual(maxLat);
      }
    });
  });
});
