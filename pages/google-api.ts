import {googleSession, googleSnapshot, connectGoogle} from './google-auth';
import {localApi, allRecords, saveGoogleRecords} from './local-api';
import type {RecordItem} from '../lib/data';

type GoogleEvent = {id:string;summary?:string;description?:string;status?:string;start?:{dateTime?:string;date?:string};end?:{dateTime?:string;date?:string};location?:string;extendedProperties?:{private?:{arcyId?:string}}};
const drive = 'https://www.googleapis.com/drive/v3/files';
const calendar = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const safeId = (id: unknown) => {if(typeof id !== 'string' || !/^[\w-]{1,150}$/.test(id)) throw new Error('Invalid Google ID.'); return id;};
async function digest(value: string) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), b => b.toString(16).padStart(2, '0')).join('');}
let syncing = false;

export async function pagesApi(path: string, body?: any, method = 'POST') {
  if (path !== '/api/google') {
    const response = await localApi(path, body, method);
    if (path === '/api/workspace' && body === undefined) {
      const {services} = googleSnapshot();
      return {...response, connections: {google: Object.values(services).some(Boolean), ai: false, ...services}};
    }
    return response;
  }
  const now = new Date().toISOString();
  if (body?.action === 'browse') {
    const session = googleSession('drive');
    const query = String(body.query || '').slice(0,150).replace(/\\/g,'\\\\').replace(/'/g,"\\'");
    const q = "trashed=false and mimeType='application/vnd.google-apps.document'" + (query ? ` and name contains '${query}'` : '');
    const params = new URLSearchParams({q, pageSize:'30', orderBy:'modifiedTime desc', fields:'files(id,name,mimeType,webViewLink,modifiedTime),nextPageToken'});
    if(body.pageToken) params.set('pageToken', String(body.pageToken));
    return (await session.request(drive+'?'+params)).json();
  }
  if (body?.action === 'import') {
    const session = googleSession('drive'), id = safeId(body.id);
    const meta = await (await session.request(`${drive}/${id}?fields=id,name,mimeType,modifiedTime`)).json() as {name:string;mimeType:string;modifiedTime:string};
    if(meta.mimeType !== 'application/vnd.google-apps.document') throw new Error('Select a Google Docs document.');
    const content = await (await session.request(`${drive}/${id}/export?mimeType=text%2Fplain`)).text();
    if(content.length > 100000) throw new Error('The document is too long. Choose one under 100,000 characters.');
    const item:RecordItem = {id:'google:doc:'+await digest(session.owner+':'+id), kind:'note', title:meta.name, body:content, updated:now, meta:{provider:'google', googleAccount:session.owner, source:'Google Docs', tag:'Drive', url:`https://docs.google.com/document/d/${id}/edit`, sourceModified:meta.modifiedTime}};
    await saveGoogleRecords([item], session.assertCurrent); return {item};
  }
  if (body?.action === 'sheets') {
    const session = googleSession('sheets');
    const input = String(body.id || '').trim();
    const id = input.startsWith('https://docs.google.com/spreadsheets/d/') ? input.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/)?.[1] : input;
    safeId(id);
    const range = String(body.range || '').trim();
    if(!range || range.length > 200) throw new Error('Enter a valid A1 range, up to 200 characters.');
    const result = await (await session.request(`https://sheets.googleapis.com/v4/spreadsheets/${id}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE`)).json() as {values?:unknown[][]};
    const content = (result.values || []).map((r: unknown[]) => r.join('\t')).join('\n');
    if(content.length > 100000) throw new Error('The range is too large. Choose a smaller range.');
    const item:RecordItem = {id:'google:sheet:'+await digest(session.owner+':'+id+':'+range), kind:'note', title:range, body:content || '(Empty range)', updated:now, meta:{provider:'google', googleAccount:session.owner, source:'Google Sheets', tag:'Sheets', url:`https://docs.google.com/spreadsheets/d/${id}/edit`, range}};
    await saveGoogleRecords([item], session.assertCurrent); return {item};
  }
  if (body?.action === 'calendar') {
    if(syncing) throw new Error('Calendar sync is already running.');
    const session = googleSession('calendar');
    syncing = true;
    try {
      const start = new Date(); start.setDate(start.getDate()-30);
      const end = new Date(); end.setMonth(end.getMonth()+6);
      const params = new URLSearchParams({timeMin:start.toISOString(), timeMax:end.toISOString(), singleEvents:'true', orderBy:'startTime', maxResults:'250'});
      const items:RecordItem[] = [];
      for(let page=0; page<20; page++) {
        const result = await (await session.request(calendar+'?'+params)).json() as {items?:GoogleEvent[];nextPageToken?:string};
        for(const event of result.items || []) {
          if(event.status === 'cancelled' || !event.start || !event.end) continue;
          const id = safeId(event.id);
          items.push({id:'google:event:'+await digest(session.owner+':'+id), kind:'event', title:event.summary || '(Untitled)', body:event.description || '', updated:now, meta:{provider:'google', googleAccount:session.owner, source:'Google Calendar', googleId:id, url:'https://calendar.google.com/calendar/u/0/r', start:event.start.dateTime || event.start.date, end:event.end.dateTime || event.end.date, location:event.location || ''}});
        }
        if(!result.nextPageToken) {
          await saveGoogleRecords(items, session.assertCurrent, session.owner);
          return {complete:true, nextPageToken:null, changed:items.length};
        }
        params.set('pageToken', result.nextPageToken);
      }
      throw new Error('The calendar is too large for one import. The previous snapshot is preserved.');
    } finally {syncing = false;}
  }
  if (body?.action === 'publish-event') {
    // This branch is invoked only by the existing explicit preview/approval button.
    // Request the additional write scope from that same user gesture.
    try {googleSession('calendarWrite');} catch {await connectGoogle('calendarWrite');}
    const session = googleSession('calendarWrite');
    const item = (await allRecords()).find(r => r.id === body.id && r.kind === 'event' && r.meta.provider !== 'google');
    if(!item) throw new Error('Local event not found.');
    if(!Number.isFinite(Date.parse(item.meta.start)) || !Number.isFinite(Date.parse(item.meta.end)) || Date.parse(item.meta.end) <= Date.parse(item.meta.start)) throw new Error('Invalid event time.');
    const id = 'a'+await digest(session.owner+':'+item.id);
    let response = await session.request(calendar+'?sendUpdates=none', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, summary:item.title, description:item.body, start:{dateTime:item.meta.start}, end:{dateTime:item.meta.end}, extendedProperties:{private:{arcyId:item.id}}})});
    if(response.status === 409) {
      response = await session.request(calendar+'/'+id);
      const existing = await response.json() as GoogleEvent;
      if(existing.status === 'cancelled' || existing.extendedProperties?.private?.arcyId !== item.id) throw new Error('This event was already sent or deleted in Google. Create a new event to send it again.');
    }
    session.assertCurrent();
    return {ok:true};
  }
  throw new Error('Unknown Google action.');
}
