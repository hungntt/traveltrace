import { ImporterError } from "../errors";

const ALLOWED_INPUT_HOSTS = new Set(["maps.app.goo.gl", "google.com", "www.google.com"]);
const ALLOWED_ENDPOINT_HOSTS = new Set(["google.com", "www.google.com"]);
const ALLOWED_GETLIST_PATHS = new Set([
  "/maps/rpc/entitylist/getlist",
  "/maps/preview/entitylist/getlist",
]);

function parseHttpsUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ImporterError("INVALID_URL", "Enter a complete Google Maps shared-list URL.", 400);
  }

  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) {
    throw new ImporterError("INVALID_URL", "Only standard HTTPS Google Maps links are accepted.", 400);
  }
  return url;
}

export function validateGoogleMapsInput(input: string): URL {
  const url = parseHttpsUrl(input.trim());
  if (!ALLOWED_INPUT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ImporterError(
      "URL_NOT_ALLOWED",
      "This doesn’t look like a supported Google Maps link.",
      400,
      "Use a maps.app.goo.gl or google.com/maps shared-list URL.",
    );
  }
  if (url.hostname !== "maps.app.goo.gl" && !url.pathname.startsWith("/maps")) {
    throw new ImporterError("URL_NOT_ALLOWED", "The URL must point to Google Maps.", 400);
  }
  return url;
}

export function validateRedirectTarget(target: string, base: URL): URL {
  const url = parseHttpsUrl(new URL(target, base).toString());
  if (!ALLOWED_INPUT_HOSTS.has(url.hostname.toLowerCase())) {
    throw new ImporterError("URL_NOT_ALLOWED", "Google redirected to an unsupported host, so the import was stopped.", 400);
  }
  return url;
}

export function validateGetListEndpoint(input: string): URL {
  const url = parseHttpsUrl(input);
  if (!ALLOWED_ENDPOINT_HOSTS.has(url.hostname.toLowerCase()) || !ALLOWED_GETLIST_PATHS.has(url.pathname)) {
    throw new ImporterError("UPSTREAM_CHANGED", "Google Maps returned an unexpected list endpoint.", 502);
  }
  return url;
}
