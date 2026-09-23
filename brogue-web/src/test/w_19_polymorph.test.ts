import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { getBoltForItem, BoltEffect } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { polymorphHP, polymorphSpecies } from '../engine/Combat/Polymorph';
import { CombatSystem } from '../engine/Combat/Combat';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Player } from '../entities/Player';
import { Monster, MonsterState as S, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import mutations from '../data/mutations.json';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
const data=(id:string)=>(monsters as MonsterData[]).find(d=>d.id===id)!;
const index=(id:string)=>monsters.findIndex(d=>d.id===id)+1;
const cfg=()=>({...getBoltForItem('wand_of_slowness')!,id:'w19-effect-fixture',ceType:CEBoltType.POLYMORPH,effect:BoltEffect.POLYMORPH});
function install(g:Game){
 g.grid=new Grid(DCOLS,DROWS);for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++){
  g.grid.setTerrain(x,y,x>0&&x<DCOLS-1&&y>0&&y<DROWS-1?T.FLOOR:T.WALL);Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true,isDiscovered:true});
 }
 g.player=new Player(4,5);g.monsters=[];g.dormantMonsters=[];g.items=[];g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
 g.spawnFloatingText=vi.fn();g.stats={kills:0,gold:0,turns:0,maxDepth:1};return g;
}
function scene(){const g=install(Object.create(Game.prototype));(g as any).updateVision=vi.fn();return g;}
function live(){return install(createHeadlessGame(1919,'test'));}
function mob(g:Game,id='rat',x=9,y=5){const m=new Monster(x,y,data(id));g.monsters.push(m);return m;}
function cast(g:Game,m:Monster,next='jackal'){
 const item=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;
 const draw=vi.spyOn(rng,'randRange').mockReturnValue(index(next));
 try{return g.zapBoltFromPlayer(cfg(),item,m.loc);}finally{draw.mockRestore();}
}
const dump=(m:Monster)=>JSON.stringify(m,(k,v)=>k==='leader'?(v?.id??null):v instanceof Set?[...v].sort():v);
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(1919);ItemLoader.identifiedItems.clear();});

describe('W-19 CE catalog and compiled original polymorph',()=>{
 it('existing 67-row projection has the exact CE order and eligible set, including composite turrets and special exclusions',()=>{
  const rows=JSON.parse(fs.readFileSync('ai_docs/reports/w-19-evidence/ce-catalog.json','utf8'));
  expect(rows).toHaveLength(67);const excluded:string[]=[];
  for(const row of rows){
   const d=monsters[row.index-1]!;expect(d.id).toBe(row.name.replaceAll(' ','_'));expect([d.hp,d.moveSpeed,d.attackSpeed]).toEqual([row.hp,row.move,row.attack]);
   const draw=vi.fn().mockReturnValueOnce(row.index).mockReturnValue(index('rat'));
   expect(polymorphSpecies('kobold', {randRange:draw}).id).toBe(row.eligible&&d.id!=='kobold'?d.id:'rat');
   expect(draw).toHaveBeenCalledTimes(row.eligible&&d.id!=='kobold'?1:2);
   expect(draw.mock.calls.every(([lo,hi])=>lo===1&&hi===67)).toBe(true);
   if(!row.eligible)excluded.push(d.id);
  }
  expect(excluded).toEqual(['goblin_totem','arrow_turret','ogre_totem','spark_turret','sentinel','dart_turret','lich','phylactery','flame_turret','spectral_blade','spectral_sword','stone_guardian','winged_guardian','guardian_spirit','Warden_of_Yendor','eldritch_totem','mirrored_totem','phoenix','phoenix_egg','mangrove_dryad']);
 });
 it('matches every compiled CE HP/old haste+slow combination through the actual in-place operation',()=>{
  const rows=fs.readFileSync('ai_docs/reports/w-19-evidence/ce-polymorph.txt','utf8').trim().split('\n');
  const m=new Monster(9,5,data('kobold'));let choice=1;const draw=vi.spyOn(rng,'randRange').mockImplementation(()=>choice);const failures:unknown[]=[];
  for(const line of rows){
   const [hp,oldMax,form,speed,expectedHP,move,attack,hasted,slowed]=line.split(' ').map(Number) as [number,number,number,number,number,number,number,number,number];
   choice=form;m.typeId='kobold';m.hp=hp;m.maxHp=oldMax;m.statusDurations={hasted:speed&1,slowed:speed&2};
   const ok=m.polymorph(()=>{throw Error('unexpected demotion');});
   if(!ok||polymorphHP(hp,oldMax,data(m.typeId).hp)!==expectedHP||m.hp!==expectedHP||m.moveSpeed!==move||m.attackSpeed!==attack||m.getStatusDuration('hasted')!==hasted||m.getStatusDuration('slowed')!==slowed)failures.push({line,m:dump(m)});
  }
  expect(rows).toHaveLength(16256);expect(failures).toEqual([]);expect(draw).toHaveBeenCalledTimes(rows.length);
 });
 it('rejects the same species and each invalid roll without spawn/depth RNG',()=>{
  const g=scene(),m=mob(g),wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;
  const sequence=['rat','arrow_turret','lich','phoenix','mangrove_dryad','Warden_of_Yendor','unicorn'];
  const draw=vi.spyOn(rng,'randRange');for(const id of sequence)draw.mockReturnValueOnce(index(id));
  const r=g.zapBoltFromPlayer(cfg(),wand,m.loc);expect(m.typeId).toBe('unicorn');expect(r.hits[0]?.creature).toBe(m);
  expect(draw.mock.calls).toEqual(sequence.map(()=>[1,67]));expect(g.monsters).toEqual([m]);
 });
 it.each(['eel','goblin_warlord','black_jelly','vampire','unicorn','ifrit','dragon'])('does not exclude %s for depth, habitat, machineOnly, or boss role',id=>{
  const g=scene(),m=mob(g);g.depth=1;cast(g,m,id);expect(m.typeId).toBe(id);expect(m.loc).toEqual({x:9,y:5});
 });
});

describe('W-19 transaction gates, state order, and real ray contact',()=>{
 it.each(['MONST_INANIMATE','MONST_INVULNERABLE','MONST_TURRET'])('%s rejects before mutation/status/relationship writes or draws',flag=>{
  const g=scene(),m=mob(g);m.behaviorFlags.add(flag);m.isAlly=m.isCaged=true;m.seized=true;m.statusDurations={hasted:8,poisoned:9};m.wasNegated=true;
  const before=dump(m),wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!,draw=vi.spyOn(rng,'randRange');
  const r=g.zapBoltFromPlayer(cfg(),wand,m.loc);expect(r.hits[0]?.creature).toBe(m);expect(r.outcome?.autoID).toBe(false);expect(draw).not.toHaveBeenCalled();expect(dump(m)).toBe(before);
 });
 it.each(['lich','phoenix','mangrove_dryad','revenant'])('%s is a valid SOURCE despite output restrictions/weapon immunity',id=>{
  const g=scene(),m=mob(g,id);cast(g,m);expect(m.typeId).toBe('jackal');
 });
 it('living immobile targets may transform',()=>{const g=scene(),m=mob(g);m.behaviorFlags.add('MONST_IMMOBILE');cast(g,m);expect(m.typeId).toBe('jackal');});
 it.each(['empty','wall','origin'])('%s has no target, no roll, no autoID',kind=>{
  const g=scene(),m=mob(g),before=dump(m),wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;if(kind==='wall')g.grid.setTerrain(7,5,T.WALL);
  const draw=vi.spyOn(rng,'randRange'),r=g.zapBoltFromPlayer(cfg(),wand,kind==='origin'?g.player.loc:kind==='empty'?{x:9,y:6}:m.loc);
  expect(r.hits).toEqual([]);expect(r.outcome?.autoID).toBe(false);expect(draw).not.toHaveBeenCalled();expect(dump(m)).toBe(before);
 });
 it('reflection into player does not polymorph the player or the reflector',()=>{
  const g=scene(),m=mob(g,'stone_guardian'),before=dump(m),player=JSON.stringify(g.player);const r=cast(g,m);
  expect(r.reflections).toHaveLength(1);expect(r.hits.map(h=>h.creature)).toEqual([g.player]);expect(JSON.stringify(g.player)).toBe(player);expect(dump(m)).toBe(before);expect(r.outcome?.autoID).toBe(false);
 });
 it('random reflection transforms only its bystander contact',()=>{
  const g=scene(),m=mob(g,'golem',8,5),other=mob(g,'rat',8,8),before=dump(m),wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;
  vi.spyOn(rng,'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);vi.spyOn(rng,'randRange').mockReturnValueOnce(16).mockReturnValue(index('dragon'));
  const r=g.zapBoltFromPlayer(cfg(),wand,m.loc);expect(r.hits.map(h=>h.creature)).toEqual([other]);expect(other.typeId).toBe('dragon');expect(dump(m)).toBe(before);
 });
 it.each([true,false])('autoID uses NEW invisible status only, regardless of visibility=%s',visible=>{
  const g=scene(),m=mob(g);g.grid.getCell(9,5)!.isVisible=visible;m.setStatusDuration('invisible',30);
  expect(cast(g,m,'jackal').outcome?.autoID).toBe(true);g.player.setStatusDuration('telepathy',30);expect(cast(g,m,'phantom').outcome?.autoID).toBe(false);
 });
 it('unAlly/mutation/carried creature reset occurs BEFORE the first species roll',()=>{
  const g=scene(),m=mob(g,'monkey'),leader=mob(g,'rat',15,7);m.leader=leader;m.isAlly=true;m.carriedMonster=new Monster(0,0,data('phoenix'));m.mutation=mutations[0] as any;
  const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;vi.spyOn(rng,'randRange').mockImplementation(()=>{expect(m.isAlly).toBe(false);expect(m.leader).toBeNull();expect(m.mutation).toBeUndefined();expect(m.carriedMonster).toBeNull();expect(m.state).toBe(S.HUNTING);return index('rat');});g.zapBoltFromPlayer(cfg(),wand,m.loc);
 });
 it.each([['rat',S.ASLEEP,S.ASLEEP],['rat',S.FLEEING,S.FLEEING],['wraith',S.FLEEING,S.HUNTING],['goblin_conjurer',S.FLEEING,S.HUNTING],['goblin_conjurer',S.WANDERING,S.WANDERING],['monkey',S.ASLEEP,S.HUNTING]])('old %s state %i becomes %i (including C precedence)',(id,state,expected)=>{
  const g=scene(),m=mob(g,id as string);m.state=state as S;cast(g,m,'jackal');expect(m.state).toBe(expected);
 });
});

describe('W-19 fields, identity, relation exceptions, and death ownership',()=>{
 it('resets every projected info field but preserves creature identity, counters, bookkeeping, item and followers',()=>{
  const g=scene(),m=mob(g,'dragon'),leader=mob(g,'rat',15,6),child=mob(g,'rat',16,6);m.leader=leader;child.leader=m;
  m.mutate(mutations[0] as any);m.wasNegated=true;m.carriedMonster=new Monster(0,0,data('phoenix'));const carried=m.carriedMonster;
  m.accuracy=m.defense=777;m.abilityFlags.add('MA_HIT_STEAL_FLEE');m.bolts=['DRAGONFIRE'];m.abilities.add('ranged');m.statusImmunities.add('confused');m.statusResistTurns={confused:9};m.onHitStatus='weakened';m.onHitChance=1;m.onHitDuration=99;
  m.statusDurations={hasted:8,slowed:9,invisible:3,entranced:4,poisoned:11,shielded:100,levitating:1,immune_fire:99,confused:7,paralyzed:8};(m.statusDurations as any).burning=7;
  m.poisonAmount=4;m.maxShield=100;m.regenCounter=17;m.ticksUntilTurn=222;m.seized=m.seizing=true;
  m.machineHome=42;m.givenUpOnScent=true;m.targetWaypointIndex=3;m.waypointAlreadyVisited=[false,true];m.safetySnapshot=[[7]];m.spawnLoc={x:12,y:13};m.falling=m.preplaced=true;m.boundToLeader=m.boundToPlayer=m.doesNotTrackLeader=true;
  m.goldDropChance=.37;m.itemDropChance=.29;m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;
  const oldId=m.id,loc=m.loc,key=m.carriedItem,oldHP=m.hp,oldMax=m.maxHp,oldStats={...g.stats},way=m.waypointAlreadyVisited,safety=m.safetySnapshot;
  cast(g,m,'jackal');const d=data('jackal');
  expect(m).toMatchObject({id:oldId,typeId:'jackal',hp:polymorphHP(oldHP,oldMax,d.hp),maxHp:d.hp,accuracy:d.accuracy,defense:d.defense,damageString:d.damage,regenTurns:d.regen,regenCounter:17,ticksUntilTurn:222,wasNegated:false,mutation:undefined,carriedMonster:null,seized:false,seizing:false,poisonAmount:4,maxShield:0,machineHome:42,givenUpOnScent:true,targetWaypointIndex:3,spawnLoc:{x:12,y:13},falling:true,preplaced:true,boundToLeader:true,boundToPlayer:true,doesNotTrackLeader:true,goldDropChance:.37,itemDropChance:.29});
  expect(m.loc).toBe(loc);expect(m.carriedItem).toBe(key);expect(m.leader).toBe(leader);expect(child.leader).toBe(m);expect(m.waypointAlreadyVisited).toBe(way);expect(m.safetySnapshot).toBe(safety);expect(carried.hp).toBeGreaterThan(0);expect(g.stats).toEqual(oldStats);expect(g.items).toEqual([]);
  expect(m.statusDurations).toEqual({});expect([...m.behaviorFlags]).toEqual(d.behaviorFlags);expect([...m.abilityFlags]).toEqual(d.abilityFlags);expect(m.bolts).toEqual(d.bolts);expect([...m.abilities]).toEqual(d.abilities??[]);expect([...m.statusImmunities]).toEqual(d.statusImmunities??[]);expect(m.statusResistTurns).toEqual(d.statusResistTurns??{});expect(m.onHitStatus).toBe(d.onHitStatus);expect(m.onHitChance).toBe(d.onHitChance??0);expect(m.onHitDuration).toBe(d.onHitDuration??0);
 });
 it('normal ally loses only its own leader; its followers, including bound/dormant, keep their pointers',()=>{
  const g=scene(),m=mob(g),old=mob(g,'rat',15,6),a=mob(g,'rat',16,6),b=mob(g,'rat',17,6),d=mob(g,'rat',18,6);
  m.isAlly=m.dominated=true;m.leader=old;for(const f of [a,b,d]){f.leader=m;f.isAlly=true;}b.boundToLeader=true;d.isDormant=true;g.monsters=g.monsters.filter(f=>f!==d);g.dormantMonsters=[d];
  cast(g,m);expect(m).toMatchObject({isAlly:false,dominated:false,leader:null,state:S.HUNTING});for(const f of [a,b,d]){expect(f.leader).toBe(m);expect(f.isAlly).toBe(true);}
 });
 it('captive demotes after info/status reset, elects ordinary followers, detaches bound/dormant, keeps own hostile leader and item',()=>{
  const g=scene(),m=mob(g),old=mob(g,'rat',15,6),a=mob(g,'rat',16,6),b=mob(g,'rat',17,6),bound=mob(g,'rat',18,6),d=mob(g,'rat',19,6);
  m.isCaged=true;m.leader=old;m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;m.targetWaypointIndex=2;for(const f of [a,b,bound,d])f.leader=m;bound.boundToLeader=true;d.isDormant=true;b.waypointAlreadyVisited=[true,true,true];g.monsters=g.monsters.filter(f=>f!==d);g.dormantMonsters=[d];
  const demote=vi.spyOn(g as any,'demoteMonsterFromLeadership');cast(g,m);expect(demote).toHaveBeenCalledExactlyOnceWith(m);expect(m).toMatchObject({isCaged:false,isAlly:false,leader:old,state:S.HUNTING});expect(a.leader).toBeNull();expect(b.leader).toBe(a);expect(b.waypointAlreadyVisited[2]).toBe(false);expect(bound.leader).toBeNull();expect(d.leader).toBeNull();expect(m.carriedItem).toBeTruthy();expect(g.items).toEqual([]);
  (g as any).killOrphanedBoundFollowers();expect(bound.hp).toBe(0);expect(a.hp).toBeGreaterThan(0);expect(m.hp).toBeGreaterThan(0);
 });
 it('bound ally unAlly preserves the bound bit; orphan death happens on the ordinary next-turn sink',()=>{
  const g=scene(),m=mob(g);m.isAlly=true;m.boundToLeader=true;cast(g,m);expect(m.hp).toBeGreaterThan(0);(g as any).killOrphanedBoundFollowers();expect(m.hp).toBe(0);
 });
 it.each([['wisp',{levitating:1000,immune_fire:1000,burning:1000}],['phantom',{levitating:1000,invisible:1000}],['rat',{}]])('initializeStatus derives exactly the new %s flags, permanent for 1001 ticks',(id,status)=>{
  const g=scene(),m=mob(g,'kobold');m.statusDurations={hasted:8,slowed:8,shielded:100,poisoned:9};cast(g,m,id as string);expect(m.statusDurations).toEqual(status);for(let i=0;i<1001;i++)m.tickStatuses();expect(m.statusDurations).toEqual(status);
 });
 it('cleared haste leaves new cached speed, survives unrelated expiration, then a new slow/expiry restores normal behavior',()=>{
  const g=scene(),m=mob(g);m.statusDurations={hasted:8};cast(g,m);expect([m.moveSpeed,m.attackSpeed,m.getStatusDuration('hasted')]).toEqual([25,50,0]);m.applyStatus('confused',1);m.tickStatuses();expect([m.moveSpeed,m.attackSpeed]).toEqual([25,50]);
  (g as any).applyBasicBoltEffect(m,BoltEffect.SLOW,1);expect([m.moveSpeed,m.attackSpeed]).toEqual([100,200]);for(let i=0;i<5;i++)m.tickStatuses();expect([m.moveSpeed,m.attackSpeed]).toEqual([50,100]);
 });
 it('negation resets polymorph cached speed even without a haste status',()=>{const g=scene(),m=mob(g);m.statusDurations={hasted:8};cast(g,m);(g as any).negateCreatureMagic(m);expect([m.moveSpeed,m.attackSpeed]).toEqual([50,100]);});
 it.each([0,100,101,333])('ticksUntilTurn %i is max(old,101)',ticks=>{const g=scene(),m=mob(g);m.ticksUntilTurn=ticks;cast(g,m);expect(m.ticksUntilTurn).toBe(Math.max(ticks,101));});
 it('does not invoke immediate terrain entry or kill on losing flight; next environment pass owns lava death',()=>{
  const g=scene(),m=mob(g,'vampire_bat');g.grid.setTerrain(9,5,T.LAVA);const entry=vi.spyOn(g as any,'applyEnvironmentalEffects');cast(g,m,'rat');expect(m.hp).toBeGreaterThan(0);expect(entry).not.toHaveBeenCalled();(g as any).applyEnvironmentalEffects(m);expect(m.hp).toBe(0);
 });
 it.each([['bloat','rat',false],['rat','bloat',true]])('%s -> %s death uses new ability/type, exactly once',(from,to,gas)=>{
  const g=scene(),m=mob(g,from as string);m.carriedMonster=new Monster(0,0,data('phoenix'));m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;const key=m.carriedItem;const death=vi.spyOn(g.environment,'addGas');cast(g,m,to as string);expect(death).not.toHaveBeenCalled();m.takeDamage(m.hp,true);(g as any).triggerDeathFeatures();(g as any).triggerDeathFeatures();expect(death).toHaveBeenCalledTimes(gas?1:0);(g as any).removeDeadMonsters();(g as any).removeDeadMonsters();expect(g.items).toEqual([key]);expect(g.monsters).toEqual([]);
 });
});

describe('W-19 save and actual submission',()=>{
 it('ordinary save BEFORE any polymorph keeps species identity and actual traits despite a translated display name',()=>{
  const g=scene(),m=mob(g);m.name='老鼠';m.behaviorFlags.add('MONST_FLIES');m.abilityFlags.add('MA_HIT_STEAL_FLEE');m.bolts=['FIRE'];m.accuracy=321;
  const saved=JSON.parse(JSON.stringify((g as any).serializeMonster(m))),restored=(g as any).deserializeMonster(saved) as Monster;g.monsters=[restored];
  expect(restored.typeId).toBe('rat');expect(restored.hasBehavior('MONST_FLIES')).toBe(true);expect(restored.bolts).toEqual(['FIRE']);expect(restored.accuracy).toBe(321);
  const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;const draw=vi.spyOn(rng,'randRange').mockReturnValueOnce(index('rat')).mockReturnValueOnce(index('jackal'));
  g.zapBoltFromPlayer(cfg(),wand,restored.loc);expect(restored.typeId).toBe('jackal');expect(draw.mock.calls).toEqual([[1,67],[1,67]]);
 });
 it.each(['rat','stone_guardian','Warden_of_Yendor'])('legacy exact localized %s name restores identity and native eligibility without guessing from glyph',id=>{
  const g=scene(),m=mob(g,id);m.name='旧档'+id;const saved=JSON.parse(JSON.stringify((g as any).serializeMonster(m)));delete saved.form;
  // Translation lookup is a deterministic fixture for the current locale.
  vi.spyOn(ItemLoader,'translateName').mockImplementation(name=>name===data(id).name?'旧档'+id:name);
  const restored=(g as any).deserializeMonster(saved) as Monster;g.monsters=[restored];expect(restored.typeId).toBe(id);expect([...restored.behaviorFlags]).toEqual(data(id).behaviorFlags);
  const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!,draw=vi.spyOn(rng,'randRange').mockReturnValue(index('jackal'));
  // Direct effect contact isolates the legacy immunity gate from reflector travel.
  const accepted=restored.polymorph(()=>{});expect(accepted).toBe(id==='rat');expect(draw).toHaveBeenCalledTimes(id==='rat'?1:0);expect(wand).toBeTruthy();
 });
 it('unrecognizable legacy names are not guessed from glyph or HP and refuse polymorph without writes/RNG',()=>{
  const g=scene(),m=mob(g);m.name='unknown old mutation title';m.isAlly=true;m.isCaged=true;const saved=JSON.parse(JSON.stringify((g as any).serializeMonster(m)));delete saved.form;
  const restored=(g as any).deserializeMonster(saved) as Monster;g.monsters=[restored];const before=dump(restored),wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!,draw=vi.spyOn(rng,'randRange');
  const r=g.zapBoltFromPlayer(cfg(),wand,restored.loc);expect(r.outcome?.autoID).toBe(false);expect(draw).not.toHaveBeenCalled();expect(dump(restored)).toBe(before);
 });
 it('JSON round-trip retains current species, speed, item identity, hostile relation, and later death; tagless legacy stays legacy',()=>{
  const g=live(),m=mob(g),leader=mob(g,'rat',15,7),child=mob(g,'rat',16,7);m.leader=leader;child.leader=m;m.statusDurations={hasted:8};m.poisonAmount=4;m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;m.carriedItem.id=900000;m.machineHome=72;m.targetWaypointIndex=2;m.deathEffectTriggered=false;
  cast(g,m,'bloat');const saved=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(saved)).toBe(true);const restored=g.monsters.find(x=>x.id===m.id)!;
  expect(restored).toMatchObject({typeId:'bloat',polymorphed:true,moveSpeed:50,attackSpeed:50,ticksUntilTurn:101,poisonAmount:4,machineHome:72});expect(restored.leader?.id).toBe(leader.id);expect(g.monsters.find(x=>x.id===child.id)!.leader).toBe(restored);expect(restored.carriedItem!.id).toBe(900000);expect(new Monster(0,0,data('rat')).id).toBeGreaterThan(900000);
  restored.tickStatuses();expect(restored.moveSpeed).toBe(50);restored.takeDamage(restored.hp,true);const gas=vi.spyOn(g.environment,'addGas');(g as any).triggerDeathFeatures();(g as any).removeDeadMonsters();expect(gas).toHaveBeenCalledOnce();expect(g.items[0]!.id).toBe(900000);
  const old=structuredClone(saved);for(const s of old.monsters)delete s.polymorph;g.loadSnapshot(old);expect(g.monsters.find(x=>x.id===m.id)!.polymorphed).toBe(false);
 });
 it('tagged dormant list and test-room reconstruction preserve form and references',()=>{
  const g=live(),m=mob(g),child=mob(g,'rat',15,7);cast(g,m,'phantom');child.leader=m;g.toggleMonsterDormancy(m);
  const saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(saved);const restored=g.dormantMonsters.find(x=>x.id===m.id)!;expect(restored.isDormant).toBe(true);expect(restored.typeId).toBe('phantom');expect(restored.hasStatus('invisible')).toBe(true);expect(g.monsters[0]!.leader).toBe(restored);const copy=(g as any).createMonsterFromSnapshot(saved.dormantMonsters[0]);expect(copy.typeId).toBe('phantom');expect(copy.polymorphed).toBe(true);
 });
 it('cancel is zero cost; actual confirm spends one charge/turn and transforms in place',()=>{
  const g=live(),m=mob(g);m.ticksUntilTurn=100000;const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;wand.charges=3;g.player.inventory.addItem(wand);
  const zap=g.zapBoltFromPlayer.bind(g);vi.spyOn(g,'zapBoltFromPlayer').mockImplementation((_b,it,to)=>zap(cfg(),it,to));
  const turns=g.stats.turns;g.useArcanaItem(wand);g.cancelArcanaSelection();expect(wand.charges).toBe(3);expect(g.stats.turns).toBe(turns);expect(m.typeId).toBe('rat');
  g.useArcanaItem(wand);g.setArcanaTarget(m.x,m.y);const original=rng.randRange.bind(rng);vi.spyOn(rng,'randRange').mockImplementation((lo,hi)=>lo===1&&hi===67?index('jackal'):original(lo,hi));g.confirmArcanaTarget();expect(wand.charges).toBe(2);expect(g.stats.turns).toBe(turns+1);expect(m.typeId).toBe('jackal');expect(g.monsters).toContain(m);
 });
 it('101 wait protects the cast action; the transformed creature acts on the next objective advance',()=>{
  const g=live(),m=mob(g,'rat',5,5);m.state=S.HUNTING;m.isAlly=true;m.ticksUntilTurn=0;const wand=ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;wand.charges=2;g.player.inventory.addItem(wand);
  const zap=g.zapBoltFromPlayer.bind(g);vi.spyOn(g,'zapBoltFromPlayer').mockImplementation((_b,it,to)=>zap(cfg(),it,to));
  const original=rng.randRange.bind(rng);vi.spyOn(rng,'randRange').mockImplementation((lo,hi)=>lo===1&&hi===67?index('jackal'):original(lo,hi));
  const attack=vi.spyOn(CombatSystem,'attack'),turn=vi.spyOn(m,'takeTurn');g.useArcanaItem(wand);g.setArcanaTarget(5,5);g.confirmArcanaTarget();expect(m.typeId).toBe('jackal');expect(m.ticksUntilTurn).toBe(1);expect(turn).not.toHaveBeenCalled();
  g.handlePlayerAction('wait');expect(turn).toHaveBeenCalled();expect(attack.mock.calls.some(([attacker,defender])=>attacker===m&&defender===g.player)).toBe(true);
 });

});
