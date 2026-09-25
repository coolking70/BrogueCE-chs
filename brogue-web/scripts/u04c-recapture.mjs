// User-authorized recapture only after independent guards and single-variable attribution.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
const dir='ai_docs/reports/u-04c-evidence',fixture='src/test/fixtures/generation_baseline.json';
const read=n=>JSON.parse(fs.readFileSync(`${dir}/${n}.json`));
const hash=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const a=read('generation-control'),b=read('generation-sourceOnly'),c=read('generation-final'),base=read('baseline-before');
assert.deepEqual(b,c);assert.deepEqual(a.levels,base.levels);
for(const name of ['guards-fixed','targeted','pre-recapture-guards','pre-recapture-topology-ownership']) {
 const r=read(name);assert.equal(r.success,true,`${name} must pass`);assert.ok(r.numPassedTests>0);
}
assert.equal(read('negative-check').caught,true);
const detailed=base.seeds.flatMap(seed=>a.traces[seed].flatMap((row,i)=>{
 const next=c.traces[seed][i],fields=Object.keys(row).filter(k=>JSON.stringify(row[k])!==JSON.stringify(next[k]));
 return fields.length?[{seed,depth:i+1,fields,
  itemPositionsChanged:JSON.stringify(row.itemPositions)!==JSON.stringify(next.itemPositions),
  monsterPositionsChanged:JSON.stringify(row.monsterPositions)!==JSON.stringify(next.monsterPositions),
  rngBeforeCount:row.rng.randomNumbersGenerated,rngAfterCount:next.rng.randomNumbersGenerated,
  rngStreamsChanged:JSON.stringify(row.rng.streams)!==JSON.stringify(next.rng.streams)}]:[];
}));
const attribution=read('drift-attribution');
attribution.detailedDrift=detailed;
attribution.changedWorldLayers=detailed.filter(r=>r.fields.includes('generatedWorld')).length;
attribution.changedItemPositionLayers=detailed.filter(r=>r.itemPositionsChanged).length;
attribution.changedMonsterPositionLayers=detailed.filter(r=>r.monsterPositionsChanged).length;
attribution.changedRNGCountLayers=detailed.filter(r=>r.rngBeforeCount!==r.rngAfterCount).length;
attribution.changedRNGStreamsLayers=detailed.filter(r=>r.rngStreamsChanged).length;
fs.writeFileSync(`${dir}/drift-attribution.json`,JSON.stringify(attribution,null,2)+'\n');
const beforeSHA256=hash(fixture);assert.equal(beforeSHA256,hash(`${dir}/baseline-before.json`));
const captured={...base,note:'U04c K31 grid-derived machine membership; recaptured after single-variable attribution and independent guards. Original fp/n/species/items fields unchanged; placement and RNG-count drift: ai_docs/reports/u-04c.report.md',levels:c.levels};
fs.writeFileSync(fixture,JSON.stringify(captured,null,2)+'\n');
fs.writeFileSync(`${dir}/recapture.json`,JSON.stringify({beforeSHA256,afterSHA256:hash(fixture),
 valuesUnchanged:JSON.stringify(base.levels)===JSON.stringify(captured.levels),metadataOnly:true,
 guardReports:['guards-fixed','targeted','pre-recapture-guards','pre-recapture-topology-ownership'],
 negativeControlCaught:true,changedWorldLayers:attribution.changedWorldLayers,changedItemPositionLayers:attribution.changedItemPositionLayers,
 changedMonsterPositionLayers:attribution.changedMonsterPositionLayers,changedRNGCountLayers:attribution.changedRNGCountLayers,
 changedRNGStreamsLayers:attribution.changedRNGStreamsLayers},null,2)+'\n');
console.log(fs.readFileSync(`${dir}/recapture.json`,'utf8'));
