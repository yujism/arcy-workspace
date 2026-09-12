import {useSyncExternalStore} from 'react';
import {Moon,Sun} from 'lucide-react';
const key='arcy-theme';
const system=window.matchMedia('(prefers-color-scheme: dark)');
function saved(){try{const value=localStorage.getItem(key);return value==='dark'||value==='light'?value:null;}catch{return null;}}
let theme=saved()||(system.matches?'dark':'light');
const listeners=new Set<()=>void>();
function apply(value:string){theme=value;document.documentElement.dataset.theme=value;document.documentElement.classList.toggle('dark',value==='dark');document.documentElement.style.colorScheme=value;listeners.forEach(fn=>fn());}
apply(theme);
system.addEventListener('change',()=>{if(!saved())apply(system.matches?'dark':'light');});
window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(saved()||(system.matches?'dark':'light'));});
const subscribe=(fn:()=>void)=>{listeners.add(fn);return ()=>{listeners.delete(fn);};};
export default function ThemeToggle(){
 const current=useSyncExternalStore(subscribe,()=>theme,()=>theme);
 const dark=current==='dark';
 return <button className="theme-toggle" type="button" aria-label="Dark mode" aria-pressed={dark} title={dark?'Ganti ke light mode':'Ganti ke dark mode'} onClick={()=>{const next=dark?'light':'dark';try{localStorage.setItem(key,next);}catch{/* Theme still works when browser storage is blocked. */}apply(next);}}>{dark?<Sun size={16}/>:<Moon size={16}/>}<span>{dark?'Light mode':'Dark mode'}</span></button>;
}
