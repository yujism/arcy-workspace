import {recordSchema as schema,MAX_RECORDS} from './record-schema';
import {workspaceStorage} from './drive-workspace';
import type {RecordItem} from '../lib/data';

export async function allRecords(){return workspaceStorage().records();}
export async function saveGoogleRecords(items:RecordItem[],assertCurrent:()=>void,calendarOwner?:string){
 const storage=workspaceStorage();
 for(const item of items){schema.parse(item);if(item.meta.googleAccount!==storage.owner)throw new Error('This Google source belongs to another account.');}
 await storage.mutate(records=>{
  const imported=new Set(items.map(r=>r.id));
  const removed=calendarOwner?records.filter(r=>r.kind==='event'&&r.meta.source==='Google Calendar'&&r.meta.googleAccount===calendarOwner&&!imported.has(r.id)):[];
  return [...removed.map(r=>({id:r.id,value:null})),...items.map(value=>({id:value.id,value}))];
 },assertCurrent);
}
export async function localApi(path:string,body?:any,method='POST'){
 const storage=workspaceStorage();
 if(path==='/api/workspace'){
  let ai=false;
  if(body===undefined && typeof window!=='undefined' && !window.location.hostname.endsWith('github.io')){
   try{const response=await fetch('/api/auth/ai-status',{method:'POST',credentials:'same-origin',headers:{'X-Arcy-Request':'1'},signal:AbortSignal.timeout(10000)});if(response.ok)ai=((await response.json()) as {configured?:boolean}).configured===true;}catch{}
  }
  if(body===undefined)return {items:storage.records(),user:{id:storage.owner,name:'Google account'},connections:{google:false,ai},now:new Date().toISOString()};
  if(method==='DELETE'){
   if(typeof body.id!=='string')throw new Error('Invalid item.');
   await storage.mutate(records=>{
    const existing=records.find(r=>r.id===body.id);
    if(existing&&body.expectedUpdated&&existing.updated!==body.expectedUpdated)throw new Error('This item changed in another browser. Review the latest version before deleting.');
    return existing?[{id:body.id,value:null}]:[];
   });return {ok:true};
  }
  if(!['task','note','event'].includes(body.kind)||typeof body.title!=='string'||!body.title.trim()||body.title.length>250)throw new Error('Enter a valid title, up to 250 characters.');
  if(body.kind==='event'&&(!Number.isFinite(Date.parse(body.meta?.start))||!Number.isFinite(Date.parse(body.meta?.end))||Date.parse(body.meta.end)<=Date.parse(body.meta.start)))throw new Error('The end time must be after the start time.');
  let item:RecordItem;
  const id=body.id||crypto.randomUUID();
  await storage.mutate(records=>{
   const existing=records.find(r=>r.id===id);
   if(body.id&&(!existing||existing.kind!==body.kind))throw new Error('This item was deleted or its type changed in another browser.');
   if(existing&&body.expectedUpdated&&existing.updated!==body.expectedUpdated)throw new Error('This item changed in another browser. Copy your draft, then reopen the latest version.');
   const updated=new Date(Math.max(Date.now(),existing?Date.parse(existing.updated)+1:0)).toISOString();
   item=schema.parse({id,kind:body.kind,title:body.title.trim(),body:body.body||'',meta:body.meta||{},updated}) as RecordItem;
   return [{id,value:item}];
  });return {item:item!};
 }
 if(path==='/api/ask'){
  const question=typeof body?.question==='string'?body.question.trim():'';if(!question||question.length>3000)throw new Error('Enter a question, up to 3,000 characters.');
  const terms=question.toLowerCase().split(/\W+/).filter((t:string)=>t.length>2&&!['yang','gua','dan','apa','hari','ini','the','for'].includes(t));
  const brief=/brief|today|hari ini|agenda|follow.up/i.test(question);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  const all=storage.records();if(all.length>=MAX_RECORDS)throw new Error('The 5,000-item limit has been reached. Remove unneeded items to continue.');
  const sources=all.filter(x=>x.kind!=='message').map(x=>({x,score:terms.reduce((n:number,t:string)=>n+(x.title.toLowerCase().includes(t)?4:0)+(x.body.toLowerCase().includes(t)?1:0),0)+(brief&&((x.kind==='task'&&x.meta.status!=='done')||(x.kind==='event'&&x.meta.start&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date(x.meta.start))===today))?3:0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(({x},i)=>({id:x.id,number:i+1,title:x.title,excerpt:x.body.slice(0,700),kind:x.kind,meta:x.meta}));
  let mode='search';
  let answer=sources.length?'Found '+sources.length+' sources in your workspace. These are text search results.\n\n'+sources.map(s=>`[${s.number}] ${s.title}\n${s.excerpt||JSON.stringify(s.meta)}`).join('\n\n'):'No matching sources yet. Add notes, tasks, or Google sources, then try again.';
  if(sources.length && typeof window!=='undefined' && !window.location.hostname.endsWith('github.io')){
   const response=await fetch('/api/auth/ai',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Arcy-Request':'1'},body:JSON.stringify({question,sources}),signal:AbortSignal.timeout(50000)});
   const data=await response.json() as {answer?:unknown;error?:string};
   if(!response.ok)throw new Error(data.error||'Gemini could not answer. Try again.');
   if(typeof data.answer!=='string'||!data.answer.trim())throw new Error('Gemini returned no answer.');
   answer=data.answer;mode='ai';
  }
  const item={id:crypto.randomUUID(),kind:'message',title:question,body:answer,meta:{sources,mode},updated:new Date().toISOString()};await storage.mutate(records=>{if(records.length>=MAX_RECORDS)throw new Error('The 5,000-item limit has been reached.');return [{id:item.id,value:item}];});return {item};
 }
 throw new Error('This feature is not available yet.');
}
export async function exportBackup(){return JSON.stringify({format:'arcy-local-backup',version:1,exportedAt:new Date().toISOString(),records:await allRecords()},null,2);}
export function parseBackup(text:string):RecordItem[]{
 let data:any;try{data=JSON.parse(text)}catch{throw new Error('The file is not valid JSON.');}
 if(data?.format!=='arcy-local-backup'||data.version!==1||!Array.isArray(data.records)||data.records.length>MAX_RECORDS)throw new Error('Invalid Arcy backup format.');
 return data.records.map((r:unknown)=>{
  const result=schema.safeParse(r);if(!result.success)throw new Error('The backup contains an invalid item.');
  const item=result.data as RecordItem;
  if(item.meta.url&&(typeof item.meta.url!=='string'||!/^https:\/\//.test(item.meta.url)))throw new Error('The backup contains an unsafe source URL.');
  if(item.kind==='event'&&(!Number.isFinite(Date.parse(item.meta.start))||!Number.isFinite(Date.parse(item.meta.end))))throw new Error('Invalid event date in backup.');
  return item;
 });
}
export async function importRecords(records:RecordItem[]){
 const storage=workspaceStorage();let count=0;
 for(const r of records){schema.parse(r);if(r.meta.googleAccount&&r.meta.googleAccount!==storage.owner)throw new Error('The backup contains sources from another Google account. Sign in with that account.');}
 await storage.mutate(current=>{
  const ids=new Set(current.map(r=>r.id));
  const fresh=records.filter(r=>{if(ids.has(r.id))return false;ids.add(r.id);return true;});
  count=fresh.length;return fresh.map(value=>({id:value.id,value}));
 });return count;
}
export async function importBackup(text:string){return importRecords(parseBackup(text));}

// Read-only migration path: the old browser database is never cleared or reassigned.
export async function legacyRecords():Promise<RecordItem[]>{
 return new Promise((resolve,reject)=>{
  const request=indexedDB.open('arcy-workspace-local-v1',1);
  request.onupgradeneeded=()=>{request.result.createObjectStore('records',{keyPath:'id'});};
  request.onerror=()=>reject(new Error('Unable to read old local data.'));
  request.onblocked=()=>reject(new Error('Close older Arcy tabs to read local data.'));
  request.onsuccess=()=>{
   const db=request.result;const tx=db.transaction('records','readonly');const read=tx.objectStore('records').getAll();
   read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=()=>{db.close();reject(new Error('Unable to read local data.'));};
  };
 });
}
