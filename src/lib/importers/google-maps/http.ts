import { ImporterError } from "../errors";
import { validateRedirectTarget } from "./url";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export async function readTextLimited(response: Response, maxBytes: number): Promise<string> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    throw new ImporterError("RESPONSE_TOO_LARGE", "Google Maps returned more data than this importer accepts.", 502);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new ImporterError("RESPONSE_TOO_LARGE", "Google Maps returned more data than this importer accepts.", 502);
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

export async function fetchGoogleMapsPage(
  start: URL,
  fetchImpl: FetchLike,
  signal: AbortSignal,
  maxRedirects = 5,
): Promise<string> {
  let current = start;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(current, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      signal,
      headers: { Accept: "text/html,application/xhtml+xml" },
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) throw new ImporterError("UPSTREAM_UNAVAILABLE", "Google Maps returned an incomplete redirect.", 502);
      if (redirectCount === maxRedirects) {
        throw new ImporterError("UPSTREAM_UNAVAILABLE", "The Google Maps link redirected too many times.", 502);
      }
      current = validateRedirectTarget(location, current);
      continue;
    }

    if (!response.ok) {
      throw new ImporterError(
        "LIST_INACCESSIBLE",
        "We can’t access this list.",
        422,
        "Make sure its sharing setting is “Anyone with the link.”",
      );
    }
    return readTextLimited(response, 2_000_000);
  }
  throw new ImporterError("UPSTREAM_UNAVAILABLE", "The Google Maps link could not be resolved.", 502);
}

export async function fetchGetList(
  endpoint: URL,
  fetchImpl: FetchLike,
  signal: AbortSignal,
): Promise<string> {
  const response = await fetchImpl(endpoint, {
    method: "GET",
    redirect: "error",
    cache: "no-store",
    signal,
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "Mozilla/5.0 (compatible; TravelTrace/1.0; +https://traveltrace.app)",
    },
  });
  if (!response.ok) throw new ImporterError("UPSTREAM_UNAVAILABLE", "Google Maps did not return the shared list.", 502);
  return readTextLimited(response, 8_000_000);
}
