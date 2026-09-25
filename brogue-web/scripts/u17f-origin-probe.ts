import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {BlueprintEngine, type MachineResult} from '../src/engine/Generator/BlueprintEngine';
import blueprints from '../src/data/blueprints.json';
const original=BlueprintEngine.prototype.buildMachines;
let machines:MachineResult[]=[];
BlueprintEngine.prototype.buildMachines=function(){const r=original.call(this);machines.push(...r);return r;};
const hits=[];
for(let seed=33;seed<=100&&!hits.length;seed++){
 machines=[];const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=26;depth++){
  if(depth>1){machines=[];g.depth=depth;g.generateDepth(false,false);}
  const walk=(m:MachineResult):MachineResult[]=>[m,...m.subMachines.flatMap(walk)];
  for(const m of machines.flatMap(walk)){
   const bp=blueprints.find(b=>b.id===m.blueprintId)!;
   if(!bp||bp.flags.includes('BP_ROOM')||bp.flags.includes('BP_VESTIBULE'))continue;
   for(const i of g.items)if(i.x===m.center.x&&i.y===m.center.y&&m.itemSpawns.some(s=>s.pos.x===i.x&&s.pos.y===i.y))hits.push({seed,depth,bp:m.blueprintId,loc:i.loc,id:i.identityId,category:i.category});
  }
 }
 console.log(seed,hits.length);
}
fs.writeFileSync('ai_docs/reports/u-17f-evidence/origin-probe.json',JSON.stringify(hits,null,2)+'\n');
