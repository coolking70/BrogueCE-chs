import {it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import {runMachineActions} from '../src/test/fixtures/u19d-machine-actions';
import {runCrystalWormActions} from '../src/test/fixtures/u19f-machine-actions';
const out='ai_docs/reports/x4-r2-evidence';
it('replaces only drifted natural scene coordinates, retaining complete action proofs',()=>{
 const census=readFileSync(`${out}/census-after-levels.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s));
 const rows:any[]=[],failures:any[]=[];
 for(const ce of [35,40,52]){
  for(const candidate of census.filter(r=>r.blueprints[ce]).slice(0,10)){
   let machines:any[]=[];setMachineObservationHook(()=>{});
   const g:any=createHeadlessGame(19,'test'),populate=g.populateLevel.bind(g);
   g.populateLevel=(...args:any[])=>{const r=populate(...args);machines=args[3];return r;};
   g.startNewGame({seed:candidate.seed,mode:'normal'});
   for(let d=2;d<=candidate.depth;d++){g.depth=d;g.generateDepth(false,false);}
   const m=machines.find(m=>m.observation?.ceBlueprintId===ce);
   if(!m){failures.push({ce,seed:candidate.seed,depth:candidate.depth,error:'missing'});continue;}
   try{
    const entry=m.door??m.center;
    const result=ce===52?runCrystalWormActions(g,m.observation,entry):runMachineActions(g,m.observation);
    const last=result.phases[result.phases.length-1];
    expect(last.player).toEqual(result.entry);expect(last.inventory.filter((id:number)=>id===result.rewardId)).toHaveLength(1);
    rows.push({ce,seed:candidate.seed,depth:candidate.depth,machine:m.machineNumber,entry:result.entry,commands:result.commands.length});break;
   }catch(e){failures.push({ce,seed:candidate.seed,depth:candidate.depth,error:String(e)});}
  }
 }
 setMachineObservationHook(null);writeFileSync(`${out}/replacement-scenes.json`,JSON.stringify({rows,failures},null,2)+'\n');
 expect(rows.map(r=>r.ce)).toEqual([35,40,52]);
});
it('finds a natural public-recording seed with all three original inventory prerequisites',()=>{
 const wanted=['wand_of_slowness','scroll_of_enchantment','potion_of_strength'];
 const candidates:any[]=[];
 // Both seeds were already observed with these products in the R2 census.
 for(const seed of [1453227,764274]){
  const g=createHeadlessGame(seed,'wizard');
  if(wanted.every(id=>g.items.some(i=>(i.identityId??i.consumableId)===id)))candidates.push({seed,items:g.items.map(i=>({id:i.identityId??i.consumableId,loc:i.loc}))});
 }
 writeFileSync(`${out}/recording-seed-candidates.json`,JSON.stringify(candidates,null,2)+'\n');expect(candidates.length).toBeGreaterThan(0);
});
