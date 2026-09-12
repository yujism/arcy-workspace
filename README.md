# Arcy Workspace

## GitHub Pages edition

Static build files live in `docs/`. To publish, open repository Settings → Pages, select **Deploy from a branch**, branch **main**, folder **/docs**, then Save. The existing **main / (root)** setting also works: the root entry forwards to `docs/`. Expected project URL after GitHub reports a successful deployment: `https://yujism.github.io/arcy-workspace/`.

This edition opens with **Sign in with Google**. Tasks, notes, agenda snapshots, and search history are stored in the private application-data area of the chosen Google Drive account. Opening another browser and signing into the same account restores that workspace. Mutations are confirmed by Drive before the UI reports success; an open visible tab refreshes every 30 seconds and on focus/reconnection. Internet access is required to save.

Existing browser-local records are preserved and can be copied with **Pindahkan ke akun ini**, followed by an account-specific confirmation. JSON export/import remains available. Google Docs and Sheets imports remain snapshots; source-wide automatic import is not included. AI still requires a separate backend. See `GOOGLE_SETUP.md`.

Rebuild after source changes with `pnpm install --frozen-lockfile` and `pnpm build:pages`; commit the updated `docs/` along with source. No dependencies were added for the static build. `pages/vite.config.ts` sets relative asset URLs for project Pages and excludes environment-file loading.

The original backend build is retained below. Hosting this repository on Pages does **not** run its API routes or D1 database.

Private personal workspace built with React, Vinext (Next.js App Router compatibility), Sites Workers, and D1/SQLite. The hosted MVP deliberately uses platform-managed storage instead of the proposed external PostgreSQL/pgvector. No vector index is present.

## Available immediately

- Persistent task creation/editing/completion/deletion, due dates and priorities.
- Notes with tags, filtering, source search, and conversion into task drafts.
- Local calendar events in Asia/Jakarta, editing, deletion, and day navigation.
- Stored question/answer history; keyword retrieval with explicit source references when no LLM is configured.
- Home dashboard with open tasks, overdue count, current-day agenda and recent notes.
- Per-user server authorization using the Sites authenticated identity; private owner-only publishing.

## Optional provider configuration (original Sites backend)

Set runtime secrets through Sites environment settings, never in client-side code or public files. `.env.example` lists the required names. The app does not inherit ChatGPT connector credentials.

### AI

`OPENAI_API_KEY` and optional `OPENAI_MODEL` (default `gpt-4.1-mini`). Use the OpenAI Developers plugin API-key workflow to provision with the user's approval. Only selected source excerpts and the query are sent to the provider. Model responses cannot execute tools or writes.

### Google data authorization

App sign-in stays platform-managed; this MVP does not implement app-owned Google OAuth sign-in. Bring a server-side Google OAuth client ID, client secret and refresh token for data access, bound to `GOOGLE_OWNER_USER_ID` displayed in Connections. Never paste secrets into chat or workspace notes.

Enable Google Drive, Sheets and Calendar APIs. Read scopes: `drive.readonly`, `spreadsheets.readonly`, `calendar.events.readonly`. Explicit Calendar publishing additionally requires `calendar.events`. The refresh token must be provisioned with offline access. See https://developers.google.com/identity/protocols/oauth2/web-server .

Implemented connectors after configuration:

- Search Google Docs by name (30 most recent results); import/export plain text on demand; re-import refreshes the same stored source.
- Read explicit Sheets A1 ranges through the live API, retain tab-separated snapshot and source URL. No spreadsheet writes.
- Sync primary Calendar with pagination and incremental `nextSyncToken`; recover expired cursors with a full resync. Five pages per request; continue button handles additional pages.
- Publish local events with explicit preview/approval. Deterministic Google event IDs avoid duplicate creation on retries. Imported Google events link back to Google for edits.

## Limits

- No connected providers are claimed without configured server secrets; provider access has not been verified until an actual call succeeds.
- No background jobs, automatic Drive-wide sync, PDF parsing, pgvector, or semantic/hybrid retrieval.
- Google Docs/range imports limited to 100,000 characters; workspace list limited to the most recently updated 2,000 records.
- Recurring series are linked to Google rather than expanded into daily occurrences. Calendar sync includes the primary calendar only.
- API integration checks and compilation run locally; browser QA and credential-dependent Google/AI calls were not run.

## Checks

`node tests/drive-workspace.mjs` — account isolation, fresh-browser restore, concurrent writes, deletion propagation, upload retry, and stale edit checks with mocked Drive.

`node tests/google-pages.mjs` — mocked Google authorization and API scenarios for the Pages connector; does not prove live OAuth activation.


`node node_modules/typescript/bin/tsc --noEmit`

`node tests/api.mjs`

The integration checks run the real API modules against in-memory SQLite and substituted authenticated identities, covering persistence, status changes, validation, same-origin mutation checks, ownership isolation and grounded retrieval fallback.

Build and publish using the Sites skills. Database migrations are generated with Drizzle and applied by the hosting platform.

