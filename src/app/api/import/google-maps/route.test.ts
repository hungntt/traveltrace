import { describe, expect, it } from "vitest";
import { POST } from "./route";

function request(body: string, ip: string) {
  return new Request("http://localhost/api/import/google-maps", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body,
  });
}

describe("POST /api/import/google-maps", () => {
  it("rejects malformed JSON", async () => {
    const response = await POST(request("not-json", "test-invalid-json"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ error: expect.objectContaining({ code: "INVALID_REQUEST" }) }));
  });

  it("rejects non-JSON content types before reading the body", async () => {
    const response = await POST(new Request("http://localhost/api/import/google-maps", {
      method: "POST",
      headers: { "Content-Type": "text/plain", "x-forwarded-for": "test-content-type" },
      body: JSON.stringify({ url: "https://maps.app.goo.gl/abc" }),
    }));
    expect(response.status).toBe(415);
  });

  it("limits the streamed request body even without a content-length header", async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`{"url":"https://maps.app.goo.gl/abc","padding":"${"x".repeat(5_000)}"}`));
        controller.close();
      },
    });
    const response = await POST(new Request("http://localhost/api/import/google-maps", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-forwarded-for": "test-stream-limit" },
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" }));
    expect(response.status).toBe(413);
  });

  it("rejects extra request fields", async () => {
    const response = await POST(request(JSON.stringify({ url: "https://maps.app.goo.gl/abc", proxy: "https://example.com" }), "test-extra-field"));
    expect(response.status).toBe(400);
  });

  it("returns a safe validation error for a non-Google URL", async () => {
    const response = await POST(request(JSON.stringify({ url: "https://example.com/list" }), "test-disallowed-url"));
    const payload = await response.json();
    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("URL_NOT_ALLOWED");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
