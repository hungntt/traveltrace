import * as turf from "@turf/turf";
import type { Feature, FeatureCollection, LineString, MultiLineString } from "geojson";
import type { TravelPlace } from "@/types/import";

export interface TravelerState {
  position: [number, number]; // [lng, lat]
  bearing: number;
  departedStopIndex: number;
  destinationStopIndex: number;
  arrivedStopIndex: number | null; // non-null when currently at a stop
  isAtStop: boolean;
  isTransit: boolean;
  progress: number;
}

export interface PreparedSegment {
  segmentIndex: number;
  p1: [number, number];
  p2: [number, number];
  distanceKm: number;
  samples: [number, number][];
  unwrappedSamples: [number, number][];
  fullFeature: Feature<LineString | MultiLineString>;
}

/**
 * Unwraps a longitude value relative to a reference longitude to ensure continuous motion
 * across the ±180° antimeridian.
 */
export function unwrapLongitude(lng: number, referenceLng: number): number {
  let uLng = lng;
  while (uLng - referenceLng > 180) uLng -= 360;
  while (uLng - referenceLng < -180) uLng += 360;
  return uLng;
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

  if (Math.abs(y) < 1e-9 && Math.abs(x) < 1e-9) {
    return 0;
  }

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

  const npoints = Math.max(24, Math.min(100, Math.round(distKm / 50)));
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
 * Precomputes route geometry and dense sampled points for each segment.
 * Call this once when places change, avoiding expensive Turf calls during playback animation frames.
 */
export function prepareSegments(places: TravelPlace[]): PreparedSegment[] {
  if (places.length < 2) return [];

  const segments: PreparedSegment[] = [];
  const SAMPLES_PER_SEGMENT = 128;

  for (let i = 0; i < places.length - 1; i++) {
    const p1: [number, number] = [places[i].longitude, places[i].latitude];
    const p2: [number, number] = [places[i + 1].longitude, places[i + 1].latitude];

    const pt1 = turf.point(p1);
    const pt2 = turf.point(p2);
    const distanceKm = turf.distance(pt1, pt2, { units: "kilometers" });

    const samples: [number, number][] = [];
    const unwrappedSamples: [number, number][] = [];

    let prevLng = p1[0];

    for (let s = 0; s <= SAMPLES_PER_SEGMENT; s++) {
      const fraction = s / SAMPLES_PER_SEGMENT;
      const pt = intermediatePoint(p1, p2, fraction);
      samples.push(pt);

      const uLng = unwrapLongitude(pt[0], prevLng);
      unwrappedSamples.push([uLng, pt[1]]);
      prevLng = uLng;
    }

    const fullFeature = buildGreatCircleSegment(p1, p2, i);

    segments.push({
      segmentIndex: i,
      p1,
      p2,
      distanceKm,
      samples,
      unwrappedSamples,
      fullFeature,
    });
  }

  return segments;
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

  // If we have reached or exceeded the final progress, every segment is completed
  if (clampedProgress >= maxProgress) {
    const allCompletedFeatures: Feature<LineString | MultiLineString>[] = [];
    for (let i = 0; i < places.length - 1; i++) {
      const p1: [number, number] = [places[i].longitude, places[i].latitude];
      const p2: [number, number] = [places[i + 1].longitude, places[i + 1].latitude];
      allCompletedFeatures.push(buildGreatCircleSegment(p1, p2, i));
    }
    return {
      completedGeoJson: {
        type: "FeatureCollection",
        features: allCompletedFeatures,
      },
      activeGeoJson: {
        type: "FeatureCollection",
        features: [],
      },
    };
  }

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
 * Optimized runtime progress route generator that reuses precomputed segments.
 * Performs zero Turf calculations for maximum frame rates.
 */
export function buildOptimizedProgressRoute(
  preparedSegments: PreparedSegment[],
  progress: number
): {
  completedGeoJson: FeatureCollection<LineString | MultiLineString>;
  activeGeoJson: FeatureCollection<LineString | MultiLineString>;
} {
  if (preparedSegments.length === 0 || progress <= 0) {
    return {
      completedGeoJson: { type: "FeatureCollection", features: [] },
      activeGeoJson: { type: "FeatureCollection", features: [] },
    };
  }

  const maxProgress = preparedSegments.length;
  const clampedProgress = Math.max(0, Math.min(maxProgress, progress));

  if (clampedProgress >= maxProgress) {
    return {
      completedGeoJson: {
        type: "FeatureCollection",
        features: preparedSegments.map((s) => s.fullFeature),
      },
      activeGeoJson: {
        type: "FeatureCollection",
        features: [],
      },
    };
  }

  const currentSegmentIndex = Math.min(
    Math.floor(clampedProgress),
    preparedSegments.length - 1
  );
  const segmentFraction = clampedProgress - currentSegmentIndex;

  const completedFeatures: Feature<LineString | MultiLineString>[] = [];
  for (let i = 0; i < currentSegmentIndex; i++) {
    completedFeatures.push(preparedSegments[i].fullFeature);
  }

  const activeFeatures: Feature<LineString | MultiLineString>[] = [];
  if (segmentFraction > 0.0001) {
    const curSeg = preparedSegments[currentSegmentIndex];
    const samples = curSeg.unwrappedSamples?.length ? curSeg.unwrappedSamples : curSeg.samples;
    const scaled = segmentFraction * (samples.length - 1);
    const sampleIdx = Math.min(Math.floor(scaled), samples.length - 2);
    const subFraction = scaled - sampleIdx;

    const pA = samples[sampleIdx];
    const pB = samples[sampleIdx + 1];

    const currentPt: [number, number] = [
      pA[0] + subFraction * (pB[0] - pA[0]),
      pA[1] + subFraction * (pB[1] - pA[1]),
    ];

    const activeCoords: [number, number][] = [
      ...samples.slice(0, sampleIdx + 1),
      currentPt,
    ];

    if (activeCoords.length >= 2) {
      activeFeatures.push({
        type: "Feature",
        properties: {
          segmentIndex: currentSegmentIndex,
        },
        geometry: {
          type: "LineString",
          coordinates: activeCoords,
        },
      });
    }
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
 * Uses precomputed segment samples when available to avoid runtime trigonometric overhead.
 */
export function getTravelerState(
  places: TravelPlace[],
  progress: number,
  preparedSegments?: PreparedSegment[]
): TravelerState | null {
  if (places.length === 0) return null;

  if (places.length === 1) {
    return {
      position: [places[0].longitude, places[0].latitude],
      bearing: 0,
      departedStopIndex: 0,
      destinationStopIndex: 0,
      arrivedStopIndex: 0,
      isAtStop: true,
      isTransit: false,
      progress: 0,
    };
  }

  const maxProgress = places.length - 1;
  const clampedProgress = Math.max(0, Math.min(maxProgress, progress));

  if (clampedProgress <= 0) {
    const p1: [number, number] = [places[0].longitude, places[0].latitude];
    const p2: [number, number] = [places[1].longitude, places[1].latitude];
    return {
      position: p1,
      bearing: calculateBearing(p1, p2),
      departedStopIndex: 0,
      destinationStopIndex: 1,
      arrivedStopIndex: 0,
      isAtStop: true,
      isTransit: false,
      progress: 0,
    };
  }

  if (clampedProgress >= maxProgress) {
    const pLastPrev: [number, number] = [
      places[places.length - 2].longitude,
      places[places.length - 2].latitude,
    ];
    const pLast: [number, number] = [
      places[places.length - 1].longitude,
      places[places.length - 1].latitude,
    ];
    return {
      position: pLast,
      bearing: calculateBearing(pLastPrev, pLast),
      departedStopIndex: places.length - 2,
      destinationStopIndex: places.length - 1,
      arrivedStopIndex: places.length - 1,
      isAtStop: true,
      isTransit: false,
      progress: maxProgress,
    };
  }

  const currentSegmentIndex = Math.min(Math.floor(clampedProgress), places.length - 2);
  const segmentFraction = clampedProgress - currentSegmentIndex;

  let position: [number, number];
  let bearing: number;

  const seg = preparedSegments && preparedSegments[currentSegmentIndex];
  if (seg && (seg.unwrappedSamples?.length ?? seg.samples?.length) >= 2) {
    const samples = seg.unwrappedSamples?.length ? seg.unwrappedSamples : seg.samples;
    const scaled = segmentFraction * (samples.length - 1);
    const sampleIdx = Math.min(Math.floor(scaled), samples.length - 2);
    const subFraction = scaled - sampleIdx;
    const pA = samples[sampleIdx];
    const pB = samples[sampleIdx + 1];

    position = [
      pA[0] + subFraction * (pB[0] - pA[0]),
      pA[1] + subFraction * (pB[1] - pA[1]),
    ];

    const lookAheadIdx =
      subFraction > 0.8 && sampleIdx + 2 < samples.length
        ? sampleIdx + 2
        : sampleIdx + 1;
    bearing = calculateBearing(position, samples[lookAheadIdx]);
    if (bearing === 0 && (pA[0] !== pB[0] || pA[1] !== pB[1])) {
      bearing = calculateBearing(pA, pB);
    }
  } else {
    const p1: [number, number] = [
      places[currentSegmentIndex].longitude,
      places[currentSegmentIndex].latitude,
    ];
    const p2: [number, number] = [
      places[currentSegmentIndex + 1].longitude,
      places[currentSegmentIndex + 1].latitude,
    ];
    const rawPos = intermediatePoint(p1, p2, segmentFraction);
    const lookAheadFraction = Math.min(1, segmentFraction + 0.04);
    const lookAheadPoint = intermediatePoint(p1, p2, lookAheadFraction);
    bearing = calculateBearing(rawPos, lookAheadPoint);
    position = [
      unwrapLongitude(rawPos[0], places[currentSegmentIndex].longitude),
      rawPos[1],
    ];
  }

  const isAtStop = segmentFraction < 0.001;
  const isTransit = !isAtStop;

  return {
    position,
    bearing,
    departedStopIndex: currentSegmentIndex,
    destinationStopIndex: currentSegmentIndex + 1,
    arrivedStopIndex: isAtStop ? currentSegmentIndex : null,
    isAtStop,
    isTransit,
    progress: clampedProgress,
  };
}

/**
 * Calculates sum of great-circle distances between consecutive destinations in kilometers.
 */
export function calculateTotalRouteDistance(places: TravelPlace[]): number {
  if (places.length < 2) return 0;
  let totalKm = 0;
  for (let i = 0; i < places.length - 1; i++) {
    const pt1 = turf.point([places[i].longitude, places[i].latitude]);
    const pt2 = turf.point([places[i + 1].longitude, places[i + 1].latitude]);
    totalKm += turf.distance(pt1, pt2, { units: "kilometers" });
  }
  return totalKm;
}

/**
 * Formats kilometers into a clean string (e.g. "24,830 km" or "850 km").
 */
export function formatDistance(km: number): string {
  return `${Math.round(km).toLocaleString()} km`;
}

/**
 * Computes antimeridian-aware bounding box [[minLng, minLat], [maxLng, maxLat]] for all places.
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

  let minLat = places[0].latitude;
  let maxLat = places[0].latitude;

  for (const place of places) {
    minLat = Math.min(minLat, place.latitude);
    maxLat = Math.max(maxLat, place.latitude);
  }

  if (minLat === maxLat) {
    minLat -= 0.05;
    maxLat += 0.05;
  }

  // Antimeridian-aware longitudinal span optimization on [0, 360)
  const normLngs = places.map((p) => ((p.longitude % 360) + 360) % 360);
  const sorted = Array.from(new Set(normLngs)).sort((a, b) => a - b);

  if (sorted.length === 1) {
    const lng = places[0].longitude;
    return [
      [lng - 0.05, minLat],
      [lng + 0.05, maxLat],
    ];
  }

  let maxGap = sorted[0] + 360 - sorted[sorted.length - 1];
  let bestStart = sorted[0];
  let bestEnd = sorted[sorted.length - 1];

  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = sorted[i + 1] - sorted[i];
    if (gap > maxGap) {
      maxGap = gap;
      bestStart = sorted[i + 1];
      bestEnd = sorted[i] + 360;
    }
  }

  let startLng = bestStart > 180 ? bestStart - 360 : bestStart;
  let endLng = startLng + (bestEnd - bestStart);

  if (startLng === endLng) {
    startLng -= 0.05;
    endLng += 0.05;
  }

  return [
    [startLng, minLat],
    [endLng, maxLat],
  ];
}
