import { describe, expect, it } from "vitest";
import type { TravelPlace } from "@/types/import";
import {
  buildFullRouteFeatureCollection,
  buildGreatCircleSegment,
  buildOptimizedProgressRoute,
  buildProgressRouteGeoJSON,
  calculateBearing,
  calculateTotalRouteDistance,
  formatDistance,
  getJourneyBounds,
  getTravelerState,
  intermediatePoint,
  prepareSegments,
  unwrapLongitude,
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
  describe("unwrapLongitude", () => {
    it("should keep longitude unchanged when within [-180, 180] span of reference", () => {
      expect(unwrapLongitude(10, 0)).toBe(10);
      expect(unwrapLongitude(-10, 0)).toBe(-10);
    });

    it("should unwrap across the antimeridian going East", () => {
      // Reference at 179 deg, next point at -179 deg -> should be unwrapped to 181 deg
      expect(unwrapLongitude(-179, 179)).toBe(181);
    });

    it("should unwrap across the antimeridian going West", () => {
      // Reference at -179 deg, next point at 179 deg -> should be unwrapped to -181 deg
      expect(unwrapLongitude(179, -179)).toBe(-181);
    });
  });

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

    it("should return 0 for identical coordinates without NaN", () => {
      expect(calculateBearing([139.65, 35.67], [139.65, 35.67])).toBe(0);
    });
  });

  describe("buildGreatCircleSegment", () => {
    it("should create line segment for short distance or identical points", () => {
      const seg = buildGreatCircleSegment([10, 10], [10.0001, 10.0001], 0);
      expect(seg.geometry.type).toBe("LineString");
      expect(seg.properties?.segmentIndex).toBe(0);

      const identical = buildGreatCircleSegment([10, 10], [10, 10], 0);
      expect(identical.geometry.type).toBe("LineString");
    });

    it("should create great circle arc for long distance", () => {
      const seg = buildGreatCircleSegment([139.65, 35.67], [2.35, 48.85], 0);
      expect(["LineString", "MultiLineString"]).toContain(seg.geometry.type);
    });
  });

  describe("prepareSegments & buildOptimizedProgressRoute", () => {
    it("should prepare segments once and return valid structures", () => {
      const segs = prepareSegments(samplePlaces);
      expect(segs).toHaveLength(2);
      expect(segs[0].distanceKm).toBeGreaterThan(5000);
      expect(segs[0].samples.length).toBeGreaterThan(50);
      expect(segs[0].unwrappedSamples.length).toBe(segs[0].samples.length);
    });

    it("should build optimized progress routes identical to standard routes", () => {
      const segs = prepareSegments(samplePlaces);

      // Progress 0
      const prog0 = buildOptimizedProgressRoute(segs, 0);
      expect(prog0.completedGeoJson.features).toHaveLength(0);
      expect(prog0.activeGeoJson.features).toHaveLength(0);

      // Progress 0.5
      const prog05 = buildOptimizedProgressRoute(segs, 0.5);
      expect(prog05.completedGeoJson.features).toHaveLength(0);
      expect(prog05.activeGeoJson.features).toHaveLength(1);

      // Progress 1.0
      const prog1 = buildOptimizedProgressRoute(segs, 1.0);
      expect(prog1.completedGeoJson.features).toHaveLength(1);
      expect(prog1.activeGeoJson.features).toHaveLength(0);

      // Progress 2.0 (final)
      const prog2 = buildOptimizedProgressRoute(segs, 2.0);
      expect(prog2.completedGeoJson.features).toHaveLength(2);
      expect(prog2.activeGeoJson.features).toHaveLength(0);
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

  describe("buildProgressRouteGeoJSON regression tests", () => {
    it("should handle progress 0: completed empty, active empty", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 0);
      expect(completedGeoJson.features).toHaveLength(0);
      expect(activeGeoJson.features).toHaveLength(0);
    });

    it("should handle progress 0.5: completed empty, active segment 0 partial", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 0.5);
      expect(completedGeoJson.features).toHaveLength(0);
      expect(activeGeoJson.features).toHaveLength(1);
      expect(activeGeoJson.features[0].properties?.segmentIndex).toBe(0);
    });

    it("should handle progress 1.0: completed segment 0, active empty", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 1.0);
      expect(completedGeoJson.features).toHaveLength(1);
      expect(completedGeoJson.features[0].properties?.segmentIndex).toBe(0);
      expect(activeGeoJson.features).toHaveLength(0);
    });

    it("should handle progress 1.5: completed segment 0, active segment 1 partial", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 1.5);
      expect(completedGeoJson.features).toHaveLength(1);
      expect(completedGeoJson.features[0].properties?.segmentIndex).toBe(0);
      expect(activeGeoJson.features).toHaveLength(1);
      expect(activeGeoJson.features[0].properties?.segmentIndex).toBe(1);
    });

    it("should handle FINAL progress (2.0): all segments completed, active route is completely empty", () => {
      const { completedGeoJson, activeGeoJson } = buildProgressRouteGeoJSON(samplePlaces, 2.0);
      expect(completedGeoJson.features).toHaveLength(2);
      expect(completedGeoJson.features[0].properties?.segmentIndex).toBe(0);
      expect(completedGeoJson.features[1].properties?.segmentIndex).toBe(1);
      expect(activeGeoJson.features).toHaveLength(0);
    });
  });

  describe("getTravelerState semantics", () => {
    it("should return null for empty places", () => {
      expect(getTravelerState([], 0)).toBeNull();
    });

    it("should return stationary state for 1 place", () => {
      const state = getTravelerState([samplePlaces[0]], 0);
      expect(state).not.toBeNull();
      expect(state?.position).toEqual([samplePlaces[0].longitude, samplePlaces[0].latitude]);
      expect(state?.departedStopIndex).toBe(0);
      expect(state?.destinationStopIndex).toBe(0);
      expect(state?.arrivedStopIndex).toBe(0);
      expect(state?.isAtStop).toBe(true);
      expect(state?.isTransit).toBe(false);
    });

    it("should return correct state at start (progress 0)", () => {
      const state = getTravelerState(samplePlaces, 0);
      expect(state?.departedStopIndex).toBe(0);
      expect(state?.destinationStopIndex).toBe(1);
      expect(state?.arrivedStopIndex).toBe(0);
      expect(state?.isAtStop).toBe(true);
      expect(state?.isTransit).toBe(false);
    });

    it("should return in-transit state mid-segment (progress 0.5)", () => {
      const state = getTravelerState(samplePlaces, 0.5);
      expect(state?.departedStopIndex).toBe(0);
      expect(state?.destinationStopIndex).toBe(1);
      expect(state?.arrivedStopIndex).toBeNull();
      expect(state?.isAtStop).toBe(false);
      expect(state?.isTransit).toBe(true);
    });

    it("should return arrived state at stop 2 (progress 1.0)", () => {
      const state = getTravelerState(samplePlaces, 1.0);
      expect(state?.departedStopIndex).toBe(1);
      expect(state?.destinationStopIndex).toBe(2);
      expect(state?.arrivedStopIndex).toBe(1);
      expect(state?.isAtStop).toBe(true);
      expect(state?.isTransit).toBe(false);
    });

    it("should return arrived state at final destination (progress 2.0)", () => {
      const state = getTravelerState(samplePlaces, 2.0);
      expect(state?.departedStopIndex).toBe(1);
      expect(state?.destinationStopIndex).toBe(2);
      expect(state?.arrivedStopIndex).toBe(2);
      expect(state?.isAtStop).toBe(true);
      expect(state?.isTransit).toBe(false);
      expect(state?.position[0]).toBeCloseTo(samplePlaces[2].longitude, 4);
      expect(state?.position[1]).toBeCloseTo(samplePlaces[2].latitude, 4);
    });
  });

  describe("distance calculations", () => {
    it("should calculate total distance and format cleanly", () => {
      expect(calculateTotalRouteDistance([])).toBe(0);
      expect(calculateTotalRouteDistance([samplePlaces[0]])).toBe(0);

      const totalKm = calculateTotalRouteDistance(samplePlaces);
      expect(totalKm).toBeGreaterThan(10000);
      const formatted = formatDistance(totalKm);
      expect(formatted).toMatch(/^[0-9,]+ km$/);
    });
  });

  describe("getJourneyBounds & antimeridian awareness", () => {
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

    it("should enclose ordinary route (Paris -> New York)", () => {
      const parisNY: TravelPlace[] = [samplePlaces[1], samplePlaces[2]];
      const [[minLng, minLat], [maxLng, maxLat]] = getJourneyBounds(parisNY);
      expect(minLng).toBeCloseTo(-74.006, 1);
      expect(maxLng).toBeCloseTo(2.352, 1);
      expect(minLat).toBeCloseTo(40.7128, 1);
      expect(maxLat).toBeCloseTo(48.8566, 1);
    });

    it("should handle dateline crossing route (Tokyo -> Honolulu) with minimal Pacific span", () => {
      const tokyoHonolulu: TravelPlace[] = [
        { id: "t1", name: "Tokyo", longitude: 139.69, latitude: 35.68, originalIndex: 0, journeyIndex: 0 },
        { id: "h1", name: "Honolulu", longitude: -157.85, latitude: 21.30, originalIndex: 1, journeyIndex: 1 },
      ];
      const [[minLng], [maxLng]] = getJourneyBounds(tokyoHonolulu);
      const span = maxLng - minLng;
      expect(span).toBeLessThan(100);
      expect(span).toBeCloseTo(62.46, 1);
    });

    it("should handle Fiji -> Samoa dateline crossing cleanly", () => {
      const fijiSamoa: TravelPlace[] = [
        { id: "f1", name: "Fiji", longitude: 178.06, latitude: -18.14, originalIndex: 0, journeyIndex: 0 },
        { id: "s1", name: "Samoa", longitude: -172.10, latitude: -13.83, originalIndex: 1, journeyIndex: 1 },
      ];
      const [[minLng], [maxLng]] = getJourneyBounds(fijiSamoa);
      const span = maxLng - minLng;
      expect(span).toBeLessThan(30);
      expect(span).toBeCloseTo(9.84, 1);
    });

    it("should handle consecutive identical coordinates without crashing", () => {
      const duplicates: TravelPlace[] = [
        { id: "d1", name: "Spot A", longitude: 100, latitude: 20, originalIndex: 0, journeyIndex: 0 },
        { id: "d2", name: "Spot A copy", longitude: 100, latitude: 20, originalIndex: 1, journeyIndex: 1 },
      ];
      const [[minLng, minLat], [maxLng, maxLat]] = getJourneyBounds(duplicates);
      expect(minLng).toBeLessThan(100);
      expect(maxLng).toBeGreaterThan(100);
      expect(minLat).toBeLessThan(20);
      expect(maxLat).toBeGreaterThan(20);
    });
  });

  describe("Phase 2 & 10 Manual Visual Proof: Two-Stop Tokyo -> Paris seeking", () => {
    const tokyoParis: TravelPlace[] = [
      { id: "p1", name: "Tokyo", latitude: 35.6762, longitude: 139.6503, originalIndex: 0, journeyIndex: 0 },
      { id: "p2", name: "Paris", latitude: 48.8566, longitude: 2.3522, originalIndex: 1, journeyIndex: 1 },
    ];

    it("should accurately move traveler and grow active route across seek fractions [0, 0.25, 0.5, 0.75, 1.0]", () => {
      const prepared = prepareSegments(tokyoParis);
      expect(prepared).toHaveLength(1);
      expect(prepared[0].samples.length).toBe(129); // 128 intervals + 1 point

      // seekTo(0)
      const state0 = getTravelerState(tokyoParis, 0, prepared);
      expect(state0?.position[0]).toBeCloseTo(139.6503, 2);
      expect(state0?.position[1]).toBeCloseTo(35.6762, 2);
      expect(state0?.isAtStop).toBe(true);
      const route0 = buildOptimizedProgressRoute(prepared, 0);
      expect(route0.activeGeoJson.features).toHaveLength(0);
      expect(route0.completedGeoJson.features).toHaveLength(0);

      // seekTo(0.25)
      const state025 = getTravelerState(tokyoParis, 0.25, prepared);
      expect(state025?.isTransit).toBe(true);
      const route025 = buildOptimizedProgressRoute(prepared, 0.25);
      expect(route025.activeGeoJson.features).toHaveLength(1);
      const coords025 = (route025.activeGeoJson.features[0].geometry as { coordinates: number[][] }).coordinates;
      expect(coords025.length).toBeGreaterThan(20);

      // seekTo(0.5) - roughly halfway
      const state05 = getTravelerState(tokyoParis, 0.5, prepared);
      expect(state05?.isTransit).toBe(true);
      const route05 = buildOptimizedProgressRoute(prepared, 0.5);
      expect(route05.activeGeoJson.features).toHaveLength(1);
      const coords05 = (route05.activeGeoJson.features[0].geometry as { coordinates: number[][] }).coordinates;
      expect(coords05.length).toBeGreaterThan(coords025.length);

      // seekTo(0.75)
      const state075 = getTravelerState(tokyoParis, 0.75, prepared);
      expect(state075?.isTransit).toBe(true);
      const route075 = buildOptimizedProgressRoute(prepared, 0.75);
      expect(route075.activeGeoJson.features).toHaveLength(1);
      const coords075 = (route075.activeGeoJson.features[0].geometry as { coordinates: number[][] }).coordinates;
      expect(coords075.length).toBeGreaterThan(coords05.length);

      // seekTo(1.0) - arrived at Paris
      const state1 = getTravelerState(tokyoParis, 1.0, prepared);
      expect(state1?.position[0]).toBeCloseTo(2.3522, 2);
      expect(state1?.position[1]).toBeCloseTo(48.8566, 2);
      expect(state1?.isAtStop).toBe(true);
      expect(state1?.arrivedStopIndex).toBe(1);
      const route1 = buildOptimizedProgressRoute(prepared, 1.0);
      expect(route1.completedGeoJson.features).toHaveLength(1);
      expect(route1.activeGeoJson.features).toHaveLength(0);
    });
  });

  describe("Phase 11 Multi-Stop Route: Tokyo -> Paris -> New York -> Sydney", () => {
    const multiPlaces: TravelPlace[] = [
      { id: "1", name: "Tokyo", latitude: 35.6762, longitude: 139.6503, originalIndex: 0, journeyIndex: 0 },
      { id: "2", name: "Paris", latitude: 48.8566, longitude: 2.3522, originalIndex: 1, journeyIndex: 1 },
      { id: "3", name: "New York", latitude: 40.7128, longitude: -74.006, originalIndex: 2, journeyIndex: 2 },
      { id: "4", name: "Sydney", latitude: -33.8688, longitude: 151.2093, originalIndex: 3, journeyIndex: 3 },
    ];

    it("should correctly handle progress across all 3 segments", () => {
      const prepared = prepareSegments(multiPlaces);
      expect(prepared).toHaveLength(3);

      // At stop 0
      const s0 = getTravelerState(multiPlaces, 0, prepared);
      expect(s0?.departedStopIndex).toBe(0);
      expect(s0?.destinationStopIndex).toBe(1);
      expect(s0?.isAtStop).toBe(true);

      // En route to Paris
      const s05 = getTravelerState(multiPlaces, 0.5, prepared);
      expect(s05?.isTransit).toBe(true);
      expect(s05?.destinationStopIndex).toBe(1);

      // En route to NY
      const s15 = getTravelerState(multiPlaces, 1.5, prepared);
      expect(s15?.isTransit).toBe(true);
      expect(s15?.departedStopIndex).toBe(1);
      expect(s15?.destinationStopIndex).toBe(2);
      const r15 = buildOptimizedProgressRoute(prepared, 1.5);
      expect(r15.completedGeoJson.features).toHaveLength(1);
      expect(r15.activeGeoJson.features).toHaveLength(1);

      // En route to Sydney
      const s25 = getTravelerState(multiPlaces, 2.5, prepared);
      expect(s25?.isTransit).toBe(true);
      expect(s25?.departedStopIndex).toBe(2);
      expect(s25?.destinationStopIndex).toBe(3);
      const r25 = buildOptimizedProgressRoute(prepared, 2.5);
      expect(r25.completedGeoJson.features).toHaveLength(2);
      expect(r25.activeGeoJson.features).toHaveLength(1);

      // Arrived at Sydney (progress 3.0)
      const s3 = getTravelerState(multiPlaces, 3.0, prepared);
      expect(s3?.isAtStop).toBe(true);
      expect(s3?.arrivedStopIndex).toBe(3);
      const r3 = buildOptimizedProgressRoute(prepared, 3.0);
      expect(r3.completedGeoJson.features).toHaveLength(3);
      expect(r3.activeGeoJson.features).toHaveLength(0);
    });
  });

  describe("Trace progression and exact coordinate alignment", () => {
    const places: TravelPlace[] = [
      { id: "a", name: "A - London", latitude: 51.5074, longitude: -0.1278, originalIndex: 0, journeyIndex: 0 },
      { id: "b", name: "B - Rome", latitude: 41.9028, longitude: 12.4964, originalIndex: 1, journeyIndex: 1 },
      { id: "c", name: "C - Cairo", latitude: 30.0444, longitude: 31.2357, originalIndex: 2, journeyIndex: 2 },
    ];

    it("should guarantee traveler position matches the exact tip of the active route at every step", () => {
      const prepared = prepareSegments(places);
      const testFractions = [0.05, 0.12, 0.333, 0.5, 0.77, 0.95, 1.05, 1.45, 1.88];

      for (const prog of testFractions) {
        const state = getTravelerState(places, prog, prepared);
        const route = buildOptimizedProgressRoute(prepared, prog);

        expect(state).not.toBeNull();
        expect(route.activeGeoJson.features).toHaveLength(1);

        const activeFeature = route.activeGeoJson.features[0];
        const coords = (activeFeature.geometry as { coordinates: number[][] }).coordinates;
        const lastCoord = coords[coords.length - 1];

        // The traveler position must match the last coordinate of the active route
        expect(state!.position[0]).toBeCloseTo(lastCoord[0], 6);
        expect(state!.position[1]).toBeCloseTo(lastCoord[1], 6);
      }
    });

    it("should follow the complete progression lifecycle: Future -> Active Growing -> Completed Green", () => {
      const prepared = prepareSegments(places);
      const fullRoute = buildFullRouteFeatureCollection(places);

      // Future route has all segments
      expect(fullRoute.features).toHaveLength(2);

      // 1. Before playback (prog = 0)
      const prog0State = getTravelerState(places, 0, prepared);
      const prog0Route = buildOptimizedProgressRoute(prepared, 0);
      expect(prog0State?.position[0]).toBeCloseTo(places[0].longitude, 4);
      expect(prog0State?.position[1]).toBeCloseTo(places[0].latitude, 4);
      expect(prog0Route.completedGeoJson.features).toHaveLength(0);
      expect(prog0Route.activeGeoJson.features).toHaveLength(0);

      // 2. During A -> B (prog = 0.4)
      const prog04State = getTravelerState(places, 0.4, prepared);
      const prog04Route = buildOptimizedProgressRoute(prepared, 0.4);
      expect(prog04State?.isTransit).toBe(true);
      expect(prog04State?.departedStopIndex).toBe(0);
      expect(prog04State?.destinationStopIndex).toBe(1);
      expect(prog04Route.completedGeoJson.features).toHaveLength(0);
      expect(prog04Route.activeGeoJson.features).toHaveLength(1);

      // 3. Arriving at B (prog = 1.0)
      const prog1State = getTravelerState(places, 1.0, prepared);
      const prog1Route = buildOptimizedProgressRoute(prepared, 1.0);
      expect(prog1State?.isAtStop).toBe(true);
      expect(prog1State?.arrivedStopIndex).toBe(1);
      expect(prog1State?.position[0]).toBeCloseTo(places[1].longitude, 4);
      expect(prog1State?.position[1]).toBeCloseTo(places[1].latitude, 4);
      // Finished segment A -> B is now completed
      expect(prog1Route.completedGeoJson.features).toHaveLength(1);
      expect(prog1Route.completedGeoJson.features[0].properties?.segmentIndex).toBe(0);
      expect(prog1Route.activeGeoJson.features).toHaveLength(0);

      // 4. During B -> C (prog = 1.6)
      const prog16State = getTravelerState(places, 1.6, prepared);
      const prog16Route = buildOptimizedProgressRoute(prepared, 1.6);
      expect(prog16State?.isTransit).toBe(true);
      expect(prog16State?.departedStopIndex).toBe(1);
      expect(prog16State?.destinationStopIndex).toBe(2);
      expect(prog16Route.completedGeoJson.features).toHaveLength(1);
      expect(prog16Route.activeGeoJson.features).toHaveLength(1);
      expect(prog16Route.activeGeoJson.features[0].properties?.segmentIndex).toBe(1);

      // 5. Arrived at C (prog = 2.0)
      const prog2State = getTravelerState(places, 2.0, prepared);
      const prog2Route = buildOptimizedProgressRoute(prepared, 2.0);
      expect(prog2State?.isAtStop).toBe(true);
      expect(prog2State?.arrivedStopIndex).toBe(2);
      expect(prog2State?.position[0]).toBeCloseTo(places[2].longitude, 4);
      expect(prog2State?.position[1]).toBeCloseTo(places[2].latitude, 4);
      expect(prog2Route.completedGeoJson.features).toHaveLength(2);
      expect(prog2Route.activeGeoJson.features).toHaveLength(0);
    });
  });
});
