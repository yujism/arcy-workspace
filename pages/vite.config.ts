import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),
 base:'./',
 envDir:false,
 publicDir:false,
 plugins:[react()],
 resolve:{alias:{'@':fileURLToPath(new URL('..',import.meta.url))}},
 css:{postcss:fileURLToPath(new URL('..',import.meta.url))},
 build:{outDir:fileURLToPath(new URL('../docs',import.meta.url)),emptyOutDir:true,sourcemap:false},
});
