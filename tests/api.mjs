import ts from 'typescript';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const temp=mkdtempSync(join(tmpdir(),'arcy-api-'));
const sql=new DatabaseSync(':memory:');
sql.exec(readFileSync('drizzle/0000_marvelous_rattler.sql','utf8'));
globalThis.__arcyDB = {
 prepare(query) {
  return {
   bind(...args) {
    const statement = sql.prepare(query);
    return {
     async run() { return statement.run(...args); },
     async all() { return { results: statement.all(...args) }; },
     async first() { return statement.get(...args) || null; }
    };
   }
  };
 }
};
globalThis.__arcyUser={userId:'owner-a',email:'a@example.test'};
writeFileSync(join(temp,'env.mjs'),'export const env={DB:globalThis.__arcyDB};');
writeFileSync(join(temp,'auth.mjs'),'export async function getChatGPTUser(){return globalThis.__arcyUser}');
function compile(src,out){let code=readFileSync(src,'utf8').replace("'cloudflare:workers'","'./env.mjs'").replace("'@/app/chatgpt-auth'","'./auth.mjs'").replace("'@/lib/data'","'./data.mjs'").replace("'zod'",JSON.stringify(new URL('../node_modules/zod/index.js',import.meta.url).href));writeFileSync(join(temp,out),ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText)}
compile('lib/data.ts','data.mjs');compile('app/api/workspace/route.ts','workspace.mjs');compile('app/api/ask/route.ts','ask.mjs');
const route=await import(join(temp,'workspace.mjs'));const ask=await import(join(temp,'ask.mjs'));
const request=(body,origin='https://arcy.test',method='POST')=>new Request('https://arcy.test/api/workspace',{method,headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
try{
 let res=await route.POST(request({kind:'task',title:'Review planning',meta:{status:'open',priority:'high'}}));assert.equal(res.status,200);const {item}=await res.json();
 assert.equal((await(await route.GET()).json()).items.length,1);
 res=await route.POST(request({...item,title:'Planning reviewed',meta:{status:'done'}}));assert.equal(res.status,200);assert.equal((await(await route.GET()).json()).items[0].meta.status,'done');
 assert.equal((await route.POST(request({...item,kind:'note'}))).status,400);
 assert.equal((await route.POST(request({kind:'task',title:''}))).status,400);
 assert.equal((await route.POST(request({kind:'event',title:'Invalid event',meta:{start:'2026-09-10T02:00:00Z',end:'2026-09-10T01:00:00Z'}}))).status,400);
 assert.equal((await route.POST(request({kind:'task',title:'Cross-site'},'https://other.test'))).status,403);
 globalThis.__arcyUser={userId:'owner-b',email:'b@example.test'};
 assert.equal((await(await route.GET()).json()).items.length,0);
 assert.equal((await route.POST(request({...item,title:'Hijack'}))).status,400);
 await route.DELETE(request({id:item.id},'https://arcy.test','DELETE'));
 globalThis.__arcyUser={userId:'owner-a',email:'a@example.test'};
 assert.equal((await(await route.GET()).json()).items.length,1);
 res=await ask.POST(request({question:'planning'}));assert.equal(res.status,200);let chat=(await res.json()).item;assert.equal(chat.meta.mode,'search');assert.equal(chat.meta.sources[0].id,item.id);
 globalThis.__arcyUser=null;assert.equal((await route.GET()).status,401);assert.equal((await ask.POST(request({question:'planning'}))).status,401);
 console.log('PASS: persistence, completion, validation, origin checks, owner isolation, grounded source search, unauthenticated access.');
}finally{sql.close();rmSync(temp,{recursive:true,force:true})}
