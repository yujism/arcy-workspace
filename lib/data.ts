import {env} from 'cloudflare:workers';
import {getChatGPTUser} from '@/app/chatgpt-auth';
export type RecordItem={id:string;kind:string;title:string;body:string;meta:Record<string,any>;updated:string};
export type Runtime={DB:D1Database;OPENAI_API_KEY?:string;OPENAI_MODEL?:string;GOOGLE_CLIENT_ID?:string;GOOGLE_CLIENT_SECRET?:string;GOOGLE_REFRESH_TOKEN?:string;GOOGLE_OWNER_USER_ID?:string};
export const runtime=()=>env as unknown as Runtime;
export const db=()=>{const d=runtime().DB;if(!d)throw new Error('Penyimpanan belum tersedia. Coba lagi sebentar.');return d;};
export async function identity(){const u=await getChatGPTUser();if(!u)throw new Error('UNAUTHORIZED');return u;}
export function guardOrigin(req:Request){const origin=req.headers.get('origin');if(!origin||origin!==new URL(req.url).origin)throw new Error('FORBIDDEN');}
export async function list(owner:string){const r=await db().prepare('SELECT id,kind,title,body,meta,updated FROM records WHERE owner=? ORDER BY updated DESC LIMIT 2000').bind(owner).all();return (r.results||[]).map((x:any)=>({...x,meta:JSON.parse(x.meta)})) as RecordItem[];}
export async function put(owner:string,r:RecordItem){await db().prepare('INSERT INTO records (id,owner,kind,title,body,meta,updated) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,meta=excluded.meta,updated=excluded.updated WHERE records.owner=excluded.owner AND records.kind=excluded.kind').bind(r.id,owner,r.kind,r.title,r.body,JSON.stringify(r.meta),r.updated).run();}
export function failure(e:unknown){const msg=e instanceof Error?e.message:'Permintaan gagal.';const code=msg==='UNAUTHORIZED'?401:msg==='FORBIDDEN'?403:400;return Response.json({error:msg==='UNAUTHORIZED'?'Silakan masuk ke workspace terlebih dahulu.':msg==='FORBIDDEN'?'Permintaan tidak diizinkan.':msg},{status:code});}
export const readyGoogle=(owner:string)=>{const e=runtime();return !!(e.GOOGLE_CLIENT_ID&&e.GOOGLE_CLIENT_SECRET&&e.GOOGLE_REFRESH_TOKEN&&e.GOOGLE_OWNER_USER_ID===owner);};
