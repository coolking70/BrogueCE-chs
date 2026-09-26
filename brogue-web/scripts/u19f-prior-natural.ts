import {TerrainType as T} from '../src/engine/Map/Grid';
import fs from 'node:fs';import {gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';import {Game} from '../src/engine/Core/Game';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import {runAltarActions} from '../src/test/fixtures/u19e-machine-actions';
import {runMachineActions} from '../src/test/fixtures/u19d-machine-actions';
const out='ai_docs/reports/u-19f-evidence',rows:any[]=[],errors:any[]=[];let traces:any[]=[],entries=new Map<number,any>();
const targets=[1,6,7,26,18,22,28];
setMachineObservationHook(()=>{});const populate=(Game.prototype as any).populateLevel;
(Game.prototype as any).populateLevel=function(...args:any[]){const r=populate.apply(this,args);entries=new Map(args[3].map((m:any)=>[m.machineNumber,m.door??m.center]));traces=args[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
for(const seed of [424242,777,31337,20260913,...Array.from({length:60},(_,i)=>i+1)]){
 const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=26;depth++){
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  for(const t of traces.filter(t=>targets.includes(t.ceBlueprintId)&&!rows.some(r=>r.ce===t.ceBlueprintId))){
   const origin=entries.get(t.machineNumber);const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));const h=createHeadlessGame(19,'test');if(!h.loadSnapshot(snapshot))throw Error('load');
   try{const entry=origin,r=[1,2,6,7,26,47].includes(t.ceBlueprintId)?runAltarActions(h,t,entry):runMachineActions(h,t);if(r.rewardId!==undefined&&!r.after.inventory.includes(r.rewardId))throw Error('reward missing');
    const phase=(name:string)=>r.phases.find(p=>p.label===name);
    if(t.ceBlueprintId===18&&h.player.inventory.items.find(i=>i.id===r.rewardId)?.category!==10)throw Error('requires original key reward');
    if([22,28].includes(t.ceBlueprintId)){const q=phase('thrown');if(!r.before.tiles.some((c:any)=>c.layers.includes(T.TRAP_DOOR))||q.tiles.some((c:any)=>[T.ALTAR_CAGE_RETRACTABLE,T.PORTCULLIS_CLOSED,T.WORM_TUNNEL_OUTER_WALL].some(v=>c.layers.includes(v))))throw Error('plate branch or gate not complete');}

    const {initial,...rest}=r;fs.writeFileSync(`${out}/prior-natural-start-ce${t.ceBlueprintId}.json.gz`,gzipSync(JSON.stringify(initial)));
    rows.push({seed,depth,ce:t.ceBlueprintId,machine:t.machineNumber,...rest,entry});console.log('pass',t.ceBlueprintId,seed,depth);
   }catch(e){errors.push({seed,depth,ce:t.ceBlueprintId,machine:t.machineNumber,error:String(e)});}finally{if(!g.loadSnapshot(snapshot))throw Error('source restore');}
  }
 }
 fs.writeFileSync(`${out}/prior-natural-strict.json`,JSON.stringify({rows,errors},null,2)+'\n');console.log('seed',seed,'found',rows.map(r=>r.ce));if(rows.length===targets.length)break;
}
fs.writeFileSync(`${out}/prior-natural-strict.json`,JSON.stringify({rows,errors},null,2)+'\n');
