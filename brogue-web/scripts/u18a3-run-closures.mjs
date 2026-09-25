import {build} from 'esbuild';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'u18a3-closures-'));
try{await build({entryPoints:['scripts/u18a3-closures.ts'],outfile:`${dir}/probe.mjs`,bundle:true,format:'esm',platform:'node'});const r=spawnSync(process.execPath,[`${dir}/probe.mjs`],{stdio:'inherit'});process.exitCode=r.status??1;}finally{fs.rmSync(dir,{recursive:true,force:true});}
