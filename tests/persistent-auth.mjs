import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import handler from '../api/auth/[action].js';
const origin = 'https://arcy.example.test';
Object.assign(process.env, {ARCY_APP_ORIGIN: origin, ARCY_SESSION_SECRET: randomBytes(32).toString('hex'), GOOGLE_CLIENT_ID: 'test-client', GOOGLE_CLIENT_SECRET: 'test-secret'});
const realFetch = globalThis.fetch;
const jar = new Map();
const workspace = 'https://www.googleapis.com/auth/drive.appdata';
let owner = 'account-a', refreshInvalid = false, requests = [];
globalThis.fetch = async (url, init) => {
  requests.push({url, init});
  if (url.endsWith('/token')) {
    if (refreshInvalid) return Response.json({error: 'invalid_grant'}, {status: 400});
    return Response.json({access_token: 'access-only', refresh_token: 'refresh-secret', expires_in: 3600, scope: workspace});
  }
  if (url.endsWith('/userinfo')) return Response.json({sub: owner, email: owner + '@example.test', email_verified: true});
  if (url.endsWith('/revoke')) return new Response('', {status: 200});
  throw new Error('Unexpected destination');
};
async function call(action, {method = 'POST', requestOrigin = origin, apply = true} = {}) {
  const headers = new Map();
  const req = {url: '/api/auth/' + action, method, headers: {origin: requestOrigin, 'x-arcy-request': '1', cookie: [...jar].map(([k,v]) => k+'='+v).join('; ')}};
  const res = {statusCode: 200, setHeader: (k,v) => headers.set(k,v), getHeader: k => headers.get(k), end: body => {res.body = body;}};
  await handler(req, res);
  if (apply) for (const cookie of headers.get('Set-Cookie') || []) {
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    const [pair] = cookie.split(';'), i = pair.indexOf('=');
    if (cookie.includes('Max-Age=0')) jar.delete(pair.slice(0,i)); else jar.set(pair.slice(0,i), pair.slice(i+1));
  }
  assert.equal(headers.get('Cache-Control'), 'no-store');
  return {...res, headers, json: res.body ? JSON.parse(res.body) : undefined};
}
async function signIn() {
  const start = await call('start?permission=workspace');
  assert.equal(start.statusCode, 200);
  const url = new URL(start.json.url);
  assert.equal(url.searchParams.get('access_type'), 'offline');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('redirect_uri'), origin + '/api/auth/callback');
  return call('callback?state='+url.searchParams.get('state')+'&code=test-code', {method:'GET'});
}
try {
  assert.equal((await call('session')).statusCode, 401);
  assert.equal((await call('start', {requestOrigin:'https://evil.test'})).statusCode, 403);
  assert.equal((await call('start', {method:'GET'})).statusCode, 405);
  assert.equal((await call('start?permission=evil')).statusCode, 400);
  assert.equal((await call('callback?state=wrong&code=fake', {method:'GET'})).headers.get('Location'), '/?auth_error=invalid_state');
  assert.equal(requests.length, 0, 'bad OAuth state must never reach Google');
  const signed = await signIn();
  assert.equal(signed.headers.get('Location'), '/');
  const saved = jar.get('__Host-arcy-session');
  assert.ok(saved && !saved.includes('refresh-secret'));
  assert.equal(jar.has('__Host-arcy-oauth'), false, 'callback clears flow cookie');
  requests = [];
  const resumed = await call('session');
  assert.equal(resumed.json.owner, owner);
  assert.equal(resumed.json.access_token, 'access-only');
  assert.equal(JSON.stringify(resumed.json).includes('refresh-secret'), false);
  assert.equal(requests[0].init.body.get('grant_type'), 'refresh_token', 'returning browser renews access without OAuth');
  assert.match(resumed.headers.get('Set-Cookie')[0], /Max-Age=2592000/);
  jar.set('__Host-arcy-session', 'broken'+saved);
  assert.equal((await call('session')).statusCode, 401, 'tampering cannot authenticate');
  jar.set('__Host-arcy-session', saved);
  owner = 'account-b';
  assert.equal((await call('session')).statusCode, 401, 'refresh cannot change account');
  owner = 'account-a';
  await signIn();
  const start = await call('start?permission=drive'), state = new URL(start.json.url).searchParams.get('state');
  owner = 'account-b';
  const mismatch = await call('callback?state='+state+'&code=test', {method:'GET'});
  assert.equal(mismatch.headers.get('Location'), '/?auth_error=account_changed');
  owner = 'account-a';
  await call('logout');
  assert.equal(jar.size, 0); assert.equal((await call('session')).statusCode, 401);
  await signIn(); refreshInvalid = true;
  assert.equal((await call('session')).statusCode, 401);
  assert.equal(jar.has('__Host-arcy-session'), false);
  refreshInvalid = false; await signIn();
  await call('disconnect');
  assert.ok(requests.some(r => r.url.endsWith('/revoke')));
  assert.equal(jar.size, 0);
  delete process.env.GOOGLE_CLIENT_SECRET;
  assert.equal((await call('session')).statusCode, 503);
  console.log('PASS: persistent restore/renewal, 30-day cookie, CSRF, PKCE, account isolation, tampering, logout, revocation, expired grants, missing config. Google is mocked.');
} finally {globalThis.fetch = realFetch;}
