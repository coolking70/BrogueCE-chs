import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import crypto from 'node:crypto';
import {TerrainType as T,DungeonLayer as L,DRAW_PRIORITY} from '../engine/Map/Grid';
import {TERRAIN_FLAGS} from '../engine/Map/TerrainCatalog';
import {LightKind} from '../engine/Map/LightCatalog';
import {DF,DUNGEON_FEATURE_CATALOG as D,DF_MISSING_TILES} from '../engine/Map/DungeonFeatureCatalog';
import {AUTO_GENERATOR_CATALOG as A,RETIRED_AUTOGENERATOR_MACHINES} from '../engine/Map/AutoGenerator';
import {blueprintQualifies,RETIRED_INVENTED_BLUEPRINT_IDS,type BlueprintDef} from '../engine/Generator/BlueprintEngine';
import blueprints from '../data/blueprints.json';
import {MonsterState} from '../entities/Monster';
import golden from './fixtures/u19f-ce-catalog.json';
import {restoredAutoRows,runAutoActions} from './fixtures/u19f-auto-actions';

const terrain=(name:string)=>T[(({DEEP_WATER:'WATER_DEEP'} as Record<string,string>)[name]??name) as keyof typeof T];
describe('U19f complete CE directory contracts',()=>{
 it('21 appended tiles and 24 DF rows retain every CE behavioral field',()=>{
  for(const [file,hash] of Object.entries(golden.sources))expect(crypto.createHash('sha256').update(readFileSync(file)).digest('hex')).toBe(hash);
  expect(T.PORTAL_LIGHT).toBe(168);expect(T.FUNGUS_FOREST).toBe(169);
  for(const [name,row] of Object.entries(golden.tiles)){
   const {line,literal,description,flavorText,drawPriority,glowLight,...expected}=row;
   expect(line).toBeGreaterThan(0);expect(literal.length).toBe(14);expect(description).not.toBe('');expect(typeof flavorText).toBe('string');
   expect(TERRAIN_FLAGS[terrain(name)]).toEqual({...expected,glowLight:LightKind[glowLight as keyof typeof LightKind],webOnly:false});
   expect(DRAW_PRIORITY[terrain(name)]).toBe(drawPriority);
  }
  for(const [name,row] of Object.entries(golden.dfs)){
   const id=DF[name as keyof typeof DF];expect(id).toBe(row.id);
   expect(D[id]).toEqual({id,ceLine:row.line,ceTile:row.tile,tile:terrain(row.tile),layer:L[row.layer as keyof typeof L],startProbability:row.startProbability,probabilityDecrement:row.probabilityDecrement,flags:row.flags,description:row.description,lightFlare:row.lightFlare,flashColor:row.flashColor,effectRadius:row.effectRadius,cePropagationTerrain:row.propagationTerrain,propagationTerrain:row.propagationTerrain?terrain(row.propagationTerrain):null,subsequentDF:row.subsequentDF?DF[row.subsequentDF as keyof typeof DF]:null});
  }
  expect(DF_MISSING_TILES).toEqual([]);
 });
 it('all 49 autoGen rows match CE columns and all 48 executable rows are connected',()=>{
  expect(A).toHaveLength(49);expect(RETIRED_AUTOGENERATOR_MACHINES.size).toBe(0);
  for(const r of golden.autogen){
   expect(A[r.index]).toMatchObject({index:r.index,ceLine:r.line,ceTerrain:r.terrain,layer:L[r.layer as keyof typeof L],ceDf:r.df,ceDfId:r.dfId,ceMachine:r.machine,machine:r.machineId,requiredDungeonFoundationType:terrain(r.foundation[0]!),requiredLiquidFoundationType:terrain(r.foundation[1]!),minDepth:r.minDepth,maxDepth:r.maxDepth,frequency:r.frequency,minNumberIntercept:r.minNumberIntercept,minNumberSlope:r.minNumberSlope,maxNumber:r.maxNumber,carrier:r.index===0?'dead-index0':'wired'});
   if(r.index){expect(A[r.index]!.terrain).toBe(r.terrain==='0'?null:terrain(r.terrain));expect(A[r.index]!.df).toBe(r.df==='0'?null:r.dfId);}
  }
 });
 it('every CE blueprint qualifies under its own flags/depth, only D2 inventions retire',()=>{
  for(const bp of blueprints as BlueprintDef[]){
   const flags=bp.category==='key_guard'?['BP_ADOPT_ITEM']:bp.flags.filter(f=>['BP_ADOPT_ITEM','BP_VESTIBULE'].includes(f));
   expect(blueprintQualifies(bp,bp.depthRange[0],flags),bp.id).toBe(!RETIRED_INVENTED_BLUEPRINT_IDS.has(bp.id));
  }
 });
});

describe('U19f per-row generation → real player action',()=>{
 for(const index of restoredAutoRows)it(`autoGen row ${index} has its CE consumer`,()=>{
  const r=runAutoActions(index),at=(label:string)=>r.phases.find(p=>p.label===label),first=at('generated'),last=at('final');
  expect(r.stats.totalBuilt).toBeGreaterThan(0);expect(r.commands.length).toBeGreaterThan(0);
  expect(first.target).toContain(r.tile);expect(last.hp).toBeGreaterThan(0);
  if([22,24,26,28].includes(index))expect(at('searched').target).not.toContain(r.tile);
  if([15,22].includes(index)){expect(at('interacted').target).toContain(T.NETTING);expect(at('interacted').stuck).toBeGreaterThan(0);expect(at('escaped').player).toEqual(r.entry);expect(at('escaped').target).not.toContain(T.NETTING);}
  else if([17,24].includes(index)){expect(first.witness).toBe(MonsterState.ASLEEP);expect(last.witness).toBe(MonsterState.HUNTING);}
  else if([18,26].includes(index))expect(at('confused').confused).toBeGreaterThan(0);
  else if([20,28].includes(index))expect((last.terrainCounts.FLOOD_WATER_DEEP??0)+(last.terrainCounts.FLOOD_WATER_SHALLOW??0)).toBeGreaterThan(0);
  else if(index===9){expect(at('interacted').target).toContain(T.TRAMPLED_FUNGUS_FOREST);expect(at('regrown').target).toContain(T.FUNGUS_FOREST);}
  else if(index===10){expect(at('bloomed').terrainCounts.DEEP_WATER_ALGAE_2).toBeGreaterThan(0);expect(at('entered').player).toEqual(r.target);}
  else if(index===32){expect(at('steam').terrainCounts.STEAM).toBeGreaterThan(0);expect(at('entered').hp).toBeLessThan(at('steam').hp);}
  else if(index>=34&&index<=37){expect(at('interacted').target).not.toContain(r.tile);expect(at('interacted').target).toContain(T.BROKEN_GLASS);expect(at('interacted').terrainCounts[['POISON_GAS','CONFUSION_GAS','PARALYSIS_GAS','METHANE_GAS'][index-34]!]).toBeGreaterThan(0);expect(at('interacted').player).toEqual(r.entry);}
  else if(r.obstructing){expect(last.player).toEqual(r.entry);expect(last.target).toContain(r.tile);}
  else expect(last.player).toEqual(r.target);
  if([2,9,13,30,38].includes(index))expect(first.light).toBeGreaterThan(0);
  const saved=JSON.parse(JSON.stringify(r.game.toSnapshot()));expect(r.game.loadSnapshot(saved)).toBe(true);
  expect(r.game.grid.getCell(r.target.x,r.target.y).layers).toEqual(last.target);
 });
});
