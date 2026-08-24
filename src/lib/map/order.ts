import type { TravelPlace } from "@/types/import";

/**
 * Normalizes journeyIndex to 0, 1, 2, ... based on array position
 */
export function normalizeJourneyIndices(places: TravelPlace[]): TravelPlace[] {
  return places.map((place, idx) => ({
    ...place,
    journeyIndex: idx,
  }));
}

/**
 * Moves a place from one index to another, re-indexing journeyIndex
 */
export function movePlace(places: TravelPlace[], fromIndex: number, toIndex: number): TravelPlace[] {
  if (fromIndex < 0 || fromIndex >= places.length || toIndex < 0 || toIndex >= places.length || fromIndex === toIndex) {
    return places;
  }
  const result = [...places];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return normalizeJourneyIndices(result);
}

/**
 * Updates the visitedAt date for a specific place by id
 */
export function updatePlaceDate(
  places: TravelPlace[],
  placeId: string,
  visitedAt: string | undefined
): TravelPlace[] {
  return places.map((place) => {
    if (place.id === placeId) {
      return {
        ...place,
        visitedAt: visitedAt ? visitedAt.trim() : undefined,
      };
    }
    return place;
  });
}

/**
 * Sorts places chronologically by visitedAt if available, preserving relative journeyIndex for items without dates
 */
export function sortPlacesByDate(places: TravelPlace[]): TravelPlace[] {
  const sorted = [...places].sort((a, b) => {
    const aDate = a.visitedAt?.trim();
    const bDate = b.visitedAt?.trim();

    if (aDate && bDate) {
      const cmp = aDate.localeCompare(bDate);
      if (cmp !== 0) return cmp;
      return a.journeyIndex - b.journeyIndex;
    }
    if (aDate && !bDate) {
      return -1;
    }
    if (!aDate && bDate) {
      return 1;
    }
    return a.journeyIndex - b.journeyIndex;
  });

  return normalizeJourneyIndices(sorted);
}

/**
 * Gets places sorted strictly by journeyIndex (fallback/default ordering)
 */
export function getOrderedPlaces(places: TravelPlace[]): TravelPlace[] {
  return [...places].sort((a, b) => a.journeyIndex - b.journeyIndex);
}
