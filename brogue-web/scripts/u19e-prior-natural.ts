import fs from 'node:fs';import {gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';import {Game} from '../src/engine/Core/Game';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import {runMachineActions} from '../src/test/fixtures/u19d-machine-actions';
const out='ai_docs/reports/u-19e-evidence',rows:any[]=[],errors:any[]=[];let traces:any[]=[];
setMachineObservationHook(()=>{});const populate=(Game.prototype as any).populateLevel;
(Game.prototype as any).populateLevel=function(...args:any[]){const r=populate.apply(this,args);traces=args[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
for(const seed of [12,19,...Array.from({length:20},(_,i)=>i+1)]){
 const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=13;depth++){
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  for(const t of traces.filter(t=>[40,43].includes(t.ceBlueprintId)&&!rows.some(r=>r.ce===t.ceBlueprintId))){
   const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));const h=createHeadlessGame(19,'test');if(!h.loadSnapshot(snapshot))throw Error('load');
   try{const r=runMachineActions(h,t);if(!r.after.inventory.includes(r.rewardId))throw Error('reward missing');
    const {initial,...rest}=r;fs.writeFileSync(`${out}/prior-natural-start-ce${t.ceBlueprintId}.json.gz`,gzipSync(JSON.stringify(initial)));
    rows.push({seed,depth,ce:t.ceBlueprintId,machine:t.machineNumber,...rest});console.log('pass',t.ceBlueprintId,seed,depth);
   }catch(e){errors.push({seed,depth,ce:t.ceBlueprintId,machine:t.machineNumber,error:String(e)});}finally{if(!g.loadSnapshot(snapshot))throw Error('source restore');}
  }
 }
 if(rows.length===2)break;
}
fs.writeFileSync(`${out}/prior-natural-retarget.json`,JSON.stringify({rows,errors},null,2)+'\n');
