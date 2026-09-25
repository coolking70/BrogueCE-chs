import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
const dir='ai_docs/reports/u-04c-evidence',temp=fs.mkdtempSync(path.join(os.tmpdir(),'u04c-attribution-'));
const old=fs.readFileSync(`${dir}/before-Game.ts.txt`,'utf8');
const oldBlock=`        this.machineCells = new Set();
        for (const mr of machineResults) {
            for (const c of mr.cells) this.machineCells.add(c.y * DCOLS + c.x);
        }`;
const newBlock=`        this.machineCells = new Set();
        for (let y = 0; y < this.grid.height; y++) {
            for (let x = 0; x < this.grid.width; x++) {
                if (this.grid.getCell(x, y)!.machineNumber !== 0) this.machineCells.add(y * DCOLS + x);
            }
        }`;
assert.equal(old.split(oldBlock).length,2);
fs.writeFileSync(`${dir}/single-variable.patch.txt`,`${oldBlock}\n\n=> only replacement =>\n\n${newBlock}\n`);
const variants={control:old,sourceOnly:old.replace(oldBlock,newBlock),final:fs.readFileSync('src/engine/Core/Game.ts','utf8')};
const results={};
try {
 for(const [name,source]of Object.entries(variants)) {
  const outfile=path.join(temp,`${name}.mjs`);
  await build({entryPoints:['scripts/u04c-generation.ts'],bundle:true,platform:'node',format:'esm',outfile,
   plugins:[{name:'one-source-change',setup(b){b.onLoad({filter:/\/engine\/Core\/Game\.ts$/},()=>({contents:source,loader:'ts'}));}}]});
  const output=`${dir}/generation-${name}.json`,log=fs.openSync(`${dir}/generation-${name}.txt`,'w');
  const run=spawnSync(process.execPath,[outfile],{env:{...process.env,U04C_OUTPUT:output},stdio:['ignore',log,log]});fs.closeSync(log);
  assert.equal(run.status,0,`${name} failed`);results[name]=JSON.parse(fs.readFileSync(output));console.log(`${name} recorded`);
 }
 const base=JSON.parse(fs.readFileSync(`${dir}/baseline-before.json`));
 const changes=(a,b)=>base.seeds.flatMap(seed=>a[seed].flatMap((r,i)=>Object.keys(r).filter(k=>r[k]!==b[seed][i][k]).map(field=>({seed,depth:i+1,field,before:r[field],after:b[seed][i][field]}))));
 const controlDiff=changes(base.levels,results.control.levels),sourceDiff=changes(results.control.levels,results.sourceOnly.levels),finalDiff=changes(results.sourceOnly.levels,results.final.levels);
 assert.equal(controlDiff.length,0,'unrelated initial drift');assert.equal(finalDiff.length,0,'non-source generation drift');
 assert.deepEqual(results.sourceOnly,results.final,'full state/RNG or placement drift beyond the one source switch');
 const beforeSHA256=crypto.createHash('sha256').update(fs.readFileSync(`${dir}/baseline-before.json`)).digest('hex');
 const summary={beforeSHA256,controlDiff,sourceDiff,finalDiff,fullSourceOnlyEqualsFinal:true,
  changedLayers:new Set(sourceDiff.map(r=>`${r.seed}/${r.depth}`)).size,
  firstBySeed:base.seeds.map(seed=>({seed,first:sourceDiff.find(r=>r.seed===seed)??null})),
  original424242D2:results.control.traces['424242'][1],final424242D2:results.final.traces['424242'][1]};
 fs.writeFileSync(`${dir}/drift-attribution.json`,JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify({controlDiff:controlDiff.length,sourceDiff:sourceDiff.length,finalDiff:finalDiff.length,changedLayers:summary.changedLayers,fullSourceOnlyEqualsFinal:true}));
}finally{fs.rmSync(temp,{recursive:true,force:true});}
