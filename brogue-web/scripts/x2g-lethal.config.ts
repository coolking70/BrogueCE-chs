import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {defineConfig} from 'vitest/config';
const out='ai_docs/reports/x2g-evidence';
const stage=process.env.X2G_STAGE ?? 'rot-lethal';
const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${stage}.json.gz`)).toString());
export default defineConfig({plugins:[{name:'x2g-lethal-review',enforce:'pre',load(id){
 const file=path.relative(process.cwd(),id);
 if(file==='src/test/x2g_native_effects.test.ts')return fs.readFileSync(`${out}/repaired-x2g_native_effects.test.ts.txt`,'utf8');
 if(file in sources&&!file.endsWith('.test.ts'))return sources[file];
}}],test:{testTimeout:900000,hookTimeout:120000}});
