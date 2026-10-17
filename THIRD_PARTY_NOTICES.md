# Third-Party Notices

Copyright © 2026 Parsa Fathi. DeviceHub is licensed under the Apache License 2.0 (see [LICENSE](LICENSE)).

DeviceHub incorporates and depends on the following third-party components. Each remains under its own license; this file lists the key dependencies of this project and their licenses as used here. It is not an exhaustive dependency tree — run your own license scan (`bun pm ls`, `pip list`) for the full closure of a given install.

## Web application / backend (Node/Bun)

| Component | License | Use |
|---|---|---|
| [Next.js](https://nextjs.org) | MIT | web framework, API routes |
| [React](https://react.dev) / React DOM | MIT | UI runtime |
| [Prisma](https://www.prisma.io) (client & CLI) | Apache-2.0 | data layer / migrations |
| [Tailwind CSS](https://tailwindcss.com) | MIT | styling |
| [shadcn/ui](https://ui.shadcn.com) | MIT | UI component primitives |
| [Radix UI primitives](https://www.radix-ui.com) | MIT | accessible component behaviors (used via shadcn/ui) |
| [lucide-react](https://lucide.dev) | ISC | icon set |
| [recharts](https://recharts.org) | MIT | charts |
| [socket.io](https://socket.io) / socket.io-client | MIT | realtime events |
| [Zod](https://zod.dev) | MIT | schema validation |
| [react-query (TanStack Query)](https://tanstack.com/query) | MIT | server state in the client |
| [zustand](https://zustand.docs.pmnd.rs) | MIT | client state |
| [uuid](https://github.com/uuidjs/uuid) | MIT | id generation |
| [date-fns](https://date-fns.org) | MIT | date formatting |
| [Bun](https://bun.sh) | MIT | JS/TS runtime & package manager for services and dev |
| [z-ai-web-dev-sdk](https://www.npmjs.com/package/z-ai-web-dev-sdk) | provider SDK (see package/NOTICE at the pinned version) | AI chat provider used by `/api/ai/diagnostics` |

## Edge services (TypeScript)

| Component | License | Use |
|---|---|---|
| [aedes](https://github.com/moscajs/aedes) | MIT | embedded MQTT broker |
| [MQTT.js](https://github.com/mqttjs/MQTT.js) | MIT | MQTT client (gateway, simulator) |
| [Bun `sqlite` built-in](https://bun.sh/docs/api/sqlite) | with Bun (MIT) | durable edge spool |

## Analytics (Python)

| Component | License | Use |
|---|---|---|
| [FastAPI](https://fastapi.tiangolo.com) | MIT | HTTP service framework |
| [uvicorn](https://www.uvicorn.org) | BSD-3-Clause | ASGI server |
| [scikit-learn](https://scikit-learn.org) | BSD-3-Clause | IsolationForest anomaly detection |
| [NumPy](https://numpy.org) | BSD-3-Clause | numerical features/statistics |
| [httpx](https://www.python-httpx.org) | BSD-3-Clause | backend HTTP client |
| [pytest](https://pytest.org) | MIT | analytics test suite |

## C protocol library

| Component | License | Use |
|---|---|---|
| gcc / glibc toolchain (build-time only) | GPL-3-class toolchain runtime exceptions (not distributed) | compiling `protocol-c/`; the library itself has no runtime dependencies |

No third-party code is vendored into `protocol-c/` — the CRC-32 table was generated programmatically and cross-checked against zlib during development (zlib is not linked).

## Fonts

| Component | License | Use |
|---|---|---|
| [Geist](https://vercel.com/font) | SIL Open Font License 1.1 (OFL-1.1) | UI typeface (loaded with Next.js `next/font`) |

## Notices

- The names above are trademarks of their respective owners; listing them here is attribution, not endorsement.
- Licenses summarized as SPDX identifiers; the authoritative text for each is the license file in the respective upstream repository or distribution.
- If you redistribute DeviceHub, keep this file and [LICENSE](LICENSE) together with the distribution, per Apache-2.0 §4(d).
