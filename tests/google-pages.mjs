import ts from 'typescript';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temporary=mkdtempSync(join(tmpdir(),'arcy-google-'));
const realFetch=globalThis.fetch;
let oauthOptions, requested, responseHandler;
const account={sub:'account-a',email:'owner@example.test'};
globalThis.window={google:{accounts:{oauth2:{
  initTokenClient(options){oauthOptions=options;return {requestAccessToken(options){requested=options;}};},
  revoke(_token, callback){callback({successful:true});},
}}}};
globalThis.fetch=async(url,options={})=>{
  if(String(url).endsWith('/userinfo'))return Response.json(account);
  return responseHandler(url,options);
};
function compile(source,target,replace=code=>code){
  writeFileSync(join(temporary,target),ts.transpileModule(replace(readFileSync(source,'utf8')),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
compile('pages/google-auth.ts','unconfigured.mjs',code=>code.replace("import config from './google-config.json';","const config={clientId:''};"));
compile('pages/google-auth.ts','google-auth.mjs',code=>code.replace("import config from './google-config.json';","const config={clientId:'123456-arcytest.apps.googleusercontent.com'};"));
compile('pages/google-api.ts','google-api.mjs',code=>code.replace("'./google-auth'","'./google-auth.mjs'").replace("'./local-api'","'./local-api.mjs'"));
// Substitute storage only: run the real OAuth and Google API orchestration.
writeFileSync(join(temporary,'local-api.mjs'),`
export let records=[];
export async function allRecords(){return records;}
export async function localApi(path,body){if(body){records.push(body);return {item:body};}return {items:records};}
export async function saveGoogleRecords(items,assertCurrent,owner){
 assertCurrent();
 if(owner)records=records.filter(r=>r.meta.googleAccount!==owner||r.meta.source!=='Google Calendar');
 for(const item of items){const i=records.findIndex(r=>r.id===item.id);if(i<0)records.push(item);else records[i]=item;}
}
`);
const auth=await import(join(temporary,'google-auth.mjs'));
const unconfigured=await import(join(temporary,'unconfigured.mjs'));
const {pagesApi}=await import(join(temporary,'google-api.mjs'));
const storage=await import(join(temporary,'local-api.mjs'));
const readScopes=['drive.readonly','spreadsheets.readonly','calendar.events.readonly'].map(s=>'https://www.googleapis.com/auth/'+s);
async function authorize(permission='all',granted=readScopes){
  const connected=auth.connectGoogle(permission);
  assert.ok(requested,'popup must open synchronously from click');
  await oauthOptions.callback({access_token:'test-memory-only',expires_in:3600,scope:granted.join(' ')});
  await connected;
}
try{
  await unconfigured.prepareGoogle();assert.equal(unconfigured.googleSnapshot().phase,'setup');
  await assert.rejects(unconfigured.connectGoogle(),/Pendaftaran/);
  await auth.prepareGoogle();assert.equal(auth.googleSnapshot().phase,'ready');
  const cancelled=auth.connectGoogle();const cancelledCheck=assert.rejects(cancelled,/dibatalkan/);
  oauthOptions.error_callback({type:'popup_closed'});await cancelledCheck;
  assert.equal(auth.googleSnapshot().phase,'ready');assert.equal(auth.googleSnapshot().services.drive,false);
  const denied=auth.connectGoogle();const deniedCheck=assert.rejects(denied,/belum diberikan/);
  await oauthOptions.callback({error:'access_denied'});await deniedCheck;
  await authorize('all',[readScopes[0]]);
  assert.deepEqual(auth.googleSnapshot().services,{drive:true,sheets:false,calendar:false});
  assert.throws(()=>auth.googleSession('sheets'),/Hubungkan layanan/);
  assert.throws(()=>auth.googleSession('calendarWrite'),/Izinkan pengiriman/);
  assert.equal(requested.prompt,'select_account');
  await authorize();assert.equal(requested.hint,account.sub);
  assert.ok(!oauthOptions.scope.split(' ').includes('https://www.googleapis.com/auth/calendar.events'),'initial connect must be read-only');
  assert.equal(JSON.stringify(auth.googleSnapshot()).includes('test-memory-only'),false);
  await assert.rejects(auth.googleSession('drive').request('https://attacker.test/'),/Tujuan API/);

  responseHandler=async(url,options)=>{
    assert.equal(options.headers.Authorization,'Bearer test-memory-only');
    if(String(url).includes('/export?'))return new Response('Verified document snapshot');
    return Response.json({name:'Planning',mimeType:'application/vnd.google-apps.document',modifiedTime:'2026-09-11T00:00:00Z'});
  };
  await pagesApi('/api/google',{action:'import',id:'doc1'});
  await pagesApi('/api/google',{action:'import',id:'doc1'});
  assert.equal(storage.records.length,1,'reimport updates same record');
  account.sub='account-b';
  const switched=auth.connectGoogle();const rejectSwitch=assert.rejects(switched,/Akun berbeda/);
  await oauthOptions.callback({access_token:'other-token',expires_in:3600,scope:readScopes.join(' ')});await rejectSwitch;
  assert.equal(auth.googleSnapshot().owner,'account-a');
  auth.signOutGoogle();await authorize();
  await pagesApi('/api/google',{action:'import',id:'doc1'});
  assert.equal(storage.records.length,2,'same Doc imports are isolated by Google account');
  const sheetCalls=[];
  responseHandler=async(url)=>{sheetCalls.push(String(url));return Response.json({values:[['Article','Qty'],['E1001',12]]});};
  const imported=await pagesApi('/api/google',{action:'sheets',id:'https://docs.google.com/spreadsheets/d/sheet123/edit',range:"'Planning'!A1:B2"});
  assert.equal(imported.item.body,'Article\tQty\nE1001\t12');
  assert.ok(sheetCalls[0].includes(encodeURIComponent("'Planning'!A1:B2")));
  await assert.rejects(pagesApi('/api/google',{action:'sheets',id:'https://attacker.test/sheet',range:'A1'}),/ID Google/);
  await storage.localApi('/api/workspace',{id:'old-event',kind:'event',title:'Old',meta:{googleAccount:account.sub,source:'Google Calendar'}});
  let page=0;
  const event={id:'event1',summary:'Review',start:{dateTime:'2026-09-11T09:00:00+07:00'},end:{dateTime:'2026-09-11T10:00:00+07:00'}};
  responseHandler=async()=>++page===1?Response.json({items:[event],nextPageToken:'page2'}):new Response('',{status:500});
  await assert.rejects(pagesApi('/api/google',{action:'calendar'}),/500/);
  assert.ok(storage.records.some(r=>r.id==='old-event'),'failed second page must retain old Calendar');
  page=0;
  responseHandler=async()=>++page===1?Response.json({items:[event],nextPageToken:'page2'}):Response.json({items:[{...event,id:'event2'}]});
  const synced=await pagesApi('/api/google',{action:'calendar'});
  assert.equal(synced.changed,2);assert.equal(storage.records.some(r=>r.id==='old-event'),false);
  assert.equal(storage.records.filter(r=>r.kind==='note').length,3,'calendar replacement preserves notes');

  await authorize('calendarWrite',[...readScopes,'https://www.googleapis.com/auth/calendar.events']);
  await storage.localApi('/api/workspace',{id:'local-event',kind:'event',title:'Follow-up',body:'Review only',meta:{start:'2026-09-11T02:00:00Z',end:'2026-09-11T03:00:00Z'}});
  const posted=[];
  responseHandler=async(url,options)=>{
    if(options.method==='POST'){posted.push(JSON.parse(options.body));return posted.length===1?Response.json({id:posted[0].id}):new Response('',{status:409});}
    return Response.json({extendedProperties:{private:{arcyId:'local-event'}}});
  };
  await pagesApi('/api/google',{action:'publish-event',id:'local-event'});
  await pagesApi('/api/google',{action:'publish-event',id:'local-event'});
  assert.equal(posted[0].id,posted[1].id);assert.equal(posted[0].attendees,undefined);
  assert.match(posted[0].id,/^[a-v0-9]{5,1024}$/);

  let release;
  responseHandler=async()=>new Promise(resolve=>{release=resolve;});
  const outstanding=pagesApi('/api/google',{action:'import',id:'stale'});
  const staleCheck=assert.rejects(outstanding,/Sesi Google berubah/);
  await auth.disconnectGoogle();
  release(Response.json({name:'Stale',mimeType:'application/vnd.google-apps.document'}));
  await staleCheck;
  assert.equal(storage.records.some(r=>r.title==='Stale'),false);
  assert.equal(auth.googleSnapshot().phase,'ready');
  await authorize();responseHandler=async()=>new Response('',{status:401});
  await assert.rejects(pagesApi('/api/google',{action:'browse'}),/Sesi Google berakhir/);
  assert.equal(auth.googleSnapshot().phase,'expired');assert.equal(auth.googleSnapshot().services.drive,false);
  console.log('PASS: missing registration, popup cancellation, denied/partial scopes, memory-only token state, account isolation, Docs reimport, Sheets read, paginated Calendar rollback, idempotent event creation, stale-session rejection, expired-token recovery. Google responses and storage are mocked; live consent remains unverified.');
}finally{await auth.disconnectGoogle();globalThis.fetch=realFetch;delete globalThis.window;rmSync(temporary,{recursive:true,force:true});}

