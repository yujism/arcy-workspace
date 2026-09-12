import config from './google-config.json';

export type GoogleService = 'drive' | 'sheets' | 'calendar';
export type GooglePermission = GoogleService | 'calendarWrite' | 'workspace' | 'all';
const scope = {
  workspace: 'https://www.googleapis.com/auth/drive.appdata',
  drive: 'https://www.googleapis.com/auth/drive.readonly',
  sheets: 'https://www.googleapis.com/auth/spreadsheets.readonly',
  calendar: 'https://www.googleapis.com/auth/calendar.events.readonly',
  calendarWrite: 'https://www.googleapis.com/auth/calendar.events',
};
type TokenResponse = {access_token?: string; expires_in?: number; scope?: string; error?: string};
type OAuth = {
  initTokenClient(options: {
    client_id: string; scope: string; include_granted_scopes: boolean;
    callback: (response: TokenResponse) => void;
    error_callback: (error: {type: string}) => void;
  }): {requestAccessToken(options: {prompt: string; hint?: string}): void};
  revoke(token: string, callback: (result: {successful: boolean}) => void): void;
};
declare global {interface Window {google?: {accounts?: {oauth2?: OAuth}}}}
export type GoogleState = {
  phase: 'loading' | 'setup' | 'ready' | 'connecting' | 'connected' | 'expired' | 'error';
  email: string; owner: string; workspace: boolean; error: string; revision: number;
  services: Record<GoogleService, boolean>;
};
const emptyServices = () => ({drive: false, sheets: false, calendar: false});
let state: GoogleState = {phase: 'loading', email: '', owner: '', workspace: false, error: '', revision: 0, services: emptyServices()};
let token: {value: string; owner: string; expires: number; scopes: Set<string>} | undefined;
let generation = 0;
let expiry: ReturnType<typeof setTimeout> | undefined;
let preparation: Promise<void> | undefined;
let pending = false;
const listeners = new Set<() => void>();
export const googleSnapshot = () => state;
export function subscribeGoogle(listener: () => void) {listeners.add(listener); return () => {listeners.delete(listener);};}
function update(patch: Partial<GoogleState>) {state = {...state, ...patch, revision: state.revision + 1}; listeners.forEach(fn => fn());}
function clearSession(phase: GoogleState['phase'], error = '') {
  generation++; token = undefined; clearTimeout(expiry);
  update({phase, email: '', owner: '', workspace: false, services: emptyServices(), error});
}
export function prepareGoogle() {
  if (preparation) return preparation;
  preparation = (async () => {
    if (!/^\d+-[\w-]+\.apps\.googleusercontent\.com$/.test(config.clientId)) {
      update({phase: 'setup'}); return;
    }
    try {
      if (!window.google?.accounts?.oauth2) await new Promise<void>((resolve, reject) => {
        const script = document.createElement('script');
        const timer = setTimeout(() => {script.remove(); reject(new Error('Login Google belum berhasil dimuat. Muat ulang halaman dan periksa koneksi.'));}, 15000);
        script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
        script.onload = () => {clearTimeout(timer); resolve();};
        script.onerror = () => {clearTimeout(timer); script.remove(); reject(new Error('Login Google diblokir atau jaringan tidak tersedia. Muat ulang lalu coba lagi.'));};
        document.head.appendChild(script);
      });
      if (!window.google?.accounts?.oauth2) throw new Error('Login Google tidak tersedia. Muat ulang halaman.');
      update({phase: 'ready', error: ''});
    } catch (error) {update({phase: 'error', error: (error as Error).message});}
  })();
  return preparation;
}

// Called directly from a click: no awaited work before opening Google's popup.
export function connectGoogle(permission: GooglePermission = 'all'): Promise<void> {
  const oauth = window.google?.accounts?.oauth2;
  if (!config.clientId) return Promise.reject(new Error('Pendaftaran aplikasi ke Google belum selesai.'));
  if (!oauth) return Promise.reject(new Error('Login Google belum siap. Muat ulang halaman.'));
  if (pending) return Promise.reject(new Error('Selesaikan jendela Google yang sudah terbuka.'));
  pending = true;
  const run = ++generation;
  const requested = permission === 'all' ? [scope.workspace, scope.drive, scope.sheets, scope.calendar] : [scope[permission]];
  update({phase: 'connecting', error: ''});
  return new Promise<void>((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => fail('Login Google belum selesai. Coba hubungkan lagi.'), 120000);
    function fail(message: string) {
      if (done) return;
      done = true; clearTimeout(timer); pending = false;
      if (run === generation) update({phase: token && token.expires > Date.now() ? 'connected' : 'ready', error: message});
      reject(new Error(message));
    }
    try {
      const client = oauth.initTokenClient({
        client_id: config.clientId,
        scope: ['openid', 'https://www.googleapis.com/auth/userinfo.email', ...requested].join(' '),
        include_granted_scopes: true,
        error_callback: error => fail(error.type === 'popup_closed' ? 'Koneksi dibatalkan. Data lu tetap ada.' : 'Jendela Google tidak terbuka. Izinkan pop-up untuk Arcy lalu coba lagi.'),
        callback: async response => {
          if (done || run !== generation) return;
          if (response.error || !response.access_token) {fail('Izin Google belum diberikan. Lu bisa coba lagi.'); return;}
          try {
            const started = Date.now();
            const seconds = Number(response.expires_in);
            if (!Number.isFinite(seconds) || seconds <= 60) throw new Error('Sesi Google tidak valid. Hubungkan lagi.');
            const profileResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: {Authorization: 'Bearer ' + response.access_token}, signal: AbortSignal.timeout(15000),
            });
            if (!profileResponse.ok) throw new Error('Akun Google belum bisa diverifikasi. Hubungkan lagi.');
            const profile = await profileResponse.json() as {sub?: unknown; email?: unknown};
            if (typeof profile.sub !== 'string' || !profile.sub || typeof profile.email !== 'string') throw new Error('Izinkan akses identitas akun untuk menghubungkan Google.');
            if (done || run !== generation) return;
            if (token && token.owner !== profile.sub) throw new Error('Akun berbeda. Keluar terlebih dahulu untuk beralih akun.');
            const granted = new Set((response.scope || '').split(' '));
            const services = {
              drive: granted.has(scope.drive), sheets: granted.has(scope.sheets),
              calendar: granted.has(scope.calendar) || granted.has(scope.calendarWrite),
            };
            token = {value: response.access_token, owner: profile.sub, expires: started + (seconds - 30) * 1000, scopes: granted};
            clearTimeout(expiry);
            expiry = setTimeout(() => clearSession('expired', 'Sesi Google berakhir. Klik Connect Google untuk melanjutkan.'), Math.min(2147483647, token.expires - Date.now()));
            const missing = requested.some(s => !granted.has(s) && !(s === scope.calendar && granted.has(scope.calendarWrite)));
            update({phase: 'connected', email: profile.email, owner: profile.sub, workspace: granted.has(scope.workspace), services, error: missing ? 'Sebagian izin belum diberikan. Hubungkan layanan yang ingin lu pakai.' : ''});
            done = true; clearTimeout(timer); pending = false; resolve();
          } catch (error) {fail((error as Error).message);}
        },
      });
      client.requestAccessToken({prompt: token ? '' : 'select_account', ...(token ? {hint: token.owner} : {})});
    } catch {fail('Login Google gagal dibuka. Coba lagi.');}
  });
}

export async function disconnectGoogle() {
  if (pending) throw new Error('Selesaikan jendela Google terlebih dahulu.');
  const previous = token?.value;
  clearSession('ready');
  if (!previous) return;
  pending = true;
  update({phase: 'connecting'});
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Sesi lokal sudah diputus. Pencabutan izin belum terkonfirmasi; periksa akses Arcy di Akun Google.')), 10000);
      window.google!.accounts!.oauth2!.revoke(previous, result => {
        clearTimeout(timer);
        result.successful ? resolve() : reject(new Error('Sesi lokal sudah diputus. Cabut izin Arcy dari halaman Akun Google.'));
      });
    });
  } catch (error) {update({error: (error as Error).message}); throw error;}
  finally {pending = false; update({phase: 'ready'});}
}

export function signOutGoogle() {
  if (pending) throw new Error('Selesaikan jendela Google terlebih dahulu.');
  clearSession('ready');
}

export function googleSession(permission: GoogleService | 'calendarWrite' | 'workspace') {
  if (!token || token.expires <= Date.now()) {
    if (token) clearSession('expired');
    throw new Error('Klik Connect Google untuk melanjutkan.');
  }
  if (!token.scopes.has(scope[permission]) && !(permission === 'calendar' && token.scopes.has(scope.calendarWrite))) {
    throw new Error(permission === 'calendarWrite' ? 'Izinkan pengiriman agenda ke Google terlebih dahulu.' : 'Hubungkan layanan ini dan izinkan aksesnya di Google.');
  }
  const session = token, run = generation;
  function assertCurrent() {if (token !== session || generation !== run || session.expires <= Date.now()) throw new Error('Sesi Google berubah. Ulangi dari akun yang terhubung.');}
  return {
    owner: session.owner, assertCurrent,
    async request(url: string, options: RequestInit = {}) {
      assertCurrent();
      const target = new URL(url);
      if (target.protocol !== 'https:' || !['www.googleapis.com', 'sheets.googleapis.com'].includes(target.host) || target.username || target.password) throw new Error('Tujuan API Google tidak valid.');
      const response = await fetch(url, {...options, redirect: 'error', headers: {...options.headers, Authorization: 'Bearer ' + session.value}, signal: AbortSignal.timeout(25000)});
      assertCurrent();
      if (response.status === 401) {clearSession('expired'); throw new Error('Sesi Google berakhir. Hubungkan ulang.');}
      if (!response.ok) {
        if (response.status === 409 && options.method === 'POST') return response;
        throw new Error(response.status === 403 ? 'Google menolak akses. Periksa izin akun dan aktivasi layanan Google untuk aplikasi ini.' : `Permintaan Google gagal (${response.status}). Coba lagi.`);
      }
      return response;
    },
  };
}
