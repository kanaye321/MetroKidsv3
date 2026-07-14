# MetroEast RideLink

A group motorcycle-ride companion app: riders create/join a group with an invite code, then share live location, speed, and voice chat on a shared map while riding together.

## Run & Operate

- Two workflows run this project:
  - **API Server** — `cd artifacts/api-server && PORT=8000 pnpm run dev` (Express + Socket.IO backend, console output, port 8000)
  - **Mobile** — `cd artifacts/mobile && ... pnpm exec expo start --localhost --port 5000` (Expo web preview, port 5000, shown in the webview)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — already provisioned (Replit Postgres)

## Stack

- pnpm workspaces, Node.js 20, TypeScript 5.9
- API: Express 5 + Socket.IO (real-time groups, presence, chat, location, voice relay)
- DB: PostgreSQL + Drizzle ORM (schema currently empty — no models defined yet)
- Mobile: Expo / React Native (Expo Router)
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (API server, CJS-free ESM bundle)

## Where things live

- `artifacts/api-server` — Express + Socket.IO backend (`src/routes`, `src/socket/RideSocket.ts` for real-time ride/group logic, `src/mumble` for the Mumble voice gateway)
- `artifacts/mobile` — Expo app (screens under `app/`, shared state in `context/`)
- `artifacts/mockup-sandbox` — design/prototyping sandbox, not part of the shipped app
- `lib/db` — Drizzle schema/client (`lib/db/src/schema` — currently empty, add tables here)
- `lib/api-spec`, `lib/api-zod`, `lib/api-client-react` — OpenAPI spec + generated Zod schemas/React Query hooks

## Architecture decisions

- The mobile app expects the API (including the `/api/socket.io` websocket) to live at the same origin it's served from (see `SocketContext.tsx`, `EXPO_PUBLIC_DOMAIN`). In production this holds because only the API server is deployed publicly; the native app talks to it directly.
- In this Replit dev workspace the API server and the Expo web preview run as two separate workflows/ports, so the same-origin assumption doesn't hold in the browser preview: Socket.IO calls from the web preview will fail with a 502 (see Gotchas). REST calls made directly against the API server (port 8000, e.g. via curl) work fine.

## Product

- Guest or named sign-in, create/join a ride group via a 6-character invite code, live group map (location, speed, heading), in-group text chat, and a peer-relayed/Mumble-gateway voice channel with push-to-talk.
- Backend state for groups/riders is in-memory (no persistence yet) — a reconnect or server restart clears active groups.

## User preferences

_None recorded yet._

## Gotchas

- Root `tsconfig.json` / `tsconfig.base.json` were missing from the imported repo (referenced by every package's `tsconfig.json` but never committed) — recreated with reasonable defaults (ES2022, bundler resolution) so `pnpm run typecheck` and `pnpm run build` work.
- `artifacts/mobile` has pre-existing typecheck errors unrelated to setup (`app/(tabs)/settings.tsx`, `hooks/useColors.ts`) — not introduced by this setup pass.
- Socket.IO in the browser-based Expo web preview will show `WebSocket ... 502` errors because the API server isn't reachable at the same origin in dev (see Architecture decisions). The rest of the UI works normally.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
