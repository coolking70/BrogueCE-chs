// Read-only mechanism probe for the previously masked, unchanged P1-37 current-format assertion.
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = fs.mkdtempSync(path.join(os.tmpdir(),'u03-p1-machine-cells-'));
try {
 await build({stdin:{resolveDir:process.cwd(),loader:'ts',contents:`
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHeadlessGame } from './src/test/harness';
const g = createHeadlessGame(424242);
g.depth = 2; (g as any).generateDepth(false, false);
const saved = JSON.parse(JSON.stringify(g.toSnapshot()));
const sorted = (xs: Iterable<number>) => [...xs].sort((a,b)=>a-b);
const before = sorted((g as any).machineCells);
const derived = sorted(saved.grid.filter((c:any)=>c.machineNumber!==0).map((c:any)=>c.y*saved.width+c.x));
const fresh = createHeadlessGame(1);
assert.equal(fresh.loadSnapshot(saved),true);
const restored = sorted((fresh as any).machineCells);
assert.deepEqual(restored,before);
const stable = (s:any) => {const {savedAt:_time,...state}=s;return state;};
assert.deepEqual(stable(JSON.parse(JSON.stringify(fresh.toSnapshot()))),stable(saved));
const result={seed:424242,depth:2,before,saved:sorted(saved.machineCells),restored,gridDerived:derived,
 beforeCount:before.length,restoredCount:restored.length,gridDerivedCount:derived.length,fullSnapshotEquality:true,
 extraVsGrid:restored.filter(k=>!derived.includes(k)),missingVsGrid:derived.filter(k=>!restored.includes(k))};
fs.writeFileSync('ai_docs/reports/u-03-evidence/adjudication/p1-machine-cells.json',JSON.stringify(result,null,2)+'\\n');
console.log(JSON.stringify(result));
`},bundle:true,platform:'node',format:'esm',outfile:path.join(dir,'probe.mjs')});
 await import(pathToFileURL(path.join(dir,'probe.mjs')).href);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
