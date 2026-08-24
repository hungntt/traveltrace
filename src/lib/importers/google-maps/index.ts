import type { PlaceImporter, PlaceImportResult } from "@/types/import";
import { toImporterError } from "../errors";
import { fetchGetList, fetchGoogleMapsPage, type FetchLike } from "./http";
import { normalizeGoogleList } from "./normalize";
import { extractGetListUrl, parseGetListResponse } from "./parser";
import { validateGetListEndpoint, validateGoogleMapsInput } from "./url";

const IMPORT_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const resultCache = new Map<string, { expiresAt: number; result: PlaceImportResult }>();

function readCache(key: string): PlaceImportResult | undefined {
  const cached = resultCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    resultCache.delete(key);
    return undefined;
  }
  return cached.result;
}

function writeCache(key: string, result: PlaceImportResult) {
  if (resultCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = resultCache.keys().next().value as string | undefined;
    if (oldestKey) resultCache.delete(oldestKey);
  }
  resultCache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
}

export class GoogleMapsImporter implements PlaceImporter {
  constructor(private readonly fetchImpl: FetchLike = fetch) {}

  async import(input: string): Promise<PlaceImportResult> {
    const inputUrl = validateGoogleMapsInput(input);
    const cacheKey = inputUrl.toString();
    const cached = readCache(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), IMPORT_TIMEOUT_MS);
    try {
      const pageHtml = await fetchGoogleMapsPage(inputUrl, this.fetchImpl, controller.signal);
      const endpoint = validateGetListEndpoint(extractGetListUrl(pageHtml));
      const rawList = await fetchGetList(endpoint, this.fetchImpl, controller.signal);
      const result = normalizeGoogleList(parseGetListResponse(rawList));
      writeCache(cacheKey, result);
      return result;
    } catch (error) {
      throw toImporterError(error);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const googleMapsImporter = new GoogleMapsImporter();
