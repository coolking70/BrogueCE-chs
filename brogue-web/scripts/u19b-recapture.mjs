// One deliberate baseline write after independent guards and attribution.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-19b-evidence',file='src/test/fixtures/generation_baseline.json';
if(fs.existsSync(`${out}/recapture.json`))throw Error('Baseline already recaptured; refusing second write');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u19b-final-capture-'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
try{
 await build({entryPoints:['scripts/u19b-observe.ts'],outfile:`${tmp}/capture.mjs`,bundle:true,platform:'node',format:'esm'});
 const r=spawnSync(process.execPath,[`${tmp}/capture.mjs`,`${out}/generation-final.json.gz`],{stdio:'inherit'});if(r.status!==0)throw Error('Capture failed');
 const read=p=>JSON.parse(gunzipSync(fs.readFileSync(p)));
 const rows=read(`${out}/generation-final.json.gz`),expected=read(`${out}/generation-s3.json.gz`);
 if(JSON.stringify(rows)!==JSON.stringify(expected))throw Error('Final capture differs from attributed final stage');
 const before=sha(file),base=JSON.parse(fs.readFileSync(file,'utf8'));
 base.note='U19b: CE vestibule/room pending item occupancy and post-machine autogenerator pending item/active monster filtering; AMULET deferred materialization. Individually attributed, one recapture; see u-19b.report.md.';
 for(const row of rows)base.levels[row.seed][row.depth-1]={fp:row.fp,n:row.n,species:row.species,items:row.items};
 fs.writeFileSync(file,JSON.stringify(base,null,2)+'\n');
 fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({before,after:sha(file),layers:rows.length,fullCaptureEqualsS3:true,writes:1},null,2)+'\n');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
