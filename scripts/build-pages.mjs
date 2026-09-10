import {spawnSync} from 'node:child_process';
import {copyFileSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const result=spawnSync(process.execPath,['node_modules/vite/bin/vite.js','build','--config','pages/vite.config.ts'],{cwd:root,stdio:'inherit'});
if(result.status!==0)process.exit(result.status||1);
writeFileSync(new URL('../docs/.nojekyll',import.meta.url),'');
copyFileSync(new URL('../public/favicon.svg',import.meta.url),new URL('../docs/favicon.svg',import.meta.url));
const html=readFileSync(new URL('../docs/index.html',import.meta.url),'utf8');
for(const [,asset] of html.matchAll(/(?:src|href)="([^"#]+)"/g)){
 if(!asset.startsWith('./')||!existsSync(new URL('../docs/'+asset.slice(2),import.meta.url)))throw new Error('Invalid Pages asset: '+asset);
}
console.log('Pages build ready: docs/ — relative assets verified.');
