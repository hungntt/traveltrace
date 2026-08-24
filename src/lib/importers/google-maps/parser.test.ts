import { describe, expect, it } from "vitest";
import { ImporterError } from "../errors";
import { createGoogleResponse } from "./fixtures";
import { extractGetListUrl, parseGetListResponse, stripXssi } from "./parser";

describe("Google Maps response parser", () => {
  it("extracts and decodes the getlist preload endpoint", () => {
    const html = '<link rel="preload" href="/maps/rpc/entitylist/getlist?authuser=0&amp;hl=en&amp;pb=data" as="fetch">';
    expect(extractGetListUrl(html)).toBe("https://www.google.com/maps/rpc/entitylist/getlist?authuser=0&hl=en&pb=data");
  });

  it("reports inaccessible/private lists without leaking parser details", () => {
    expect(() => extractGetListUrl("<html>No public list</html>")).toThrowError(ImporterError);
    try {
      extractGetListUrl("<html />");
    } catch (error) {
      expect((error as ImporterError).code).toBe("LIST_INACCESSIBLE");
    }
  });

  it("removes the XSSI prefix", () => {
    expect(stripXssi(")]}'\n[1,2,3]")).toBe("[1,2,3]");
    expect(stripXssi("[1,2,3]")).toBe("[1,2,3]");
  });

  it("parses names, fallback addresses, coordinates, IDs, and metadata", () => {
    const result = parseGetListResponse(createGoogleResponse());
    expect(result.listName).toBe("A life in places");
    expect(result.owner).toBe("Ada");
    expect(result.places).toHaveLength(3);
    expect(result.places[0]).toMatchObject({ name: "Hanoi", address: "Hanoi, Vietnam", latitude: 21.0285, longitude: 105.8542, googlePlaceId: "ChIJHanoi", originalIndex: 0 });
    expect(result.places[1].address).toBe("Shinjuku, Tokyo");
    expect(result.places[2].latitude).toBeUndefined();
  });

  it("classifies structural changes separately from empty lists", () => {
    expect(() => parseGetListResponse(")]}'\n{}" )).toThrowError(expect.objectContaining({ code: "UPSTREAM_CHANGED" }));
    const emptyRoot = [null, null, null, null, "Empty", null, null, null, []];
    expect(() => parseGetListResponse(`)]}'\n${JSON.stringify([emptyRoot])}`)).toThrowError(expect.objectContaining({ code: "EMPTY_LIST" }));
  });
});
