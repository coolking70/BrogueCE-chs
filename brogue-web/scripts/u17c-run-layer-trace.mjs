import {build} from 'esbuild';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync} from 'node:child_process';
const work=fs.mkdtempSync(path.join(os.tmpdir(),'u17c-layer-trace-'));
try{await build({entryPoints:['scripts/u17c-layer-trace.ts'],outfile:`${work}/trace.mjs`,bundle:true,platform:'node',format:'esm'});const r=spawnSync(process.execPath,[`${work}/trace.mjs`],{stdio:'inherit'});process.exitCode=r.status;}finally{fs.rmSync(work,{recursive:true,force:true});}
