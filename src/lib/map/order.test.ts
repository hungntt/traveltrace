import { describe, expect, it } from "vitest";
import type { TravelPlace } from "@/types/import";
import {
  getOrderedPlaces,
  movePlace,
  normalizeJourneyIndices,
  sortPlacesByDate,
  updatePlaceDate,
} from "./order";

const mockPlaces: TravelPlace[] = [
  {
    id: "p1",
    name: "Tokyo Tower",
    latitude: 35.6586,
    longitude: 139.7454,
    originalIndex: 0,
    journeyIndex: 0,
  },
  {
    id: "p2",
    name: "Eiffel Tower",
    latitude: 48.8584,
    longitude: 2.2945,
    originalIndex: 1,
    journeyIndex: 1,
  },
  {
    id: "p3",
    name: "Empire State Building",
    latitude: 40.7484,
    longitude: -73.9857,
    originalIndex: 2,
    journeyIndex: 2,
  },
];

describe("order utilities", () => {
  it("normalizeJourneyIndices should re-index journeyIndex from 0 to N-1", () => {
    const scrambled = [
      { ...mockPlaces[1], journeyIndex: 5 },
      { ...mockPlaces[0], journeyIndex: 10 },
      { ...mockPlaces[2], journeyIndex: 99 },
    ];
    const normalized = normalizeJourneyIndices(scrambled);
    expect(normalized.map((p) => p.journeyIndex)).toEqual([0, 1, 2]);
    expect(normalized[0].name).toBe("Eiffel Tower");
    expect(normalized[1].name).toBe("Tokyo Tower");
  });

  it("movePlace should move an item up and down correctly and update journeyIndex", () => {
    // Move p3 (index 2) up to index 0
    const movedUp = movePlace(mockPlaces, 2, 0);
    expect(movedUp.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
    expect(movedUp.map((p) => p.journeyIndex)).toEqual([0, 1, 2]);

    // Move p1 (index 0) down to index 2
    const movedDown = movePlace(mockPlaces, 0, 2);
    expect(movedDown.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
    expect(movedDown.map((p) => p.journeyIndex)).toEqual([0, 1, 2]);

    // Out of bounds should do nothing
    expect(movePlace(mockPlaces, -1, 1)).toEqual(mockPlaces);
    expect(movePlace(mockPlaces, 0, 99)).toEqual(mockPlaces);
  });

  it("updatePlaceDate should update visitedAt for the specified place", () => {
    const updated = updatePlaceDate(mockPlaces, "p2", "2024-04-10");
    expect(updated[1].visitedAt).toBe("2024-04-10");
    expect(updated[0].visitedAt).toBeUndefined();

    // Clear date with empty string
    const cleared = updatePlaceDate(updated, "p2", "");
    expect(cleared[1].visitedAt).toBeUndefined();
  });

  it("sortPlacesByDate should order chronologically with fallback to journeyIndex", () => {
    const withDates: TravelPlace[] = [
      { ...mockPlaces[0], visitedAt: "2024-05-20", journeyIndex: 0 },
      { ...mockPlaces[1], visitedAt: "2024-01-15", journeyIndex: 1 },
      { ...mockPlaces[2], visitedAt: undefined, journeyIndex: 2 },
    ];

    const sorted = sortPlacesByDate(withDates);
    // 2024-01-15 (Eiffel Tower) comes first, then 2024-05-20 (Tokyo Tower), then no date (Empire State)
    expect(sorted.map((p) => p.id)).toEqual(["p2", "p1", "p3"]);
    expect(sorted.map((p) => p.journeyIndex)).toEqual([0, 1, 2]);
  });

  it("getOrderedPlaces should return places sorted by journeyIndex", () => {
    const unarranged = [
      { ...mockPlaces[2], journeyIndex: 2 },
      { ...mockPlaces[0], journeyIndex: 0 },
      { ...mockPlaces[1], journeyIndex: 1 },
    ];
    const ordered = getOrderedPlaces(unarranged);
    expect(ordered.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});
