import {useState,useEffect,useSyncExternalStore} from 'react';
import {createRoot} from 'react-dom/client';
import {LoaderCircle,LogOut,RefreshCw,Cloud,Lock} from 'lucide-react';
import Workspace from '../app/workspace';
import ThemeToggle from './theme';
import './theme.css';
import {legacyRecords,importRecords} from './local-api';
import {DriveWorkspace,activateWorkspace} from './drive-workspace';
import {pagesApi} from './google-api';
import {googleSnapshot,subscribeGoogle,prepareGoogle,connectGoogle,disconnectGoogle,signOutGoogle} from './google-auth';
import type {RecordItem} from '../lib/data';
import '../app/globals.css';
import './pages.css';
import './refinement.css';

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
  <h1>One account. Your workspace, anywhere.</h1>
  <p>Sign in with Google to open your tasks, notes, calendar, and search history.</p>
  <div className="pages-login-info"><Cloud size={22}/><p>Your workspace is saved privately in Google Drive. Use the same account in any browser to pick up where you left off.</p></div>
  <button className="primary google-login" disabled={working||google.phase==='setup'} onClick={login}>
   {working?<LoaderCircle className="spin" size={20}/>:<span className="google-letter" aria-hidden="true">G</span>}
   {google.phase==='loading'?'Preparing sign-in…':google.phase==='connecting'?'Waiting for Google…':'Sign in with Google'}
  </button>
  {(error||google.error)&&<p role="alert">{error||google.error}</p>}
  {google.phase==='error'&&<button className="secondary" onClick={()=>location.reload()}>Reload</button>}
  {google.phase==='setup'&&<p role="alert">Sign-in has not been configured by the app owner.</p>}
  {google.owner&&!google.workspace&&<p role="alert">Allow app data storage in Google Drive to open your workspace.</p>}
  <p className="pages-start-foot"><Lock size={13}/> Google handles sign-in. Arcy never asks for your password.</p>
 </div></main>;
}
function AccountWorkspace({owner}:{owner:string}){
 const google=useSyncExternalStore(subscribeGoogle,googleSnapshot,googleSnapshot);
 const [storage]=useState(()=>new DriveWorkspace(owner));
 const sync=useSyncExternalStore(storage.subscribe,storage.snapshot,storage.snapshot);
 const [ready,setReady]=useState(false),[status,setStatus]=useState(''),[busy,setBusy]=useState(false);
 const [legacy,setLegacy]=useState<RecordItem[]>([]),[migration,setMigration]=useState(false);
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
 const blocked=busy||sync.writing||google.phase==='connecting';
 const requireIdle=()=>{if(storage.snapshot().writing)throw new Error('Wait for saving to finish, then try again.');};
 const syncText=sync.phase==='loading'?'Loading workspace…':sync.phase==='syncing'?'Syncing…':sync.phase==='error'?'Sync failed':'Saved to Google Drive';
 const accountControls=<div className="account-controls"><div className="account-sync"><Cloud size={15}/><span role="status">{syncText}</span></div><ThemeToggle/>
  <button disabled={blocked||sync.phase==='syncing'} onClick={()=>storage.refresh().then(()=>setReady(true)).catch(()=>{})}><RefreshCw size={16} className={sync.phase==='syncing'?'spin':''}/>Sync now</button>
  <button disabled={blocked} onClick={()=>{try{signOutGoogle();}catch(e){setStatus((e as Error).message);}}}><LogOut size={16}/>Sign out</button>
 </div>;
 return <>
 {(status||sync.error)&&<div className="pages-status" role="alert">{status||sync.error}{status&&<button aria-label="Dismiss notification" onClick={()=>setStatus('')}>×</button>}</div>}
 {ready&&legacy.length>0&&<div className="pages-migration"><span>{legacy.length} items from your old local workspace are available in this browser.</span><button disabled={blocked} onClick={()=>setMigration(true)}>Move to this account</button></div>}
 {migration&&<div className="pages-migration"><p>Copy {legacy.length} local items to <strong>{google.email}</strong>? Your original local data stays intact. Sources from other Google accounts will be skipped.</p><button disabled={blocked} onClick={async()=>{setBusy(true);try{const matching=legacy.filter(r=>!r.meta.googleAccount||r.meta.googleAccount===owner);const count=await importRecords(matching);setStatus(count+' items saved to account '+google.email+'.');setMigration(false);setLegacy([]);}catch(e){setStatus((e as Error).message);}finally{setBusy(false);}}}>Yes, copy to this account</button><button disabled={blocked} onClick={()=>setMigration(false)}>Cancel</button></div>}
 {ready?<Workspace accountControls={accountControls} request={pagesApi} cloudMode refreshRevision={sync.revision} accountName={google.email.split('@')[0]} googleControls={{state:google,connect:permission=>{requireIdle();return connectGoogle(permission);},disconnect:()=>{requireIdle();return disconnectGoogle();}}}/>:<main className="pages-loading">{accountControls}<Cloud size={30}/><h1>{sync.phase==='error'?'Unable to load workspace':'Loading your workspace…'}</h1><p>{sync.phase==='error'?'Check your connection and Google permissions, then select Sync now.':'Fetching this account’s data from Google Drive.'}</p></main>}
 </>;
}
createRoot(document.getElementById('root')!).render(<Pages/>);
