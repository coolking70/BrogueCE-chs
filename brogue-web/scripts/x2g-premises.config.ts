import fs from 'node:fs';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { defineConfig } from 'vitest/config';
const out='ai_docs/reports/x2g-evidence';
const stage=process.env.X2G_STAGE ?? 'pool';
const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)).toString());
export default defineConfig({plugins:[{name:'x2g-premise-proof',enforce:'pre',load(id){
    const file=path.relative(process.cwd(),id);
    if(file.endsWith('.test.ts')) {
        const saved=`${out}/original-${path.basename(file)}.txt`;
        if(process.env.X2G_ORIGINAL==='1' && fs.existsSync(saved))return fs.readFileSync(saved,'utf8');
        return;
    }
    if(file in sources)return sources[file];
}}],test:{testTimeout:900000,hookTimeout:120000}});
