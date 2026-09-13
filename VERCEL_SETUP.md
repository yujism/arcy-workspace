# Persistent Google sign-in on Vercel

Deployment: https://arcy-workspace.vercel.app/

The Vercel frontend and `/api/auth/*` functions are deployed. **Google sign-in is not active until the client secret and redirect URI below are configured.** The previous GitHub Pages app continues to use its existing browser-only login.

## Finish activation

1. Open the existing Arcy **Web application OAuth client** in Google Cloud → Google Auth Platform → Clients. Keep the same client ID from `pages/google-config.json` so the app continues using the same private Drive app-data area.
2. Add this **Authorized redirect URI**, exactly:

   `https://arcy-workspace.vercel.app/api/auth/callback`

   Keep the existing GitHub Pages JavaScript origin. This server redirect flow does not require a new JavaScript origin.
3. In Vercel → `yujism's projects` → `arcy-workspace` → Settings → Environment Variables, add **`GOOGLE_CLIENT_SECRET`** for **Production**, using the secret belonging to that same OAuth client. Enter it directly in Vercel, never in chat or GitHub. If the original secret is unavailable, create an additional secret for the existing client instead of creating a different client.
4. Redeploy the latest production deployment so the function receives the environment variable.
5. Open the Vercel URL, sign in once, and approve workspace storage/offline access. Verify a saved task or note is present, close and reopen the browser, and verify the workspace returns without clicking Sign in. Test Sign out and another Google account separately.

The currently deployed build is a prebuilt upload. Source is in this repository with `vercel.json` for subsequent source builds; Git auto-deployment is not configured by that upload. Import/link this repository in Vercel if automatic deploys on future pushes are desired.

## Session behavior

- A `Secure`, `HttpOnly`, `SameSite=Lax` cookie remembers this browser for **30 days of inactivity**. Successful restoration extends it by another 30 days.
- The refresh token is inside an authenticated, encrypted cookie that page JavaScript cannot read. Encryption uses a separately derived key from the server client secret (or the optional key below). The frontend receives only short-lived access tokens, held in memory.
- Startup, impending expiry, and a Google 401 response trigger server renewal without opening a Google window. Restoring the same account preserves in-flight workspace operations.
- Workspace records stay in the same Google Drive app-data area. The new Vercel origin needs its own first login; GitHub Pages cookies or browser state cannot transfer to it.
- Sign out clears this browser's cookie. Disconnect also attempts to revoke Google access. A remote per-device session revocation list is not implemented; adding one requires server-side session storage.
- Additional Drive, Sheets, and Calendar permissions still require Google authorization when first requested. Reopening the app does not itself request additional permissions.
- Incognito, deleted cookies, revoked Google permission, expired provider access, 30 days of inactivity, or rotated server secrets can require another login.
- An external Google OAuth app in **Testing** may receive refresh tokens that expire after seven days when Drive/Calendar scopes are used. Review the Google audience/publishing status if login is requested weekly. Publishing or verification is a separate Google configuration action.

## Optional overrides

| Variable | Default / purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Existing public ID in `pages/google-config.json`. |
| `ARCY_APP_ORIGIN` | `https://arcy-workspace.vercel.app`; change with the registered Google callback if using another canonical domain. |
| `ARCY_SESSION_SECRET` | Optional independent 32-byte key as 64 hex characters. Otherwise derived from `GOOGLE_CLIENT_SECRET` using HKDF-SHA256. Rotation invalidates cookies. |

Use the canonical production domain. Alternate Vercel aliases and previews are not authorized origins for session mutations.

## Verify and build

```bash
node tests/persistent-auth.mjs
node tests/persistent-client.mjs
node tests/google-pages.mjs
node tests/drive-workspace.mjs
node node_modules/typescript/bin/tsc --noEmit
ARCY_PERSISTENT_AUTH=1 node scripts/build-pages.mjs
```

The first two checks exercise real server/client logic with mocked Google/server responses: CSRF/state, PKCE, cookie tampering, startup restoration, refresh, account isolation, 401 handling, logout and revocation. They do not replace a live Google consent test.

Vercel uses its build command to enable the persistent adapter. Build without `ARCY_PERSISTENT_AUTH` before committing `docs/` for the existing GitHub Pages deployment; do not publish a backend-dependent bundle to Pages.

References: [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [refresh token expiration](https://developers.google.com/identity/protocols/oauth2#expiration), [Vercel environment variables](https://vercel.com/docs/environment-variables).
