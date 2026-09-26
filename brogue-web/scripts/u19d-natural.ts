import fs from 'node:fs';import {gzipSync} from 'node:zlib';
import {Game} from '../src/engine/Core/Game';
import {createHeadlessGame} from '../src/test/harness';
import {setMachineObservationHook,type MachineTrace} from '../src/engine/Generator/MachineObservation';
const out='ai_docs/reports/u-19d-evidence',targets=[18,21,22,23,28,29,35,36,38,40,43,67,68,69],rows:any[]=[],counts:Record<string,number>={};
let traces:MachineTrace[]=[];setMachineObservationHook(()=>{});
const populate=(Game.prototype as any).populateLevel;
(Game.prototype as any).populateLevel=function(...args:any[]){const result=populate.apply(this,args);traces=(args[3]??[]).flatMap((m:any)=>m.observation?[m.observation]:[]);return result;};
const seeds=[424242,777,31337,20260913,...Array.from({length:60},(_,i)=>i+1)];
for(const seed of seeds){
 traces=[];const g:any=createHeadlessGame(seed);
 const end=seed>60?26:13;
 for(let depth=1;depth<=end;depth++){
  if(depth>1){traces=[];g.depth=depth;g.generateDepth(false,false);}
  const machines=traces.filter(t=>t.status==='committed'&&targets.includes(t.ceBlueprintId!));
  for(const m of machines)counts[m.ceBlueprintId!]=(counts[m.ceBlueprintId!]??0)+1;
  const candidates=machines.filter(m=>rows.filter(r=>r.ce===m.ceBlueprintId).length<12);
  if(candidates.length){
   const file=`natural-${seed}-${depth}.json.gz`;fs.writeFileSync(`${out}/${file}`,gzipSync(JSON.stringify(g.toSnapshot())));
   for(const m of candidates)rows.push({seed,depth,ce:m.ceBlueprintId,machine:m.machineNumber,file,trace:m});
  }
 }
 console.log(seed,JSON.stringify(counts));
 fs.writeFileSync(`${out}/natural-index.json`,JSON.stringify({counts,rows},null,2)+'\n');
 if(targets.every(ce=>rows.filter(r=>r.ce===ce).length>=2))break;
}
setMachineObservationHook(null);
