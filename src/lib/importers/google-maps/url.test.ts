import { describe, expect, it } from "vitest";
import { validateGetListEndpoint, validateGoogleMapsInput, validateRedirectTarget } from "./url";

describe("Google Maps URL allowlist", () => {
  it.each([
    "https://maps.app.goo.gl/abc123",
    "https://www.google.com/maps/placelists/list/abc",
    "https://google.com/maps/@1,2,3z",
  ])("accepts supported Maps URLs: %s", (url) => {
    expect(validateGoogleMapsInput(url)).toBeInstanceOf(URL);
  });

  it.each([
    "http://maps.app.goo.gl/abc",
    "https://maps.app.goo.gl.evil.example/abc",
    "https://www.google.com/search?q=maps",
    "https://user:secret@www.google.com/maps/list",
    "https://127.0.0.1/maps",
  ])("rejects unsafe or unrelated URLs: %s", (url) => {
    expect(() => validateGoogleMapsInput(url)).toThrow();
  });

  it("validates every redirect rather than trusting the initial host", () => {
    const base = new URL("https://maps.app.goo.gl/abc");
    expect(() => validateRedirectTarget("https://attacker.example/internal", base)).toThrowError(expect.objectContaining({ code: "URL_NOT_ALLOWED" }));
  });

  it("only accepts the expected Google RPC as the extracted endpoint", () => {
    expect(validateGetListEndpoint("https://www.google.com/maps/rpc/entitylist/getlist?pb=x")).toBeInstanceOf(URL);
    expect(validateGetListEndpoint("https://www.google.com/maps/preview/entitylist/getlist?pb=x")).toBeInstanceOf(URL);
    expect(() => validateGetListEndpoint("https://www.google.com/maps/search?q=secret")).toThrow();
  });
});
