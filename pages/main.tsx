import {useState,useRef,useEffect,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {LoaderCircle,LogOut,RefreshCw,Cloud,Lock} from 'lucide-react';
import Workspace from '../app/workspace';
import ThemeToggle from './theme';
import './theme.css';
import {exportBackup,importBackup,legacyRecords,importRecords} from './local-api';
import {DriveWorkspace,activateWorkspace} from './drive-workspace';
import {pagesApi} from './google-api';
import {googleSnapshot,subscribeGoogle,prepareGoogle,connectGoogle,disconnectGoogle,signOutGoogle} from './google-auth';
import type {RecordItem} from '../lib/data';
import '../app/globals.css';
import './pages.css';

function Pages(){
 const google=useSyncExternalStore(subscribeGoogle,googleSnapshot,googleSnapshot);
 const [error,setError]=useState('');
 useEffect(()=>{void prepareGoogle();},[]);
 // A stable account key prevents a previous account's UI or draft from leaking.
 if(google.owner&&google.workspace)return <AccountWorkspace key={google.owner} owner={google.owner}/>;
 const working=google.phase==='loading'||google.phase==='connecting';
 function login(){setError('');connectGoogle('workspace').catch(e=>setError(e.message));}
 return <main className="pages-start"><div className="login-theme"><ThemeToggle/></div><div className="pages-start-card">
  <span className="pages-mark">a</span><p className="eyebrow">ARCY WORKSPACE</p>
  <h1>Satu akun. Workspace lu di mana pun.</h1>
  <p>Masuk dengan akun Google untuk membuka task, catatan, agenda, dan riwayat pencarian lu.</p>
  <div className="pages-login-info"><Cloud size={22}/><p>Isi workspace tersimpan privat di Google Drive akun lu. Pakai akun yang sama di browser lain untuk melanjutkan.</p></div>
  <button className="primary google-login" disabled={working||google.phase==='setup'} onClick={login}>
   {working?<LoaderCircle className="spin" size={20}/>:<span className="google-letter" aria-hidden="true">G</span>}
   {google.phase==='loading'?'Menyiapkan login…':google.phase==='connecting'?'Menunggu Google…':'Masuk dengan Google'}
  </button>
  {(error||google.error)&&<p role="alert">{error||google.error}</p>}
  {google.phase==='error'&&<button className="secondary" onClick={()=>location.reload()}>Muat ulang</button>}
  {google.phase==='setup'&&<p role="alert">Login belum dikonfigurasi oleh pemilik aplikasi.</p>}
  {google.owner&&!google.workspace&&<p role="alert">Izinkan penyimpanan data aplikasi di Google Drive untuk membuka workspace.</p>}
  <p className="pages-start-foot"><Lock size={13}/> Google menangani login. Password lu tidak diminta oleh Arcy.</p>
 </div></main>;
}
function AccountWorkspace({owner}:{owner:string}){
 const google=useSyncExternalStore(subscribeGoogle,googleSnapshot,googleSnapshot);
 const [storage]=useState(()=>new DriveWorkspace(owner));
 const sync=useSyncExternalStore(storage.subscribe,storage.snapshot,storage.snapshot);
 const [ready,setReady]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const [legacy,setLegacy]=useState<RecordItem[]>([]),[migration,setMigration]=useState(false);
 const file=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  let alive=true;activateWorkspace(storage);
  const refresh=()=>{if(document.visibilityState==='hidden'||storage.snapshot().phase==='syncing')return;storage.refresh().then(()=>{if(alive)setReady(true);}).catch(()=>{});};
  refresh();
  void legacyRecords().then(items=>{if(alive)setLegacy(items);}).catch(()=>{});
  const interval=setInterval(refresh,30000);
  const visible=()=>{if(document.visibilityState==='visible')refresh();};
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);document.addEventListener('visibilitychange',visible);
  const leave=(event:BeforeUnloadEvent)=>{if(storage.snapshot().writing){event.preventDefault();event.returnValue='';}};
  window.addEventListener('beforeunload',leave);
  return ()=>{alive=false;clearInterval(interval);window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);document.removeEventListener('visibilitychange',visible);window.removeEventListener('beforeunload',leave);activateWorkspace();storage.close();};
 },[storage]);
 async function download(){setBusy(true);try{const url=URL.createObjectURL(new Blob([await exportBackup()],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='arcy-backup-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}}
 const blocked=busy||sync.writing||google.phase==='connecting';
 const requireIdle=()=>{if(storage.snapshot().writing)throw new Error('Tunggu penyimpanan selesai, lalu coba lagi.');};
 const syncText=sync.phase==='loading'?'Memuat workspace…':sync.phase==='syncing'?'Menyinkronkan…':sync.phase==='error'?'Sinkronisasi belum berhasil':'Tersimpan di Google Drive';
 return <><div className="pages-banner"><div className="pages-account"><strong>{google.email}</strong><span role="status">{syncText}</span></div><div className="pages-backup"><ThemeToggle/>
  <button disabled={blocked||sync.phase==='syncing'} onClick={()=>storage.refresh().then(()=>setReady(true)).catch(()=>{})}><RefreshCw size={14}/>Sinkronkan</button>
  <button disabled={blocked||!ready} onClick={download}>Export backup</button>
  <button disabled={blocked||!ready} onClick={()=>file.current?.click()}>Import backup</button>
  <button disabled={blocked} onClick={()=>{try{signOutGoogle();}catch(e){setStatus((e as Error).message);}}}><LogOut size={14}/>Keluar</button>
  <input ref={file} type="file" accept=".json,application/json" hidden onChange={async e=>{const input=e.target,f=input.files?.[0];if(!f)return;if(f.size>30_000_000){setStatus('Backup terlalu besar. Maksimal 30 MB.');input.value='';return;}setBusy(true);try{const count=await importBackup(await f.text());setStatus(count+' item diimpor ke akun '+google.email+'.');}catch(error){setStatus((error as Error).message);}finally{setBusy(false);input.value='';}}}/>
 </div></div>
 {(status||sync.error)&&<div className="pages-status" role="alert">{status||sync.error}{status&&<button aria-label="Tutup pemberitahuan" onClick={()=>setStatus('')}>×</button>}</div>}
 {ready&&legacy.length>0&&<div className="pages-migration"><span>{legacy.length} item dari workspace lokal lama tersedia di browser ini.</span><button disabled={blocked} onClick={()=>setMigration(true)}>Pindahkan ke akun ini</button></div>}
 {migration&&<div className="pages-migration"><p>Salin {legacy.length} item lokal ke <strong>{google.email}</strong>? Data lokal lama tetap ada. Sumber Google dari akun lain tidak akan diimpor.</p><button disabled={blocked} onClick={async()=>{setBusy(true);try{const matching=legacy.filter(r=>!r.meta.googleAccount||r.meta.googleAccount===owner);const count=await importRecords(matching);setStatus(count+' item disimpan di akun '+google.email+'.');setMigration(false);setLegacy([]);}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}}}>Ya, salin ke akun ini</button><button disabled={blocked} onClick={()=>setMigration(false)}>Batal</button></div>}
 {ready?<Workspace request={pagesApi} cloudMode refreshRevision={sync.revision} accountName={google.email.split('@')[0]} googleControls={{state:google,connect:permission=>{requireIdle();return connectGoogle(permission);},disconnect:()=>{requireIdle();return disconnectGoogle();}}}/>:<main className="pages-loading"><Cloud size={30}/><h1>{sync.phase==='error'?'Workspace belum bisa dimuat':'Memuat workspace lu…'}</h1><p>{sync.phase==='error'?'Periksa koneksi dan izin Google, lalu klik Sinkronkan.':'Mengambil data dari Google Drive akun ini.'}</p></main>}
 </>;
}
createRoot(document.getElementById('root')!).render(<Pages/>);
