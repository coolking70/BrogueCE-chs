// One deliberate baseline write after independent guards and attribution.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-19e-evidence',file='src/test/fixtures/generation_baseline.json';
if(fs.existsSync(`${out}/recapture.json`))throw Error('Baseline already recaptured; refusing second write');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u19e-final-capture-'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
try{
 await build({entryPoints:['scripts/u19e-observe.ts'],outfile:`${tmp}/capture.mjs`,bundle:true,platform:'node',format:'esm'});
 const r=spawnSync(process.execPath,[`${tmp}/capture.mjs`,`${out}/generation-final.json.gz`],{stdio:'inherit'});if(r.status!==0)throw Error('Capture failed');
 const read=p=>JSON.parse(gunzipSync(fs.readFileSync(p)));
 const rows=read(`${out}/generation-final.json.gz`),expected=read(`${out}/generation-s3.json.gz`);
 if(JSON.stringify(rows)!==JSON.stringify(expected))throw Error('Final capture differs from attributed final stage');
 const stage=JSON.parse(fs.readFileSync(`${out}/s3-inputs.json`));for(const [f,h] of Object.entries(stage))if(sha(f)!==h)throw Error(`Changed attributed source ${f}`);
 const before=sha(file);if(before!==sha(`${out}/baseline-before.json`))throw Error('Original baseline changed before capture');
 const base=JSON.parse(fs.readFileSync(file,'utf8'));
 base.note='U19e: restore CE47 adoption via CE direct feature placement, remove the CE28 whitelist; commutation/resurrection/sacrifice/library action chains and CE selection contracts verified, individually attributed, one recapture; see u-19e.report.md.';
 for(const row of rows)base.levels[row.seed][row.depth-1]={fp:row.fp,n:row.n,species:row.species,items:row.items};
 fs.writeFileSync(file,JSON.stringify(base,null,2)+'\n');
 fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({before,after:sha(file),layers:rows.length,fullCaptureEqualsS3:true,writes:1},null,2)+'\n');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
