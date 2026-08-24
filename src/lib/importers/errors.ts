export type ImportErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_URL"
  | "URL_NOT_ALLOWED"
  | "TOO_MANY_REQUESTS"
  | "LIST_INACCESSIBLE"
  | "EMPTY_LIST"
  | "UPSTREAM_CHANGED"
  | "UPSTREAM_UNAVAILABLE"
  | "IMPORT_TIMEOUT"
  | "RESPONSE_TOO_LARGE";

export class ImporterError extends Error {
  constructor(
    public readonly code: ImportErrorCode,
    message: string,
    public readonly status: number,
    public readonly recovery?: string,
  ) {
    super(message);
    this.name = "ImporterError";
  }
}

export function toImporterError(error: unknown): ImporterError {
  if (error instanceof ImporterError) return error;
  if (error instanceof Error && error.name === "AbortError") {
    return new ImporterError(
      "IMPORT_TIMEOUT",
      "Google Maps took too long to respond.",
      504,
      "Try the link again in a moment.",
    );
  }
  return new ImporterError(
    "UPSTREAM_UNAVAILABLE",
    "We couldn’t reach Google Maps right now.",
    502,
    "Try again shortly, or use CSV/JSON import when those fallbacks are enabled.",
  );
}
