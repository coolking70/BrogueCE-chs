import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { getBoltForItem, BoltEffect } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { arcanaTargetCandidates } from '../engine/Combat/BoltTargeting';
import { wandDominate } from '../engine/Combat/Domination';
import { CombatSystem } from '../engine/Combat/Combat';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Player } from '../entities/Player';
import { Monster, MonsterState, countMinions, monstersAreEnemies, monstersAreTeammates, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import hordes from '../data/hordes.json';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';

function install(g:Game) {
 g.grid=new Grid(DCOLS,DROWS);
 for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++){
  g.grid.setTerrain(x,y,x>0&&x<DCOLS-1&&y>0&&y<DROWS-1?T.FLOOR:T.WALL);
  Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true});
 }
 g.player=new Player(4,5);g.monsters=[];g.dormantMonsters=[];g.items=[];
 g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
 g.spawnFloatingText=vi.fn();g.stats={kills:0,gold:0,turns:0,maxDepth:1};return g;
}
function scene(){const g=install(Object.create(Game.prototype));(g as any).updateVision=vi.fn();return g;}
function live(){const g=install(createHeadlessGame(1717,'test'));g.player.ticksUntilTurn=0;return g;}
function mob(g:Game,id='rat',x=9,y=5){const m=new Monster(x,y,(monsters as MonsterData[]).find(d=>d.id===id)!);m.hp=19;m.maxHp=100;g.monsters.push(m);return m;}
function item(){return ItemLoader.spawnWand('wand_of_slowness',-1,-1)!;}
const bolt=()=>({...getBoltForItem('wand_of_slowness')!,id:'w17-explicit-fixture',ceType:CEBoltType.DOMINATION,effect:BoltEffect.DOMINATION});
function cast(g:Game,to={x:9,y:5}){return g.zapBoltFromPlayer(bolt(),item(),to);}
const dump=(m:Monster)=>JSON.stringify(m,(k,v)=>k==='leader'?(v?.id??null):v instanceof Set?[...v].sort():v);
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(1717);ItemLoader.identifiedItems.clear();});

describe('W-17 compiled CE formula and actual 100-outcome boundary sweep',()=>{
 it('matches the unmodified clang-compiled formula, including integer truncation and overhealing',()=>{
  const rows=fs.readFileSync('ai_docs/reports/w-17-evidence/ce-domination.txt','utf8').trim().split('\n');
  expect(rows.length).toBe(485);
  for(const line of rows){const [hp,maxHp,chance,count]=line.split(' ').map(Number);expect(wandDominate({hp:hp!,maxHp:maxHp!})).toBe(chance);expect(count).toBe(chance);}
 });
 it.each([[100,0],[20,80],[19,100]])('HP %i/100: every possible CE roll yields exactly %i actual conversions',(hp,successes)=>{
  const g=scene(),m=mob(g),wand=item();const draw=vi.spyOn(rng,'randRange');let count=0;
  for(let roll=0;roll<100;roll++){
   m.hp=hp;m.maxHp=100;m.isAlly=false;m.dominated=false;m.state=MonsterState.FLEEING;m.setStatusDuration('discordant',17);
   draw.mockReturnValue(roll);draw.mockClear();
   const result=g.zapBoltFromPlayer({...bolt(),magnitude:999},wand,m.loc);
   expect(result.hits.map(h=>h.creature)).toEqual([m]);expect(result.outcome?.autoID).toBe(true);
   expect(draw).toHaveBeenCalledExactlyOnceWith(0,99);
   if(m.isAlly){count++;expect(m.hasStatus('discordant')).toBe(false);expect(m.state).toBe(MonsterState.WANDERING);}
   else{expect(m.getStatusDuration('discordant')).toBe(17);expect(m.state).toBe(MonsterState.FLEEING);}
   expect(m.hp).toBe(hp);
  }
  expect(count).toBe(successes);
 });
 it.each([0,100])('even chance %i consumes one substantive RNG draw',chance=>{
  const g=scene(),m=mob(g),wand=item();m.hp=chance===0?100:19;
  const before=rng.randomNumbersGenerated;g.zapBoltFromPlayer(bolt(),wand,m.loc);expect(rng.randomNumbersGenerated-before).toBe(1);
 });
});

describe('W-17 failure is a no-write transaction and success preserves unrelated state',()=>{
 it.each([false,true])('chance 80 percent failure leaves every target field, leader, followers and carried key unchanged (ally=%s)',ally=>{
  const g=scene(),m=mob(g),leader=mob(g,'rat',15,7),follower=mob(g,'rat',16,7);
  m.hp=20;m.isAlly=ally;m.isCaged=true;m.state=MonsterState.ASLEEP;m.leader=leader;follower.leader=m;
  m.seized=m.seizing=true;m.boundToLeader=true;m.setStatusDuration('discordant',11);m.setStatusDuration('confused',7);
  m.setStatusDuration('hasted',8);m.addPoison(12,3);m.applyShield(130);m.carriedItem=ItemLoader.spawnKey('iron_key',9,5)!;
  const before=[m,leader,follower].map(dump);const ground=[...g.items];const convert=vi.spyOn(g,'becomeAllyWith');
  vi.spyOn(rng,'randRange').mockReturnValue(80);const r=cast(g);
  expect([m,leader,follower].map(dump)).toEqual(before);expect(g.items).toEqual(ground);expect(convert).not.toHaveBeenCalled();expect(r.outcome?.autoID).toBe(true);
 });
 it('successful conversion clears only discordant/captive/seized, wakes target, retains seizing and other statuses',()=>{
  const g=scene(),m=mob(g);m.state=MonsterState.ASLEEP;m.isCaged=true;m.seized=m.seizing=true;
  m.setStatusDuration('discordant',10);m.setStatusDuration('confused',8);m.setStatusDuration('paralyzed',9);m.addPoison(10,2);m.applyShield(200);
  const before={...m.statusDurations},hp=m.hp;cast(g);
  expect(m).toMatchObject({isAlly:true,dominated:true,isCaged:false,seized:false,seizing:true,leader:null,state:MonsterState.WANDERING,hp});
  expect(m.getStatusDuration('discordant')).toBe(0);
  for(const [key,value] of Object.entries(before))if(key!=='discordant')expect(m.statusDurations[key as keyof typeof before]).toBe(value);
  expect(m.poisonAmount).toBe(2);expect(m.maxShield).toBe(200);expect(monstersAreTeammates(m,g.player)).toBe(true);expect(monstersAreEnemies(m,g.player)).toBe(false);
 });
 it('a full-health already allied discordant target resists without being cured or detached',()=>{
  const g=scene(),m=mob(g),leader=mob(g,'rat',12,7);m.hp=100;m.isAlly=true;m.leader=leader;m.setStatusDuration('discordant',9);
  const before=dump(m);cast(g);expect(dump(m)).toBe(before);
 });
});

describe('W-17 ineligible targets, actual contacts, observability, and selection',()=>{
 it.each(['MONST_INANIMATE','MONST_INVULNERABLE','MONST_TURRET'])('%s contact performs no roll, conversion, cure or autoID',flag=>{
  const g=scene(),m=mob(g),wand=item();m.behaviorFlags.add(flag);m.isCaged=true;m.setStatusDuration('discordant',4);
  const before=dump(m),draw=vi.spyOn(rng,'randPercent');const r=g.zapBoltFromPlayer(bolt(),wand,m.loc);
  expect(r.hits.map(h=>h.creature)).toEqual([m]);expect(draw).not.toHaveBeenCalled();expect(dump(m)).toBe(before);expect(r.outcome?.autoID).toBe(false);
 });
 it('living IMMOBILE/weapon-immune targets are eligible; no extra guessed immunity',()=>{
  const g=scene(),m=mob(g);m.behaviorFlags.add('MONST_IMMOBILE');m.behaviorFlags.add('MONST_IMMUNE_TO_WEAPONS');cast(g);expect(m.isAlly).toBe(true);
 });
 it('always reflection hits the player, who remains unchanged and cannot be dominated',()=>{
  const g=scene(),m=mob(g,'stone_guardian');const before=JSON.stringify(g.player);const r=cast(g);
  expect(r.reflections).toHaveLength(1);expect(r.hits.map(h=>h.creature)).toEqual([g.player]);expect(JSON.stringify(g.player)).toBe(before);expect(m.isAlly).toBe(false);expect(r.outcome?.autoID).toBe(false);
 });
 it('random reflection dominates only the actual bystander, leaving the reflector and original aim unchanged',()=>{
  const g=scene(),reflector=mob(g,'golem',8,5),bystander=mob(g,'rat',8,8);bystander.setStatusDuration('discordant',6);
  const before=dump(reflector);vi.spyOn(rng,'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(true);
  vi.spyOn(rng,'randRange').mockReturnValue(16);const r=cast(g,reflector.loc);
  expect(r.reflections).toHaveLength(1);expect(r.hits.map(h=>h.creature)).toEqual([bystander]);expect(dump(reflector)).toBe(before);
  expect(bystander.isAlly).toBe(true);expect(bystander.hasStatus('discordant')).toBe(false);expect(g.player.hp).toBe(g.player.maxHp);
 });
 it.each(['empty','wall','same-origin'])('%s ray cannot convert, cure or identify',mode=>{
  const g=scene(),m=mob(g);if(mode==='wall')g.grid.setTerrain(7,5,T.WALL);
  const before=dump(m);const r=cast(g,mode==='same-origin'?g.player.loc:mode==='empty'?{x:9,y:6}:m.loc);
  expect(r.hits).toEqual([]);expect(dump(m)).toBe(before);expect(r.outcome?.autoID).toBe(false);
 });
 it.each([true,false])('unseen success/failure (success=%s) does not identify',success=>{
  const g=scene(),m=mob(g);m.hp=success?19:100;g.grid.getCell(m.x,m.y)!.isVisible=false;
  const r=cast(g);expect(m.isAlly).toBe(success);expect(r.outcome?.autoID).toBe(false);
 });
 it('invisible enemy becomes observable on success; failure stays invisible and unidentified',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('invisible',20);m.hp=100;expect(cast(g).outcome?.autoID).toBe(false);
  m.hp=19;expect(cast(g).outcome?.autoID).toBe(true);expect(m.hasStatus('invisible')).toBe(true);
 });
 it('known candidates exclude full health but manual fire still makes a 0% attempt; unknown kind does not leak HP filtering',()=>{
  const g=scene(),m=mob(g),wand=item();(wand as any).identityId='wand_of_domination';m.hp=100;
  expect(arcanaTargetCandidates(g.player,g.grid,g.monsters,wand)).toEqual([m]);ItemLoader.identifiedItems.add('wand_of_domination');
  expect(arcanaTargetCandidates(g.player,g.grid,g.monsters,wand)).toEqual([]);expect(cast(g).outcome?.autoID).toBe(true);expect(m.isAlly).toBe(false);
  m.hp=99;expect(arcanaTargetCandidates(g.player,g.grid,g.monsters,wand)).toEqual([m]);m.isCaged=true;expect(arcanaTargetCandidates(g.player,g.grid,g.monsters,wand)).toEqual([]);
 });
});

describe('W-17 item ownership, captive, horde, minions, grab and combat consumers',()=>{
 it('success frees a captive without calling freeCaptive/logging a separate rescue; drops same bound key, never auto-picks it up',()=>{
  const g=scene(),m=mob(g);m.isCaged=true;const key=ItemLoader.spawnKey('iron_key',0,0)!;
  key.keyLoc=[{loc:{x:11,y:5},machine:7,disposableHere:true}];key.originDepth=1;m.carriedItem=key;const free=vi.spyOn(g,'freeCaptive');
  cast(g);expect(free).not.toHaveBeenCalled();expect(m.isCaged).toBe(false);expect(m.carriedItem).toBeNull();expect(g.items).toEqual([key]);expect(key.loc).toEqual(m.loc);
  expect(g.player.inventory.items).not.toContain(key);expect(key.keyLoc).toEqual([{loc:{x:11,y:5},machine:7,disposableHere:true}]);expect(key.originDepth).toBe(1);
 });
 it('an occupied drop square searches nearby without overwriting the existing item; monsters can share a drop square',()=>{
  const g=scene(),m=mob(g),other=mob(g,'rat',8,4);const old=ItemLoader.spawnFood('ration_of_food',9,5)!;g.items=[old];m.carriedItem=ItemLoader.spawnFood('ration_of_food',0,0)!;const carried=m.carriedItem;
  vi.spyOn(rng,'randRange').mockReturnValue(0);cast(g);expect(g.items).toEqual([old,carried]);expect(carried.loc).toEqual(other.loc);expect(old.loc).toEqual(m.loc);
 });
 it('converting a member detaches only it from its old leader; hostile minion count falls',()=>{
  const g=scene(),m=mob(g),leader=mob(g,'goblin_conjurer',15,7),peer=mob(g,'rat',16,7);m.leader=leader;peer.leader=leader;
  expect(countMinions(leader,g.monsters)).toBe(2);cast(g);expect(m.leader).toBeNull();expect(peer.leader).toBe(leader);expect(countMinions(leader,g.monsters)).toBe(1);expect(peer.isAlly).toBe(false);
 });
 it('converting a leader elects current active follower, reparents later/cross-level followers, detaches dormant and bound ones',()=>{
  const g=scene(),m=mob(g),bound=mob(g,'spectral_blade',13,7),first=mob(g,'rat',14,7),second=mob(g,'rat',15,7),remote=mob(g,'rat',16,7),dormant=mob(g,'rat',17,7),remoteDormant=mob(g,'rat',18,7);
  for(const f of [bound,first,second,remote,dormant,remoteDormant])f.leader=m;
  bound.boundToLeader=true;dormant.isDormant=remoteDormant.isDormant=true;g.monsters=[m,bound,first,second];g.dormantMonsters=[dormant];
  (g as any).levels=new Map([[2,{monsters:[remote],dormantMonsters:[remoteDormant]}],[1,{monsters:g.monsters,dormantMonsters:g.dormantMonsters}]]);
  m.targetWaypointIndex=3;second.waypointAlreadyVisited=Array(40).fill(true);cast(g);
  expect(m.leader).toBeNull();expect(first.leader).toBeNull();expect(second.leader).toBe(first);expect(remote.leader).toBe(first);
  expect(bound.leader).toBeNull();expect(bound.hp).toBeGreaterThan(0);expect(dormant.leader).toBeNull();expect(remoteDormant.leader).toBeNull();
  expect(second.targetWaypointIndex).toBe(3);expect(second.waypointAlreadyVisited[3]).toBe(false);
  for(const f of [bound,first,second,remote,dormant,remoteDormant])expect(f.isAlly).toBe(false);
 });
 it('when no current follower can inherit, election visits cached levels by CE depth order, not Map insertion order',()=>{
  const g=scene(),m=mob(g),later=mob(g,'rat',15,7),earlier=mob(g,'rat',16,7);later.leader=earlier.leader=m;g.monsters=[m];
  (g as any).levels=new Map([[8,{monsters:[later],dormantMonsters:[]}],[2,{monsters:[earlier],dormantMonsters:[]}]]);
  cast(g);expect(earlier.leader).toBeNull();expect(later.leader).toBe(earlier);expect(earlier.isAlly).toBe(false);
 });
 it('dead active entities and stale current-level cached arrays cannot win leadership on a revisited level',()=>{
  const g=scene(),m=mob(g),dead=mob(g,'rat',14,7),stale=mob(g,'rat',15,7),liveFollower=mob(g,'rat',16,7);
  for(const f of [dead,stale,liveFollower])f.leader=m;dead.hp=0;g.depth=1;g.monsters=[m,dead];
  (g as any).levels=new Map([[1,{monsters:[stale],dormantMonsters:[]}],[2,{monsters:[liveFollower],dormantMonsters:[]}]]);
  cast(g);expect(liveFollower.leader).toBeNull();expect(stale.leader).toBe(m);expect(dead.hp).toBe(0);
 });
 it('detached bound enemy dies through normal turn/death settlement once; allied bound follower survives',()=>{
  const g=live(),m=mob(g),bound=mob(g,'spectral_blade',13,7),ally=mob(g,'spectral_blade',14,7);
  for(const f of [bound,ally]){f.boundToLeader=true;f.leader=m;f.applyShield(1000);}ally.isAlly=true;bound.carriedItem=ItemLoader.spawnFood('ration_of_food',0,0)!;const carried=bound.carriedItem;
  const die=vi.spyOn(bound as any,'die');cast(g);expect(bound.hp).toBeGreaterThan(0);
  (g as any).playerTurnEnded();expect(die).toHaveBeenCalledOnce();expect(g.monsters).not.toContain(bound);expect(g.monsters).toContain(ally);expect(g.items).toContain(carried);
  (g as any).playerTurnEnded();expect(die).toHaveBeenCalledOnce();expect(g.items.filter(i=>i===carried)).toHaveLength(1);
 });
 it('W-11 freeCaptive shares corrected leader demotion but does not clear discordant',()=>{
  const g=scene(),m=mob(g),bound=mob(g,'spectral_blade',13,7),f=mob(g,'rat',14,7);bound.boundToLeader=true;bound.leader=m;f.leader=m;m.isCaged=true;m.setStatusDuration('discordant',7);
  g.freeCaptive(m);expect(bound.leader).toBeNull();expect(f.leader).toBeNull();expect(m.getStatusDuration('discordant')).toBe(7);expect(m.dominated).toBe(false);
 });
 it('real summonMinionsFor marks the CE bound horde without changing summon allegiance inheritance',()=>{
  const g=scene(),m=mob(g,'goblin_conjurer');cast(g);g.summonMinionsFor(m);const minions=g.monsters.filter(f=>f.leader===m);
  expect(minions.length).toBeGreaterThan(0);for(const f of minions)expect(f).toMatchObject({isAlly:true,boundToLeader:true,ticksUntilTurn:101});
  expect(hordes.some(h=>h.leader==='GOBLIN_CONJURER'&&h.flags.includes('HORDE_DIES_ON_LEADER_DEATH'))).toBe(true);
  expect(countMinions(m,g.monsters)).toBe(1+minions.length);
 });
 it('natural splitting inherits converted allegiance and binding without converting the old team',()=>{
  const g=scene(),m=mob(g,'pink_jelly'),enemy=mob(g,'rat',15,5);m.boundToLeader=true;cast(g);m.hp=18;
  (g as any).trySplitMonster(m,enemy);const clone=g.monsters.find(x=>x!==m&&x.typeId==='pink_jelly')!;
  expect(clone).toBeDefined();expect(clone).toMatchObject({isAlly:true,dominated:true,boundToLeader:true,leader:null});expect(enemy.isAlly).toBe(false);
 });
 it('dominating the player\'s seizer retains its seizing bit but ends the hostile grab relationship',()=>{
  const g=scene(),m=mob(g,'kraken',5,5);m.seizing=true;g.player.seized=true;expect((g as any).findLiveSeizer()).toBe(m);
  cast(g,m.loc);expect(m.seizing).toBe(true);expect((g as any).findLiveSeizer()).toBeUndefined();
 });
 it('the converted ally attacks its former team, and an awake enemy can retaliate',()=>{
  const g=live(),m=mob(g),enemy=mob(g,'rat',10,5);enemy.state=MonsterState.HUNTING;m.damageString=enemy.damageString='1d1';m.regenTurns=0;
  cast(g);vi.spyOn(rng,'randPercent').mockReturnValue(true);const attack=vi.spyOn(CombatSystem,'attack');const hp=enemy.hp;
  m.takeTurn(g,10);expect(attack.mock.calls[0]![1]).toBe(enemy);expect(enemy.hp).toBeLessThan(hp);const own=m.hp;
  enemy.takeTurn(g,10);expect(m.hp).toBeLessThan(own);expect(g.player.hp).toBe(g.player.maxHp);
 });
});

describe('W-17 JSON persistence and submission (W-24 catalog now available)',()=>{
 it('active/dormant JSON round trip retains allegiance, cleared discord, item key binding and re-elected leader references',()=>{
  const g=live(),m=mob(g,'goblin_conjurer'),f=mob(g,'rat',15,7),peer=mob(g,'rat',16,7),dormant=mob(g,'rat',17,7);f.leader=peer.leader=m;
  m.setStatusDuration('discordant',9);m.carriedItem=ItemLoader.spawnKey('iron_key',0,0)!;m.carriedItem!.keyLoc=[{loc:{x:11,y:5},machine:4}];
  cast(g);dormant.isAlly=true;dormant.isDormant=true;g.monsters=g.monsters.filter(x=>x!==dormant);g.dormantMonsters=[dormant];
  const save=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(save)).toBe(true);const restored=g.monsters.find(x=>x.id===m.id)!;
  expect(restored).toMatchObject({isAlly:true,dominated:true,typeId:'goblin_conjurer',leader:null,isCaged:false,hp:19});expect(restored.hasStatus('discordant')).toBe(false);
  expect(restored.bolts).toEqual(m.bolts);expect(restored.abilityFlags).toEqual(m.abilityFlags);expect(restored.moveSpeed).toBe(m.moveSpeed);
  expect(g.monsters.find(x=>x.id===peer.id)!.leader).toBe(g.monsters.find(x=>x.id===f.id));expect(g.dormantMonsters[0]!.isAlly).toBe(true);expect(g.items[0]!.keyLoc).toEqual([{loc:{x:11,y:5},machine:4}]);
  g.summonMinionsFor(restored);expect(g.monsters.some(x=>x.leader===restored&&x.isAlly)).toBe(true);
 });
 it('horde blade leader/binding round trip stays in its single W-16 tag; deleting it preserves the old tagless fallback',()=>{
  const g=live(),leader=mob(g,'goblin_conjurer',15,7),blade=mob(g,'spectral_blade');blade.leader=leader;blade.boundToLeader=true;
  const saved=(g as any).serializeMonster(blade);expect(saved.allegiance).toBeUndefined();expect(saved.spectralBlade).toMatchObject({leaderId:leader.id,boundToLeader:true});
  g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));const restored=g.monsters.find(m=>m.id===blade.id)!;
  expect(restored.boundToLeader).toBe(true);expect(restored.leader).toBe(g.monsters.find(m=>m.id===leader.id));
  delete saved.spectralBlade;expect((g as any).deserializeMonster(saved)).toMatchObject({isAlly:false,boundToLeader:false,leader:null});
 });
 it('old saves without allegiance never infer an ally from name/state; W-16 blade tag remains compatible',()=>{
  const g=live(),m=mob(g);cast(g);const save=JSON.parse(JSON.stringify(g.toSnapshot()));for(const row of save.monsters){delete row.allegiance;delete row.dominatedForm;}
  g.loadSnapshot(save);expect(g.monsters[0]!).toMatchObject({isAlly:false,dominated:false,boundToLeader:false,leader:null});
  const row=(g as any).serializeMonster(m);delete row.allegiance;row.spectralBlade={isAlly:true,boundToPlayer:true,doesNotTrackLeader:true,ticksUntilTurn:1};
  expect((g as any).deserializeMonster(row)).toMatchObject({isAlly:true,boundToPlayer:true,ticksUntilTurn:1});
 });
 it('test-room baseline restore uses the same relation and actual form payload',()=>{
  const g=scene(),m=mob(g,'ogre');cast(g);const row=(g as any).serializeMonster(m);const restored=(g as any).createMonsterFromSnapshot(JSON.parse(JSON.stringify(row)));
  expect(restored).toMatchObject({isAlly:true,dominated:true,typeId:'ogre',leader:null});expect(restored.damageString).toBe(m.damageString);
 });
 it('actual test-room reset restores both the ally and hostile follower references from JSON baselines',()=>{
  const g=live(),m=mob(g),leader=mob(g,'rat',15,7),f=mob(g,'rat',16,7);f.leader=leader;cast(g);
  const room={id:17,x1:1,y1:1,x2:20,y2:10,baselineItems:[],baselineMonsters:g.monsters.map(x=>(g as any).serializeMonster(x)),baselineTerrains:[]};
  g.testRooms=new Map([[17,JSON.parse(JSON.stringify(room))]]);(g as any).resetTestRoom(17);
  expect(g.monsters.find(x=>x.id===m.id)).toMatchObject({isAlly:true,dominated:true});
  expect(g.monsters.find(x=>x.id===f.id)!.leader).toBe(g.monsters.find(x=>x.id===leader.id));
 });
 it.each([19,100])('explicit pending fixture: cancel costs zero; confirmation at HP=%i consumes one charge/turn and visible result autoIDs',hp=>{
  const g=live(),m=mob(g);m.hp=hp;m.ticksUntilTurn=100000;const wand=item();wand.charges=2;g.player.inventory.addItem(wand);
  const realZap=g.zapBoltFromPlayer.bind(g);vi.spyOn(g,'zapBoltFromPlayer').mockImplementation((_config,it,to)=>realZap(bolt(),it,to));
  g.useArcanaItem(wand);g.setArcanaTarget(m.x,m.y);const before=g.stats.turns;
  g.cancelArcanaSelection();expect(wand.charges).toBe(2);expect(g.stats.turns).toBe(before);expect(m.isAlly).toBe(false);
  g.useArcanaItem(wand);g.setArcanaTarget(m.x,m.y);const r=g.confirmArcanaTarget();
  expect(r?.outcome?.autoID).toBe(true);expect(wand.charges).toBe(1);expect(g.stats.turns).toBe(before+1);expect(m.isAlly).toBe(hp===19);
 });
 it('W-24 supplies the domination identity/config and generation entry',()=>{
  expect(ItemLoader.spawnWand('wand_of_domination',0,0)).not.toBeNull();expect(getBoltForItem('wand_of_domination')?.effect).toBe(BoltEffect.DOMINATION);
  expect(JSON.parse(fs.readFileSync('src/data/arcana.json','utf8')).wands.some((w:{id:string})=>w.id==='wand_of_domination')).toBe(true);
 });
});
