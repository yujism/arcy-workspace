import ts from 'typescript';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'arcy-sync-'));
symlinkSync(resolve('node_modules'),join(dir,'node_modules'),'dir');
for(const name of ['record-schema','drive-workspace','local-api']){
 let source=readFileSync('pages/'+name+'.ts','utf8').replaceAll("'./record-schema'","'./record-schema.mjs'").replaceAll("'./drive-workspace'","'./drive-workspace.mjs'").replace("import {googleSession} from './google-auth';", "const googleSession=()=>{throw new Error('No test session');};");
 writeFileSync(join(dir,name+'.mjs'),ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText);
}
const {DriveWorkspace,activateWorkspace}=await import(join(dir,'drive-workspace.mjs'));
const {localApi}=await import(join(dir,'local-api.mjs'));
let seq=0,failList=false,failUpload=false,ambiguous=false;
const files=new Map();
function session(owner){return {owner,assertCurrent(){},async request(url,options={}){
 const u=new URL(url);
 if(u.pathname.endsWith('/generateIds'))return Response.json({ids:['file_'+(++seq)]});
 if(options.method==='POST'){
  if(failUpload)throw new Error('Network failed');
  const boundary=options.headers['Content-Type'].split('boundary=')[1];
  const parts=options.body.split('--'+boundary).slice(1,3).map(s=>JSON.parse(s.split('\r\n\r\n')[1].trim()));
  const [meta,op]=parts;assert.equal(op.owner,owner);assert.deepEqual(meta.parents,['appDataFolder']);
  if(files.has(meta.id))return new Response('',{status:409});
  files.set(meta.id,{owner,op});
  if(ambiguous){ambiguous=false;throw new Error('Response lost');}
  return Response.json({id:meta.id});
 }
 if(u.searchParams.get('alt')==='media'){
  const file=files.get(u.pathname.split('/').pop());assert.equal(file.owner,owner);return Response.json(file.op);
 }
 if(failList)throw new Error('List failed');
 assert.equal(u.searchParams.get('spaces'),'appDataFolder');
 // Force pagination to verify all pages are read.
 const all=[...files].filter(([,f])=>f.owner===owner).map(([id])=>({id}));
 const offset=Number(u.searchParams.get('pageToken')||0);
 return Response.json({files:all.slice(offset,offset+2),...(offset+2<all.length?{nextPageToken:String(offset+2)}:{})});
 }};}
const a=new DriveWorkspace('a',()=>session('a')),b=new DriveWorkspace('a',()=>session('a')),other=new DriveWorkspace('b',()=>session('b'));
const item=(id,title=id)=>({id,kind:'task',title,body:'',meta:{status:'open'},updated:new Date().toISOString()});
try{
 await Promise.all([a.refresh(),b.refresh(),other.refresh()]);assert.equal(a.records().length,0);
 await a.mutate(()=>[{id:'one',value:item('one')}]);await b.refresh();assert.equal(b.records()[0].id,'one');
 await Promise.all([a.mutate(()=>[{id:'two',value:item('two')}]),b.mutate(()=>[{id:'three',value:item('three')}])]);
 await Promise.all([a.refresh(),b.refresh()]);assert.deepEqual(a.records(),b.records());assert.equal(a.records().length,3);
 await a.mutate(()=>[{id:'one',value:null}]);await b.mutate(()=>[{id:'four',value:item('four')}]);
 await Promise.all([a.refresh(),b.refresh()]);assert.equal(b.records().some(r=>r.id==='one'),false);assert.deepEqual(a.records(),b.records());
 await Promise.all([a.mutate(()=>[{id:'two',value:item('two','A')}]),b.mutate(()=>[{id:'two',value:item('two','B')}])]);
 await Promise.all([a.refresh(),b.refresh()]);assert.deepEqual(a.records(),b.records(),'concurrent edits converge deterministically');
 await other.refresh();assert.equal(other.records().length,0,'account isolation');
 const wrong=new DriveWorkspace('a',()=>session('b'));await assert.rejects(wrong.refresh(),/Akun berubah/);
 const before=a.records();failList=true;await assert.rejects(a.refresh(),/List failed/);assert.deepEqual(a.records(),before);failList=false;
 failUpload=true;await assert.rejects(a.mutate(()=>[{id:'retry',value:item('retry')}]),/Network failed/);assert.equal(a.records().some(r=>r.id==='retry'),false);failUpload=false;
 await a.refresh();assert.equal(a.records().some(r=>r.id==='retry'),true);
 ambiguous=true;await assert.rejects(a.mutate(()=>[{id:'ambiguous',value:item('ambiguous')}]),/Response lost/);const count=files.size;
 await a.refresh();assert.equal(files.size,count,'lost response retries same ID');assert.equal(a.records().filter(r=>r.id==='ambiguous').length,1);
 activateWorkspace(a);const current=a.records().find(r=>r.id==='two');
 await localApi('/api/workspace',{...current,expectedUpdated:current.updated,title:'Fresh'});
 await assert.rejects(localApi('/api/workspace',{...current,expectedUpdated:current.updated,title:'Stale'}),/berubah di browser lain/);
 await assert.rejects(localApi('/api/workspace',{id:current.id,expectedUpdated:current.updated},'DELETE'),/berubah di browser lain/);
 const fresh=new DriveWorkspace('a',()=>session('a'));await fresh.refresh();assert.deepEqual(fresh.records(),a.records(),'fresh browser restores from Drive only');
 const max=seq;await assert.rejects(a.mutate(()=>[{id:'bad',value:{...item('bad'),kind:'bad'}}]));assert.equal(seq,max);
 a.close();assert.throws(()=>a.records(),/ditutup/);
 console.log('PASS: account isolation, fresh-browser restore, pagination, concurrent writes, deterministic conflict merge, deletion tombstones, failed reads/writes, ambiguous upload retry without duplicates, stale-edit rejection, schema validation and closed-session guards. Drive is mocked.');
}finally{activateWorkspace();rmSync(dir,{recursive:true,force:true});}
