import { ImporterError } from "@/lib/importers/errors";
import { googleMapsImporter } from "@/lib/importers/google-maps";
import { consumeImportAttempt } from "@/lib/rate-limit";
import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const requestSchema = z.object({
  url: z.string().trim().min(1).max(2_048),
}).strict();

const securityHeaders = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

class RequestBodyTooLargeError extends Error {}

async function readJsonBodyLimited(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.body) throw new SyntaxError("Missing request body");
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let raw = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      throw new RequestBodyTooLargeError();
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  return JSON.parse(raw) as unknown;
}

function clientKey(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? request.headers.get("x-real-ip")
    ?? "anonymous";
}

export async function POST(request: Request) {
  const rate = consumeImportAttempt(clientKey(request));
  if (!rate.allowed) {
    return NextResponse.json(
      { error: { code: "TOO_MANY_REQUESTS", message: "Too many imports were requested. Please wait a moment and try again." } },
      { status: 429, headers: { ...securityHeaders, "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Content-Type must be application/json." } },
      { status: 415, headers: securityHeaders },
    );
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > 4_096) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "The request body is too large." } },
      { status: 413, headers: securityHeaders },
    );
  }

  let body: unknown;
  try {
    body = await readJsonBodyLimited(request, 4_096);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return NextResponse.json(
        { error: { code: "INVALID_REQUEST", message: "The request body is too large." } },
        { status: 413, headers: securityHeaders },
      );
    }
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Send a JSON body containing a Google Maps URL." } },
      { status: 400, headers: securityHeaders },
    );
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "INVALID_REQUEST", message: "Send exactly one valid `url` value." } },
      { status: 400, headers: securityHeaders },
    );
  }

  try {
    const result = await googleMapsImporter.import(parsed.data.url);
    return NextResponse.json({ data: result }, { status: 200, headers: securityHeaders });
  } catch (error) {
    if (error instanceof ImporterError) {
      return NextResponse.json(
        { error: { code: error.code, message: error.message, recovery: error.recovery } },
        { status: error.status, headers: securityHeaders },
      );
    }
    console.error("Unexpected Google Maps import failure", error);
    return NextResponse.json(
      { error: { code: "UPSTREAM_UNAVAILABLE", message: "The list could not be imported right now." } },
      { status: 500, headers: securityHeaders },
    );
  }
}
