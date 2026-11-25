# Third-party notices

| Name | Source / version | Licence | Use and obligations |
|---|---|---|---|
| Node.js | https://nodejs.org/ · runtime supplied by host | MIT (Node.js project; bundled components may have separate terms) | Server runtime. Node's bundled component notices apply to redistributed runtimes. This repository does not redistribute Node.js. |
| Poppins | https://fonts.google.com/specimen/Poppins · Google Fonts hosted font | SIL Open Font License 1.1 | UI heading font, loaded remotely when available. OFL permits use and distribution subject to its terms; no font files are redistributed here. |
| Inter | https://fonts.google.com/specimen/Inter · Google Fonts hosted font | SIL Open Font License 1.1 | UI body and control font, loaded remotely when available. OFL permits use and distribution subject to its terms; no font files are redistributed here. |
| Noto Sans Devanagari | https://fonts.google.com/noto/specimen/Noto+Sans+Devanagari · Google Fonts hosted font | SIL Open Font License 1.1 | Devanagari fallback and language support, loaded remotely when available. OFL permits use and distribution subject to its terms; no font files are redistributed here. |
| Ganesh logo | User-supplied `Ganesh Logo.jpg`, cropped for the header at `public/assets/ganesh-logo.jpg` | Not specified | Used at the user's request. No author or licence information accompanied the image; confirm reuse/redistribution rights before publishing the repository. |

The application itself has no npm runtime dependencies. Site artwork uses CSS and text glyphs created for this demo.

### @flagsmith/nodejs 9.5.0 (npm)

Official Flagsmith server SDK, MIT License, installed via npm (`package-lock.json`). Its dependencies pino, jsonpath-plus and undici-types are MIT; semver is ISC. https://github.com/Flagsmith/flagsmith-nodejs-client

### qrcode 1.5.4 (npm) and jsQR 1.4.0 (vendored)

`qrcode` (MIT) generates pass QR codes on the server. `public/vendor/jsQR.js` is the unmodified jsQR distribution (Apache-2.0; full text in `public/vendor/JSQR-LICENSE.txt`), used by the staff gate scanner.

### Geocoding

Voice search may look up a spoken Mumbai locality via OpenStreetMap Nominatim (https://nominatim.org, usage policy: max 1 request/second, identifying User-Agent, caching). Data © OpenStreetMap contributors, ODbL.

### three.js r187 (vendored)

`public/vendor/three.module.js` and `three.core.js` are the unmodified three.js 0.187.0 build (MIT; full text in `public/vendor/THREE-LICENSE.txt`), used for the home-page river animation on capable desktops only. https://github.com/mrdoob/three.js

### MapLibre GL JS 6.19.0 (vendored)

`public/vendor/maplibre-gl.mjs`, `maplibre-gl-worker.mjs` and `maplibre-gl.css` are unmodified distribution files from the `maplibre-gl` npm package (source maps references removed). License: BSD-3-Clause, full text in `public/vendor/MAPLIBRE-LICENSE.txt`. https://github.com/maplibre/maplibre-gl-js

### Map tiles and data

The optional map loads the `liberty` style and vector tiles from the OpenFreeMap public instance (https://openfreemap.org; free, no API key; see its terms of service). Tiles are built with OpenMapTiles from OpenStreetMap data, © OpenStreetMap contributors, available under the Open Database License (ODbL). Attribution is displayed on the map. For production traffic, self-host tiles or confirm the provider's usage terms. Re-audit exact versions and notices before each production release.
