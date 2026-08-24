import { ImporterError } from "../errors";

export interface ParsedGooglePlace {
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  googlePlaceId?: string;
  originalIndex: number;
}

export interface ParsedGoogleList {
  listName: string;
  owner?: string;
  places: ParsedGooglePlace[];
}

function decodeHtmlEntities(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function extractGetListUrl(pageHtml: string): string {
  const match = pageHtml.match(/href\s*=\s*["']([^"']*entitylist\/getlist[^"']*)["']/i);
  if (!match) {
    throw new ImporterError(
      "LIST_INACCESSIBLE",
      "We can’t access this list.",
      422,
      "Make sure its sharing setting is “Anyone with the link.”",
    );
  }
  const decoded = decodeHtmlEntities(match[1]);
  return decoded.startsWith("/") ? `https://www.google.com${decoded}` : decoded;
}

export function stripXssi(raw: string): string {
  let index = 0;
  while (index < raw.length && ")]}'\n\r".includes(raw[index])) index += 1;
  return raw.slice(index);
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function parseGetListResponse(raw: string): ParsedGoogleList {
  let data: unknown;
  try {
    data = JSON.parse(stripXssi(raw));
  } catch {
    throw new ImporterError("UPSTREAM_CHANGED", "Google Maps returned a list format we don’t recognize.", 502);
  }

  const envelope = asArray(data);
  const root = envelope ? asArray(envelope[0]) : undefined;
  const items = root ? asArray(root[8]) : undefined;
  if (!root || !items) {
    throw new ImporterError("UPSTREAM_CHANGED", "Google Maps returned a list format we don’t recognize.", 502);
  }

  const ownerData = asArray(root[3]);
  const places: ParsedGooglePlace[] = [];
  items.forEach((item, originalIndex) => {
    const itemData = asArray(item);
    const name = itemData ? asNonEmptyString(itemData[2]) : undefined;
    if (!itemData || !name) return;

    const placeInfo = asArray(itemData[1]);
    const coordinates = placeInfo ? asArray(placeInfo[5]) : undefined;
    places.push({
      name,
      address: placeInfo ? asNonEmptyString(placeInfo[2]) ?? asNonEmptyString(placeInfo[4]) : undefined,
      latitude: coordinates ? asFiniteNumber(coordinates[2]) : undefined,
      longitude: coordinates ? asFiniteNumber(coordinates[3]) : undefined,
      googlePlaceId: placeInfo ? asNonEmptyString(placeInfo[7]) : undefined,
      originalIndex,
    });
  });

  if (places.length === 0) {
    throw new ImporterError("EMPTY_LIST", "No locations were found in this list.", 422);
  }
  return {
    listName: asNonEmptyString(root[4]) ?? "Imported Google Maps list",
    owner: ownerData ? asNonEmptyString(ownerData[0]) : undefined,
    places,
  };
}
