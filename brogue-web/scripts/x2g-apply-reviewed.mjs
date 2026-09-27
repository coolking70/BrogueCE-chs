// Apply the already-tested isolated candidate only after the first full suite finishes.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
const out='ai_docs/reports/x2g-evidence';
assert(!fs.existsSync(`${out}/delivery-applied.json`),'Already applied');
const first=JSON.parse(fs.readFileSync(`${out}/first-full/final-summary.json`));
assert.equal(first.files,206);assert.equal(first.failed,20);
const read=s=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${s}.json.gz`)));
const before=read('review'),after=read('final');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const changed=[];
for(const [f,source] of Object.entries(after)) {
 if(f.endsWith('.test.ts'))continue; // Historical snapshots also contain colocated tests, not production inputs.
 assert.equal(fs.readFileSync(f,'utf8'),before[f],`Unexpected working-tree change: ${f}`);
 if(source!==before[f]){fs.writeFileSync(f,source);changed.push({file:f,before:sha(before[f]),after:sha(source)});}
}
const guardFiles=[];
for(const name of fs.readdirSync(out)){
 if(!/^repaired-.*\.test\.ts\.txt$/.test(name)||name.startsWith('repaired-x2g'))continue;
 const basename=name.slice('repaired-'.length,-'.txt'.length);
 const file=basename==='Discoveries.test.ts'?`src/engine/UI/${basename}`:`src/test/${basename}`;
 assert(fs.existsSync(file),file);fs.copyFileSync(`${out}/${name}`,file);guardFiles.push(file);
}
fs.copyFileSync(`${out}/repaired-x2g-delivery.test.ts.txt`,'src/test/x2g_native_effects.test.ts');
fs.copyFileSync(`${out}/ce-terrain-additions.json`,'src/test/fixtures/x2g-ce-terrain.json');
const originals=fs.readdirSync(out).filter(n=>/^original-.*\.test\.ts\.txt$/.test(n)).sort().map(n=>{
 const file=n.slice('original-'.length,-'.txt'.length),bytes=fs.readFileSync(`${out}/${n}`);
 const sourcePath=file==='Discoveries.test.ts'?`src/engine/UI/${file}`:`src/test/${file}`;
 const head=execFileSync('git',['show',`HEAD:brogue-web/${sourcePath}`]);assert(bytes.equals(head),file);
 return {file,sourcePath,matchesHEAD:true,sha256:sha(bytes)};
});
assert.equal(originals.length,16);
fs.writeFileSync(`${out}/premise-original-provenance.json`,JSON.stringify(originals,null,2)+'\n');
const production=Object.fromEntries(Object.entries(after).filter(([f])=>!f.endsWith('.test.ts')));
const now=Object.fromEntries(Object.keys(production).map(f=>[f,fs.readFileSync(f,'utf8')]));assert.deepEqual(now,production);
fs.writeFileSync(`${out}/delivery-applied.json`,JSON.stringify({at:new Date().toISOString(),sourceStage:'final',changed,guardFiles,originalGuards:originals.length},null,2)+'\n');
console.log(`Applied ${changed.length} production refinements and ${guardFiles.length} prepared guard files; 17 native tests.`);
