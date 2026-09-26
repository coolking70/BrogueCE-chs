import fs from 'node:fs';import {createHeadlessGame} from '../src/test/harness';import {Game} from '../src/engine/Core/Game';import {TerrainType as T} from '../src/engine/Map/Grid';import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
let machines:any[]=[];setMachineObservationHook(()=>{});const populate=(Game.prototype as any).populateLevel;
(Game.prototype as any).populateLevel=function(...args:any[]){const r=populate.apply(this,args);machines=args[3];return r;};
const g:any=createHeadlessGame(42);g.depth=2;g.generateDepth(false,false);const item=g.items.find((i:any)=>i.x===33&&i.y===8),machine=machines.find(m=>m.itemSpawns.some((s:any)=>s.entity===item));
fs.writeFileSync('ai_docs/reports/u-19f-evidence/item-probe.json',JSON.stringify({item,layers:g.grid.getCell(33,8).layers.map((t:T)=>T[t]),machine},null,2)+'\n');
