import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {affectedCE,machineScene,observeFromOrigin} from '../src/test/fixtures/u19a-machine-scenes';
const g:any=createHeadlessGame(19,'test'),rows:any[]=[];
for(const ce of affectedCE){
 let chosen:any=null;
 for(let size=0;size<3&&!chosen;size++)for(let seed=1;seed<=100&&!chosen;seed++){
  const scene=machineScene(g,ce,seed,size);if(!scene)continue;
  if(!scene.snapshots.some(s=>s.placements.length))continue;
  const observation=observeFromOrigin(g,scene);
  if(!observation.before.some(t=>t.visible)&&!observation.after.some(t=>t.visible))continue;
  chosen={ce,seed,size,origin:scene.origin,snapshots:scene.snapshots.map(({view,...s})=>s),features:scene.result.featureSpawns,observation};
 }
 rows.push(chosen??{ce,missing:true});console.log(ce,chosen?{seed:chosen.seed,size:chosen.size,features:chosen.snapshots.map((s:any)=>[s.feature,s.placements.length]),visible:chosen.observation.after.filter((t:any)=>t.visible).length}:'MISSING');
}
fs.writeFileSync('ai_docs/reports/u-19a-evidence/machines.json',JSON.stringify(rows)+'\n');
if(rows.some(r=>r.missing))process.exitCode=1;
