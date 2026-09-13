import {createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, timingSafeEqual} from 'node:crypto';
import googleConfig from '../../pages/google-config.json' with {type: 'json'};

const SESSION = '__Host-arcy-session', FLOW = '__Host-arcy-oauth';
const MONTH = 30 * 24 * 60 * 60;
const scopes = {
  workspace: 'https://www.googleapis.com/auth/drive.appdata',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  sheets: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarWrite: 'https://www.googleapis.com/auth/calendar.events',
};
function settings() {
  const clientId = process.env.GOOGLE_CLIENT_ID || googleConfig.clientId;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const secret = process.env.ARCY_SESSION_SECRET;
  const origin = process.env.ARCY_APP_ORIGIN || 'https://arcy-workspace.vercel.app';
  if (!clientId || !clientSecret || (secret && !/^[a-f0-9]{64}$/i.test(secret)) || new URL(origin).origin !== origin || !origin.startsWith('https://')) {
    throw Object.assign(new Error('Persistent sign-in is awaiting server configuration.'), {status: 503});
  }
  // Derive a separate encryption key from Google's server secret; rotating it
  // invalidates existing sessions. An independent key can be configured if needed.
  const key = secret ? Buffer.from(secret, 'hex') : Buffer.from(hkdfSync('sha256', clientSecret, 'arcy-workspace', 'session-cookie-v1', 32));
  return {clientId, clientSecret, key, origin};
}
function seal(value, purpose, key) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(purpose));
  return Buffer.concat([iv, cipher.update(JSON.stringify(value)), cipher.final(), cipher.getAuthTag()]).toString('base64url');
}
function readCookie(req, name, key) {
  try {
    const raw = (req.headers.cookie || '').split('; ').find(c => c.startsWith(name + '='))?.slice(name.length + 1);
    if (!raw || raw.length > 3800) return;
    const bytes = Buffer.from(raw, 'base64url'), decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(name)); decipher.setAuthTag(bytes.subarray(-16));
    const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString());
    if (value.exp > Date.now()) return value;
  } catch { /* Invalid, expired, or tampered cookies are unauthenticated. */ }
}
function cookie(res, name, value, seconds, key) {
  const encoded = value ? seal({...value, exp: Date.now() + seconds * 1000}, name, key) : '';
  if (encoded.length > 3800) throw new Error('Session could not be saved.');
  res.setHeader('Set-Cookie', [...(res.getHeader('Set-Cookie') || []), `${name}=${encoded}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${seconds}`]);
}
function json(res, status, value) {res.statusCode = status; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value));}
function redirect(res, path) {res.statusCode = 303; res.setHeader('Location', path); res.end();}
async function exchange(parameters, cfg) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({client_id: cfg.clientId, client_secret: cfg.clientSecret, ...parameters}),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw Object.assign(new Error('Google session could not be renewed.'), {status: data.error === 'invalid_grant' ? 401 : 502});
  if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in) || data.expires_in < 60) throw new Error('Invalid Google token response.');
  return data;
}
async function profile(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {headers: {Authorization: 'Bearer ' + accessToken}, signal: AbortSignal.timeout(15000)});
  if (!response.ok) throw Object.assign(new Error('Could not verify your Google account.'), {status: response.status === 401 ? 401 : 502});
  const data = await response.json();
  if (typeof data.sub !== 'string' || !data.sub || typeof data.email !== 'string' || !data.email_verified) throw new Error('Google account identity is unavailable.');
  return {owner: data.sub, email: data.email};
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  let cfg;
  const action = new URL(req.url, 'https://arcy.invalid').pathname.split('/').pop();
  try {
    cfg = settings();
    const url = new URL(req.url, cfg.origin);
    if (action === 'callback') {
      if (req.method !== 'GET') return json(res, 405, {error: 'Method not allowed.'});
      const flow = readCookie(req, FLOW, cfg.key), current = readCookie(req, SESSION, cfg.key);
      const returned = url.searchParams.get('state') || '';
      if (!flow || typeof flow.state !== 'string' || returned.length !== flow.state.length || !timingSafeEqual(Buffer.from(returned), Buffer.from(flow.state))) {
        return redirect(res, '/?auth_error=invalid_state');
      }
      cookie(res, FLOW, null, 0, cfg.key);
      if (url.searchParams.has('error')) return redirect(res, '/?auth_error=canceled');
      if ((flow.owner || '') !== (current?.owner || '')) return redirect(res, '/?auth_error=account_changed');
      const code = url.searchParams.get('code');
      if (!code || code.length > 4096) return redirect(res, '/?auth_error=invalid_response');
      const data = await exchange({code, code_verifier: flow.verifier, grant_type: 'authorization_code', redirect_uri: cfg.origin + '/api/auth/callback'}, cfg);
      const identity = await profile(data.access_token);
      if (flow.owner && flow.owner !== identity.owner) return redirect(res, '/?auth_error=account_changed');
      const refresh = data.refresh_token || (current?.owner === identity.owner ? current.refresh : undefined);
      if (typeof refresh !== 'string' || !refresh) return redirect(res, '/?auth_error=offline_access');
      const granted = typeof data.scope === 'string' ? data.scope : '';
      if (!granted.split(' ').includes(scopes.workspace)) return redirect(res, '/?auth_error=workspace_permission');
      // ponytail: encrypted HttpOnly cookie avoids a session database. Add a server
      // session store if per-device remote revocation is needed; Disconnect revokes Google access.
      cookie(res, SESSION, {...identity, refresh, scope: granted}, MONTH, cfg.key);
      return redirect(res, '/');
    }
    if (req.method !== 'POST') return json(res, 405, {error: 'Method not allowed.'});
    if (req.headers.origin !== cfg.origin || req.headers['x-arcy-request'] !== '1') return json(res, 403, {error: 'Invalid request origin.'});
    const session = readCookie(req, SESSION, cfg.key);
    if (action === 'start') {
      const permission = url.searchParams.get('permission') || 'workspace';
      if (permission !== 'all' && !Object.hasOwn(scopes, permission)) return json(res, 400, {error: 'Invalid permission.'});
      const requested = permission === 'all' ? [scopes.drive, scopes.sheets, scopes.calendar] : [scopes[permission]];
      const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
      cookie(res, FLOW, {state, verifier, owner: session?.owner || ''}, 600, cfg.key);
      const params = new URLSearchParams({
        client_id: cfg.clientId, redirect_uri: cfg.origin + '/api/auth/callback', response_type: 'code',
        scope: [...new Set(['openid', 'email', scopes.workspace, ...requested])].join(' '),
        access_type: 'offline', include_granted_scopes: 'true', state,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
      });
      if (session) params.set('login_hint', session.owner);
      else params.set('prompt', 'consent select_account');
      return json(res, 200, {url: 'https://accounts.google.com/o/oauth2/v2/auth?' + params});
    }
    if (action === 'logout' || action === 'disconnect') {
      cookie(res, SESSION, null, 0, cfg.key); cookie(res, FLOW, null, 0, cfg.key);
      if (action === 'disconnect' && session) {
        const revoked = await fetch('https://oauth2.googleapis.com/revoke', {method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded'}, body: new URLSearchParams({token: session.refresh}), signal: AbortSignal.timeout(15000)});
        if (!revoked.ok) return json(res, 502, {error: 'Signed out. Google revocation is unconfirmed; check your Google account permissions.'});
      }
      return json(res, 200, {ok: true});
    }
    if (action !== 'session') return json(res, 404, {error: 'Not found.'});
    if (!session) {cookie(res, SESSION, null, 0, cfg.key); return json(res, 401, {error: 'Sign in with Google to continue.'});}
    const data = await exchange({refresh_token: session.refresh, grant_type: 'refresh_token'}, cfg);
    const identity = await profile(data.access_token);
    if (identity.owner !== session.owner) throw Object.assign(new Error('Google account changed. Sign in again.'), {status: 401});
    const granted = typeof data.scope === 'string' ? data.scope : session.scope;
    cookie(res, SESSION, {...identity, refresh: data.refresh_token || session.refresh, scope: granted}, MONTH, cfg.key);
    return json(res, 200, {...identity, access_token: data.access_token, expires_in: data.expires_in, scope: granted});
  } catch (error) {
    if (cfg && error.status === 401) cookie(res, SESSION, null, 0, cfg.key);
    if (action === 'callback') return redirect(res, '/?auth_error=connection_failed');
    return json(res, error.status || 502, {error: error.status === 503 ? error.message : 'Google connection failed. Please try again.'});
  }
}
