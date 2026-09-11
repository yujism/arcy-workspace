import {z} from 'zod';
import type {RecordItem} from '../lib/data';
const MAX_RECORDS=5000;
const schema=z.object({id:z.string().min(1).max(200),kind:z.enum(['task','note','event','message']),title:z.string().trim().min(1).max(3000),body:z.string().max(100000),meta:z.record(z.unknown()),updated:z.string().datetime()});
let connection:Promise<IDBDatabase>|undefined;
function database(){if(!connection)connection=new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open('arcy-workspace-local-v1',1);r.onupgradeneeded=()=>{r.result.createObjectStore('records',{keyPath:'id'})};r.onsuccess=()=>{r.result.onversionchange=()=>{r.result.close();connection=undefined};resolve(r.result)};r.onerror=()=>{connection=undefined;reject(new Error('Penyimpanan browser tidak tersedia. Gunakan mode browser biasa dan izinkan penyimpanan situs.'))};r.onblocked=()=>reject(new Error('Tutup tab Arcy lain lalu coba lagi.'))});return connection;}
async function transaction<T>(mode:IDBTransactionMode,operation:(store:IDBObjectStore)=>IDBRequest<T>){const db=await database();return new Promise<T>((resolve,reject)=>{const tx=db.transaction('records',mode);const request=operation(tx.objectStore('records'));let result:T;request.onsuccess=()=>{result=request.result};tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(new Error('Perubahan belum tersimpan. Ruang penyimpanan browser mungkin penuh.'));tx.onerror=()=>reject(new Error('Penyimpanan gagal. Input lu belum dihapus.'));});}
export async function allRecords(){return (await transaction<RecordItem[]>('readonly',store=>store.getAll())).sort((a,b)=>b.updated.localeCompare(a.updated));}
async function put(item:RecordItem){schema.parse(item);await transaction('readwrite',store=>store.put(item));}
// Replace a Calendar snapshot only after every API page succeeded. The transaction
// keeps existing records intact when capacity, validation, or authorization fails.
export async function saveGoogleRecords(items:RecordItem[],assertCurrent:()=>void,calendarOwner?:string){
 for(const item of items)schema.parse(item);
 const db=await database();assertCurrent();
 await new Promise<void>((resolve,reject)=>{
  const tx=db.transaction('records','readwrite'),store=tx.objectStore('records');
  let failure:unknown;
  const current=store.getAll();
  current.onsuccess=()=>{try{
   assertCurrent();
   const existing=current.result as RecordItem[];
   const removed=calendarOwner?existing.filter(r=>r.kind==='event'&&r.meta.source==='Google Calendar'&&r.meta.googleAccount===calendarOwner):[];
   const removedIds=new Set(removed.map(r=>r.id));
   const ids=new Set(existing.filter(r=>!removedIds.has(r.id)).map(r=>r.id));
   for(const item of items)ids.add(item.id);
   if(ids.size>MAX_RECORDS)throw new Error('Impor melebihi batas 5.000 item. Data sebelumnya tetap ada.');
   for(const item of removed)store.delete(item.id);
   for(const item of items)store.put(item);
  }catch(error){failure=error;tx.abort();}};
  tx.oncomplete=()=>resolve();
  tx.onabort=()=>reject(failure||new Error('Impor gagal. Data sebelumnya tetap ada.'));
  tx.onerror=()=>reject(new Error('Penyimpanan impor gagal.'));
 });
}
export async function localApi(path:string,body?:any,method='POST'){
 if(path==='/api/workspace'){
  if(body===undefined)return {items:await allRecords(),user:{id:'local-browser',name:'Yuji'},connections:{google:false,ai:false},now:new Date().toISOString()};
  if(method==='DELETE'){if(typeof body.id!=='string')throw new Error('Item tidak valid.');await transaction('readwrite',store=>store.delete(body.id));return {ok:true};}
  if(!['task','note','event'].includes(body.kind)||typeof body.title!=='string'||!body.title.trim()||body.title.length>250)throw new Error('Isi judul yang valid, maksimal 250 karakter.');
  const existing=body.id?await transaction<RecordItem|undefined>('readonly',store=>store.get(body.id)):undefined;
  if(body.id&&(!existing||existing.kind!==body.kind))throw new Error('Item tidak ditemukan atau jenis item berubah.');
  if(body.kind==='event'&&(!Number.isFinite(Date.parse(body.meta?.start))||!Number.isFinite(Date.parse(body.meta?.end))||Date.parse(body.meta.end)<=Date.parse(body.meta.start)))throw new Error('Waktu selesai harus setelah waktu mulai.');
  if(!existing&&(await allRecords()).length>=MAX_RECORDS)throw new Error('Batas 5.000 item tercapai. Ekspor backup sebelum membersihkan data.');
  const item={id:body.id||crypto.randomUUID(),kind:body.kind,title:body.title.trim(),body:body.body||'',meta:body.meta||{},updated:new Date().toISOString()};
  await put(item);return {item};
 }
 if(path==='/api/ask'){
  const question=typeof body?.question==='string'?body.question.trim():'';if(!question||question.length>3000)throw new Error('Isi pertanyaan, maksimal 3.000 karakter.');
  const terms=question.toLowerCase().split(/\W+/).filter((t:string)=>t.length>2&&!['yang','gua','dan','apa','hari','ini','the','for'].includes(t));
  const brief=/brief|today|hari ini|agenda|follow.up/i.test(question);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date());
  const all=await allRecords();if(all.length>=MAX_RECORDS)throw new Error('Batas 5.000 item tercapai. Ekspor backup sebelum membersihkan data.');
  const sources=all.filter(x=>x.kind!=='message').map(x=>({x,score:terms.reduce((n:number,t:string)=>n+(x.title.toLowerCase().includes(t)?4:0)+(x.body.toLowerCase().includes(t)?1:0),0)+(brief&&((x.kind==='task'&&x.meta.status!=='done')||(x.kind==='event'&&x.meta.start&&new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date(x.meta.start))===today))?3:0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,8).map(({x},i)=>({id:x.id,number:i+1,title:x.title,excerpt:x.body.slice(0,700),kind:x.kind,meta:x.meta}));
  const answer=sources.length?'Gua nemuin '+sources.length+' sumber di browser ini. Ini pencarian teks, bukan jawaban model AI.\n\n'+sources.map(s=>`[${s.number}] ${s.title}\n${s.excerpt||JSON.stringify(s.meta)}`).join('\n\n'):'Belum ada sumber yang cocok di browser ini. Tambahkan catatan, task, atau impor sumber Google lalu coba lagi.';
  const item={id:crypto.randomUUID(),kind:'message',title:question,body:answer,meta:{sources,mode:'search'},updated:new Date().toISOString()};await put(item);return {item};
 }
 throw new Error('Integrasi Google dan AI memerlukan backend. Fitur ini tidak aktif di GitHub Pages.');
}
export async function exportBackup(){return JSON.stringify({format:'arcy-local-backup',version:1,exportedAt:new Date().toISOString(),records:await allRecords()},null,2);}
export async function importBackup(text:string){
 let data:any;try{data=JSON.parse(text)}catch{throw new Error('File bukan JSON yang valid.');}
 if(data?.format!=='arcy-local-backup'||data.version!==1||!Array.isArray(data.records)||data.records.length>MAX_RECORDS)throw new Error('Format backup Arcy tidak valid.');
 const records=data.records.map((r:unknown)=>{const result=schema.safeParse(r);if(!result.success)throw new Error('Backup berisi item yang tidak valid.');const item=result.data as RecordItem;if(item.meta.url&&(typeof item.meta.url!=='string'||!/^https:\/\//.test(item.meta.url)))throw new Error('Backup berisi URL sumber yang tidak aman.');if(item.kind==='event'&&(!Number.isFinite(Date.parse(item.meta.start))||!Number.isFinite(Date.parse(item.meta.end))))throw new Error('Tanggal agenda dalam backup tidak valid.');return item;});
 const ids=new Set((await allRecords()).map(r=>r.id));const fresh=records.filter((r:RecordItem)=>{if(ids.has(r.id))return false;ids.add(r.id);return true});if(ids.size>MAX_RECORDS)throw new Error('Backup melebihi batas 5.000 item.');
 const db=await database();await new Promise<void>((resolve,reject)=>{const tx=db.transaction('records','readwrite');for(const item of fresh)tx.objectStore('records').add(item);tx.oncomplete=()=>resolve();tx.onabort=()=>reject(new Error('Impor gagal; data lama tetap ada.'));tx.onerror=()=>reject(new Error('Impor gagal; data lama tetap ada.'));});return fresh.length;
}
