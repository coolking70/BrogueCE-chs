import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {defineConfig} from 'vitest/config';
const out='ai_docs/reports/x2g-evidence';
const sources=JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${process.env.X2G_STAGE??'review'}.json.gz`)).toString());
export default defineConfig({plugins:[{name:'x2g-discoveries-premise',enforce:'pre',load(id){
 const file=path.relative(process.cwd(),id);
 if(file==='src/engine/UI/Discoveries.test.ts')return fs.readFileSync(`${out}/${process.env.X2G_FIXED==='1'?'repaired':'original'}-Discoveries.test.ts.txt`,'utf8');
 if(!file.endsWith('.test.ts')&&file in sources)return sources[file];
}}]});
