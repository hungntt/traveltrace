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
  {
    id: "p4",
    name: "Sydney Opera House",
    latitude: -33.8568,
    longitude: 151.2153,
    originalIndex: 3,
    journeyIndex: 3,
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
    expect(movedUp.map((p) => p.id)).toEqual(["p3", "p1", "p2", "p4"]);
    expect(movedUp.map((p) => p.journeyIndex)).toEqual([0, 1, 2, 3]);

    // Move p1 (index 0) down to index 2
    const movedDown = movePlace(mockPlaces, 0, 2);
    expect(movedDown.map((p) => p.id)).toEqual(["p2", "p3", "p1", "p4"]);
    expect(movedDown.map((p) => p.journeyIndex)).toEqual([0, 1, 2, 3]);

    // Out of bounds should do nothing
    expect(movePlace(mockPlaces, -1, 1)).toEqual(mockPlaces);
    expect(movePlace(mockPlaces, 0, 99)).toEqual(mockPlaces);
  });

  it("updatePlaceDate should update visitedAt for the specified place", () => {
    const updated = updatePlaceDate(mockPlaces, "p2", "2024-04-10");
    expect(updated[1].visitedAt).toBe("2024-04-10");
    expect(updated[0].visitedAt).toBeUndefined();

    // Clear date with empty or whitespace string
    const cleared = updatePlaceDate(updated, "p2", "   ");
    expect(cleared[1].visitedAt).toBeUndefined();
  });

  describe("sortPlacesByDate & getOrderedPlaces", () => {
    it("should order chronologically by date", () => {
      const withDates: TravelPlace[] = [
        { ...mockPlaces[0], visitedAt: "2024-05-20", journeyIndex: 0 },
        { ...mockPlaces[1], visitedAt: "2024-01-15", journeyIndex: 1 },
        { ...mockPlaces[2], visitedAt: "2023-11-01", journeyIndex: 2 },
      ];

      const sorted = sortPlacesByDate(withDates);
      expect(sorted.map((p) => p.id)).toEqual(["p3", "p2", "p1"]); // 2023-11-01 (p3), 2024-01-15 (p2), 2024-05-20 (p1)
      expect(sorted.map((p) => p.journeyIndex)).toEqual([0, 1, 2]);
    });

    it("should use journeyIndex as stable tiebreaker for equal dates", () => {
      const equalDates: TravelPlace[] = [
        { ...mockPlaces[0], visitedAt: "2024-05-20", journeyIndex: 0 },
        { ...mockPlaces[1], visitedAt: "2024-05-20", journeyIndex: 1 },
        { ...mockPlaces[2], visitedAt: "2024-01-10", journeyIndex: 2 },
      ];

      const sorted = sortPlacesByDate(equalDates);
      // p3 first (Jan 10), then p1 before p2 because p1.journeyIndex (0) < p2.journeyIndex (1)
      expect(sorted.map((p) => p.id)).toEqual(["p3", "p1", "p2"]);
      expect(sorted.map((p) => p.journeyIndex)).toEqual([0, 1, 2]);
    });

    it("should place undated locations after dated locations in stable manual order", () => {
      const mixed: TravelPlace[] = [
        { ...mockPlaces[0], visitedAt: undefined, journeyIndex: 0 }, // undated (idx 0)
        { ...mockPlaces[1], visitedAt: "2024-06-01", journeyIndex: 1 }, // dated
        { ...mockPlaces[2], visitedAt: undefined, journeyIndex: 2 }, // undated (idx 2)
        { ...mockPlaces[3], visitedAt: "2024-02-01", journeyIndex: 3 }, // dated
      ];

      const sorted = sortPlacesByDate(mixed);
      // Dated: p4 (Feb 01), p2 (June 01).
      // Undated: p1 (idx 0), p3 (idx 2).
      expect(sorted.map((p) => p.id)).toEqual(["p4", "p2", "p1", "p3"]);
      expect(sorted.map((p) => p.journeyIndex)).toEqual([0, 1, 2, 3]);
    });

    it("getOrderedPlaces respects manual vs date mode", () => {
      const places: TravelPlace[] = [
        { ...mockPlaces[0], visitedAt: "2024-12-01", journeyIndex: 0 },
        { ...mockPlaces[1], visitedAt: "2024-01-01", journeyIndex: 1 },
      ];

      const manual = getOrderedPlaces(places, "manual");
      expect(manual.map((p) => p.id)).toEqual(["p1", "p2"]);

      const dateOrdered = getOrderedPlaces(places, "date");
      expect(dateOrdered.map((p) => p.id)).toEqual(["p2", "p1"]);
    });
  });
});
