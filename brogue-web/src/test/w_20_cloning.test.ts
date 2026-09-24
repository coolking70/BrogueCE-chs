import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { getBoltForItem, BoltEffect } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { cloneLocation } from '../engine/Combat/Cloning';
import { CombatSystem } from '../engine/Combat/Combat';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Player } from '../entities/Player';
import { Monster, MonsterState as S, countMinions, type MonsterData, type MutationData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import mutations from '../data/mutations.json';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
const data=(id:string)=>(monsters as MonsterData[]).find(d=>d.id===id)!;
const cfg=()=>({...getBoltForItem('wand_of_slowness')!,id:'w20-effect-fixture',ceType:CEBoltType.PLENTY,effect:BoltEffect.PLENTY});
function install(g:Game){
 g.grid=new Grid(DCOLS,DROWS);for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++){
  g.grid.setTerrain(x,y,x>0&&x<DCOLS-1&&y>0&&y<DROWS-1?T.FLOOR:T.WALL);Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true,isDiscovered:true});
 }
 g.player=new Player(4,5);g.monsters=[];g.dormantMonsters=[];g.items=[];g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
 g.spawnFloatingText=vi.fn();g.stats={kills:0,gold:0,turns:0,maxDepth:1};return g;
}
function scene(){const g=install(Object.create(Game.prototype));(g as any).updateVision=vi.fn();return g;}
function live(){return install(createHeadlessGame(2020,'test'));}
function mob(g:Game,id='rat',x=9,y=5){const m=new Monster(x,y,data(id));g.monsters.push(m);return m;}
function cast(g:Game,m:Monster|Player){return g.zapBoltFromPlayer(cfg(),ItemLoader.spawnWand('wand_of_slowness',-1,-1)!,m.loc);}
const dump=(m:Monster)=>JSON.stringify(m,(k,v)=>k==='leader'?(v?.id??null):v instanceof Set?[...v].sort():v);
const fields=['abilities','abilityFlags','behaviorFlags','bolts','carriedItem','carriedMonster','leader','loc','mutation','safetySnapshot','spawnLoc','statusDurations','statusImmunities','statusResistTurns','waypointAlreadyVisited'];
function rich(m:Monster){
 m.statusDurations={hasted:7,poisoned:8,shielded:231,entranced:12};(m.statusDurations as any).burning=6;m.poisonAmount=4;m.maxShield=300;
 m.mutate(structuredClone(mutations[0]!));m.statusImmunities.add('confused');m.statusResistTurns={slowed:2};m.abilities.add('flying');m.behaviorFlags.add('MONST_FLIES');m.abilityFlags.add('MA_CAST_SUMMON');m.bolts=['HEALING'];
 m.waypointAlreadyVisited=[true,false];m.targetWaypointIndex=1;m.safetySnapshot=[[3,4],[5,6]];m.spawnLoc={x:7,y:8};m.regenCounter=13;m.machineHome=17;m.seized=m.seizing=true;m.movementSpeed=37;m.attackSpeed=43;m.polymorphKeepsSpeed=true;m.wasNegated=true;m.givenUpOnScent=true;m.falling=m.preplaced=true;
 return m;
}
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(2020);ItemLoader.identifiedItems.clear();});

describe('W-20 current values and container ownership',()=>{
 it('audits EVERY object-valued Monster own field (including nested mutation arrays); no shared value container',()=>{
  const g=scene(),m=rich(mob(g)),leader=mob(g,'kobold',15,7);m.leader=leader;m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;m.carriedMonster=new Monster(0,0,data('phoenix'));
  expect(Object.entries(m).filter(([,v])=>v!==null&&typeof v==='object').map(([k])=>k).sort()).toEqual(fields);
  const before=dump(m),c=g.cloneMonster(m)!;
  for(const key of fields){
   if(key==='leader'){expect(c.leader).toBe(leader);continue;}
   if(['carriedItem','carriedMonster','safetySnapshot'].includes(key)){expect((c as any)[key]).toBeNull();continue;}
   expect((c as any)[key],key).not.toBe((m as any)[key]);
   if(key!=='loc')expect((c as any)[key],key).toEqual((m as any)[key]);
  }
  for(const key of ['abilityFlags','behaviorFlags','forbiddenFlags','forbiddenAbilityFlags'] as const)expect(c.mutation![key]).not.toBe(m.mutation![key]);
  const exceptions=new Set(['id','loc','leader','isCaged','isClone','carriedItem','carriedMonster','safetySnapshot','ticksUntilTurn','goldDropChance','itemDropChance']);
  for(const [k,v]of Object.entries(m))if(!exceptions.has(k))expect((c as any)[k],k).toEqual(v);
  expect(c.id).not.toBe(m.id);expect(c.ticksUntilTurn).toBe(101);expect(dump(m)).toBe(before);
 });
 it.each(['loc','spawnLoc','statusDurations','statusImmunities','statusResistTurns','abilities','behaviorFlags','abilityFlags','bolts','waypointAlreadyVisited','mutation'] as const)('reverse mutation of clone.%s leaves parent byte-for-byte unchanged',key=>{
  const g=scene(),m=rich(mob(g)),c=g.cloneMonster(m)!;const before=dump(m);
  const value=(c as any)[key];
  if(value instanceof Set)value.clear();else if(Array.isArray(value))value[0]=!value[0];else if(key==='mutation'){
   value.name='changed';for(const array of ['abilityFlags','behaviorFlags','forbiddenFlags','forbiddenAbilityFlags'])value[array].push('changed');
  }else {for(const k of Object.keys(value))value[k]=999;}
  expect(dump(m)).toBe(before);
 });
 it('actual tick, shield absorption, poison and death mutate only clone state',()=>{
  const g=scene(),m=rich(mob(g)),c=g.cloneMonster(m)!;const before=dump(m);c.tickStatuses();c.takeDamage(2);c.addPoison(9,3);c.takeDamage(10000,true);expect(c.hp).toBeLessThanOrEqual(0);expect(dump(m)).toBe(before);
 });
 it('retains polymorph cached speed, current learned/negated capabilities; does not rebuild from catalog',()=>{
  const g=scene(),m=rich(mob(g));m.polymorphed=true;m.behaviorFlags.delete('MONST_FLIES');const c=g.cloneMonster(m)!;
  expect(c).toMatchObject({polymorphed:true,polymorphKeepsSpeed:true,movementSpeed:37,attackSpeed:43,wasNegated:true});expect(c.bolts).toEqual(['HEALING']);expect(c.hasBehavior('MONST_FLIES')).toBe(false);
 });
});

describe('W-20 plenty and CE exceptions',()=>{
 it.each([1,2,3,5,99,100,101])('current HP %i rounds UP independently; maxHP does not split',hp=>{
  const g=scene(),m=mob(g);m.hp=hp;m.maxHp=137;const r=cast(g,m),c=g.monsters[1]!;
  expect([m.hp,c.hp]).toEqual([Math.floor((hp+1)/2),Math.floor((hp+1)/2)]);expect([m.maxHp,c.maxHp]).toEqual([137,137]);expect(r.outcome?.autoID).toBe(true);
 });
 it('empty shot does not clone player or identify',()=>{const g=scene();const r=g.zapBoltFromPlayer(cfg(),ItemLoader.spawnWand('wand_of_slowness',-1,-1)!,{x:12,y:5});expect(g.monsters).toEqual([]);expect(r.outcome?.autoID).toBe(false);});
 it.each(['goblin_totem','arrow_turret','Warden_of_Yendor'])('rejects inanimate/invulnerable %s without writes or RNG',id=>{
  const g=scene(),m=mob(g,id);m.abilityFlags.delete('MA_REFLECT_100');const item=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!,before=dump(m),draw=vi.spyOn(rng,'randRange');
  const r=g.zapBoltFromPlayer(cfg(),item,m.loc);expect(r.outcome?.autoID).toBe(false);expect(dump(m)).toBe(before);expect(g.monsters).toEqual([m]);expect(draw).not.toHaveBeenCalled();
 });
 it('dead targets cannot be copied by generic helper',()=>{const g=scene(),m=mob(g);m.hp=0;expect(g.cloneMonster(m)).toBeNull();expect(g.monsters).toEqual([m]);});
 it('unobserved invisible success still identifies (CE no sight gate)',()=>{const g=scene(),m=mob(g);m.setStatusDuration('invisible',9);g.grid.getCell(9,5)!.isVisible=false;expect(cast(g,m).outcome?.autoID).toBe(true);expect(g.monsters[1]!.hasStatus('invisible')).toBe(true);});
 it('captive copy is allied and released; original captive/key/discord/seized unchanged',()=>{
  const g=scene(),m=mob(g);m.isCaged=m.seized=m.seizing=true;m.statusDurations={discordant:17};m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;const item=m.carriedItem;const r=cast(g,m),c=g.monsters[1]!;
  expect(r.outcome?.autoID).toBe(true);expect(c).toMatchObject({isAlly:true,isCaged:false,seized:false,seizing:true,leader:null,carriedItem:null});expect(c.statusDurations.discordant).toBe(17);expect(m).toMatchObject({isAlly:false,isCaged:true,seized:true,carriedItem:item});expect(g.items).toEqual([]);
 });
 it('leader references use existing leader, otherwise original; no rebinding original followers',()=>{
  const g=scene(),m=mob(g),f=mob(g,'rat',15,7);f.leader=m;const c=g.cloneMonster(m)!;expect(c.leader).toBe(m);expect(f.leader).toBe(m);expect(m.leader).toBeNull();const c2=g.cloneMonster(c)!;expect(c2.leader).toBe(m);
 });
 it('reflected player produces gray allied @, 1d2/0 defense, copied HP/status/speed, no inventory',()=>{
  const g=scene(),reflector=mob(g,'stone_guardian');g.player.hp=19;g.player.statusDurations={hasted:8,poisoned:5};g.player.poisonAmount=3;g.player.refreshSpeeds();g.player.inventory.addItem(ItemLoader.spawnWeapon('dagger',-1,-1)!);
  const r=cast(g,reflector),c=g.monsters.find(m=>m!==reflector)!;expect(r.reflections.length).toBeGreaterThan(0);expect(r.outcome?.autoID).toBe(true);
  expect(g.player.hp).toBe(10);expect(c).toMatchObject({name:'clone',char:'@',color:0x7f7f7f,isAlly:true,hp:10,maxHp:30,damageString:'1d2',defense:0,accuracy:100,movementSpeed:50,attackSpeed:50,poisonAmount:3,carriedItem:null});
  expect(c.statusDurations).toEqual(g.player.statusDurations);expect(c.statusDurations).not.toBe(g.player.statusDurations);expect('inventory' in c).toBe(false);expect(c.leader).toBeNull();expect(g.player.inventory.items).toHaveLength(1);
 });
 it('clone death triggers ordinary DF/cleanup once and never duplicates original carried loot',()=>{
  const g=scene(),m=mob(g,'bloat');m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;m.goldDropChance=m.itemDropChance=1;const key=m.carriedItem;const c=g.cloneMonster(m)!;const add=vi.spyOn(g.environment,'addGas');
  c.takeDamage(c.hp,true);(g as any).triggerDeathFeatures();(g as any).triggerDeathFeatures();(g as any).removeDeadMonsters();expect(add).toHaveBeenCalledOnce();expect(m.deathEffectTriggered).toBe(false);expect(g.monsters).toEqual([m]);expect(g.items).toEqual([]);expect(m.carriedItem).toBe(key);
  m.takeDamage(m.hp,true);(g as any).triggerDeathFeatures();m.goldDropChance=m.itemDropChance=0;(g as any).removeDeadMonsters();expect(add).toHaveBeenCalledTimes(2);expect(g.items).toEqual([key]);
 });
});

describe('W-20 placement is not just adjacent empty tiles',()=>{
 function walls(g:Game){for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)g.grid.setTerrain(x,y,T.WALL);}
 it('searches through occupied creatures to next free distance ring',()=>{const g=scene(),m=mob(g);for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)if(dx||dy)mob(g,'rat',9+dx,5+dy);const p=cloneLocation(g,m)!;expect(Math.max(Math.abs(p.x-9),Math.abs(p.y-5))).toBe(2);});
 it('path fallback can find a disconnected room beyond walls',()=>{const g=scene(),m=mob(g);walls(g);g.grid.setTerrain(9,5,T.FLOOR);g.grid.setTerrain(15,5,T.FLOOR);expect(cloneLocation(g,m)).toEqual({x:15,y:5});});
 it('no valid cell anywhere is failure with no HP/id allocation/entities/RNG writes',()=>{const g=scene(),m=mob(g);walls(g);g.grid.setTerrain(9,5,T.FLOOR);const before=dump(m),draw=vi.spyOn(rng,'randRange');expect(g.cloneMonster(m)).toBeNull();expect(dump(m)).toBe(before);expect(g.monsters).toEqual([m]);expect(draw).not.toHaveBeenCalled();const next=new Monster(0,0,data('rat'));expect(next.id).toBe(m.id+1);});
 it('plenty failure leaves odd HP intact and autoID false',()=>{const g=scene(),m=mob(g);walls(g);g.grid.setTerrain(9,5,T.FLOOR);m.hp=5;const result={...cfg(),hits:[{creature:m,pos:m.loc}],hitCreatures:[m],effect:BoltEffect.PLENTY,impactPos:m.loc};expect((g as any).applyBoltEffect(result,ItemLoader.spawnWand('wand_of_slowness',-1,-1)!)).toBe(false);expect(m.hp).toBe(5);expect(g.monsters).toEqual([m]);});
 it('stairs/player are forbidden, dormant monster does not occupy active cell',()=>{const g=scene(),m=mob(g);walls(g);g.grid.setTerrain(9,5,T.FLOOR);g.grid.setTerrain(10,5,T.STAIRS_UP);g.grid.setTerrain(8,5,T.FLOOR);g.player.loc={x:8,y:5};g.grid.setTerrain(9,6,T.FLOOR);const d=new Monster(9,6,data('rat'));d.isDormant=true;g.dormantMonsters=[d];expect(cloneLocation(g,m)).toEqual({x:9,y:6});});
 it('temporary levitation does not change info-based avoidance; native flight does',()=>{const g=scene(),m=mob(g);walls(g);g.grid.setTerrain(9,5,T.FLOOR);g.grid.setTerrain(10,5,T.WATER_DEEP);m.setStatusDuration('levitating',100);expect(cloneLocation(g,m)).toBeNull();m.behaviorFlags.add('MONST_FLIES');expect(cloneLocation(g,m)).toEqual({x:10,y:5});});
});

describe('W-20 self split uses clone THEN filters learned traits',()=>{
 it.each([23,1000])('burning, grabbed/entranced/poison/shield/regen inherited; levitation %i follows CE exception',levitation=>{
  const g=scene(),m=rich(mob(g,'pink_jelly'));m.hp=19;m.setStatusDuration('levitating',levitation);m.abilityFlags.add('MA_CLONE_SELF_ON_DEFEND');m.behaviorFlags.add('MONST_FLIES');m.abilityFlags.add('MA_HIT_STEAL_FLEE');
  (g as any).trySplitMonster(m,g.player);const c=g.monsters[1]!;expect([m.hp,c.hp]).toEqual([10,10]);expect((c.statusDurations as any).burning).toBe(6);expect(c.getStatusDuration('entranced')).toBe(12);expect(c.poisonAmount).toBe(4);expect(c.maxShield).toBe(300);expect(c.regenCounter).toBe(13);expect(c.seized).toBe(true);expect(c.getStatusDuration('levitating')).toBe(levitation===1000?0:23);expect(c.hasBehavior('MONST_FLIES')).toBe(false);expect(c.hasAbility('MA_HIT_STEAL_FLEE')).toBe(false);expect(c.bolts).toEqual(data('pink_jelly').bolts);expect(c.mutation).toEqual(m.mutation);expect(c.ticksUntilTurn).toBe(101);
 });
 it('plenty preserves learned bolts and flags, unlike self split',()=>{const g=scene(),m=rich(mob(g,'pink_jelly'));cast(g,m);const c=g.monsters[1]!;expect(c.hasBehavior('MONST_FLIES')).toBe(true);expect(c.bolts).toEqual(['HEALING']);});
 it('cloning does not invoke summoning, but a real cloned follower legitimately counts for P4-2',()=>{const g=scene(),m=mob(g,'goblin_conjurer');const summon=vi.spyOn(g,'summonMinionsFor');expect(countMinions(m,g.monsters)).toBe(0);g.cloneMonster(m);expect(summon).not.toHaveBeenCalled();expect(countMinions(m,g.monsters)).toBe(1);m.isAlly=true;g.monsters[1]!.isAlly=true;expect(countMinions(m,g.monsters)).toBe(2);});
 it('plenty has no 100 self-split cap; its clones count toward the subsequent self-split cap',()=>{const g=scene(),m=mob(g,'pink_jelly');for(let i=1;i<=100;i++){const c=mob(g,'pink_jelly',20+i%20,10+Math.floor(i/20));c.leader=m;}expect((g as any).alliedCloneCount(m)).toBe(100);cast(g,m);expect(g.monsters).toHaveLength(102);const hp=m.hp;(g as any).trySplitMonster(m,g.player);expect(g.monsters).toHaveLength(102);expect(m.hp).toBe(hp);});
});

describe('W-20 save, identity and actual submission',()=>{
 it('JSON round trip keeps all clone runtime/containers/references and next ids beyond dormant high id',()=>{
  const g=live(),m=rich(mob(g)),leader=mob(g,'kobold',20,7);m.leader=leader;const c=g.cloneMonster(m)!;c.id=900000;g.toggleMonsterDormancy(c);const saved=JSON.parse(JSON.stringify(g.toSnapshot()));
  expect(g.loadSnapshot(saved)).toBe(true);const restored=g.dormantMonsters[0]!;expect(restored).toMatchObject({id:900000,isClone:true,polymorphed:false,movementSpeed:37,attackSpeed:43,ticksUntilTurn:101,machineHome:17,poisonAmount:4,maxShield:300,wasNegated:true});expect(restored.leader?.id).toBe(leader.id);expect(restored.mutation).toEqual(c.mutation);expect(restored.waypointAlreadyVisited).toEqual(c.waypointAlreadyVisited);expect(restored.carriedItem).toBeNull();
  restored.isDormant=false;g.dormantMonsters=[];g.monsters.push(restored);const next=g.cloneMonster(restored)!;expect(next.id).toBeGreaterThan(900000);expect(new Set([g.player.id,...g.monsters.map(x=>x.id)]).size).toBe(g.monsters.length+1);const before=dump(restored);next.tickStatuses();next.mutation!.behaviorFlags.push('test');expect(dump(restored)).toBe(before);
 });
 it('ordinary named clone stays ordinary, and high dormant id is reserved',()=>{const g=live(),m=mob(g);m.id=1200000;m.name='clone';g.toggleMonsterDormancy(m);const saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(saved);expect(g.dormantMonsters[0]!.isClone).toBe(false);expect(new Monster(0,0,data('rat')).id).toBeGreaterThan(1200000);});
 it('player clone and polymorphed clone remain Monsters with actual form after restore',()=>{const g=live(),m=rich(mob(g));m.polymorphed=true;const c=g.cloneMonster(m)!,p=g.cloneMonster(g.player)!;const saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(saved);expect(g.monsters.find(x=>x.id===c.id)).toMatchObject({isClone:true,polymorphed:true,movementSpeed:37});expect(g.monsters.find(x=>x.id===p.id)).toMatchObject({isClone:true,isAlly:true,char:'@',damageString:'1d2',defense:0});});
 it('cancel costs nothing; real confirmation spends charge/turn, newborn waits 101 then acts',()=>{
  const g=live(),m=mob(g,'rat',5,5);m.state=S.HUNTING;m.ticksUntilTurn=100000;m.onHitChance=0;const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;wand.charges=3;g.player.inventory.addItem(wand);
  const zap=g.zapBoltFromPlayer.bind(g);vi.spyOn(g,'zapBoltFromPlayer').mockImplementation((_b,it,to)=>zap(cfg(),it,to));const turns=g.stats.turns;g.useArcanaItem(wand);g.cancelArcanaSelection();expect(wand.charges).toBe(3);expect(g.stats.turns).toBe(turns);expect(g.monsters).toHaveLength(1);
  const attack=vi.spyOn(CombatSystem,'attack');g.useArcanaItem(wand);g.setArcanaTarget(5,5);g.confirmArcanaTarget();const c=g.monsters[1]!;expect(wand.charges).toBe(2);expect(g.stats.turns).toBe(turns+1);expect(c.ticksUntilTurn).toBe(1);expect(attack).not.toHaveBeenCalled();const turn=vi.spyOn(c,'takeTurn');g.handlePlayerAction('wait');expect(turn).toHaveBeenCalled();
 });
});


describe('W-20 compiled CE and cross-effect regression',()=>{
 it('matches compiled original BE_PLENTY and cloneMonster for every HP 1..137',()=>{
  const rows=fs.readFileSync('ai_docs/reports/w-20-evidence/ce-clone.txt','utf8').trim().split('\n');
  const hpRows=rows.filter(r=>r.startsWith('hp '));expect(hpRows).toHaveLength(137);
  for(const row of hpRows){const [,hp,a,b,ok,ticks,leader,item,safety,status,flags]=row.split(' ').map(Number);
   const g=scene(),m=mob(g);m.hp=hp!;m.statusDurations={confused:17};const result=cast(g,m),c=g.monsters[1]!;
   c.setStatusDuration('confused',99);expect([m.hp,c.hp,Number(result.outcome?.autoID),c.ticksUntilTurn,Number(c.leader===m),Number(c.carriedItem===null),Number(c.safetySnapshot===null),m.getStatusDuration('confused')]).toEqual([a,b,ok,ticks,leader,item,safety,status]);expect(flags).toBe(8);
  }
  expect(rows.slice(-3)).toEqual(['carried 1 2 1','player 10 10 clone 1 2 0 3 1','captive 3 8 3 1']);
 });
 it('W-8 actual fire staff now leaves both surviving jelly bodies burning',()=>{
  const g=scene(),m=mob(g,'pink_jelly');m.hp=m.maxHp=100;const staff=ItemLoader.spawnStaff('staff_of_fire',-1,-1)!;
  g.zapBoltFromPlayer(getBoltForItem('staff_of_fire')!,staff,m.loc);expect(g.monsters).toHaveLength(2);expect((m.statusDurations as any).burning).toBeGreaterThan(0);expect(g.monsters[1]!.statusDurations).toEqual(m.statusDurations);expect(g.monsters[1]!.statusDurations).not.toBe(m.statusDurations);
 });
 it('player clone is a legitimate polymorph source, before and after saving',()=>{
  const g=live(),c=g.cloneMonster(g.player)!;g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));const restored=g.monsters.find(m=>m.id===c.id)!;
  const draw=vi.spyOn(rng,'randRange').mockReturnValue(1);expect(restored.polymorph(()=>{})).toBe(true);expect(restored.typeId).toBe('rat');expect(restored.isAlly).toBe(false);expect(restored.isClone).toBe(true);expect(draw).toHaveBeenCalledExactlyOnceWith(1,67);
 });
 it('real melee clone kill does not advance weapon familiarity, original kill does',()=>{
  const g=live(),m=mob(g),c=g.cloneMonster(m)!;const weapon=ItemLoader.spawnWeapon('dagger',-1,-1)!;g.player.equippedWeapon=weapon;m.hp=c.hp=1;
  const auto=vi.spyOn(ItemLoader,'decrementWeaponAutoIDTimer');vi.spyOn(CombatSystem,'attack').mockImplementation((_attacker,target)=>{target.takeDamage(999,true);return {hit:true,damage:999} as any;});
  (g as any).resolvePlayerMeleeAttackOn(c);expect(auto).not.toHaveBeenCalled();(g as any).resolvePlayerMeleeAttackOn(m);expect(auto).toHaveBeenCalledExactlyOnceWith(weapon);
 });
 it('new private safety map never aliases the parent; source changes never reach clone containers',()=>{
  const g=scene(),m=rich(mob(g)),c=g.cloneMonster(m)!;c.safetySnapshot=[[8,9]];c.safetySnapshot[0]![0]=99;expect(m.safetySnapshot).toEqual([[3,4],[5,6]]);const before=dump(c);m.statusDurations.poisoned=100;m.bolts.push('FIRE');m.waypointAlreadyVisited![0]=false;expect(dump(c)).toBe(before);
 });
});


describe('W-20 relation representation and restored provenance',()=>{
 it('ally leader=null means &player; subsequent clones retain that pointer representation',()=>{const g=scene(),m=mob(g);m.isAlly=true;const a=g.cloneMonster(m)!,b=g.cloneMonster(a)!;expect(a.leader).toBeNull();expect(b.leader).toBeNull();expect([a.isAlly,b.isAlly]).toEqual([true,true]);});
 it('explicit allied monster leader is retained without cloning the leader graph',()=>{const g=scene(),leader=mob(g),m=mob(g,'rat',12,5);m.isAlly=true;m.leader=leader;expect(g.cloneMonster(m)!.leader).toBe(leader);});
 it('original saved mutation provenance survives, so self split keeps its mutation-only trait',()=>{
  const g=live(),m=mob(g,'pink_jelly');const mutation: MutationData=structuredClone(mutations[0]!);mutation.behaviorFlags.push('MONST_FLIES');m.mutate(mutation);const saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(saved);const restored=g.monsters[0]!;expect(restored.mutation).toEqual(mutation);(g as any).trySplitMonster(restored,g.player);expect(g.monsters[1]!.hasBehavior('MONST_FLIES')).toBe(true);expect(g.monsters[1]!.getStatusDuration('levitating')).toBe(1000);expect(g.monsters[1]!.mutation).not.toBe(restored.mutation);
 });
});


it('W-20 player regeneration progress projects into independent monster counters',()=>{
 const g=scene();g.player.hp=10;g.player.regenCarry=0.8;const c=g.cloneMonster(g.player)!;expect(c.regenTurns).toBe(10);expect(c.regenCounter).toBe(8);c.recoverPerTick();expect(c.hp).toBe(10);c.recoverPerTick();expect(c.hp).toBe(11);expect(g.player.hp).toBe(10);expect(g.player.regenCarry).toBe(0.8);
});


it('W-20 generic clone placement honors TURRET composite INANIMATE even though plenty itself rejects it',()=>{
 const g=scene(),m=mob(g,'arrow_turret');for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++)g.grid.setTerrain(x,y,T.WALL);
 g.grid.setTerrain(9,5,T.FLOOR);g.grid.setTerrain(10,5,T.FLOOR);g.grid.setTerrain(10,5,T.POISON_GAS);
 const ordinary=new Monster(9,5,data('rat'));expect(cloneLocation(g,ordinary)).toBeNull();const c=g.cloneMonster(m)!;expect(c).not.toBeNull();expect(c.loc).toEqual({x:10,y:5});expect(c.hasBehavior('MONST_TURRET')).toBe(true);
});
