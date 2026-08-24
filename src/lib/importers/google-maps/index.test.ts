import { describe, expect, it, vi } from "vitest";
import { GoogleMapsImporter } from ".";
import { createGoogleResponse } from "./fixtures";
import type { FetchLike } from "./http";

describe("GoogleMapsImporter", () => {
  it("follows an allowlisted redirect and produces a normalized result", async () => {
    const fetchMock = vi.fn<FetchLike>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: "https://www.google.com/maps/placelists/list/abc" } }))
      .mockResolvedValueOnce(new Response('<link href="/maps/rpc/entitylist/getlist?pb=fixture&amp;hl=en">', { status: 200 }))
      .mockResolvedValueOnce(new Response(createGoogleResponse(), { status: 200 }));

    const result = await new GoogleMapsImporter(fetchMock).import("https://maps.app.goo.gl/importer-test-1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(result.listName).toBe("A life in places");
    expect(result.places.map((place) => place.name)).toEqual(["Hanoi", "Tokyo"]);
    expect(result.issues).toHaveLength(1);
  });

  it("stops when Google redirects outside the allowlist", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { Location: "https://169.254.169.254/latest/meta-data" } }),
    );
    await expect(new GoogleMapsImporter(fetchMock).import("https://maps.app.goo.gl/importer-test-2"))
      .rejects.toMatchObject({ code: "URL_NOT_ALLOWED" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("enforces the response-size ceiling before reading a body", async () => {
    const fetchMock = vi.fn<FetchLike>().mockResolvedValueOnce(
      new Response("small", { status: 200, headers: { "Content-Length": "3000000" } }),
    );
    await expect(new GoogleMapsImporter(fetchMock).import("https://maps.app.goo.gl/importer-test-3"))
      .rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
  });
});
