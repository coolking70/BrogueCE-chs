import {afterEach,expect,it} from 'vitest';
import {createHeadlessGame} from './harness';
import {setMachineObservationHook,type MachineTrace} from '../engine/Generator/MachineObservation';
import {TerrainType as T,DungeonLayer as L,Grid} from '../engine/Map/Grid';
import {finishWalls} from '../engine/Map/WallDoorFinish';
import {runCrystalWormActions} from './fixtures/u19f-machine-actions';
import cases from './fixtures/u19f-natural-cases.json';
afterEach(()=>setMachineObservationHook(null));

for(const row of cases)it(`U19f natural CE${row.ce}: generation → player activation → original reward → exit`,()=>{
 let traces:MachineTrace[]=[];setMachineObservationHook(()=>{});
 const g:any=createHeadlessGame(19,'test'),populate=g.populateLevel.bind(g);
 g.populateLevel=(...args:any[])=>{const r=populate(...args);traces=args[3].flatMap((m:any)=>m.observation?[m.observation]:[]);return r;};
 g.startNewGame({seed:row.seed,mode:'normal'});for(let d=2;d<=row.depth;d++){g.depth=d;g.generateDepth(false,false);}
 const trace=traces.find(t=>t.ceBlueprintId===row.ce&&t.machineNumber===row.machine);
 expect(trace,'machine must survive the final generation attempt').toBeDefined();
 const r=runCrystalWormActions(g,trace!,row.entry),phase=(name:string)=>r.phases.find(p=>p.label===name),count=(name:string,t:T)=>phase(name).tiles.filter((c:any)=>c.layers.includes(t)).length;
 const first=phase('entry'),last=phase('final');
 expect(last.player).toEqual(r.entry);expect(last.depth).toBe(row.depth);expect(last.hp).toBeGreaterThan(0);
 expect(first.inventory).not.toContain(r.rewardId);expect(last.inventory.filter((id:number)=>id===r.rewardId)).toHaveLength(1);
 if(row.ce===52){
  const crystals=count('entry',T.ELECTRIC_CRYSTAL_OFF);expect(crystals).toBeGreaterThanOrEqual(3);
  expect(first.residents).toHaveLength(crystals);expect(first.residents.every((m:any)=>m.dormant)).toBe(true);
  expect(phase('turrets').residents.every((m:any)=>!m.dormant)).toBe(true);
  expect(count('charged',T.ELECTRIC_CRYSTAL_OFF)).toBe(0);expect(count('charged',T.ELECTRIC_CRYSTAL_ON)).toBe(crystals);
  expect(count('entry',T.ALTAR_CAGE_RETRACTABLE)).toBe(1);expect(count('charged',T.ALTAR_CAGE_RETRACTABLE)).toBe(0);
 }else{
  expect(count('entry',T.WALL_LEVER_HIDDEN)).toBe(1);expect(count('searched',T.WALL_LEVER)).toBe(1);expect(count('pulled',T.WALL_LEVER_PULLED)).toBe(1);
  expect(count('entry',T.WORM_TUNNEL_MARKER_DORMANT)).toBeGreaterThan(0);
  expect(count('pulled',T.WORM_TUNNEL_MARKER_ACTIVE)).toBeGreaterThan(0);expect(count('opened',T.WORM_TUNNEL_MARKER_ACTIVE)).toBe(0);
  expect(count('opened',T.FLOOR)).toBeGreaterThan(count('entry',T.FLOOR));
  expect(first.residents.length).toBeGreaterThanOrEqual(3);expect(first.residents.length).toBeLessThanOrEqual(6);
  expect(first.residents.every((m:any)=>m.name==='Underworm'&&!m.dormant)).toBe(true);
  expect(last.residents.filter((m:any)=>first.residents.some((w:any)=>w.id===m.id))).toEqual([]);
 }
 expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);
 expect(g.player.inventory.items.filter((i:any)=>i.id===r.rewardId)).toHaveLength(1);
},120000);

it('U19f wall finishing preserves liquid tunnel starters and all non-dungeon layers',()=>{
 const grid=new Grid(79,29);
 grid.setTerrain(20,10,T.FLOOR);grid.setTerrain(21,10,T.GRANITE);
 grid.setTerrainLayer(21,10,L.LIQUID,T.WORM_TUNNEL_MARKER_DORMANT);
 grid.setTerrainLayer(21,10,L.SURFACE,T.BONES);grid.setTerrainLayer(21,10,L.GAS,T.METHANE_GAS);
 const cell=grid.getCell(21,10)!;cell.volume=50;cell.machineNumber=7;
 finishWalls(grid,true);
 expect(cell.layers).toEqual([T.WALL,T.WORM_TUNNEL_MARKER_DORMANT,T.METHANE_GAS,T.BONES]);
 expect(cell.volume).toBe(50);expect(cell.machineNumber).toBe(7);
});
