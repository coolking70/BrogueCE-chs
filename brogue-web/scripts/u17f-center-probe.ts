import fs from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {BlueprintEngine, type MachineResult} from '../src/engine/Generator/BlueprintEngine';
import {TerrainType as T} from '../src/engine/Map/Grid';
const original=BlueprintEngine.prototype.buildMachines;let machines:MachineResult[]=[];
BlueprintEngine.prototype.buildMachines=function(){const r=original.call(this);machines=r;return r;};
const g:any=createHeadlessGame(1);for(let depth=2;depth<=12;depth++){g.depth=depth;g.generateDepth(false,false);}
const loc={x:62,y:26};const result={cell:g.grid.getCell(loc.x,loc.y),items:g.items.filter((i:any)=>i.x===loc.x&&i.y===loc.y),monsters:[...g.monsters,...g.dormantMonsters].filter((i:any)=>i.x===loc.x&&i.y===loc.y),machines};
fs.writeFileSync('ai_docs/reports/u-17f-evidence/center-probe.json',JSON.stringify(result,null,2)+'\n');console.log(result.items.map((i:any)=>[i.id,i.identityId]),result.cell.layers.map((t:T)=>T[t]));
