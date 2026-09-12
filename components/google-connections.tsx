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
    {key:'drive',name:'Google Drive',letter:'D',cls:'drive',description:'Cari Google Docs dan impor dokumen pilihan ke Knowledge.',action:'Browse documents',open:browse},
    {key:'sheets',name:'Google Sheets',letter:'S',cls:'sheets',description:'Baca range spreadsheet. Data spreadsheet asli tetap sama.',action:'Import a range',open:browse},
    {key:'calendar',name:'Google Calendar',letter:'C',cls:'cal',description:'Ambil agenda kalender utama: 30 hari lalu hingga 6 bulan ke depan.',action:'Sync calendar',open:sync},
  ];
  return <>
    <section className="panel google-account" aria-label="Koneksi akun Google">
      <div><h2>{connected?'Google terhubung':'Connect Google'}</h2><p>{connected?state.email:'Pilih akun Google, lalu izinkan layanan yang mau lu pakai.'}</p></div>
      <div className="button-group">
        <button className="primary" disabled={!available} onClick={()=>run(()=>connect('all'))}>
          {working?<LoaderCircle size={17} className="spin"/>:<Plug size={17}/>}
          {state.phase==='connecting'?'Menghubungkan…':state.phase==='loading'?'Menyiapkan…':connected?'Kelola izin Google':'Connect Google'}
        </button>
        {connected&&<button className="secondary" disabled={working} onClick={()=>run(disconnect)}><Unplug size={16}/>Disconnect</button>}
      </div>
      {state.phase==='setup'&&<p className="google-setup" role="status">Koneksi belum aktif: pendaftaran Arcy ke Google perlu diselesaikan sekali oleh pemilik aplikasi. Setelah aktif, lu cukup klik Connect Google tanpa mengisi kredensial.</p>}
      {state.error&&<p className="google-setup" role="status">{state.error}</p>}
      <p className="google-footnote">Google meminta izin lewat jendelanya sendiri. Arcy tidak meminta password Google. Isi workspace tersimpan di Google Drive akun lu. Disconnect mencabut akses dan menutup workspace; data di Drive tetap ada. Login lagi setelah memuat ulang halaman. <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">Kelola akses di Google</a></p>
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

