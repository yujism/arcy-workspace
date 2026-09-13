import ts from 'typescript';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir = mkdtempSync(join(tmpdir(), 'arcy-client-'));
const source = readFileSync('pages/google-auth.ts', 'utf8').replace("import config from './google-config.json';", "const config={clientId:'configured'}; const __ARCY_PERSISTENT_AUTH__=true;").replace('declare const __ARCY_PERSISTENT_AUTH__: boolean;', '');
writeFileSync(join(dir, 'auth.mjs'), ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
globalThis.location = {href:'https://arcy.example.test/'};
let signed = true, sessionCalls = 0, apiCalls = 0, denyApi = false, release;
const workspace = 'https://www.googleapis.com/auth/drive.appdata';
globalThis.fetch = async (url, options) => {
  if (url === '/api/auth/session') {
    sessionCalls++;
    assert.equal(options.method, 'POST'); assert.equal(options.headers['X-Arcy-Request'], '1');
    if (!signed) return Response.json({error:'Sign in'}, {status:401});
    return Response.json({owner:'a',email:'a@example.test',access_token:'token-'+sessionCalls,expires_in:3600,scope:workspace});
  }
  if (url === '/api/auth/logout') {signed=false;return Response.json({ok:true});}
  if (String(url).startsWith('https://www.googleapis.com/')) {
    apiCalls++;
    if (release === 'hold') return new Promise(resolve=>{release=resolve;});
    if (denyApi) {denyApi=false; return new Response('', {status:401});}
    return Response.json({ok:true});
  }
  throw new Error('Unexpected URL '+url);
};
const auth = await import(join(dir,'auth.mjs'));
try {
  await auth.prepareGoogle();
  assert.equal(auth.googleSnapshot().phase,'connected', 'restores on load without login click');
  const session = auth.googleSession('workspace');
  const realTime = Date.now(); Date.now=()=>realTime+3600*1000;
  await session.request('https://www.googleapis.com/drive/v3/files');
  assert.equal(sessionCalls,2,'expired access refreshes before request');
  session.assertCurrent();
  denyApi=true;
  await session.request('https://www.googleapis.com/drive/v3/files');
  assert.equal(sessionCalls,3);assert.equal(apiCalls,3,'401 retried once after refresh');
  await assert.rejects(session.request('https://evil.test/'), /Invalid Google API/);
  release='hold';
  const pending=session.request('https://www.googleapis.com/drive/v3/files');
  const stale=assert.rejects(pending, /session changed/);
  await auth.signOutGoogle(); release(Response.json({ok:true})); await stale;
  assert.equal(auth.googleSnapshot().owner,'');
  assert.equal(auth.googleSnapshot().phase,'ready');
  console.log('PASS: automatic startup restore, expired access renewal, 401 retry, stable in-flight identity, destination guard, logout/stale response rejection. Server is mocked.');
} finally {Date.now=originalNow;globalThis.fetch=originalFetch;delete globalThis.location;rmSync(dir,{recursive:true,force:true});}
