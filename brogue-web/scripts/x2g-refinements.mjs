// Isolate corrections discovered during review; preserve chronological source snapshots.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {gunzipSync,gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
const out='ai_docs/reports/x2g-evidence';
const read=s=>JSON.parse(gunzipSync(fs.readFileSync(`${out}/sources-${s}.json.gz`)));
const final=read('review');
const rot=read('rot');
const f='src/engine/Core/Game.ts';
for(const [a,b] of [
 ['m.hp -= m.absorbShieldDamage(damage);','m.takeDamage(damage, false, this.grid);'],
 ['m.hp -= m.absorbShieldDamage(rng.randClumpedRange(6, 12, 2));','m.takeDamage(rng.randClumpedRange(6, 12, 2), false, this.grid);'],
 ['entity.hp -= damage; // CE Time.c:2584 / Monsters.c:1885: burning bypasses shields.','if (entity instanceof Monster) entity.takeDamage(damage, true, this.grid);\n            else entity.hp -= damage; // CE burning bypasses shields.'],
 ['monst.hp -= monst.isInvulnerable() ? 0 : monst.absorbShieldDamage(damage);','if (!monst.isInvulnerable()) monst.takeDamage(damage, false, this.grid);'],
 ['entity.hp -= Math.max(1, Math.floor(entity.maxHp / 15)); // bypasses shields','if (entity instanceof Monster) entity.takeDamage(Math.max(1, Math.floor(entity.maxHp / 15)), true, this.grid);\n                    else entity.hp -= Math.max(1, Math.floor(entity.maxHp / 15)); // bypasses shields'],
]){assert(rot[f].includes(a),a);rot[f]=rot[f].replace(a,b);}
rot['src/engine/UI/Appearance.ts']=final['src/engine/UI/Appearance.ts'];
const sub=read('submerged');
for(const f of ['src/engine/Combat/Combat.ts','src/entities/Monster.ts'])sub[f]=final[f];
for(const [s,v] of [['rot-complete',rot],['submerged-review',sub]])fs.writeFileSync(`${out}/sources-${s}.json.gz`,gzipSync(JSON.stringify(v)));
for(const s of ['rot-complete','submerged-review']){
 for(const script of ['x2g-capture.mjs','x2g-traces.mjs']){const r=spawnSync(process.execPath,[`scripts/${script}`,s],{stdio:'inherit'});assert.equal(r.status,0);}
}
const results=[];
const data=p=>JSON.parse(p.endsWith('.gz')?gunzipSync(fs.readFileSync(p)):fs.readFileSync(p));
for(const [from,to] of [['rot','rot-complete'],['submerged','submerged-review']]){
 for(const type of ['generation','ur2','ur3','ur4']){
  const suffix=type==='ur2'?'.json':'.json.gz';
  assert.deepEqual(data(`${out}/${type}-${from}${suffix}`),data(`${out}/${type}-${to}${suffix}`),`${type}: ${from} -> ${to}`);
  results.push({from,to,type,unchanged:true});
 }
}
fs.writeFileSync(`${out}/refinement-attribution.json`,JSON.stringify(results,null,2)+'\n');
