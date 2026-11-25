# Dependency audit

Audit scope: dependencies declared by this repository as created on 2026-11-25.

| Component | Version | Licence | Findings |
|---|---:|---|---|
| Node.js runtime | Host-provided, Node >=20 | MIT for Node.js project; bundled components retain their own notices | No runtime package dependency. Runtime is not redistributed. |
| Google Fonts Poppins / Inter / Noto Sans Devanagari | Remote hosted fonts, no pinned version | SIL OFL 1.1 | Optional network request; system sans-serif fallbacks are provided. Consider self-hosting exact font files and notices in production. |

No package lock is needed because no packages are declared. No transitive application dependencies are installed. No known CVE scan was run; this report is an inventory and licence check, not a security certification. Production dependency selection should pin versions, retain lockfiles and repeat licence and vulnerability review.

| @flagsmith/nodejs | 9.5.0 (pinned) | MIT | Official Flagsmith server SDK (local evaluation). Transitive: pino (MIT), semver (ISC), jsonpath-plus (MIT), undici-types (MIT). Replaces the deprecated `flagsmith-nodejs` package. |
| MapLibre GL JS | 6.19.0 (vendored) | BSD-3-Clause | Map rendering, `public/vendor/`. |
| qrcode | 1.5.4 (pinned) | MIT | Server-side SVG QR codes for booking passes. |
| jsQR | 1.4.0 (vendored) | Apache-2.0 | In-browser QR decoding for the staff gate scanner, `public/vendor/jsQR.js`. |
| three.js | 0.187.0 (vendored) | MIT | Home hero WebGL river; lazy-loaded on desktops only, skipped for reduced motion / data saver. |
