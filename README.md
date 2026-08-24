# TravelTrace — Phase 1

Turn a public Google Maps saved-list URL into normalized, portable `TravelPlace[]` data.

This repository intentionally implements only the first product phase:

```text
Google Maps shared-list URL → validated server import → normalized JSON
```

It does not yet include a map, country/continent resolution, journey editing, animation, accounts, or storage.

## Requirements

- npm 9 or newer

No system-wide Node upgrade or `nvm` installation is required. Development dependencies include a project-local Node 22 runtime, and the Next.js scripts select it automatically. Production environments can instead provide their own Node 20.9+ runtime and omit development dependencies.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), make a Google Maps list public to “Anyone with the link,” and paste its shared URL.

When bootstrapping with an older system Node version, `npm install` may print an `EBADENGINE` warning for Next.js while it is installing the local runtime. That warning is non-fatal; subsequent `npm run dev` and `npm run build` commands execute Next.js with the bundled Node 22 binary.

## API

`POST /api/import/google-maps`

```json
{
  "url": "https://maps.app.goo.gl/..."
}
```

Successful responses contain list metadata, normalized coordinate-ready places, and non-fatal issues:

```json
{
  "data": {
    "source": "google-maps",
    "listName": "My places",
    "totalFound": 2,
    "places": [
      {
        "id": "google:ChIJ...",
        "name": "Hanoi",
        "address": "Hanoi, Vietnam",
        "latitude": 21.0285,
        "longitude": 105.8542,
        "googlePlaceId": "ChIJ...",
        "googleMapsUrl": "https://www.google.com/maps/place/?q=place_id:ChIJ...",
        "originalIndex": 0,
        "journeyIndex": 0
      }
    ],
    "issues": []
  }
}
```

Places without usable coordinates are reported in `issues` rather than causing the entire import to fail.

## Import boundaries

The Google-specific logic is isolated in [`src/lib/importers/google-maps`](src/lib/importers/google-maps). It follows the extraction sequence documented by the open-source [`gmaps-list`](https://github.com/anupamchugh/gmaps-list) project:

1. Resolve the public shared-list link.
2. Find the allowlisted `entitylist/getlist` preload endpoint in the canonical page.
3. Fetch the response and remove its XSSI prefix.
4. Parse Google’s nested response.
5. Normalize the result into the app-owned schema.

Because this is an undocumented Google endpoint, failures caused by a response-format change are surfaced separately from private or invalid lists.

## Security and privacy

- HTTPS-only allowlist for `maps.app.goo.gl`, `google.com`, and `www.google.com`.
- Every redirect is validated; redirects to other hosts are rejected.
- The extracted RPC URL is independently validated.
- Five-redirect limit and ten-second total timeout.
- Two-megabyte HTML and eight-megabyte list-response limits.
- Strict request schema and four-kilobyte request-body limit.
- In-memory per-client rate limiting and short-lived bounded result caching.
- No database, accounts, cookies, tracking, or persisted travel history.

In-memory protection is suitable for the stateless MVP. A shared rate-limit/cache service should replace it before horizontally scaled deployment.

## Verification

```bash
npm test
npm run lint
npm run build
npm audit
```

The test suite covers URL/redirect validation, parsing, normalization, response limits, end-to-end importer behavior, and the route-handler contract.
