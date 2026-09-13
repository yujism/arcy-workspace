import config from './google-config.json';
declare const __ARCY_PERSISTENT_AUTH__: boolean;
const persistent = typeof __ARCY_PERSISTENT_AUTH__ !== 'undefined' && __ARCY_PERSISTENT_AUTH__;

export type GoogleService = 'drive' | 'sheets' | 'calendar';
export type GooglePermission = GoogleService | 'calendarWrite' | 'workspace' | 'all';
const scope = {
  workspace: 'https://www.googleapis.com/auth/drive.appdata',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  sheets: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarWrite: 'https://www.googleapis.com/auth/calendar.events',
};
type TokenResponse = {access_token?: string; expires_in?: number; scope?: string; error?: string};
type OAuth = {
  initTokenClient(options: {
    client_id: string; scope: string; include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: (error: {type: string}) => void;
  }): {requestAccessToken(options: {prompt: string; hint?: string}): void};
  revoke(token: string, callback: (result: {successful: boolean}) => void): void;
};
declare global {interface Window {google?: {accounts?: {oauth2?: OAuth}}}}
export type GoogleState = {
  phase: 'loading' | 'setup' | 'ready' | 'connecting' | 'connected' | 'expired' | 'error';
  email: string; owner: string; workspace: boolean; error: string; revision: number;
  services: Record<GoogleService, boolean>;
};
const emptyServices = () => ({drive: false, sheets: false, calendar: false});
let state: GoogleState = {phase: 'loading', email: '', owner: '', workspace: false, error: '', revision: 0, services: emptyServices()};
let token: {value: string; owner: string; expires: number; scopes: Set<string>} | undefined;
let generation = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
let preparation: Promise<void> | undefined;
let pending = false;
const listeners = new Set<() => void>();
export const googleSnapshot = () => state;
export function subscribeGoogle(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}
function update(patch: Partial<GoogleState>) {state = {...state, ...patch, revision: state.revision + 1}; listeners.forEach(fn => fn());}
function clearSession(phase: GoogleState['phase'], error = '') {
  generation++; token = undefined; clearTimeout(expiry);
  update({phase, email: '', owner: '', workspace: false, services: emptyServices(), error});
}
async function serverRequest(action: string) {
  const response = await fetch('/api/auth/' + action, {method: 'POST', credentials: 'same-origin', headers: {'X-Arcy-Request': '1'}, signal: AbortSignal.timeout(45000)});
  const data = await response.json() as {error?: string; owner: string; email: string; access_token: string; expires_in: number; scope: string; url: string};
  if (!response.ok) throw Object.assign(new Error(data.error || 'Google connection failed.'), {status: response.status});
  return data;
}
let renewal: Promise<void> | undefined;
function restoreSession() {
  if (renewal) return renewal;
  const run = generation;
  renewal = (async () => {
    try {
      const data = await serverRequest('session');
      if (run !== generation) return;
      if (!data.owner || !data.email || !data.access_token || !Number.isFinite(data.expires_in) || data.expires_in <= 60 || typeof data.scope !== 'string') throw new Error('Invalid Google session.');
      if (token && token.owner !== data.owner) {clearSession('ready', 'Your Google account changed. Reload to continue.'); return;}
      const renewed = {value: data.access_token, owner: data.owner, expires: Date.now() + (data.expires_in - 30) * 1000, scopes: new Set(data.scope.split(' '))};
      // Keep in-flight workspace operations valid when renewing the same account.
      if (token) Object.assign(token, renewed); else token = renewed;
      clearTimeout(expiry);
      expiry = setTimeout(() => {void restoreSession().catch(() => {});}, Math.min(2147483647, Math.max(1000, token.expires - Date.now() - 60000)));
      update({phase: 'connected', owner: data.owner, email: data.email, workspace: token.scopes.has(scope.workspace), services: {
        drive: token.scopes.has(scope.drive), sheets: token.scopes.has(scope.sheets), calendar: token.scopes.has(scope.calendar) || token.scopes.has(scope.calendarWrite),
      }, error: ''});
    } catch (error) {
      if (run !== generation) return;
      const failure = error as Error & {status?: number};
      if (failure.status === 401) clearSession('ready');
      else if (failure.status === 503) update({phase: 'setup', error: failure.message});
      else {update({phase: token ? 'connected' : 'error', error: 'Could not restore Google session. Check your connection and reload.'}); throw error;}
    }
  })().finally(() => {renewal = undefined;});
  return renewal;
}
export function prepareGoogle() {
  if (preparation) return preparation;
  preparation = (async () => {
    if (persistent) {
      await restoreSession().catch(() => {});
      const url = new URL(location.href);
      if (url.searchParams.has('auth_error')) {
        const code = url.searchParams.get('auth_error');
        url.searchParams.delete('auth_error'); history.replaceState(null, '', url);
        update({error: code === 'canceled' ? 'Google connection canceled. Your data is preserved.' : code === 'account_changed' ? 'Different account selected. Sign out first to switch accounts.' : 'Google sign-in could not finish. Try again and allow workspace storage and offline access.'});
      }
      return;
    }
    if (!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) {
      update({phase: 'setup'}); return;
    }
    try {
      if (!window.google?.accounts?.oauth2) await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => {script.remove(); reject(new Error('Google sign-in could not load. Reload the page and check your connection.'));}, 15000);
        script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
        script.onload = () => {clearTimeout(timer); resolve();};
        script.onerror = () => {clearTimeout(timer); script.remove(); reject(new Error('Google sign-in is blocked or offline. Reload and try again.'));};
        document.head.appendChild(script);
      });
      if (!window.google?.accounts?.oauth2) throw new Error('Google sign-in is unavailable. Reload the page.');
      update({phase: 'ready', error: ''});
    } catch (error) {update({phase: 'error', error: (error as Error).message});}
  })();
  return preparation;
}

// Called directly from a click: no awaited work before opening Google's popup.
export function connectGoogle(permission: GooglePermission = 'all'): Promise<void> {
  if (persistent) {
    if (pending) return Promise.reject(new Error('Finish the Google connection first.'));
    pending = true; update({phase: 'connecting', error: ''});
    return serverRequest('start?permission=' + encodeURIComponent(permission)).then(data => {
      location.assign(data.url);
      // Navigation completes authorization; callers must not continue with old scopes.
      return new Promise<void>(() => {});
    }).catch(error => {pending = false; update({phase: token ? 'connected' : 'ready', error: error.message}); throw error;});
  }
  const oauth = window.google?.accounts?.oauth2;
  if (!config.clientId) return Promise.reject(new Error('Google app registration is not complete.'));
  if (!oauth) return Promise.reject(new Error('Google sign-in is not ready. Reload the page.'));
  if (pending) return Promise.reject(new Error('Finish the Google window that is already open.'));
  pending = true;
  const run = ++generation;
  const requested = permission === 'all' ? [scope.workspace, scope.drive, scope.sheets, scope.calendar] : [scope[permission]];
  update({phase: 'connecting', error: ''});
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => fail('Google sign-in did not finish. Try connecting again.'), 120000);
    function fail(message: string) {
      if (done) return;
      done = true; clearTimeout(timer); pending = false;
      if (run === generation) update({phase: token && token.expires > Date.now() ? 'connected' : 'ready', error: message});
      reject(new Error(message));
    }
    try {
      const client = oauth.initTokenClient({
        client_id: config.clientId,
        scope: ['openid', 'https://www.googleapis.com/auth/userinfo.email', ...requested].join(' '),
        include_granted_scopes: true,
        error_callback: error => fail(error.type === 'popup_closed' ? 'Connection canceled. Your data is preserved.' : 'The Google window could not open. Allow pop-ups for Arcy and try again.'),
        callback: async response => {
          if (done || run !== generation) return;
          if (response.error || !response.access_token) {fail('Google access was not granted. You can try again.'); return;}
          try {
            const started = Date.now();
            const seconds = Number(response.expires_in);
            if (!Number.isFinite(seconds) || seconds <= 60) throw new Error('Invalid Google session. Connect again.');
            const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: {Authorization: 'Bearer ' + response.access_token}, signal: AbortSignal.timeout(15000),
            });
            if (!profileResponse.ok) throw new Error('Unable to verify your Google account. Connect again.');
            const profile = await profileResponse.json() as {sub?: unknown; email?: unknown};
            if (typeof profile.sub !== 'string' || !profile.sub || typeof profile.email !== 'string') throw new Error('Allow account identity access to connect Google.');
            if (done || run !== generation) return;
            if (token && token.owner !== profile.sub) throw new Error('Different account selected. Sign out first to switch accounts.');
            const granted = new Set((response.scope || '').split(' '));
            const services = {
              drive: granted.has(scope.drive), sheets: granted.has(scope.sheets),
              calendar: granted.has(scope.calendar) || granted.has(scope.calendarWrite),
            };
            token = {value: response.access_token, owner: profile.sub, expires: started + (seconds - 30) * 1000, scopes: granted};
            clearTimeout(expiry);
            expiry = setTimeout(() => clearSession('expired', 'Sesi Google berakhir. Select Connect Google to continue.'), Math.min(2147483647, token.expires - Date.now()));
            const missing = requested.some(s => !granted.has(s) && !(s === scope.calendar && granted.has(scope.calendarWrite)));
            update({phase: 'connected', email: profile.email, owner: profile.sub, workspace: granted.has(scope.workspace), services, error: missing ? 'Some permissions were not granted. Connect the services you want to use.' : ''});
            done = true; clearTimeout(timer); pending = false; resolve();
          } catch (error) {fail((error as Error).message);}
        },
      });
      client.requestAccessToken({prompt: token ? '' : 'select_account', ...(token ? {hint: token.owner} : {})});
    } catch {fail('Unable to open Google sign-in. Try again.');}
  });
}

export async function disconnectGoogle() {
  if (pending) throw new Error('Finish the Google window first.');
  if (persistent) {await endServerSession('disconnect'); return;}
  const previous = token?.value;
  clearSession('ready');
  if (!previous) return;
  pending = true;
  update({phase: 'connecting'});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Signed out locally. Access revocation is unconfirmed; check Arcy permissions in your Google account.')), 10000);
      window.google!.accounts!.oauth2!.revoke(previous, result => {
        clearTimeout(timer);
        result.successful ? resolve() : reject(new Error('Signed out locally. Revoke Arcy access in your Google account settings.'));
      });
    });
  } catch (error) {update({error: (error as Error).message}); throw error;}
  finally {pending = false; update({phase: 'ready'});}
}

async function endServerSession(action: 'logout' | 'disconnect') {
  pending = true; ++generation; clearTimeout(expiry);
  try {
    // Finish renewal first so its Set-Cookie cannot undo logout.
    await renewal?.catch(() => {});
    await serverRequest(action);
    clearSession('ready');
  } catch (error) {update({error: (error as Error).message}); throw error;}
  finally {pending = false;}
}
export function signOutGoogle(): void | Promise<void> {
  if (pending) throw new Error('Finish the Google window first.');
  if (persistent) return endServerSession('logout');
  clearSession('ready');
}

export function googleSession(permission: GoogleService | 'calendarWrite' | 'workspace') {
  if (!token || (!persistent && token.expires <= Date.now())) {
    if (token) clearSession('expired');
    throw new Error('Select Connect Google to continue.');
  }
  if (!token.scopes.has(scope[permission]) && !(permission === 'calendar' && token.scopes.has(scope.calendarWrite))) {
    throw new Error(permission === 'calendarWrite' ? 'Allow event creation in Google first.' : 'Connect this service and authorize access in Google.');
  }
  const session = token, run = generation;
  function assertCurrent() {if (token !== session || generation !== run || (!persistent && session.expires <= Date.now())) throw new Error('Your Google session changed. Try again with the connected account.');}
  return {
    owner: session.owner, assertCurrent,
    async request(url: string, options: RequestInit = {}) {
      assertCurrent();
      if (persistent && session.expires <= Date.now() + 60000) {await restoreSession(); assertCurrent();}
      if (session.expires <= Date.now()) throw new Error('Could not renew Google access. Check your connection and retry.');
      const target = new URL(url);
      if (target.protocol !== 'https:' || !['www.googleapis.com', 'sheets.googleapis.com'].includes(target.host) || target.username || target.password) throw new Error('Invalid Google API destination.');
      const send = () => fetch(url, {...options, redirect: 'error' as const, headers: {...options.headers, Authorization: 'Bearer ' + session.value}, signal: AbortSignal.timeout(25000)});
      let response = await send();
      if (persistent && response.status === 401) {await restoreSession(); assertCurrent(); response = await send();}
      assertCurrent();
      if (response.status === 401) {clearSession('expired'); throw new Error('Your Google session expired. Reconnect to continue.');}
      if (!response.ok) {
        if (response.status === 409 && options.method === 'POST') return response;
        throw new Error(response.status === 403 ? 'Google denied access. Check account permissions and enabled APIs for this app.' : `Google request failed (${response.status}). Try again.`);
      }
      return response;
    },
  };
}
