// One deliberate baseline write after independent guards and attribution.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-15d3-evidence',file='src/test/fixtures/generation_baseline.json';
if(fs.existsSync(`${out}/recapture.json`))throw Error('Baseline already recaptured; refusing second write');
const guards=JSON.parse(fs.readFileSync(`${out}/guards.json`));
if(guards.numFailedTests||guards.numPassedTests<9)throw Error('Independent guards not green');
const negatives=JSON.parse(fs.readFileSync(`${out}/negative-summary.json`));
if(negatives.length!==17||negatives.some(r=>!r.failed))throw Error('Incomplete mutation guards');
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'u15d3-final-capture-'));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
try{
 await build({entryPoints:['scripts/u15d3-observe.ts'],outfile:`${tmp}/capture.mjs`,bundle:true,platform:'node',format:'esm'});
 const r=spawnSync(process.execPath,[`${tmp}/capture.mjs`,`${out}/generation-final.json.gz`],{stdio:'inherit'});if(r.status!==0)throw Error('Capture failed');
 const read=p=>JSON.parse(gunzipSync(fs.readFileSync(p)));
 const rows=read(`${out}/generation-final.json.gz`),expected=read(`${out}/generation-vorpal.json.gz`);
 if(JSON.stringify(rows)!==JSON.stringify(expected))throw Error('Final capture differs from attributed final stage');
 const stage=JSON.parse(fs.readFileSync(`${out}/inputs-vorpal.json`));for(const [f,h] of Object.entries(stage))if(sha(f)!==h)throw Error(`Changed attributed source ${f}`);
 const before=sha(file);if(before!==sha(`${out}/generation_baseline.json`))throw Error('Original baseline changed before capture');
 const base=JSON.parse(fs.readFileSync(file,'utf8'));
 base.note='U15d-3: complete CE weapon/armor runic mappings. Four pool stages plus unchanged vorpal lottery; original C oracle passed. One recapture; all 104 terrain/count/species rows unchanged. See u-15d3.report.md.';
 for(const row of rows)base.levels[row.seed][row.depth-1]={fp:row.fp,n:row.n,species:row.species,items:row.items};
 fs.writeFileSync(file,JSON.stringify(base,null,2)+'\n');
 fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({before,after:sha(file),layers:rows.length,fullCaptureEqualsAttributedFinal:true,writes:1},null,2)+'\n');
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
