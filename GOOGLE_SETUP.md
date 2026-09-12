# Activate Connect Google once

The Pages app now implements Google's official browser token model. The owner registers the app once; daily users click **Connect Google → choose account → approve permissions**. No password, client secret, API key, refresh token, or credential form is added to Arcy.

**Current status:** the owner's public OAuth client ID is configured in `pages/google-config.json` for the GitHub Pages origin below. The owner reports Drive, Sheets, and Calendar APIs enabled. Live authorization still needs to be verified with the intended Google account; a configured client ID alone does not confirm the account's consent or test-user access.

## One-time owner registration

1. In Google Cloud, select or create an Arcy project. Enable **Google Drive API**, **Google Sheets API**, and **Google Calendar API**.
2. Configure the Google Auth Platform app information, support/contact email and audience. For personal testing choose External / Testing and add the intended Google account as a test user. Google can show an unverified-app notice for a personal testing app. Broader distribution may require verification; do not assume this is production verified.
3. Create an OAuth client of type **Web application**, with the Authorized JavaScript origin **`https://yujism.github.io`**. Use the origin only: no `/arcy-workspace`, `/docs`, trailing path, or wildcard. This popup token flow needs no redirect URI or client secret in the app. The authorization boundary is the entire GitHub Pages origin; other projects under that origin should also be trusted.
4. Put only its public client ID in `pages/google-config.json` under `clientId`. Never add the downloaded credentials JSON or client secret to this public repository.
5. Run `node scripts/build-pages.mjs` and commit the source plus regenerated `docs/`. Publish through the existing main / docs Pages configuration (the main / root redirect also works).
6. Open Arcy → Connections → Connect Google. Validate account selection, partial grants, import, Calendar sync, and disconnect with the real account before marking activation complete.

## Permissions and behavior

| Action | Google scope | Behavior |
| --- | --- | --- |
| Identify the chosen account | `openid`, `userinfo.email` | Verify account identity using Google's userinfo API; show connected email |
| Browse and import Docs | `drive.readonly` | Search up to 30 matching Docs, import selected plain-text snapshots; no Drive writes |
| Import a Sheets range | `spreadsheets.readonly` | Read a specific range; no Sheets writes |
| Sync primary Calendar | `calendar.events.readonly` | Expand recurring events from 30 days ago through six months ahead; fetch all pages before atomically replacing that account's imported Calendar snapshot |
| Approve & send local event | `calendar.events` | Ask for this additional scope only on explicit send; deterministic event ID prevents duplicate creates on retries; no guests |

The main Connect button requests the three read capabilities together. Individual service buttons request only that service. Partial consent is represented separately for each service. Access tokens stay in JavaScript memory, never browser storage, URLs, backups, or GitHub. Reloading/closing the page or token expiry requires another user-triggered Connect click. Disconnect clears the local token and attempts revocation; a revocation failure is shown rather than silently claiming success. Previously imported snapshots remain local until removed by the user.

Imports are namespaced by Google's stable account subject. Responses from a previous/expired connection cannot be committed after the session changes. The Google API helper accepts only the Google API origins needed by these connectors. Local workspace data and snapshots remain browser-local; **this does not implement cross-device workspace sync, background sync, or a permanently connected backend session**. A backend with OAuth code exchange and secure refresh-token storage is needed for those behaviors.

Existing local data is retained. Document/range imports are limited to 100,000 characters and workspace capacity remains 5,000 records. Calendar reads are capped at 20 pages; failed/incomplete syncs retain the previous snapshot. Sending the same local event twice keeps the first Google event; editing the local event does not automatically update its Google copy.

## Official references

- [Google client registration and JavaScript origins](https://developers.google.com/identity/oauth2/web/guides/get-google-api-clientid)
- [Google token model, granular scopes, expiry and revocation](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Calendar list, recurrence and pagination](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Calendar event IDs and creation](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
