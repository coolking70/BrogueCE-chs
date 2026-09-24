import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DungeonLayer as L, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { staffBladeCount, bladeSpawnLocation } from '../engine/Combat/Conjuration';
import { getBoltForItem, BoltEffect } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { CombatSystem } from '../engine/Combat/Combat';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Player } from '../entities/Player';
import { Monster, MonsterState, countMinions, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';

function floor(w=DCOLS,h=DROWS) {
 const grid=new Grid(w,h);
 for(let x=0;x<w;x++)for(let y=0;y<h;y++){
  grid.setTerrain(x,y,x===0||y===0||x===w-1||y===h-1?T.WALL:T.FLOOR);
  Object.assign(grid.getCell(x,y)!,{isVisible:true,hasMemory:true});
 }
 return grid;
}
function install(g:Game) {
 g.grid=floor();g.player=new Player(4,5);g.monsters=[];g.dormantMonsters=[];g.items=[];
 g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
 g.spawnFloatingText=vi.fn();g.stats={kills:0,gold:0,turns:0,maxDepth:1};
 return g;
}
function scene(){const g=install(Object.create(Game.prototype));(g as any).updateVision=vi.fn();return g;}
function live(){const g=install(createHeadlessGame(1616,'test'));g.player.ticksUntilTurn=0;return g;}
function mob(g:Game,id='rat',x=12,y=5){const m=new Monster(x,y,(monsters as MonsterData[]).find(d=>d.id===id)!);g.monsters.push(m);return m;}
function staff(e=2){const item=ItemLoader.spawnStaff('staff_of_conjuration',-1,-1)!;Object.assign(item,{enchantment:e,charges:1,maxCharges:99});return item;}
const bolt=()=>getBoltForItem('staff_of_conjuration')!;
function cast(g:Game,e=2,to={x:10,y:5}){return g.zapBoltFromPlayer(bolt(),staff(e),to);}
const blades=(g:Game)=>g.monsters.filter(m=>m.typeId==='spectral_blade');
function single(g:Game,x=10,y=5){g.grid.setTerrain(x+1,y,T.WALL);cast(g,1,{x,y});const b=blades(g)[0]!;g.grid.setTerrain(x+1,y,T.FLOOR);return b;}
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(1616);ItemLoader.identifiedItems.clear();});

describe('W-16 CE fixed point golden and actual detonation',()=>{
 it('matches clang-compiled unmodified staffBladeCount for 81 fixed-point inputs',()=>{
  const values=fs.readFileSync('ai_docs/reports/w-16-evidence/ce-blade-count.txt','utf8').trim().split('\n');
  expect(values).toHaveLength(81);
  for(const row of values){const [fp,n]=row.split(' ').map(Number);expect(staffBladeCount(fp!/65536)).toBe(n);}
 });
 it.each([[2,3],[3,4],[8,12]])('E=%i creates %i unique real entities near final landing, independent of charges/config',(e,n)=>{
  const g=scene();g.grid.setTerrain(15,5,T.WALL);const item=staff(e);
  const r=g.zapBoltFromPlayer({...bolt(),magnitude:99},item,{x:8,y:5});
  expect(r.landingPos).toEqual({x:14,y:5});expect(r.outcome?.autoID).toBe(true);
  const all=blades(g);expect(all).toHaveLength(n);expect(all[0]!.loc).toEqual(r.landingPos);
  expect(new Set(all.map(b=>`${b.x},${b.y}`)).size).toBe(n);expect(new Set(all.map(b=>b.id)).size).toBe(n);
  for(const b of all){expect(g.getMonsterAt(b.x,b.y)).toBe(b);expect(g.grid.getCell(b.x,b.y)!.isPassable).toBe(true);
   expect(b).toMatchObject({hp:1,maxHp:1,damageString:'1d1',accuracy:150,defense:0,moveSpeed:50,attackSpeed:100,ticksUntilTurn:101,
    isAlly:true,boundToPlayer:true,doesNotTrackLeader:true,leader:null,goldDropChance:0,itemDropChance:0});
   expect(b.hasStatus('levitating')).toBe(true);expect(b.state).not.toBe(MonsterState.ASLEEP);
   expect(Math.max(Math.abs(b.x-14),Math.abs(b.y-5))).toBeLessThanOrEqual(2);
  }
  expect(item.charges).toBe(1);expect(item.enchantment).toBe(e);
 });
 it.each([false,true])('unknown/known=%s produces entities without any Blade floating text',known=>{
  const g=scene(), item=staff(2);if(known)ItemLoader.identifyItemKind(item);
  mob(g,'rat',10);const r=g.zapBoltFromPlayer(bolt(),item,{x:10,y:5});
  expect(r.landingPos).toEqual({x:9,y:5});expect(blades(g)).toHaveLength(3);expect(r.outcome?.autoID).toBe(true);
  expect(g.spawnFloatingText).not.toHaveBeenCalled();
 });
 it('first-cell contact detonates once after travel, not once per hit plus landing',()=>{
  const g=scene(), rat=mob(g,'rat',5);const r=cast(g,3,{x:5,y:5});
  expect(r.landingPos).toEqual(rat.loc);expect(blades(g)).toHaveLength(4);expect(g.getMonsterAt(5,5)).toBe(rat);
 });
 it('empty/same-origin path creates nothing and cannot autoID',()=>{
  const g=scene();const r=cast(g,3,g.player.loc);expect(blades(g)).toHaveLength(0);expect(r.outcome?.autoID).toBe(false);
 });
 it('a completely full level fails cleanly, no invalid entity and no autoID',()=>{
  const g=scene();g.grid=new Grid(9,9);for(let x=0;x<9;x++)for(let y=0;y<9;y++)g.grid.setTerrain(x,y,T.WALL);
  g.grid.setTerrain(4,5,T.FLOOR);g.grid.setTerrain(5,5,T.FLOOR);mob(g,'rat',5);
  const r=cast(g,8,{x:5,y:5});expect(blades(g)).toHaveLength(0);expect(r.outcome?.autoID).toBe(false);
 });
 it('partial capacity produces only qualifying entities and still identifies',()=>{
  const g=scene();g.grid=new Grid(9,9);for(let x=0;x<9;x++)for(let y=0;y<9;y++)g.grid.setTerrain(x,y,T.WALL);
  g.grid.setTerrain(4,5,T.FLOOR);g.grid.setTerrain(5,5,T.FLOOR);g.grid.setTerrain(6,5,T.FLOOR);
  const r=cast(g,8,{x:6,y:5});expect(blades(g)).toHaveLength(2);expect(r.outcome?.autoID).toBe(true);
 });
});

describe('W-16 qualifying cells and interaction RNG',()=>{
 it('origin first consumes no placement RNG; occupied origin chooses x-major nearest ties with RNG',()=>{
  const g=scene(),origin={x:10,y:5};const spy=vi.spyOn(rng,'randRange').mockReturnValue(0);
  expect(bladeSpawnLocation(g,origin)).toEqual(origin);expect(spy).not.toHaveBeenCalled();mob(g,'rat',10);
  expect(bladeSpawnLocation(g,origin)).toEqual({x:9,y:4});expect(spy).toHaveBeenCalledWith(0,7);
 });
 it.each([T.WALL,T.CRYSTAL_WALL,T.FORCEFIELD,T.STAIRS_UP,T.STAIRS_DOWN,T.PLAIN_FIRE,T.SACRED_GLYPH])('rejects terrain %s across layers',terrain=>{
  const g=scene();g.grid.setTerrain(10,5,terrain);expect(bladeSpawnLocation(g,{x:10,y:5})).not.toEqual({x:10,y:5});
 });
 it.each([T.LAVA,T.CHASM,T.WATER_DEEP,T.WEB,T.INERT_BRIMSTONE,T.POISON_GAS,T.PARALYSIS_GAS])('flying inanimate blade accepts terrain %s',terrain=>{
  const g=scene();g.grid.setTerrain(10,5,terrain);expect(bladeSpawnLocation(g,{x:10,y:5})).toEqual({x:10,y:5});
 });
 it('occupied active/player/stair cells excluded, dormant creatures do not occupy CE HAS_MONSTER',()=>{
  const g=scene();expect(bladeSpawnLocation(g,g.player.loc)).not.toEqual(g.player.loc);
  const sleeping=mob(g,'rat',10);sleeping.isDormant=true;g.dormantMonsters.push(sleeping);g.monsters=[];
  expect(bladeSpawnLocation(g,{x:10,y:5})).toEqual({x:10,y:5});
 });
 it('prefers reachable path cells over geometrically nearby sealed cells; forbids cutting diagonal corners',()=>{
  const g=scene();g.grid=new Grid(15,12);for(let x=0;x<15;x++)for(let y=0;y<12;y++)g.grid.setTerrain(x,y,T.WALL);
  for(const p of [{x:5,y:5},{x:6,y:5},{x:7,y:5},{x:4,y:4}])g.grid.setTerrain(p.x,p.y,T.FLOOR);
  g.player.loc={x:1,y:1};mob(g,'rat',5,5);mob(g,'rat',6,5);
  expect(bladeSpawnLocation(g,{x:5,y:5})).toEqual({x:7,y:5});
  mob(g,'rat',7,5);expect(bladeSpawnLocation(g,{x:5,y:5})).toEqual({x:4,y:4}); // CE geometric fallback
 });
 it('same seed repeats positions; ties vary across seeds only when actually casting',()=>{
  const run=(seed:number)=>{const g=scene();const item=staff(3);g.grid.setTerrain(15,5,T.WALL);rng.seedRandomGenerator(seed);
   const before=rng.randomNumbersGenerated;g.zapBoltFromPlayer(bolt(),item,{x:10,y:5});
   expect(rng.randomNumbersGenerated).toBeGreaterThan(before);return blades(g).map(b=>b.loc);};
  expect(run(16)).toEqual(run(16));expect(new Set([1,2,3,4].map(s=>JSON.stringify(run(s)))).size).toBeGreaterThan(1);
 });
});

describe('W-16 player binding, AI, first action, and real death',()=>{
 it('actively pursues enemies outside player FOV, then hits for 1 and spends attackSpeed',()=>{
  const g=scene(),b=single(g),rat=mob(g,'rat',13);rat.hp=rat.maxHp=10;rat.state=MonsterState.HUNTING;g.player.loc={x:2,y:2};
  for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++)g.grid.getCell(x,y)!.isVisible=false;
  b.takeTurn(g,10);expect(b.loc).toEqual({x:11,y:5});b.takeTurn(g,10);expect(b.loc).toEqual({x:12,y:5});
  vi.spyOn(rng,'randPercent').mockReturnValue(true);b.ticksUntilTurn=0;b.takeTurn(g,10);
  expect(rat.hp).toBe(9);expect(b.ticksUntilTurn).toBe(100);expect(g.player.hp).toBe(g.player.maxHp);
 });
 it('does not track player when idle; mills only on the 30% check',()=>{
  const g=scene(),b=single(g);g.player.loc={x:2,y:5};const old={...b.loc};
  const chance=vi.spyOn(rng,'randPercent').mockReturnValue(false);b.takeTurn(g,10);expect(b.loc).toEqual(old);expect(chance).toHaveBeenCalledWith(30);
  chance.mockReturnValue(true);vi.spyOn(rng,'randRange').mockReturnValue(0);b.takeTurn(g,10);expect(b.loc).toEqual({x:old.x,y:old.y-1});
 });
 it('walls/forcefield/diagonal corners block pursuit and melee; web immunity lets it move',()=>{
  const g=scene(),b=single(g),rat=mob(g,'rat',12);g.grid.setTerrain(11,5,T.FORCEFIELD);vi.spyOn(rng,'randPercent').mockReturnValue(false);
  b.takeTurn(g,10);expect(b.loc).toEqual({x:10,y:5});g.grid.setTerrainLayer(11,5,L.SURFACE,T.NOTHING);g.grid.setTerrain(10,5,T.WEB);
  b.takeTurn(g,10);expect(b.loc).toEqual({x:11,y:5});rat.loc={x:12,y:6};g.grid.setTerrain(12,5,T.WALL);
  const attack=vi.spyOn(CombatSystem,'attack');b.takeTurn(g,10);expect(attack).not.toHaveBeenCalled();
 });
 it.each([50,100,200])('first wait = 101 ticks under player action cost %i, then normal 50-tick movement',cost=>{
  const g=live(),b=single(g),turn=vi.spyOn(b,'takeTurn');
  g.player.ticksUntilTurn=cost;for(const _ of (g as any).advancementLoop()){}
  expect(turn).toHaveBeenCalledTimes(cost===200?2:0);
  expect(b.ticksUntilTurn).toBe(cost===50?51:1);
 });
 it('200 objective ticks do not expire a blade or settle loot, kills, death DF, or die',()=>{
  const g=live(),b=single(g);b.abilityFlags.add('MA_DF_ON_DEATH');b.carriedItem=ItemLoader.spawnStaff('staff_of_fire',0,0)!;
  const die=vi.spyOn(b as any,'die'),loot=vi.spyOn(g as any,'dropMonsterLoot');const before=g.stats.kills;
  for(let i=0;i<200;i++){(g as any).tickCreatureStatuses();(g as any).triggerDeathFeatures();(g as any).removeDeadMonsters();}
  expect(g.getMonsterAt(b.x,b.y)).toBe(b);expect(b.hp).toBe(1);expect(b.deathEffectTriggered).toBe(false);
  expect(die).not.toHaveBeenCalled();expect(loot).not.toHaveBeenCalled();expect(g.stats.kills).toBe(before);expect(g.items).toHaveLength(0);
 });
 it('negation kills the actual magical entity through existing death path, bypassing shield; swept once',()=>{
  const g=scene(),b=single(g);b.applyShield(1000);const die=vi.spyOn(b as any,'die');
  const neg={...bolt(),ceType:CEBoltType.NEGATION,effect:BoltEffect.NEGATION};g.zapBoltFromPlayer(neg,staff(),b.loc);
  expect(b.hp).toBe(0);expect(die).toHaveBeenCalledTimes(1);expect(b.getStatusDuration('shielded')).toBe(1000);
  (g as any).triggerDeathFeatures();(g as any).removeDeadMonsters();(g as any).removeDeadMonsters();
  expect(g.getMonsterAt(b.x,b.y)).toBeUndefined();expect(g.items).toHaveLength(0);expect(b.deathEffectTriggered).toBe(false);
 });
 it('awake enemies retaliate against an adjacent blade',()=>{
  const g=live(),b=single(g),rat=mob(g,'rat',11);rat.state=MonsterState.WANDERING;g.player.loc={x:2,y:2};
  vi.spyOn(rng,'randPercent').mockReturnValue(true);const die=vi.spyOn(b as any,'die');
  rat.takeTurn(g,1);expect(b.hp).toBe(0);expect(die).toHaveBeenCalledTimes(1);expect(rat.ticksUntilTurn).toBe(100);
  (g as any).removeDeadMonsters();expect(g.getMonsterAt(b.x,b.y)).toBeUndefined();
 });
 it('hunting enemy prefers an accessible adjacent player over a summoned blade',()=>{
  const g=live(),b=single(g),rat=mob(g,'rat',11);g.player.loc={x:12,y:5};rat.state=MonsterState.HUNTING;
  const attack=vi.spyOn(CombatSystem,'attack');rat.takeTurn(g,10);
  expect(attack).toHaveBeenCalled();expect(attack.mock.calls[0]![1]).toBe(g.player);expect(b.hp).toBe(1);
 });
 it('negation casters recognize the newly summoned magical enemy without requiring haste or shield',()=>{
  const g=scene(),b=single(g),caster=mob(g,'dar_priestess',12);
  expect(specificallyValidBoltTarget(caster,b,'NEGATION',g)).toBe(true);
  g.castMonsterBolt(caster,b,'NEGATION');expect(b.hp).toBe(0);
 });
 it('ordinary lethal combat removes a blade while other blades keep their binding',()=>{
  const g=scene();cast(g);const all=blades(g);all[0]!.takeDamage(1);(g as any).removeDeadMonsters();
  expect(blades(g)).toHaveLength(2);expect(blades(g).every(b=>b.isAlly&&b.boundToPlayer)).toBe(true);
 });
 it('horde summon keeps leader and default tracking; allied minion counts naturally include conjured blades',()=>{
  const g=scene(),summoner=mob(g,'goblin_conjurer',15);(g as any).summonMinionsFor(summoner);
  const summoned=g.monsters.filter(m=>m.leader===summoner);expect(summoned.length).toBeGreaterThan(0);
  expect(summoned.every(m=>!m.isAlly&&!m.doesNotTrackLeader&&!m.boundToPlayer&&m.ticksUntilTurn===101)).toBe(true);
  const count=countMinions(summoner,g.monsters);cast(g,2);expect(countMinions(summoner,g.monsters)).toBe(count);
  summoner.isAlly=true;expect(countMinions(summoner,g.monsters)).toBe(4);
 });
});

describe('W-16 snapshots, old saves, stairs and submission',()=>{
 it('JSON restores actual species despite translated name, ally/binding/AI, ticks, flying and negate vulnerability',()=>{
  const g=live(),b=single(g);b.name='幽灵刀刃';b.ticksUntilTurn=1;
  const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));const g2=live();expect(g2.loadSnapshot(snapshot)).toBe(true);
  const restored=blades(g2)[0]!;expect(restored).toMatchObject({id:b.id,isAlly:true,boundToPlayer:true,doesNotTrackLeader:true,ticksUntilTurn:1,moveSpeed:50,attackSpeed:100});
  expect(restored.hasStatus('levitating')).toBe(true);expect(restored.diesIfNegated()).toBe(true);
  expect(g2.getMonsterAt(restored.x,restored.y)).toBe(restored);expect(restored.leader).toBeNull();
 });
 it('dormant and test-room restoration use the same tagged blade payload',()=>{
  const g=live(),b=single(g);b.isDormant=true;g.monsters=[];g.dormantMonsters=[b];
  const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));const g2=live();g2.loadSnapshot(snapshot);
  expect(g2.dormantMonsters[0]).toMatchObject({typeId:'spectral_blade',boundToPlayer:true,doesNotTrackLeader:true,isAlly:true});
  expect(g2.getMonsterAt(b.x,b.y)).toBeUndefined();
  const restored=(g as any).createMonsterFromSnapshot(snapshot.dormantMonsters[0]);expect(restored).toMatchObject({typeId:'spectral_blade',isAlly:true,ticksUntilTurn:101});
 });
 it('down/up stairs leave blades alive on their original cached level, no follower/death/loot path',()=>{
  const g=live(),b=single(g);g.mode='normal';g.depth=1;g.grid.setTerrain(6,5,T.STAIRS_DOWN);
  const other=floor();other.setTerrain(4,5,T.STAIRS_UP);
  (g as any).levels.set(2,{grid:other,environment:new EnvironmentManager(other),fov:new FOVSys(other),lightMap:new LightMap(other),monsters:[],dormantMonsters:[],items:[],visibleMonsters:new Set(),visibleItems:new Set()});
  const die=vi.spyOn(b as any,'die');g.depth=2;(g as any).generateDepth(false);
  expect(blades(g)).toHaveLength(0);expect((g as any).levels.get(1).monsters).toContain(b);expect(b.hp).toBe(1);
  g.depth=1;(g as any).generateDepth(true);expect(g.monsters).toContain(b);expect(b.boundToPlayer).toBe(true);expect(die).not.toHaveBeenCalled();expect(g.items).toHaveLength(0);
 });
 it('real UI commit cancels without mutation, then spends one charge, identifies and leaves three waiting blades',()=>{
  const g=live(),item=staff(2);g.grid.setTerrain(15,5,T.WALL);g.player.inventory.addItem(item);
  const before=rng.randomNumbersGenerated;g.useArcanaItem(item);g.handlePlayerAction('escape');expect(item.charges).toBe(1);expect(blades(g)).toHaveLength(0);expect(rng.randomNumbersGenerated).toBe(before);
  g.useArcanaItem(item);g.setArcanaTarget(10,5);const result=g.confirmArcanaTarget();
  expect(result?.outcome?.autoID).toBe(true);expect(item.charges).toBe(0);expect(blades(g)).toHaveLength(3);
  expect(blades(g).every(b=>b.ticksUntilTurn===1)).toBe(true);expect(ItemLoader.identifiedItems.has('staff_of_conjuration')).toBe(true);
 });
});
