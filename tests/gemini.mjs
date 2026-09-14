import ts from 'typescript';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as crypto from 'node:crypto';
const source=readFileSync(new URL('../api/auth/[action].js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace('export default ','');
const env={GOOGLE_CLIENT_SECRET:'test-secret',GEMINI_API_KEY:'test-key',GEMINI_MODEL:'gemini-3.5-flash'};
let calls=0;
let providerOK=true;
const upstream=async(url,options)=>{
 calls++;
 assert.match(url,/gemini-3\.5-flash:generateContent$/);
 assert.equal(options.headers['x-goog-api-key'],'test-key');
 const body=JSON.parse(options.body);
 assert.equal(body.contents[0].parts.length,1);
 return {ok:providerOK,status:429,json:async()=>({candidates:[{content:{parts:[{text:'Answer [1]'}]}}]})};
};
const names=['createCipheriv','createDecipheriv','createHash','hkdfSync','randomBytes','timingSafeEqual'];
const api=new Function(...names,'googleConfig','process','fetch',source+';return {handler,seal,settings};')(...names.map(n=>crypto[n]),{clientId:'test-client'},{env},upstream);
const token=api.seal({owner:'test-user',exp:Date.now()+60000},'__Host-arcy-session',api.settings().key);
async function request(headers={},body={question:'Test?',sources:[{title:'Test',excerpt:'Example'}]}){
 const res={headers:{},setHeader(k,v){this.headers[k]=v},getHeader(k){return this.headers[k]},end(v){this.body=JSON.parse(v)}};
 await api.handler({url:'/api/auth/ai',method:'POST',headers,body},res);
 return res;
}
const headers={origin:'https://arcy-workspace.vercel.app','x-arcy-request':'1',cookie:'__Host-arcy-session='+token};
assert.equal((await request()).statusCode,403);
assert.equal((await request({...headers,cookie:''})).statusCode,401);
assert.equal((await request(headers,{question:'',sources:[]})).statusCode,400);
assert.equal(calls,0);
assert.equal((await request(headers)).body.answer,'Answer [1]');
providerOK=false;
assert.equal((await request(headers)).statusCode,429);
console.log('PASS: origin, session, validation, Gemini response, quota handling.');

const adapterSource=readFileSync(new URL('../pages/google-api.ts',import.meta.url),'utf8')
 .replace(/^import .*;\n/gm,'').replace('export async function pagesApi','async function pagesApi');
const adapterJS=ts.transpileModule(adapterSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
let configured=false;
const pagesApi=new Function('localApi','googleSnapshot',adapterJS+';return pagesApi;')(
 async()=>({items:[],connections:{google:false,ai:configured}}),
 ()=>({services:{drive:true,sheets:false,calendar:false}})
);
for(const ai of [true,false]){
 configured=ai;
 const result=await pagesApi('/api/workspace');
 assert.equal(result.connections.ai,ai,'Google adapter must preserve backend AI status');
 assert.equal(result.connections.google,true);
 assert.equal(result.connections.sheets,false);
}
const workspace=readFileSync(new URL('../app/workspace.tsx',import.meta.url),'utf8');
assert.ok(!/OPENAI_API_KEY|OpenAI API key/.test(workspace));
assert.ok(workspace.includes('GEMINI_API_KEY'));
console.log('PASS: Gemini status reaches the workspace and setup uses Gemini.');
