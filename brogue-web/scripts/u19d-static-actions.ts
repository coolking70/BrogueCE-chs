import fs from 'node:fs';import {gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';import {machineScene} from '../src/test/fixtures/u19a-machine-scenes';
import {runMachineActions} from '../src/test/fixtures/u19d-machine-actions';import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
const out='ai_docs/reports/u-19d-evidence',rows:any[]=[],errors:any[]=[];setMachineObservationHook(()=>{});
for(const ce of [18,22,28,36,38,40,43,15]){
 let done=false;
 for(let seed=1;seed<=20&&!done;seed++){
  const g:any=createHeadlessGame(19,'test'),scene=machineScene(g,ce,seed,0,true);if(!scene)continue;
  if([36,38].includes(ce)&&!scene.result.featureSpawns.some(f=>f.terrain==='WALL_LEVER_HIDDEN'))continue;
  g.currentLevelDepth=g.depth;for(const l of g.levelSeeds)l.visited=false;g.levelSeeds[g.depth-1].visited=true;
  const trace=scene.result.observation!;
  // Game's population pass records actual item/monster identities on the trace.
  g.populateLevel(g.depth,false,false,[scene.result]);
  try{const r=runMachineActions(g,trace,ce===18||ce===22?{x:16,y:14}:undefined);const {initial,...rest}=r;
   rows.push({ce,seed,size:0,...rest});fs.writeFileSync(`${out}/static-start-ce${ce}.json.gz`,gzipSync(JSON.stringify(initial)));console.log(ce,seed,'PASS',r.commands.length);done=true;
  }catch(e){errors.push({ce,seed,error:String(e)});console.log(ce,seed,String(e));}
 }
}
fs.writeFileSync(`${out}/static-actions.json`,JSON.stringify({rows,errors},null,2)+'\n');
