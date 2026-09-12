import {z} from 'zod';
import {googleSession} from './google-auth';
import {recordSchema, MAX_RECORDS} from './record-schema';
import type {RecordItem} from '../lib/data';

const FILES = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id';
const MARKER = 'arcy-workspace-op-v1';
const MAX_BYTES = 4_000_000;
const operationSchema = z.object({
  format:z.literal(MARKER), owner:z.string().min(1), id:z.string().uuid(),
  clock:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1),
  changes:z.array(z.object({id:z.string().min(1).max(200), value:recordSchema.nullable()})).max(10000),
});
type Operation = z.infer<typeof operationSchema>;
export type Change = {id:string; value:RecordItem|null};
type Session = ReturnType<typeof googleSession>;
export type SyncState = {phase:'loading'|'syncing'|'ready'|'error'; error:string; revision:number; lastSync:string; writing:boolean};

// Immutable operation files avoid whole-workspace overwrites when two browsers save.
// The logical clock and operation UUID define the same order on every device.
// Deletions stay in the journal so stale clients cannot restore deleted records.
export class DriveWorkspace {
  readonly owner:string;
  private alive = true;
  private operations = new Map<string,Operation>();
  private items = new Map<string,RecordItem>();
  private clock = 0;
  private queue:Promise<unknown> = Promise.resolve();
  private listeners = new Set<()=>void>();
  private state:SyncState = {phase:'loading',error:'',revision:0,lastSync:'',writing:false};
  private pending?:{fileId:string; operation:Operation};
  constructor(owner:string, private sessionProvider:()=>Session = ()=>googleSession('workspace')) {this.owner=owner;}
  snapshot = () => this.state;
  subscribe = (fn:()=>void) => {this.listeners.add(fn);return ()=>{this.listeners.delete(fn);};};
  private update(patch:Partial<SyncState>) {this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  close() {this.alive=false;this.items.clear();this.operations.clear();this.listeners.clear();}
  private session() {
    if(!this.alive)throw new Error('Workspace sudah ditutup. Masuk lagi.');
    const session=this.sessionProvider();
    if(session.owner!==this.owner)throw new Error('Akun berubah. Buka workspace akun yang aktif.');
    const original=session.assertCurrent;
    return {...session,assertCurrent:()=>{original();if(!this.alive)throw new Error('Workspace sudah ditutup.');}};
  }
  private serial<T>(work:()=>Promise<T>):Promise<T> {
    const next=this.queue.then(work,work);this.queue=next.catch(()=>{});return next;
  }
  records() {this.session().assertCurrent();return structuredClone([...this.items.values()].sort((a,b)=>b.updated.localeCompare(a.updated)));}
  private rebuild(operations:Map<string,Operation>) {
    const items=new Map<string,RecordItem>();let clock=0;
    for(const op of [...operations.values()].sort((a,b)=>a.clock-b.clock||a.id.localeCompare(b.id))) {
      clock=Math.max(clock,op.clock);
      for(const change of op.changes) {if(change.value)items.set(change.id,change.value);else items.delete(change.id);}
    }
    return {items,clock};
  }
  private async readOperation(response:Response) {
    const text=await response.text();
    if(new TextEncoder().encode(text).length>MAX_BYTES)throw new Error('Data sinkronisasi terlalu besar. Workspace sebelumnya dipertahankan.');
    const op=operationSchema.parse(JSON.parse(text));
    if(op.owner!==this.owner||op.changes.some(c=>c.value&&c.id!==c.value.id))throw new Error('Data workspace tidak sesuai akun atau format.');
    return op;
  }
  private async pull(session:Session) {
    const next=new Map(this.operations);let pageToken='';let count=0;
    const seenTokens=new Set<string>();
    do {
      const params=new URLSearchParams({spaces:'appDataFolder',q:`trashed=false and appProperties has { key='arcyFormat' and value='${MARKER}' }`,pageSize:'1000',fields:'nextPageToken,incompleteSearch,files(id,size)'});
      if(pageToken)params.set('pageToken',pageToken);
      const page=z.object({files:z.array(z.object({id:z.string(),size:z.string().optional()})),nextPageToken:z.string().optional(),incompleteSearch:z.boolean().optional()}).parse(await (await session.request(FILES+'?'+params)).json());
      if(!Array.isArray(page.files)||page.incompleteSearch)throw new Error('Google belum mengirim workspace lengkap. Coba sinkronkan lagi.');
      count+=page.files.length;
      if(count>20000)throw new Error('Riwayat workspace melebihi kapasitas versi ini. Ekspor backup sebelum melanjutkan.');
      // A bounded batch limits simultaneous Drive requests. Commit only after all pages.
      const missing=page.files.filter((file:{id:string})=>!next.has(file.id));
      for(let i=0;i<missing.length;i+=5) {
        const batch=await Promise.all(missing.slice(i,i+5).map(async(file:{id:string;size?:string})=>{
          if(!/^[\w-]+$/.test(file.id)||Number(file.size)>MAX_BYTES)throw new Error('File sinkronisasi tidak valid atau terlalu besar.');
          const op=await this.readOperation(await session.request(FILES+'/'+file.id+'?alt=media'));
          session.assertCurrent();return [file.id,op] as const;
        }));
        for(const [id,op] of batch)next.set(id,op);
      }
      pageToken=page.nextPageToken||'';
      if(pageToken&&seenTokens.has(pageToken))throw new Error('Pagination Google berulang. Coba lagi.');
      seenTokens.add(pageToken);
    }while(pageToken);
    session.assertCurrent();
    const reduced=this.rebuild(next);
    this.operations=next;this.items=reduced.items;this.clock=reduced.clock;
    this.update({revision:this.state.revision+1,lastSync:new Date().toISOString()});
  }
  private async upload(session:Session, pending:{fileId:string;operation:Operation}) {
    const {fileId,operation}=pending;
    const boundary='arcy_'+operation.id;
    const metadata={id:fileId,name:MARKER+'-'+operation.id+'.json',mimeType:'application/json',parents:['appDataFolder'],appProperties:{arcyFormat:MARKER}};
    const body=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(operation)}\r\n--${boundary}--`;
    const response=await session.request(UPLOAD,{method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
    if(response.status===409) {
      const saved=await this.readOperation(await session.request(FILES+'/'+fileId+'?alt=media'));
      if(JSON.stringify(saved)!==JSON.stringify(operation))throw new Error('Konflik ID penyimpanan. Workspace belum diubah.');
    }else {
      const saved=z.object({id:z.string()}).parse(await response.json());
      if(saved.id!==fileId)throw new Error('Penyimpanan Google belum terkonfirmasi. Klik Sinkronkan.');
    }
    session.assertCurrent();
    this.operations.set(fileId,operation);
    const reduced=this.rebuild(this.operations);this.items=reduced.items;this.clock=reduced.clock;
    this.pending=undefined;
    this.update({revision:this.state.revision+1,lastSync:new Date().toISOString()});
  }
  refresh() {return this.serial(async()=>{
    try {
      const session=this.session();this.update({phase:'syncing',error:''});
      // Retry the exact same pre-generated ID after an ambiguous upload response.
      if(this.pending)await this.upload(session,this.pending);
      await this.pull(session);this.update({phase:'ready',error:''});
    }catch(error){this.update({phase:'error',error:(error as Error).message});throw error;}
  });}
  mutate(build:(records:RecordItem[])=>Change[],assertSource:()=>void=()=>{}) {return this.serial(async()=>{
    try {
      const session=this.session();assertSource();
      this.update({phase:'syncing',error:'',writing:true});
      if(this.pending) {
        await this.upload(session,this.pending);await this.pull(session);
        throw new Error('Penyimpanan sebelumnya sudah dipulihkan. Periksa hasilnya sebelum menyimpan perubahan baru.');
      }
      await this.pull(session);assertSource();
      const changes=build(this.records());
      if(!changes.length){this.update({phase:'ready'});return;}
      const projected=new Set(this.items.keys());
      for(const c of changes){if(c.value)projected.add(c.id);else projected.delete(c.id);}
      if(projected.size>MAX_RECORDS)throw new Error('Batas 5.000 item tercapai. Data sebelumnya tetap ada.');
      if(this.operations.size>=20000)throw new Error('Riwayat workspace penuh. Ekspor backup sebelum melanjutkan.');
      const operation=operationSchema.parse({format:MARKER,owner:this.owner,id:crypto.randomUUID(),clock:this.clock+1,changes});
      if(new TextEncoder().encode(JSON.stringify(operation)).length>MAX_BYTES)throw new Error('Perubahan terlalu besar. Impor bagian yang lebih kecil (maksimal 4 MB per penyimpanan).');
      const generated=z.object({ids:z.array(z.string())}).parse(await (await session.request(FILES+'/generateIds?count=1&space=appDataFolder&type=files')).json());
      const fileId=generated.ids?.[0];if(typeof fileId!=='string'||!/^[\w-]+$/.test(fileId))throw new Error('Google belum menyediakan ID penyimpanan. Coba lagi.');
      session.assertCurrent();assertSource();
      this.pending={fileId,operation};
      await this.upload(session,this.pending);
      this.update({phase:'ready',error:''});
    }catch(error){this.update({phase:'error',error:(error as Error).message});throw error;}
    finally{this.update({writing:false});}
  });}
}

let active:DriveWorkspace|undefined;
export function activateWorkspace(workspace?:DriveWorkspace) {active=workspace;}
export function workspaceStorage() {
  if(!active)throw new Error('Masuk dengan Google untuk membuka workspace.');
  active.records();return active;
}
