import fs from 'node:fs';import {createHeadlessGame} from '../src/test/harness';import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';import {runAltarActions} from '../src/test/fixtures/u19e-machine-actions';
setMachineObservationHook(()=>{});const cases:any[]=[],results:any[]=[];
for(const seed of [42,2026]){
 const g:any=createHeadlessGame(seed);let machines:any[]=[];const populate=g.populateLevel.bind(g);g.populateLevel=(...args:any[])=>{const r=populate(...args);machines=args[3];return r;};g.startNewGame({seed,mode:'normal'});
 for(let depth=1;depth<=26;depth++){
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  for(const m of machines.filter(m=>m.observation?.ceBlueprintId===47))cases.push({seed,depth,origin:m.door??m.center,trace:JSON.parse(JSON.stringify(m.observation)),snapshot:JSON.parse(JSON.stringify(g.toSnapshot()))});
 }
}
for(const c of cases)for(const mode of ['origin']){
 const g:any=createHeadlessGame(19,'test');g.loadSnapshot(c.snapshot);
 try{const r=runAltarActions(g,c.trace,mode==='origin'?c.origin:undefined);results.push({seed:c.seed,depth:c.depth,machine:c.trace.machineNumber,mode,origin:c.origin,entry:r.entry,success:true,commands:r.commands.length});}
 catch(e){results.push({seed:c.seed,depth:c.depth,machine:c.trace.machineNumber,mode,origin:c.origin,error:String(e),player:g.player.loc,depthAfter:g.depth,target:[...g.monsters,...g.dormantMonsters].filter((m:any)=>m.markedForSacrifice),diagnostics:g.u19fAltarDiagnostics});}
 console.log(c.seed,c.depth,mode,results.at(-1).success??results.at(-1).error);
 fs.writeFileSync('ai_docs/reports/u-19f-evidence/altar-l1-probe.json',JSON.stringify(results,null,2)+'\n');
}
