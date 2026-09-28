import {it,expect,afterEach} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHeadlessGame} from '../src/test/harness';
import {setMachineObservationHook} from '../src/engine/Generator/MachineObservation';
import {TerrainType as T} from '../src/engine/Map/Grid';
import {runCrystalWormActions} from '../src/test/fixtures/u19f-machine-actions';
const out='ai_docs/reports/x4-r2-evidence';
afterEach(()=>setMachineObservationHook(null));
it('validates independent CE52 feature counts and complete original action guards',()=>{
 const census=readFileSync(`${out}/census-after-levels.jsonl`,'utf8').trim().split('\n').map(s=>JSON.parse(s));
 const failures:any[]=[],validated:any[]=[];
 for(const candidate of census.filter(r=>r.blueprints[52])){
  let machines:any[]=[];setMachineObservationHook(()=>{});
  const g:any=createHeadlessGame(19,'test'),populate=g.populateLevel.bind(g);
  g.populateLevel=(...args:any[])=>{const r=populate(...args);machines=args[3];return r;};
  g.startNewGame({seed:candidate.seed,mode:'normal'});
  for(let d=2;d<=candidate.depth;d++){g.depth=d;g.generateDepth(false,false);}
  const m=machines.find(m=>m.observation?.ceBlueprintId===52);
  if(!m){failures.push({seed:candidate.seed,depth:candidate.depth,error:'missing'});continue;}
  try{
   const r=runCrystalWormActions(g,m.observation,m.door??m.center);
   const phase=(name:string)=>r.phases.find(p=>p.label===name),count=(name:string,t:T)=>phase(name).tiles.filter((c:any)=>c.layers.includes(t)).length;
   const first=phase('entry'),last=phase('final');
   expect(last.player).toEqual(r.entry);expect(last.depth).toBe(candidate.depth);expect(last.hp).toBeGreaterThan(0);
   expect(first.inventory).not.toContain(r.rewardId);expect(last.inventory.filter((id:number)=>id===r.rewardId)).toHaveLength(1);
   const crystals=count('entry',T.ELECTRIC_CRYSTAL_OFF);expect(crystals).toBeGreaterThanOrEqual(3);expect(crystals).toBeLessThanOrEqual(4);
   const levers=first.tiles.filter((c:any)=>c.layers.includes(T.TURRET_LEVER));
   expect(levers.length).toBeGreaterThanOrEqual(4);expect(levers.length).toBeLessThanOrEqual(9);
   expect(first.residents).toHaveLength(levers.length);
   for(const lever of levers)expect(first.residents.filter((m:any)=>m.loc.x===lever.x&&m.loc.y===lever.y)).toHaveLength(1);
   expect(first.residents.every((m:any)=>m.dormant)).toBe(true);
   expect(phase('turrets').residents.every((m:any)=>!m.dormant)).toBe(true);
   expect(count('charged',T.ELECTRIC_CRYSTAL_OFF)).toBe(0);expect(count('charged',T.ELECTRIC_CRYSTAL_ON)).toBe(crystals);
   expect(count('entry',T.ALTAR_CAGE_RETRACTABLE)).toBe(1);expect(count('charged',T.ALTAR_CAGE_RETRACTABLE)).toBe(0);
   expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);
   expect(g.player.inventory.items.filter((i:any)=>i.id===r.rewardId)).toHaveLength(1);
   validated.push({seed:candidate.seed,depth:candidate.depth,ce:52,machine:m.machineNumber,entry:r.entry,crystals,turrets:levers.length,commands:r.commands.length,rewardId:r.rewardId,phases:r.phases});
  }catch(e){failures.push({seed:candidate.seed,depth:candidate.depth,error:String(e)});}
 }
 writeFileSync(`${out}/ce52-independent-feature-counts.json`,JSON.stringify({validated,failures},null,2)+'\n');
 expect(failures).toEqual([]);expect(validated).toHaveLength(4);
});
