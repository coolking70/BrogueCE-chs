import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {machineScene} from '../src/test/fixtures/u19a-machine-scenes';
import {type MachineResult,resetMachineCounter} from '../src/engine/Generator/BlueprintEngine';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import catalog from '../src/data/blueprints.json';
const out='ai_docs/reports/u-19b-evidence',g:any=createHeadlessGame(19,'test');
const affected=catalog.filter(b=>Number.isInteger(b.ceBlueprintId)&&b.features.some((f:any,i)=>i<b.features.length-1&&(f.flags.includes('MF_GENERATE_ITEM')||f.flags.includes('MF_ADOPT_ITEM')||f.flags.includes('MF_GENERATE_HORDE')||f.monsterId))||b.flags.includes('BP_VESTIBULE')).map(b=>b.ceBlueprintId!);
const flat=(m:MachineResult):MachineResult[]=>[m,...m.subMachines.flatMap(flat)];
const rows=[];
setMachineObservationHook(()=>{});
for(const ce of affected){
 let scene:any=null,attempts=0,error='';
 for(const size of [0,1,2]){for(let seed=1;seed<=8;seed++){
  attempts++;resetMachineCounter();try{scene=machineScene(g,ce,seed,size);}catch(e){error=String(e);}
  if(scene)break;
 }if(scene)break;}
 if(!scene){rows.push({ce,attempts,error:error||'no fixed site succeeded'});console.log(ce,'FAILED');continue;}
 try{
  const machines=flat(scene.result);g.populateLevel(g.depth,false,false,machines);
  g.player.loc={...scene.origin};g.updateVision();const before=g.recordedInputEvents.length;
  g.handlePlayerAction('search');g.updateVision();
  const products=machines.flatMap(m=>m.observation?.products??[]).filter(p=>p.kind==='item'||p.kind==='monster');
  const visible=products.filter(p=>g.grid.getCell(p.pos.x,p.pos.y)?.isVisible);
  rows.push({ce,seed:scene.seed,size:scene.size,attempts,origin:scene.origin,action:'search',recorded:g.recordedInputEvents.length-before,products,visible});console.log(ce,scene.seed,scene.size,products.length,visible.length);
 }catch(e){rows.push({ce,seed:scene.seed,size:scene.size,attempts,error:String(e)});console.log(ce,'MATERIALIZATION FAILED',String(e));}
}
fs.writeFileSync(`${out}/scenes-discovery.json`,JSON.stringify(rows,null,2)+'\n');
