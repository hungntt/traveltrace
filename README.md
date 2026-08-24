# TravelTrace

Turn a public Google Maps saved-list URL into an interactive animated travel journey.

## Journey Flow

```text
Google Maps list URL → Server Import → Review & Arrange → Animated Map
```

1. **Import (`/`)**: Extracts places, addresses, coordinates, and metadata from a public Google Maps shared list without requiring a Google API key, login, or persistent database.
2. **Review (`/journey`)**: Review imported locations, optionally assign visit dates, adjust sequence ordering manually (▲ / ▼) or sort chronologically, and preview extracted coordinates.
3. **Map (`/map`)**: Interactive travel map rendering great-circle routes connecting destinations, smooth traveler animation, playback controls (Play, Pause, Replay, Prev, Next, Speed, Scrubber), and calm camera transitions.

## Technology & Architecture

- **Basemap & Rendering**: MapLibre GL rendering OpenFreeMap vector tiles (`https://tiles.openfreemap.org/styles/liberty`). No paid mapping APIs, tokens, or Mapbox keys required.
- **Route Geometry**: Client-side great-circle geodesic calculation with antimeridian ($\pm 180^\circ$) support to prevent world-wrapping artifacts on transpacific routes.
- **Privacy First**: Google Maps is used solely as an import source. All imported places, visit dates, and ordering modifications live exclusively in browser `sessionStorage` (`JOURNEY_SESSION_KEY`).
- **Framework**: Next.js App Router with TypeScript and Tailwind CSS.

## Requirements

- Node.js 18.19+ (or local bundled Node runtime)
- npm 9+

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), paste a public Google Maps saved list URL (e.g. `https://maps.app.goo.gl/...`), and start exploring.

## API

`POST /api/import/google-maps`

```json
{
  "url": "https://maps.app.goo.gl/..."
}
```

Returns list metadata, normalized coordinate-ready places, and any non-fatal coordinate issues.

## Verification

```bash
npm test
npm run lint
npm run build
```
ç