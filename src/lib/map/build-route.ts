import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, Geometry, LineString, MultiLineString } from "geojson";
import type { TravelPlace } from "@/types/import";

export interface TravelerState {
  position: [number, number]; // [lng, lat]
  bearing: number;
  currentStopIndex: number;
  isAtStop: boolean;
  progress: number;
}

/**
 * Calculates geodesic intermediate point between two [lng, lat] coordinates
 * at fraction f (0 to 1) using spherical slerp.
 */
export function intermediatePoint(
  p1: [number, number],
  p2: [number, number],
  f: number
): [number, number] {
  if (f <= 0) return [p1[0], p1[1]];
  if (f >= 1) return [p2[0], p2[1]];

  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const lon1 = toRad(p1[0]);
  const lat1 = toRad(p1[1]);
  const lon2 = toRad(p2[0]);
  const lat2 = toRad(p2[1]);

  const dLat = lat2 - lat1;
  const dLon = lon2 - lon1;
  const sinDLat2 = Math.sin(dLat / 2);
  const sinDLon2 = Math.sin(dLon / 2);
  const a = sinDLat2 * sinDLat2 + Math.cos(lat1) * Math.cos(lat2) * sinDLon2 * sinDLon2;
  const d = 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, a))));

  if (d < 1e-7) return [p1[0], p1[1]];

  const sinD = Math.sin(d);
  const A = Math.sin((1 - f) * d) / sinD;
  const B = Math.sin(f * d) / sinD;

  const x = A * Math.cos(lat1) * Math.cos(lon1) + B * Math.cos(lat2) * Math.cos(lon2);
  const y = A * Math.cos(lat1) * Math.sin(lon1) + B * Math.cos(lat2) * Math.sin(lon2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y));
  const lon = Math.atan2(y, x);

  return [toDeg(lon), toDeg(lat)];
}

/**
 * Calculates initial bearing from p1 to p2 in degrees (0 to 360).
 */
export function calculateBearing(p1: [number, number], p2: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;

  const lon1 = toRad(p1[0]);
  const lat1 = toRad(p1[1]);
  const lon2 = toRad(p2[0]);
  const lat2 = toRad(p2[1]);

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);

  const brng = Math.atan2(y, x);
  return (toDeg(brng) + 360) % 360;
}

/**
 * Generates a great-circle segment between two points, handling antimeridian splitting.
 */
export function buildGreatCircleSegment(
  p1: [number, number],
  p2: [number, number],
  segmentIndex: number
): Feature<LineString | MultiLineString> {
  const pt1 = turf.point(p1);
  const pt2 = turf.point(p2);
  const distKm = turf.distance(pt1, pt2, { units: "kilometers" });

  if (distKm < 0.1) {
    return turf.lineString([p1, p2], {
      segmentIndex,
      distanceKm: distKm,
    });
  }

  const npoints = Math.max(16, Math.min(100, Math.round(distKm / 60)));
  const gc = turf.greatCircle(pt1, pt2, {
    npoints,
    properties: {
      segmentIndex,
      distanceKm: distKm,
    },
  });

  return gc as Feature<LineString | MultiLineString>;
}

/**
 * Generates full GeoJSON line features for all segments connecting the ordered places.
 */
export function buildFullRouteFeatureCollection(
  places: TravelPlace[]
): FeatureCollection<LineString | MultiLineString> {
  if (places.length < 2) {
    return {
      type: "FeatureCollection",
      features: [],
    };
  }

  const features: Feature<LineString | MultiLineString>[] = [];

  for (let i = 0; i < places.length - 1; i++) {
    const p1: [number, number] = [places[i].longitude, places[i].latitude];
    const p2: [number, number] = [places[i + 1].longitude, places[i + 1].latitude];
    features.push(buildGreatCircleSegment(p1, p2, i));
  }

  return {
    type: "FeatureCollection",
    features,
  };
}

/**
 * Generates completed route and active segment GeoJSON for a given playback progress.
 * progress is a floating number from 0 to (places.length - 1).
 */
export function buildProgressRouteGeoJSON(
  places: TravelPlace[],
  progress: number
): {
  completedGeoJson: FeatureCollection<LineString | MultiLineString>;
  activeGeoJson: FeatureCollection<LineString | MultiLineString>;
} {
  if (places.length < 2 || progress <= 0) {
    return {
      completedGeoJson: { type: "FeatureCollection", features: [] },
      activeGeoJson: { type: "FeatureCollection", features: [] },
    };
  }

  const maxProgress = places.length - 1;
  const clampedProgress = Math.max(0, Math.min(maxProgress, progress));
  const currentSegmentIndex = Math.min(Math.floor(clampedProgress), places.length - 2);
  const segmentFraction = clampedProgress - currentSegmentIndex;

  const completedFeatures: Feature<LineString | MultiLineString>[] = [];
  const activeFeatures: Feature<LineString | MultiLineString>[] = [];

  // Completed full segments
  for (let i = 0; i < currentSegmentIndex; i++) {
    const p1: [number, number] = [places[i].longitude, places[i].latitude];
    const p2: [number, number] = [places[i + 1].longitude, places[i + 1].latitude];
    completedFeatures.push(buildGreatCircleSegment(p1, p2, i));
  }

  // Active segment partial progress
  if (segmentFraction > 0.001) {
    const p1: [number, number] = [
      places[currentSegmentIndex].longitude,
      places[currentSegmentIndex].latitude,
    ];
    const p2: [number, number] = [
      places[currentSegmentIndex + 1].longitude,
      places[currentSegmentIndex + 1].latitude,
    ];
    const currentPoint = intermediatePoint(p1, p2, segmentFraction);
    const activeSegment = buildGreatCircleSegment(p1, currentPoint, currentSegmentIndex);
    activeFeatures.push(activeSegment);
  }

  return {
    completedGeoJson: {
      type: "FeatureCollection",
      features: completedFeatures,
    },
    activeGeoJson: {
      type: "FeatureCollection",
      features: activeFeatures,
    },
  };
}

/**
 * Calculates current traveler position, bearing, and stop status given progress (0 to N-1).
 */
export function getTravelerState(places: TravelPlace[], progress: number): TravelerState | null {
  if (places.length === 0) return null;

  if (places.length === 1) {
    return {
      position: [places[0].longitude, places[0].latitude],
      bearing: 0,
      currentStopIndex: 0,
      isAtStop: true,
      progress: 0,
    };
  }

  const maxProgress = places.length - 1;
  const clampedProgress = Math.max(0, Math.min(maxProgress, progress));
  const currentSegmentIndex = Math.min(Math.floor(clampedProgress), places.length - 2);
  const segmentFraction = clampedProgress - currentSegmentIndex;

  const p1: [number, number] = [
    places[currentSegmentIndex].longitude,
    places[currentSegmentIndex].latitude,
  ];
  const p2: [number, number] = [
    places[currentSegmentIndex + 1].longitude,
    places[currentSegmentIndex + 1].latitude,
  ];

  const position = intermediatePoint(p1, p2, segmentFraction);

  // Look ahead slightly for bearing
  const lookAheadFraction = Math.min(1, segmentFraction + 0.05);
  const lookAheadPoint = intermediatePoint(p1, p2, lookAheadFraction);
  const bearing = calculateBearing(position, lookAheadPoint);

  const isAtStop = segmentFraction < 0.01 || segmentFraction > 0.99;
  const currentStopIndex = Math.round(clampedProgress);

  return {
    position,
    bearing,
    currentStopIndex,
    isAtStop,
    progress: clampedProgress,
  };
}

/**
 * Computes bounding box [[minLng, minLat], [maxLng, maxLat]] for all places.
 */
export function getJourneyBounds(
  places: TravelPlace[]
): [[number, number], [number, number]] {
  if (places.length === 0) {
    return [
      [-180, -85],
      [180, 85],
    ];
  }

  if (places.length === 1) {
    const { longitude, latitude } = places[0];
    return [
      [longitude - 0.05, latitude - 0.05],
      [longitude + 0.05, latitude + 0.05],
    ];
  }

  let minLng = places[0].longitude;
  let maxLng = places[0].longitude;
  let minLat = places[0].latitude;
  let maxLat = places[0].latitude;

  for (const place of places) {
    minLng = Math.min(minLng, place.longitude);
    maxLng = Math.max(maxLng, place.longitude);
    minLat = Math.min(minLat, place.latitude);
    maxLat = Math.max(maxLat, place.latitude);
  }

  // Add small padding if all points have same coordinate
  if (minLng === maxLng) {
    minLng -= 0.05;
    maxLng += 0.05;
  }
  if (minLat === maxLat) {
    minLat -= 0.05;
    maxLat += 0.05;
  }

  return [
    [minLng, minLat],
    [maxLng, maxLat],
  ];
}
