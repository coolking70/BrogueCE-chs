import fs from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { getBoltForItem, BoltEffect } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { CombatSystem } from '../engine/Combat/Combat';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { generateMonsterDetail } from '../engine/UI/DetailGenerator';
import { Player } from '../entities/Player';
import type { StatusId } from '../entities/Creature';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import mutations from '../data/mutations.json';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';
const data=(id:string)=>(monsters as MonsterData[]).find(d=>d.id===id)!;
function install(g:Game){
 g.grid=new Grid(DCOLS,DROWS);for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++){
  g.grid.setTerrain(x,y,x>0&&x<DCOLS-1&&y>0&&y<DROWS-1?T.FLOOR:T.WALL);Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true,isDiscovered:true});
 }
 g.player=new Player(4,5);g.monsters=[];g.dormantMonsters=[];g.items=[];g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
 g.spawnFloatingText=vi.fn();g.stats={kills:0,gold:0,turns:0,maxDepth:1};return g;
}
function scene(){const g=install(Object.create(Game.prototype));(g as any).updateVision=vi.fn();return g;}
function live(){return install(createHeadlessGame(2121,'test'));}
function mob(g:Game,id='rat',x=9,y=5){const m=new Monster(x,y,data(id));m.ticksUntilTurn=100000;g.monsters.push(m);return m;}
const wand=()=>ItemLoader.spawnWand('wand_of_empowerment',-1,-1)!;
const bolt=()=>getBoltForItem('wand_of_empowerment')!;
const cast=(g:Game,m:Monster|Player)=>g.zapBoltFromPlayer(bolt(),wand(),m.loc);
const dump=(m:Monster|Player)=>JSON.stringify(m,(k,v)=>k==='leader'?(v?.id??null):v instanceof Set?[...v].sort():v);
const stats=(m:Monster)=>[m.maxHp,m.hp,m.defense,m.accuracy,CombatSystem.parseDamageString(m.damageString).min,CombatSystem.parseDamageString(m.damageString).max,m.newPowerCount,m.totalPowerCount];
beforeEach(()=>{vi.restoreAllMocks();rng.seedRandomGenerator(2121);ItemLoader.identifiedItems.clear();});

describe('W-21 CE integers and repeated actual wand hits',()=>{
 it('matches 540 compiled original CE cases, including zero and decade boundaries and twelve successive hits',()=>{
  const rows=fs.readFileSync('ai_docs/reports/w-21-evidence/ce-empower.txt','utf8').trim().split('\n').filter(l=>l.startsWith('empower '));
  const g=scene(),m=mob(g),item=wand(),failures:unknown[]=[];const rngBefore=rng.randomNumbersGenerated;
  for(const row of rows){
   const [lo,hi,n,hpMax,hp,def,acc,dlo,dhi,clump,np,tp]=row.split(' ').slice(1).map(Number);
   if(n===1){Object.assign(m,{maxHp:37,hp:1,defense:17,accuracy:85,damageString:`${lo}-${hi}`,newPowerCount:0,totalPowerCount:0});}
   const result=g.zapBoltFromPlayer(bolt(),item,m.loc);
   const expected=[hpMax,hp,def,acc,dlo,dhi,np,tp];
   if(JSON.stringify(stats(m))!==JSON.stringify(expected)||!result.outcome?.autoID)failures.push({row,actual:stats(m)});
   expect(clump).toBe(3); // CE preserves it; web's existing uniform combat is separately registered.
  }
  expect(rows).toHaveLength(540);expect(failures).toEqual([]);expect(rng.randomNumbersGenerated).toBe(rngBefore);
 });
 it.each([false,true])('same fixed increments for ally=%s; no allegiance, mutation or ability changes',ally=>{
  const g=scene(),m=mob(g,'ogre');m.isAlly=ally;m.mutate(structuredClone(mutations[0]!));m.hp=1;
  const before=stats(m),mutation=structuredClone(m.mutation),flags=[...m.behaviorFlags],bolts=[...m.bolts];cast(g,m);
  expect(m.maxHp).toBe(before[0]!+12);expect(m.hp).toBe(m.maxHp);expect(m.defense).toBe(before[2]!+10);expect(m.accuracy).toBe(before[3]!+10);expect(m.isAlly).toBe(ally);expect(m.mutation).toEqual(mutation);expect([...m.behaviorFlags]).toEqual(flags);expect(m.bolts).toEqual(bolts);expect(m.newPowerCount).toBe(1);
 });
 it('strengthened bounds reach real melee damage, and precision/defense reach hit probability',()=>{
  const g=scene(),m=mob(g);cast(g,m);g.player.hp=g.player.maxHp=100;
  vi.spyOn(rng,'randPercent').mockReturnValue(true);vi.spyOn(rng,'randRange').mockImplementation((_lo,hi)=>hi);
  const r=CombatSystem.attack(m,g.player);expect(r.hit).toBe(true);expect(r.damage).toBe(4);expect(g.player.hp).toBe(96);expect(m.accuracy).toBe(data('rat').accuracy!+10);expect(m.defense).toBe(data('rat').defense!+10);
 });
});

describe('W-21 heal panacea follows individual CE branches',()=>{
 const ids=['hallucinating','confused','slowed','weakened','poisoned','paralyzed','discordant','entranced','hasted','invisible','levitating','immune_fire','shielded'] as const;
 const ceIndex:Record<string,number>={weakened:2,hallucinating:4,levitating:5,slowed:6,hasted:7,confused:8,burning:9,paralyzed:10,poisoned:11,discordant:14,immune_fire:15,entranced:21,shielded:24,invisible:25};
 it.each([0,1,2,3])('matches compiled CE for all modeled statuses when duration=%i',duration=>{
  const line=fs.readFileSync('ai_docs/reports/w-21-evidence/ce-empower.txt','utf8').split('\n').find(l=>l.startsWith(`heal ${duration} `))!;
  const values=line.split(' ').slice(1).map(Number),m=new Monster(9,5,data('rat'));
  m.maxHp=37;m.hp=1;m.poisonAmount=4;m.maxShield=20;
  for(const id of [...ids,'burning']) (m.statusDurations as Record<string,number>)[id]=duration;
  m.refreshSpeeds();const speed=m.movementSpeed;m.heal(100,true);
  expect(m.hp).toBe(values[1]);expect(m.poisonAmount).toBe(values[2]);expect(m.maxShield).toBe(20);expect(m.movementSpeed).toBe(speed);
  for(const id of [...ids,'burning'])expect(m.getStatusDuration(id as StatusId),id).toBe(values[4+ceIndex[id]!]!);
 });
 it('slow survives at one turn and expires normally; panacea does not clear burns, grabs or paralysis',()=>{
  const g=scene(),m=mob(g);m.statusDurations={slowed:40,confused:40,hallucinating:40,poisoned:10,weakened:40,paralyzed:7,discordant:8,entranced:9,shielded:240};(m.statusDurations as any).burning=6;m.poisonAmount=3;m.maxShield=240;m.seized=m.seizing=true;m.refreshSpeeds();
  cast(g,m);expect(m.statusDurations).toMatchObject({slowed:1,confused:1,hallucinating:1,paralyzed:7,discordant:8,entranced:9,shielded:240,burning:6});expect(m.poisonAmount).toBe(0);expect(m.hasStatus('weakened')).toBe(false);expect(m.movementSpeed).toBe(200);expect(m.seized&&m.seizing).toBe(true);
  m.tickStatuses();expect(m.hasStatus('slowed')).toBe(false);expect(m.movementSpeed).toBe(100);
 });
 it('W-9 ordinary healing remains percentage-only; at full HP panacea still cures',()=>{
  const g=scene(),m=mob(g);m.maxHp=37;m.hp=1;m.statusDurations={poisoned:9,confused:8,weakened:7};m.poisonAmount=4;
  (g as any).applyBasicBoltEffect(m,BoltEffect.HEALING,3);expect(m.hp).toBe(12);expect(m.statusDurations).toEqual({poisoned:9,confused:8,weakened:7});expect(m.poisonAmount).toBe(4);
  m.hp=m.maxHp;m.heal(100,true);expect(m.hp).toBe(37);expect(m.statusDurations).toEqual({confused:1});expect(m.poisonAmount).toBe(0);
 });
});

describe('W-21 contact gates, autoID and impact flash',()=>{
 it.each(['goblin_totem','arrow_turret','Warden_of_Yendor'])('immune %s blocks travel without any writes, flash, identification or RNG',id=>{
  const g=scene(),m=mob(g,id),behind=mob(g,'rat',12,5),item=wand();m.abilityFlags.delete('MA_REFLECT_100');m.hp=1;m.statusDurations={poisoned:7};m.poisonAmount=3;const before=dump(m),draw=rng.randomNumbersGenerated;
  const r=g.zapBoltFromPlayer(bolt(),item,behind.loc);expect(dump(m)).toBe(before);expect(behind.newPowerCount).toBe(0);expect(r.outcome?.autoID).toBe(false);expect(r.frames.some(f=>f.durationMs===180)).toBe(false);expect(rng.randomNumbersGenerated).toBe(draw);
 });
 it('reflected beam reaches player but neither heals, cures nor empowers it',()=>{
  const g=scene(),m=mob(g,'stone_guardian');g.player.hp=1;g.player.statusDurations={poisoned:9,confused:9};g.player.poisonAmount=3;const before=dump(g.player),original=dump(m),r=cast(g,m);
  expect(r.reflections.length).toBeGreaterThan(0);expect(r.hits.some(h=>h.creature===g.player)).toBe(true);expect(dump(g.player)).toBe(before);expect(dump(m)).toBe(original);expect(r.outcome?.autoID).toBe(false);
 });
 it.each(['visible','invisible','hidden','telepathic','entranced','ally-invisible'])('autoID observes %s and flash only exposes observable recipients',mode=>{
  const g=scene(),m=mob(g);if(mode.includes('invisible'))m.setStatusDuration('invisible',8);if(['hidden','telepathic','entranced'].includes(mode))g.grid.getCell(m.x,m.y)!.isVisible=false;
  if(mode==='telepathic')g.player.setStatusDuration('telepathy',8);if(mode==='entranced')m.setStatusDuration('entranced',8);if(mode==='ally-invisible')m.isAlly=true;
  const seen=!['invisible','hidden'].includes(mode),r=cast(g,m);expect(m.totalPowerCount).toBe(1);expect(r.outcome?.autoID).toBe(seen);expect(r.frames.some(f=>f.durationMs===180&&f.x===m.x&&f.y===m.y)).toBe(seen);
 });
 it('empty shot and dead helper recipient have no effect',()=>{const g=scene();expect(g.zapBoltFromPlayer(bolt(),wand(),{x:9,y:5}).outcome?.autoID).toBe(false);const m=mob(g);m.hp=0;const before=dump(m);expect(m.empower()).toBe(false);expect(dump(m)).toBe(before);});
 it('actual inventory selection/cancel/submit spends one charge, identifies singleton wand and schedules one turn',()=>{
  const g=live(),m=mob(g),item=wand();g.player.inventory.addItem(item);g.useArcanaItem(item);g.setArcanaTarget(m.x,m.y);g.cancelArcanaSelection();expect(item.charges).toBe(1);expect(m.totalPowerCount).toBe(0);
  g.useArcanaItem(item);g.setArcanaTarget(m.x,m.y);const before=g.stats.turns;g.confirmArcanaTarget();expect(item.charges).toBe(0);expect(item.timesUsed).toBe(1);expect(item.isIdentified).toBe(true);expect(g.stats.turns).toBe(before+1);expect(m.totalPowerCount).toBe(1);expect(m.maxHp).toBe(18);
 });
});

describe('W-21 clone, polymorph, consumers and JSON handoff',()=>{
 it('W-20 cloneMonster copies stats and counts; subsequent hits are independent',()=>{
  const g=scene(),m=mob(g);cast(g,m);cast(g,m);const c=g.cloneMonster(m)!;expect(stats(c)).toEqual(stats(m));expect(c.totalPowerCount).toBe(2);c.empower();expect(c.totalPowerCount).toBe(3);expect(m.totalPowerCount).toBe(2);expect(c.maxHp).toBe(m.maxHp+12);
 });
 it('actual PLENTY and self-split both preserve strengthened attributes and counts',()=>{
  const g=scene(),m=mob(g,'pink_jelly');cast(g,m);cast(g,m);m.hp=31;
  const cfg={...bolt(),ceType:CEBoltType.PLENTY,effect:BoltEffect.PLENTY};g.zapBoltFromPlayer(cfg,wand(),m.loc);const c=g.monsters[1]!;
  expect(stats(c)).toEqual(stats(m));expect(m.hp).toBe(16);expect(m.maxHp).toBe(74);expect(c.totalPowerCount).toBe(2);
  (g as any).trySplitMonster(m,g.player);const split=g.monsters[2]!;expect(split.totalPowerCount).toBe(2);expect(split.newPowerCount).toBe(2);expect(split.damageString).toBe(m.damageString);expect(split.maxHp).toBe(74);
 });
 it('W-19 actual polymorph replaces enhanced info but retains both counts, then can be empowered again',()=>{
  const g=scene(),m=mob(g);cast(g,m);cast(g,m);m.isAlly=true;
  const cfg={...bolt(),ceType:CEBoltType.POLYMORPH,effect:BoltEffect.POLYMORPH},item=wand();const draw=vi.spyOn(rng,'randRange').mockReturnValue(monsters.findIndex(d=>d.id==='ogre')+1);
  g.zapBoltFromPlayer(cfg,item,m.loc);draw.mockRestore();const d=data('ogre');expect(m).toMatchObject({typeId:'ogre',maxHp:d.hp,accuracy:d.accuracy,defense:d.defense,damageString:d.damage,newPowerCount:2,totalPowerCount:2,isAlly:false});
  cast(g,m);expect(m.maxHp).toBe(d.hp+12);expect(m.newPowerCount).toBe(3);expect(m.totalPowerCount).toBe(3);
 });
 it('JSON saves active/dormant/counts/form and test reset uses same fields',()=>{
  const g=live(),m=mob(g);cast(g,m);cast(g,m);m.newPowerCount=1;const c=g.cloneMonster(m)!;c.isDormant=true;g.monsters=[m];g.dormantMonsters=[c];
  const original=stats(m),saved=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(saved)).toBe(true);expect(stats(g.monsters[0]!)).toEqual(original);expect(stats(g.dormantMonsters[0]!)).toEqual(original);
  expect(stats((g as any).createMonsterFromSnapshot(saved.monsters[0]))).toEqual(original);

 });
 it('save after polymorph keeps retained counts alongside the new catalog stats',()=>{
  const g=live(),m=mob(g);cast(g,m);vi.spyOn(rng,'randRange').mockReturnValue(4);m.polymorph(()=>{});vi.restoreAllMocks();const before=stats(m);g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));expect(stats(g.monsters[0]!)).toEqual(before);expect(g.monsters[0]!.totalPowerCount).toBe(1);
 });
 it('existing negation recovers slots except invulnerable/death paths, without removing numeric gains',()=>{
  const g=scene(),m=mob(g);cast(g,m);cast(g,m);m.newPowerCount=0;const before=stats(m);(g as any).negateCreatureMagic(m);expect(stats(m)).toEqual([...before.slice(0,6),2,2]);
  m.newPowerCount=0;m.behaviorFlags.add('MONST_INVULNERABLE');(g as any).negateCreatureMagic(m);expect(m.newPowerCount).toBe(0);m.behaviorFlags.delete('MONST_INVULNERABLE');m.behaviorFlags.add('MONST_DIES_IF_NEGATED');(g as any).negateCreatureMagic(m);expect(m.hp).toBe(0);expect(m.newPowerCount).toBe(0);
 });
 it('ally details show pending talents; waiting after an unlearnable kobold death preserves them',()=>{
  const g=live(),m=mob(g);m.isAlly=true;cast(g,m);cast(g,m);const detail=()=>generateMonsterDetail(m,30,12,0,null,0,12).sections.flatMap(s=>s.lines.map(l=>l.text)).join('\n');
  expect(detail()).toContain('准备好学习 2 项新能力');m.isAlly=false;expect(detail()).not.toContain('准备好学习');m.isAlly=true;
  const victim=mob(g,'kobold',12,5);victim.hp=0;(g as any).removeDeadMonsters();g.handlePlayerAction('wait');expect(m.newPowerCount).toBe(2);expect(m.bolts).toEqual(data('rat').bolts??[]);
 });
});
