import { describe, expect, it } from "vitest";
import { createGoogleResponse } from "./fixtures";
import { normalizeGoogleList } from "./normalize";
import { parseGetListResponse } from "./parser";

describe("Google Maps normalization", () => {
  it("returns only coordinate-ready TravelPlaces while retaining attention items", () => {
    const result = normalizeGoogleList(parseGetListResponse(createGoogleResponse()));
    expect(result.totalFound).toBe(3);
    expect(result.places).toHaveLength(2);
    expect(result.issues).toEqual([expect.objectContaining({ name: "Place without coordinates", code: "missing_coordinates" })]);
    expect(result.places[0]).toMatchObject({
      id: "google:ChIJHanoi",
      originalIndex: 0,
      journeyIndex: 0,
      googleMapsUrl: "https://www.google.com/maps/place/?q=place_id:ChIJHanoi",
    });
    expect(result.places[1].journeyIndex).toBe(1);
  });

  it("flags out-of-range coordinates", () => {
    const result = normalizeGoogleList({ listName: "Invalid", places: [{ name: "Nowhere", latitude: 91, longitude: 10, originalIndex: 0 }] });
    expect(result.places).toHaveLength(0);
    expect(result.issues[0].code).toBe("invalid_coordinates");
  });
});
