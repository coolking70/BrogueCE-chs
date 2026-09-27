import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
const stage=process.argv[2];
if(!/^[a-z0-9-]+$/.test(stage)) throw Error('stage required');
const sources=JSON.parse(gunzipSync(fs.readFileSync(`ai_docs/reports/x2g-evidence/sources-${stage}.json.gz`)));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'x2g-'));
try {
 await build({entryPoints:['scripts/x2g-observe.ts'],outfile:`${dir}/observe.mjs`,bundle:true,platform:'node',format:'esm',plugins:[{name:'stage',setup(b){b.onLoad({filter:/\/src\/.*\.(ts|json)$/},a=>{const f=path.relative(process.cwd(),a.path);if(!(f in sources))return;return {contents:sources[f],loader:f.endsWith('.json')?'json':'ts'};});}}]});
 const r=spawnSync(process.execPath,[`${dir}/observe.mjs`,`ai_docs/reports/x2g-evidence/generation-${stage}.json.gz`],{stdio:'inherit'});
 if(r.status)process.exitCode=r.status;
} finally {fs.rmSync(dir,{recursive:true,force:true});}
