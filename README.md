# TravelTrace

Turn a public Google Maps saved list into an animated travel story you can watch, scrub through, and export as a video.

No Google login. No API key. Nothing is stored on a server — your places live only in the browser tab you are using.

```text
Google Maps list link  →  Import  →  Review & arrange  →  Animated map  →  Video
```

---

## Getting started

### 1. Install

You need [Node.js](https://nodejs.org) **20.9 or newer** and npm 9+. (`npm install` also installs a project-local Node 22 runtime, so if your system Node is older, the app still runs.)

```bash
npm install
npm run dev
```

Then open **http://localhost:3000**.

To run the faster production build instead:

```bash
npm run build
npm start
```

### 2. Get a shareable link from Google Maps

TravelTrace can only read lists that are shared publicly:

1. Open Google Maps (phone or desktop).
2. Go to **Saved** → open the list you want (e.g. "Japan 2024").
3. Tap **Share** → set the access to **Anyone with the link**.
4. Copy the link. It looks like `https://maps.app.goo.gl/XXXXXXXX` or `https://www.google.com/maps/...`.

> If sharing is off, the import fails with **LIST_INACCESSIBLE** — see [Troubleshooting](#troubleshooting).

### 3. Import (step 1 of 3)

Paste the link into the box on the home page and press **Extract places**.

You get back a table of every place found: name, address, latitude, longitude, and Google Place ID. If some entries had missing or unusable coordinates, they are skipped and counted in a "needs attention" notice rather than failing the whole import.

- **Copy JSON** — copies the extracted places to your clipboard, if you want the raw data.
- **Continue to review** — moves on to step 2.

### 4. Review and arrange (step 2 of 3)

This is where you decide the order the journey is told in.

| Control | What it does |
| --- | --- |
| **Order: Manual** | You control the sequence yourself with the ▲ / ▼ buttons on each row. |
| **Order: Visit date** | The journey is sorted chronologically by the dates you assign. Places without a date go to the end. |
| Date field | Optional visit date for a place. Also shown on the map while that stop is active. |
| ↗ | Opens that place in Google Maps in a new tab. |

Changes save instantly to the current browser tab. When the order looks right, press **Visualize journey**.

### 5. Watch the journey (step 3 of 3)

The map draws a smooth great-circle route between your stops and animates a traveler along it, leaving a trail behind. The header shows your list name, the number of places, and the total distance.

**Playback**

| Control | What it does |
| --- | --- |
| **Play / Pause** | Starts or pauses the animation. |
| **Replay** | Jumps back to the first stop and starts over. |
| **◀ / ▶** | Jump to the previous or next stop. |
| **Timeline scrubber** | Drag to move anywhere in the journey. Dots mark each stop; hover one to see its name. |
| **Speed 0.5× / 1× / 2×** | Slower or faster playback. |

**View**

| Control | What it does |
| --- | --- |
| **Follow Camera** | The map follows the traveler as it moves. |
| **Fixed Map** | Holds the whole journey in view so you can see the full route at once. |
| **Fullscreen** | Expands the map to fill the screen; a compact control bar floats over it. |

**Export Video**

Press **Export Video** to record the animation. TravelTrace resets to the first stop, plays the journey once while recording the map canvas, and then downloads the file automatically as `traveltrace.mp4` or `traveltrace.webm` (whichever your browser supports).

While exporting: leave the tab in the foreground and don't touch the controls — the recording captures the animation in real time, so a journey that takes 40 seconds to play produces a ~40 second video. If your browser cannot record canvas video, you'll see "Video export is not supported in this browser" — try the latest Chrome or Edge.

---

## Good to know

- **Your data stays in the tab.** Imported places, visit dates, and ordering are kept in the browser's `sessionStorage`. Closing the tab clears them — there is no account and no server-side database. If you reach `/journey` or `/map` and see "Import a journey first", the session was cleared; just import the link again.
- **Google Maps is only an import source.** TravelTrace reads the public list once, at the moment you paste the link. It never signs in as you and never writes anything back.
- **The map is free to use.** Basemap tiles come from OpenFreeMap; no Mapbox token or paid mapping key is needed. If the tile service is unreachable, the map falls back to a plain journey-only view and shows a small notice — routes and animation still work.
- **Long-haul routes look right.** Routes that cross the antimeridian (e.g. Tokyo → San Francisco) are drawn the short way instead of wrapping around the world.
- **Import rate limit.** Up to 8 imports per minute from the same address; beyond that you'll get **TOO_MANY_REQUESTS** and just need to wait a moment.

---

## Troubleshooting

| Message / code | What happened | What to do |
| --- | --- | --- |
| `LIST_INACCESSIBLE` | The list isn't shared publicly. | In Google Maps: Saved → list → Share → **Anyone with the link**, then copy the link again. |
| `URL_NOT_ALLOWED` | The link isn't a Google Maps list link. | Use a `maps.app.goo.gl` or `google.com/maps` shared-list URL. Place links and directions links won't work. |
| `INVALID_URL` | The text isn't a complete HTTPS link. | Paste the full link, starting with `https://`. |
| `EMPTY_LIST` | The list opened but has no places in it. | Add places to the list in Google Maps, or share a different list. |
| `TOO_MANY_REQUESTS` | More than 8 imports in a minute. | Wait about a minute and try again. |
| `IMPORT_TIMEOUT` / `UPSTREAM_UNAVAILABLE` | Google Maps was slow or unreachable. | Try again shortly. |
| `UPSTREAM_CHANGED` | Google changed its list format. | Nothing you can do — this needs an app update. |
| `NETWORK_ERROR` | The browser couldn't reach the local app. | Check that `npm run dev` is still running. |
| "N locations need attention" | Some places had missing or invalid coordinates. | Those places are left out of the journey; the rest import normally. |
| "Basemap unavailable" | Map tiles couldn't be loaded. | Check your internet connection. The journey still animates on the plain view. |
| Map fails to load entirely | WebGL is unavailable or blocked. | Press **Retry map**, enable hardware acceleration, or try another browser. |

---

## For developers

**Stack:** Next.js App Router (16.x) · React · TypeScript · Tailwind CSS · MapLibre GL · Turf.js.

**Import API** — `POST /api/import/google-maps`

```json
{ "url": "https://maps.app.goo.gl/..." }
```

Returns the list name, owner, normalized `TravelPlace[]` with coordinates and ordering, and any non-fatal coordinate issues. Errors come back as `{ "error": { "code", "message", "recovery" } }`.

Only approved Google hosts are accepted, including every redirect hop; the undocumented Google response shape is parsed inside a single replaceable importer module (`src/lib/importers/google-maps/`).

**Checks**

```bash
npm test        # vitest
npm run lint    # tsc --noEmit
npm run build
```
