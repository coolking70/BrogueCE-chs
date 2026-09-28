import {it} from 'vitest';
import {writeFileSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {createHeadlessGame} from '../src/test/harness';
import {TerrainType as T} from '../src/engine/Map/Grid';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import {runAltarActions} from '../src/test/fixtures/u19e-machine-actions';
it('diagnoses the two complete natural placement scenes without changing them',()=>{
 const rows:any[]=[];setMachineObservationHook(()=>{});
 for(const [seed,depth] of [[424242,8],[20260916,15]]){
  const g:any=createHeadlessGame(seed);let machines:any[]=[];const populate=g.populateLevel.bind(g);
  g.populateLevel=(...args:any[])=>{const r=populate(...args);machines=args[3];return r;};
  g.startNewGame({seed,mode:'normal'});for(let d=2;d<=depth!;d++){g.depth=d;g.generateDepth(false,false);}
  console.log('scene',seed,depth,g.depth,g.items.map((i:any)=>({id:i.identityId,loc:i.loc,layers:g.grid.getCell(i.loc.x,i.loc.y)?.layers.map((t:T)=>T[t])})));
  for(const item of g.items.filter((i:any)=>!g.grid.getCell(i.loc.x,i.loc.y)?.isPassable)){
   const machine=machines.find(m=>m.itemSpawns.some((s:any)=>s.entity===item));
   const row:any={seed,depth,item,snapshot:g.toSnapshot(),machine:machine?.observation,door:machine?.door,center:machine?.center};
   if(machine?.observation){const replay:any=createHeadlessGame(19,'test');replay.loadSnapshot(JSON.parse(JSON.stringify(row.snapshot)));
    try{row.result=runAltarActions(replay,machine.observation,machine.door??machine.center);}catch(e){row.error=String(e);}
    row.diagnostics=replay.u19fAltarDiagnostics;row.after=replay.toSnapshot();
   }
   rows.push(row);
   console.log(JSON.stringify({seed,depth,item:{identity:item.identityId,loc:item.loc},layers:g.grid.getCell(item.loc.x,item.loc.y)?.layers.map((t:T)=>T[t]),ce:machine?.observation?.ceBlueprintId,error:row.error}));
  }
 }
 setMachineObservationHook(null);writeFileSync('ai_docs/reports/x4-r2-evidence/placement-diagnostics.json.gz',gzipSync(JSON.stringify(rows)));
},180000);
