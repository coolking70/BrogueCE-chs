import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {defineConfig} from 'vitest/config';
const sources=JSON.parse(gunzipSync(fs.readFileSync(`ai_docs/reports/x2b-evidence/sources-${process.env.X2B_STAGE}.json.gz`)).toString());
export default defineConfig({plugins:[{name:'x2b-original-premise',enforce:'pre',load(id){
 if(/\/(horde_terrain_spawn|u_26a_deep_levels)\.test\.ts$/.test(id))return execFileSync('git',['show',`HEAD:brogue-web/src/test/${path.basename(id)}`],{encoding:'utf8'});
 return sources[path.relative(process.cwd(),id)];
}}],test:{testTimeout:900000,hookTimeout:120000}});
