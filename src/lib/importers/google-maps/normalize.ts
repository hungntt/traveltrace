import { createHash } from "node:crypto";
import type { ImportIssue, PlaceImportResult, TravelPlace } from "@/types/import";
import type { ParsedGoogleList, ParsedGooglePlace } from "./parser";

function createPlaceId(place: ParsedGooglePlace): string {
  if (place.googlePlaceId) return `google:${place.googlePlaceId}`;
  const identity = `${place.name}|${place.address ?? ""}|${place.latitude ?? ""}|${place.longitude ?? ""}`;
  return `google:${createHash("sha256").update(identity).digest("hex").slice(0, 18)}`;
}

function coordinateIssue(place: ParsedGooglePlace): ImportIssue | undefined {
  if (place.latitude === undefined || place.longitude === undefined) {
    return { originalIndex: place.originalIndex, name: place.name, code: "missing_coordinates", message: "Coordinates were not available, so this place needs attention." };
  }
  if (place.latitude < -90 || place.latitude > 90 || place.longitude < -180 || place.longitude > 180) {
    return { originalIndex: place.originalIndex, name: place.name, code: "invalid_coordinates", message: "Google returned coordinates outside the valid latitude/longitude range." };
  }
  return undefined;
}

export function normalizeGoogleList(parsed: ParsedGoogleList): PlaceImportResult {
  const issues: ImportIssue[] = [];
  const places: TravelPlace[] = [];

  parsed.places.forEach((place) => {
    const issue = coordinateIssue(place);
    if (issue) {
      issues.push(issue);
      return;
    }
    const googleMapsUrl = place.googlePlaceId
      ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(place.googlePlaceId)}`
      : undefined;
    places.push({
      id: createPlaceId(place),
      name: place.name,
      address: place.address,
      latitude: place.latitude!,
      longitude: place.longitude!,
      googlePlaceId: place.googlePlaceId,
      googleMapsUrl,
      originalIndex: place.originalIndex,
      journeyIndex: places.length,
    });
  });

  return {
    source: "google-maps",
    listName: parsed.listName,
    owner: parsed.owner,
    totalFound: parsed.places.length,
    places,
    issues,
  };
}
