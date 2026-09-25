// One authorized recapture, only after the CE guards and per-carrier attribution.
import fs from 'node:fs';import crypto from 'node:crypto';import {gunzipSync} from 'node:zlib';
const out='ai_docs/reports/u-17c-evidence',file='src/test/fixtures/generation_baseline.json';
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const beforeBytes=fs.readFileSync(file),before=JSON.parse(beforeBytes);
const entry=JSON.parse(fs.readFileSync(`${out}/baseline-before.json`));
if(hash(beforeBytes)!==entry[file]||fs.existsSync(`${out}/recapture.json`))throw Error('Baseline already changed/recaptured; refusing a second write');
const rows=JSON.parse(gunzipSync(fs.readFileSync(`${out}/generation-final.json.gz`)));
const inputs=JSON.parse(fs.readFileSync(`${out}/inputs-final.json`));
for(const r of inputs)if(hash(fs.readFileSync(r.file))!==r.used)throw Error(`Captured inputs changed: ${r.file}`);
if(rows.length!==104)throw Error('Incomplete generation capture');
const after=JSON.parse(JSON.stringify(before)),diffs=[];
for(const r of rows){const row=after.levels[String(r.seed)][r.depth-1];for(const k of ['fp','n','species','items']){if(row[k]!==r[k])diffs.push({seed:r.seed,depth:r.depth,field:k,before:row[k],after:r[k]});row[k]=r[k];}}
after.note='U17c: CE used pressure plate, trapdoor, medium hole, lever and repeating floor carriers; independent trigger guards and ordered per-lever generation attribution in u-17c.report.md.';
const afterBytes=JSON.stringify(after,null,2)+'\n';fs.writeFileSync(file,afterBytes);
fs.writeFileSync(`${out}/recapture.json`,JSON.stringify({writes:1,before:hash(beforeBytes),after:hash(afterBytes),differences:diffs,metadata:'note'},null,2)+'\n');console.log('One baseline recapture:',diffs.length,'field differences');
