import {LoaderCircle, Plug, Unplug, ArrowUpRight} from 'lucide-react';
import {toast} from 'sonner';
import type {GoogleState, GooglePermission, GoogleService} from '../pages/google-auth';

export type GoogleControls = {
  state: GoogleState;
  connect: (permission?: GooglePermission) => Promise<void>;
  disconnect: () => Promise<void>;
};
export default function GoogleConnections({state,connect,disconnect,browse,sync,busy}:GoogleControls & {browse:()=>void;sync:()=>void;busy:boolean}) {
  const working = busy || state.phase === 'connecting' || state.phase === 'loading';
  const available = !working && !['setup','error'].includes(state.phase);
  const connected = state.phase === 'connected';
  const run = (operation:()=>Promise<void>) => {operation().catch(e=>toast.error(e.message));};
  const services: {key:GoogleService;name:string;letter:string;cls:string;description:string;action:string;open:()=>void}[] = [
    {key:'drive',name:'Google Drive',letter:'D',cls:'drive',description:'Find Google Docs and import selected documents into Knowledge.',action:'Browse documents',open:browse},
    {key:'sheets',name:'Google Sheets',letter:'S',cls:'sheets',description:'Read a spreadsheet range without changing the original data.',action:'Import a range',open:browse},
    {key:'calendar',name:'Google Calendar',letter:'C',cls:'cal',description:'Import primary calendar events from the past 30 days through the next 6 months.',action:'Sync calendar',open:sync},
  ];
  return <>
    <section className="panel google-account" aria-label="Google account connection">
      <div><h2>{connected?'Google connected':'Connect Google'}</h2><p>{connected?state.email:'Choose a Google account and authorize the services you want to use.'}</p></div>
      <div className="button-group">
        <button className="primary" disabled={!available} onClick={()=>run(()=>connect('all'))}>
          {working?<LoaderCircle size={17} className="spin"/>:<Plug size={17}/>}
          {state.phase==='connecting'?'Connecting…':state.phase==='loading'?'Preparing…':connected?'Manage Google permissions':'Connect Google'}
        </button>
        {connected&&<button className="secondary" disabled={working} onClick={()=>run(disconnect)}><Unplug size={16}/>Disconnect</button>}
      </div>
      {state.phase==='setup'&&<p className="google-setup" role="status">Google setup must be completed by the app owner. Once ready, select Connect Google to authorize access.</p>}
      {state.error&&<p className="google-setup" role="status">{state.error}</p>}
      <p className="google-footnote">Google handles authorization. Arcy never asks for your Google password. Your workspace is saved in Google Drive. Disconnect revokes access and closes the workspace, keeping your Drive data. Reload the page to sign in again. <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Manage access in Google</a></p>
    </section>
    <div className="connection-grid">{services.map(service=>{
      const hasAccess=state.services[service.key];
      return <section className="connection-card" key={service.key}>
        <div className="connection-card-top"><span className={'service-tile '+service.cls}>{service.letter}</span><span className={'connection-status '+(hasAccess?'ready':'')}>{hasAccess?'Connected':'Not connected'}</span></div>
        <h2>{service.name}</h2><p>{service.description}</p>
        <button className={hasAccess?'secondary':'primary'} disabled={!available} onClick={()=>hasAccess?service.open():run(()=>connect(service.key))}>{hasAccess?service.action:'Connect '+service.name}<ArrowUpRight size={15}/></button>
      </section>;
    })}</div>
  </>;
}

