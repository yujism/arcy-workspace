import {recordSchema as schema,MAX_RECORDS} from './record-schema';
import {workspaceStorage} from './drive-workspace';
import type {RecordItem} from '../lib/data';

export async function allRecords(){return workspaceStorage().records();}
export async function saveGoogleRecords(items:RecordItem[],assertCurrent:()=>void,calendarOwner?:string){
 const storage=workspaceStorage();
 for(const item of items){schema.parse(item);if(item.meta.googleAccount!==storage.owner)throw new Error('Sumber Google berasal dari akun lain.');}
 await storage.mutate(records=>{
  const imported=new Set(items.map(r=>r.id));
  const removed=calendarOwner?records.filter(r=>r.kind==='event'&&r.meta.source==='Google Calendar'&&r.meta.googleAccount===calendarOwner&&!imported.has(r.id)):[];
  return [...removed.map(r=>({id:r.id,value:null})),...items.map(value=>({id:value.id,value}))];
 },assertCurrent);
}
export async function localApi(path:string,body?:any,method='POST'){
 const storage=workspaceStorage();
 if(path==='/api/workspace'){
  if(body===undefined)return {items:storage.records(),user:{id:storage.owner,name:'Google account'},connections:{google:false,ai:false},now:new Date().toISOString()};
  if(method==='DELETE'){
   if(typeof body.id!=='string')throw new Error('Item tidak valid.');
   await storage.mutate(records=>{
    const existing=records.find(r=>r.id===body.id);
    if(existing&&body.expectedUpdated&&existing.updated!==body.expectedUpdated)throw new Error('Item berubah di browser lain. Periksa versi terbaru sebelum menghapus.');
    return existing?[{id:body.id,value:null}]:[];
   });return {ok:true};
  }
  if(!['task','note','event'].includes(body.kind)||typeof body.title!=='string'||!body.title.trim()||body.title.length>250)throw new Error('Isi judul yang valid, maksimal 250 karakter.');
  if(body.kind==='event'&&(!Number.isFinite(Date.parse(body.meta?.start))||!Number.isFinite(Date.parse(body.meta?.end))||Date.parse(body.meta.end)<=Date.parse(body.meta.start)))throw new Error('Waktu selesai harus setelah waktu mulai.');
  let item:RecordItem;
  const id=body.id||crypto.randomUUID();
  await storage.mutate(records=>{
   const existing=records.find(r=>r.id===id);
   if(body.id&&(!existing||existing.kind!==body.kind))throw new Error('Item sudah dihapus atau jenisnya berubah di browser lain.');
   if(existing&&body.expectedUpdated&&existing.updated!==body.expectedUpdated)throw new Error('Item berubah di browser lain. Salin draft lu, lalu buka ulang versi terbaru.');
   const updated=new Date(Math.max(Date.now(),existing?Date.parse(existing.updated)+1:0)).toISOString();
   item=schema.parse({id,kind:body.kind,title:body.title.trim(),body:body.body||'',meta:body.meta||{},updated}) as RecordItem;
   return [{id,value:item}];
  });return {item:item!};
 }
 if(path==='/api/ask'){
  const question=typeof body?.question==='string'?body.question.trim():'';if(!question||question.length>3000)throw new Error('Isi pertanyaan, maksimal 3.000 karakter.');
  const terms=question.toLowerCase().split(/\W+/).filter((t:string)=>t.length>2&&!['yang','gua','dan','apa','hari','ini','the','for'].includes(t));
  const brief=/brief|today|hari ini|agenda|follow.up/i.test(question);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  const all=storage.records();if(all.length>=MAX_RECORDS)throw new Error('Batas 5.000 item tercapai. Ekspor backup sebelum membersihkan data.');
  const sources=all.filter(x=>x.kind!=='message').map(x=>({x,score:terms.reduce((n:number,t:string)=>n+(x.title.toLowerCase().includes(t)?4:0)+(x.body.toLowerCase().includes(t)?1:0),0)+(brief&&((x.kind==='task'&&x.meta.status!=='done')||(x.kind==='event'&&x.meta.start&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date(x.meta.start))===today))?3:0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(({x},i)=>({id:x.id,number:i+1,title:x.title,excerpt:x.body.slice(0,700),kind:x.kind,meta:x.meta}));
  const answer=sources.length?'Gua nemuin '+sources.length+' sumber di workspace akun ini. Ini pencarian teks, bukan jawaban model AI.\n\n'+sources.map(s=>`[${s.number}] ${s.title}\n${s.excerpt||JSON.stringify(s.meta)}`).join('\n\n'):'Belum ada sumber yang cocok di workspace akun ini. Tambahkan catatan, task, atau impor sumber Google lalu coba lagi.';
  const item={id:crypto.randomUUID(),kind:'message',title:question,body:answer,meta:{sources,mode:'search'},updated:new Date().toISOString()};await storage.mutate(records=>{if(records.length>=MAX_RECORDS)throw new Error('Batas 5.000 item tercapai.');return [{id:item.id,value:item}];});return {item};
 }
 throw new Error('Fitur ini belum tersedia.');
}
export async function exportBackup(){return JSON.stringify({format:'arcy-local-backup',version:1,exportedAt:new Date().toISOString(),records:await allRecords()},null,2);}
export function parseBackup(text:string):RecordItem[]{
 let data:any;try{data=JSON.parse(text)}catch{throw new Error('File bukan JSON yang valid.');}
 if(data?.format!=='arcy-local-backup'||data.version!==1||!Array.isArray(data.records)||data.records.length>MAX_RECORDS)throw new Error('Format backup Arcy tidak valid.');
 return data.records.map((r:unknown)=>{
  const result=schema.safeParse(r);if(!result.success)throw new Error('Backup berisi item yang tidak valid.');
  const item=result.data as RecordItem;
  if(item.meta.url&&(typeof item.meta.url!=='string'||!/^https:\/\//.test(item.meta.url)))throw new Error('Backup berisi URL sumber yang tidak aman.');
  if(item.kind==='event'&&(!Number.isFinite(Date.parse(item.meta.start))||!Number.isFinite(Date.parse(item.meta.end))))throw new Error('Tanggal agenda dalam backup tidak valid.');
  return item;
 });
}
export async function importRecords(records:RecordItem[]){
 const storage=workspaceStorage();let count=0;
 for(const r of records){schema.parse(r);if(r.meta.googleAccount&&r.meta.googleAccount!==storage.owner)throw new Error('Backup memuat sumber Google akun lain. Masuk dengan akun pemilik sumber tersebut.');}
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
  request.onerror=()=>reject(new Error('Data lokal lama belum bisa dibaca.'));
  request.onblocked=()=>reject(new Error('Tutup tab Arcy lama untuk membaca data lokal.'));
  request.onsuccess=()=>{
   const db=request.result;const tx=db.transaction('records','readonly');const read=tx.objectStore('records').getAll();
   read.onsuccess=()=>{db.close();resolve(read.result);};read.onerror=()=>{db.close();reject(new Error('Gagal membaca data lokal.'));};
  };
 });
}
