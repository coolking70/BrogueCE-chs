import {describe, expect, it, afterEach, vi} from 'vitest';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {Grid, TerrainType as T, DungeonLayer as L, DCOLS, DROWS} from '../engine/Map/Grid';
import {computeMachineView} from '../engine/Generator/MachineView';
import {BlueprintEngine, type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import {FOVSys} from '../engine/Lighting/FOV';
import {T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION} from '../engine/Map/TerrainCatalog';
import {terrainFlagsOfCell} from '../engine/Map/DungeonFeature';
import {rng} from '../engine/Random';
import golden from './fixtures/u19a-ce-view.json';
import blueprints from '../data/blueprints.json';
import carriers from './fixtures/u19a-ce-carriers.json';
import {affectedCE,machineScene,observeFromOrigin} from './fixtures/u19a-machine-scenes';
import {createHeadlessGame} from './harness';

const VIEW='MF_IN_VIEW_OF_ORIGIN',PASS='MF_IN_PASSABLE_VIEW_OF_ORIGIN';
function arena(){const g=new Grid(DCOLS,DROWS);for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)g.setTerrain(x,y,T.FLOOR);return g;}
function digest(mask:boolean[][]){return crypto.createHash('sha256').update(Array.from({length:DROWS},(_,y)=>Array.from({length:DCOLS},(_,x)=>mask[x]![y]?'1':'0').join('')).join('')).digest('hex');}
afterEach(()=>vi.restoreAllMocks());

describe('U19a independent compiled CE visibility oracle',()=>{
 it('579 whole-map masks agree with the actual CE C scanner in both modes',()=>{
  for(const row of golden.cases){
   const g=arena();for(const [x,y] of row.blocked)g.setTerrain(x!,y!,T.GRANITE);
   for(const passable of [false,true])expect(digest(computeMachineView(g,row.origin,passable)),`${row.name}/${passable}`).toBe(row.mask);
  }
 });
 it('oracle source hashes pin the C inputs, and the old web scan demonstrably differs',()=>{
  for(const [file,key] of [['Movement.c','movement'],['Math.c','math']] as const){
   expect(crypto.createHash('sha256').update(readFileSync(`../BrogueCE-master/src/brogue/${file}`)).digest('hex')).toBe(golden.source[key]);
  }
  const row=golden.cases.find(c=>c.name==='patch-1')!,g=arena();for(const [x,y] of row.blocked)g.setTerrain(x!,y!,T.GRANITE);
  const old=new FOVSys(g).computeFOVMask(row.origin.x,row.origin.y,79,c=>!!(terrainFlagsOfCell(c)&(T_OBSTRUCTS_PASSABILITY|T_OBSTRUCTS_VISION)));
  expect(digest(old)).not.toBe(row.mask);
 });
});

describe('U19a candidate gates and feature-time snapshots',()=>{
 // A straight corridor independently fixes expected geometry, including the
 // obstructing tile itself. No call to computeMachineView supplies expectations.
 it.each([
  [T.FLOOR,L.DUNGEON,true,true], [T.DOOR,L.DUNGEON,false,true],
  [T.SECRET_DOOR,L.DUNGEON,false,false], [T.LOCKED_DOOR,L.DUNGEON,false,false],
  [T.WATER_DEEP,L.LIQUID,true,false], [T.LAVA,L.LIQUID,true,false],
  [T.CHASM,L.LIQUID,true,false], [T.PLAIN_FIRE,L.SURFACE,true,false],
  [T.FOLIAGE,L.SURFACE,false,true], [T.FORCEFIELD,L.SURFACE,false,false],
 ] as const)('layered obstruction %s/%s: ordinary=%s passable=%s',(tile,layer,ordinary,passable)=>{
  const g=arena();for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)g.setTerrain(x,y,T.GRANITE);
  for(let x=4;x<=10;x++)g.setTerrain(x,6,T.FLOOR);g.setTerrainLayer(6,6,layer,tile);
  const e:any=new BlueprintEngine(g,5,[]),origin={x:4,y:6},interior=new Set([6*DCOLS+8]);
  for(const [flag,want] of [[VIEW,ordinary],[PASS,passable]] as const){
   expect(e.cellIsFeatureCandidate(8,6,origin,interior,1,new Set([flag]),new Set())).toBe(want);
   expect(e.featureView(origin,new Set([flag]))[6][6]).toBe(true);
  }
  expect(e.cellIsFeatureCandidate(8,6,origin,interior,1,new Set([VIEW,PASS]),new Set())).toBe(passable);
  expect(e.cellIsFeatureCandidate(8,6,origin,interior,1,new Set(),new Set())).toBe(true);
 });
 it.each([VIEW,PASS])('integer-slope boundary rejects a cell the legacy scanner admits: %s',(flag)=>{
  const g=arena();g.setTerrain(37,12,T.GRANITE);const e:any=new BlueprintEngine(g,5,[]),origin={x:35,y:14};
  // CE patch-1: (38,10) is behind the blocker according to the center-slope scan.
  expect(e.cellIsFeatureCandidate(38,10,origin,new Set([10*DCOLS+38]),1,new Set([flag]),new Set())).toBe(false);
 });
 it('does not consume RNG or write player visibility/memory; radius is map-wide',()=>{
  const g=arena(),before=JSON.stringify(g),state=rng.getState();
  const view=computeMachineView(g,{x:0,y:0},false);
  expect(view[70]![0]).toBe(true);expect(view[78]![28]).toBe(false);expect(view[0]![0]).toBe(true);
  expect(JSON.stringify(g)).toBe(before);expect(rng.getState()).toEqual(state);
 });
 it('snapshots after preceding feature writes, once across EVERYWHERE/repeat, fresh on next feature/build',()=>{
  const g=arena(),e:any=new BlueprintEngine(g,5,[]),origin={x:4,y:6};
  const bp:BlueprintDef={id:'u19a-timing',name:'u19a-timing',category:'thematic',flags:['BP_NO_INTERIOR_FLAG'],depthRange:[1,26],roomSize:[1,100],frequency:0,features:[
   {terrain:'DOOR',layer:'DUNGEON',instanceCount:[1,1],personalSpace:1,flags:['MF_BUILD_AT_ORIGIN']},
   {terrain:'STATUE_INERT',layer:'DUNGEON',instanceCount:[1,1],minimumInstanceCount:1,personalSpace:1,flags:[VIEW,'MF_EVERYWHERE','MF_REPEAT_UNTIL_NO_PROGRESS']},
   {instanceCount:[0,0],personalSpace:1,flags:[PASS]},
  ]};
  const snapshots:any[]=[];const original=e.featureView.bind(e);const seen=new Set<Set<string>>();
  vi.spyOn(e,'featureView').mockImplementation((...args:any[])=>{
   const [p,flags]=args,view=original(p,flags);
   if(view&&!seen.has(flags)){seen.add(flags);snapshots.push({flags:[...flags],originTile:g.getCell(4,6)!.terrain,view});}
   return view;
  });
  rng.seedRandomGenerator(19);
  const result=e.applyBlueprint(bp,{cells:[origin,{x:5,y:6},{x:6,y:6},{x:7,y:6}],center:origin,door:null});
  expect(result).not.toBeNull();expect(snapshots).toHaveLength(2);expect(snapshots[0].originTile).toBe(T.DOOR);
  expect(result.featureSpawns.filter((f:any)=>f.featureIndex===1)).toHaveLength(3);
  const view=snapshots[0].view;expect(view[7][6]).toBe(true);
  expect(e.featureView(origin,new Set([VIEW]))[7][6]).toBe(false);
  expect(e.cellIsFeatureCandidate(4,6,origin,new Set(),1,new Set([VIEW,'MF_BUILD_AT_ORIGIN']),new Set(['BP_ROOM']))).toBe(true);
 });
 it('view cache remains isolated during reentrant child machine construction',()=>{
  const g=arena(),e:any=new BlueprintEngine(g,5,[]),outer=new Set([VIEW]),inner=new Set([VIEW]);
  const parent=e.featureView({x:4,y:6},outer);g.setTerrain(6,6,T.GRANITE);
  const child=e.featureView({x:8,y:6},inner);
  expect(child).not.toBe(parent);expect(e.featureView({x:4,y:6},outer)).toBe(parent);
  expect(parent[8][6]).toBe(true);expect(child[4][6]).toBe(false);
 });
 it('affected catalog is exactly 14 machines / 18 features, retaining literal flags',()=>{
  expect(crypto.createHash('sha256').update(readFileSync(carriers.file)).digest('hex')).toBe(carriers.sha256);
  for(const row of carriers.rows)expect((blueprints as BlueprintDef[]).find(b=>b.ceBlueprintId===row.ce)!.features[row.index]!.flags).toEqual(row.flags);
  const actual=(blueprints as BlueprintDef[]).flatMap(b=>b.features.flatMap((f,i)=>f.flags.some(x=>x===VIEW||x===PASS)?[[b.ceBlueprintId,i,f.flags.includes(PASS)?PASS:VIEW]]:[]));
  expect(actual.sort((a,b)=>Number(a[0])-Number(b[0])||Number(a[1])-Number(b[1]))).toEqual([
   [15,2,PASS],[18,2,PASS],[24,2,VIEW],[36,6,PASS],[37,0,VIEW],[38,6,PASS],[46,6,PASS],
   [49,0,VIEW],[49,1,VIEW],[55,5,PASS],[56,1,VIEW],[62,0,VIEW],[62,1,VIEW],[62,2,VIEW],[62,3,VIEW],[65,3,VIEW],[66,2,VIEW],[71,0,VIEW],
  ]);
 });
});

describe('U19a all affected machine writers -> player at origin -> search -> visible feature',()=>{
 it.each(affectedCE)('CE%i literal complete blueprint, including retired explicit fixtures',(ce)=>{
  const g=createHeadlessGame(19,'test'),scene=machineScene(g,ce,[36,38].includes(ce)?2:1)!;
  expect(scene).not.toBeNull();
  const expected=carriers.rows.filter(r=>r.ce===ce).map(r=>r.index);
  expect(scene.snapshots.map(s=>s.feature)).toEqual(expected);
  for(const snapshot of scene.snapshots){
   expect(snapshot.placements.length).toBeGreaterThan(0);
   expect(snapshot.accepted.length).toBeGreaterThan(0);
   for(const p of [...snapshot.accepted,...snapshot.placements])expect(snapshot.view[p.x][p.y]).toBe(true);
  }
  const observed=observeFromOrigin(g,scene);
  expect(observed.after.some(t=>t.visible)).toBe(true);
  // Every flagged feature (including all 4 camp decorations) has an observable
  // product. Wall-carried dormant monsters are represented by their terrain.
  for(const index of expected)expect(observed.after.filter(t=>t.feature===index).some(t=>t.visible)).toBe(true);
  for(const index of expected){
   const f=scene.bp.features[index]!;
   if(f.monsterId&&!f.terrain)expect(observed.before.filter(t=>t.feature===index).some(t=>t.occupants.length>0)).toBe(true);
  }
 });
});
