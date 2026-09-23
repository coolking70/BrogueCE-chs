import { beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DCOLS, DROWS, DungeonLayer } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { FOVSys } from '../engine/Lighting/FOV';
import { LightMap } from '../engine/Lighting/LightMap';
import { getBoltForItem, BoltEffect } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { canObserveBoltCreature } from '../engine/Combat/BoltTargeting';
import { staffEntrancementDuration } from '../engine/Movement/Entrancement';
import { CombatSystem } from '../engine/Combat/Combat';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Player } from '../entities/Player';
import { Monster, MonsterState, specificallyValidBoltTarget, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { createHeadlessGame } from './harness';

function scene() {
 const g=createHeadlessGame(1818,'test');g.grid=new Grid(DCOLS,DROWS);
 for(let x=0;x<DCOLS;x++)for(let y=0;y<DROWS;y++){
  g.grid.setTerrain(x,y,x>0&&x<DCOLS-1&&y>0&&y<DROWS-1?T.FLOOR:T.GRANITE);
  Object.assign(g.grid.getCell(x,y)!,{isVisible:true,hasMemory:true,isDiscovered:true});
 }
 g.player=new Player(4,5);g.player.hp=g.player.maxHp=100;g.monsters=[];g.dormantMonsters=[];g.items=[];
 g.environment=new EnvironmentManager(g.grid);g.fov=new FOVSys(g.grid);g.lightMap=new LightMap(g.grid);
 g.animationEnabled=false;g.player.ticksUntilTurn=0;g.ticksTillUpdateEnvironment=100;
 g.spawnFloatingText=vi.fn();(g as any).updateVision=vi.fn();(g as any).needsRender=false;return g;
}
function mob(g:Game,id='rat',x=10,y=5){
 const m=new Monster(x,y,(monsters as MonsterData[]).find(d=>d.id===id)!);
 m.hp=m.maxHp=100;m.regenTurns=0;m.state=MonsterState.HUNTING;m.onHitStatus=undefined;
 m.ticksUntilTurn=10000;g.monsters.push(m);return m;
}
const bolt=()=>({...getBoltForItem('staff_of_haste')!,id:'w18-explicit-fixture',ceType:CEBoltType.ENTRANCEMENT,effect:BoltEffect.ENTRANCEMENT});
function cast(g:Game,m:Monster,e=8){const staff=ItemLoader.spawnStaff('staff_of_haste',-1,-1)!;staff.enchantment=e;return g.zapBoltFromPlayer(bolt(),staff,m.loc);}
function step(g:Game,x=1,y=0){g.handlePlayerAction('move',{x,y},'system');expect(g.lastAdvancementError).toBeNull();}
function wait(g:Game){g.handlePlayerAction('wait',undefined,'system');expect(g.lastAdvancementError).toBeNull();}
beforeEach(()=>{vi.restoreAllMocks();ItemLoader.identifiedItems.clear();});

describe('W-18 CE effect and trace',()=>{
 it('matches compiled CE duration including fixed-point truncation',()=>{
  for(const row of fs.readFileSync('ai_docs/reports/w-18-evidence/ce-entrancement.txt','utf8').trim().split('\n')){
   const [fixed,duration]=row.split(' ').map(Number);expect(staffEntrancementDuration(fixed!/65536)).toBe(duration);
  }
 });
 it.each([2,3,8])('E=%i, not charges/catalog magnitude; weaker recast replaces',e=>{
  const g=scene(),m=mob(g);const r=cast(g,m,e);expect(r.hits.map(h=>h.creature)).toEqual([m]);expect(r.outcome?.autoID).toBe(true);
  expect(m.getStatusDuration('entranced')).toBe(3*e);cast(g,m,2);expect(m.getStatusDuration('entranced')).toBe(6);
 });
 it.each(['MONST_INANIMATE','MONST_INVULNERABLE'])('%s rejects without waking or changing budget',flag=>{
  const g=scene(),m=mob(g);m.behaviorFlags.add(flag);m.state=MonsterState.ASLEEP;
  const r=cast(g,m);expect(r.outcome?.autoID).toBe(false);expect(m.hasStatus('entranced')).toBe(false);expect(m.ticksUntilTurn).toBe(10000);expect(m.state).toBe(MonsterState.ASLEEP);
 });
 it('wakes recipient/teammates; applying to an ally retains allegiance',()=>{
  const g=scene(),m=mob(g),friend=mob(g,'rat',15,8);m.state=friend.state=MonsterState.ASLEEP;friend.ticksUntilTurn=20;
  cast(g,m);expect(m.state).toBe(MonsterState.HUNTING);expect(friend.state).toBe(MonsterState.HUNTING);expect(m.ticksUntilTurn).toBe(100);expect(friend.ticksUntilTurn).toBe(100);
  m.isAlly=true;m.state=MonsterState.WANDERING;cast(g,m);expect(m.isAlly).toBe(true);expect(m.state).toBe(MonsterState.WANDERING);
 });
 it('new entrancement itself reveals an unseen invisible recipient and auto-identifies',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('invisible',100);g.grid.getCell(10,5)!.isVisible=false;
  expect(canObserveBoltCreature(g.player,g.grid,m)).toBe(false);const r=cast(g,m);expect(r.outcome?.autoID).toBe(true);expect(canObserveBoltCreature(g.player,g.grid,m)).toBe(true);
 });
 it('real reflection confuses player, not reflector; actual confused direction drives all entranced monsters',()=>{
  const g=scene(),reflector=mob(g,'stone_guardian',8,5),follower=mob(g,'rat',12,8);follower.setStatusDuration('entranced',24);
  const r=cast(g,reflector,2);expect(r.reflections).toHaveLength(1);expect(r.hits.map(h=>h.creature)).toEqual([g.player]);
  expect(g.player.getStatusDuration('confused')).toBe(6);expect(g.player.hasStatus('entranced')).toBe(false);expect(reflector.hasStatus('entranced')).toBe(false);expect(r.outcome?.autoID).toBe(true);
  vi.spyOn(rng,'randRange').mockReturnValue(0);step(g,1,0);expect(g.player.loc).toEqual({x:4,y:4});expect(follower.loc).toEqual({x:12,y:9});
  wait(g);expect(g.player.loc).toEqual({x:4,y:4});expect(follower.loc).toEqual({x:12,y:9});
 });
 it('random reflection affects actual bystander only',()=>{
  const g=scene(),r=mob(g,'golem',8,5),m=mob(g,'rat',8,8),staff=ItemLoader.spawnStaff('staff_of_haste',-1,-1)!;staff.enchantment=3;
  vi.spyOn(rng,'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);vi.spyOn(rng,'randRange').mockReturnValue(16);
  const result=g.zapBoltFromPlayer(bolt(),staff,r.loc);expect(result.hits.map(h=>h.creature)).toEqual([m]);expect(m.getStatusDuration('entranced')).toBe(9);expect(r.hasStatus('entranced')).toBe(false);expect(g.player.hasStatus('confused')).toBe(false);
 });
});

describe('W-18 required action-level chain and P2',()=>{
 it.each([[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]])('actual player direction %i,%i yields exactly opposite single step',(dx,dy)=>{
  const g=scene(),m=mob(g);cast(g,m);step(g,dx,dy);expect(g.player.loc).toEqual({x:4+dx,y:5+dy});expect(m.loc).toEqual({x:10-dx,y:5-dy});
 });
 it.each([50,100,200])('speed %i: one follow per player move, zero autonomous move/attack/cast/summon',speed=>{
  const g=scene(),m=mob(g,'lich');m.moveSpeed=speed;m.attackSpeed=150;cast(g,m);m.moveSpeed=speed;
  const turn=vi.spyOn(m,'takeTurn'),summon=vi.spyOn(m,'trySummon'),spell=vi.spyOn(m,'tryUseBolt');
  step(g);expect(m.loc).toEqual({x:9,y:5});expect(turn).not.toHaveBeenCalled();
  wait(g);expect(m.loc).toEqual({x:9,y:5});expect(summon).not.toHaveBeenCalled();expect(spell).not.toHaveBeenCalled();expect(g.monsters).toHaveLength(1);expect(g.player.hp).toBe(100);
 });
 it('haste player: follow occurs each action while duration decrements only at 100 objective ticks',()=>{
  const g=scene(),m=mob(g);cast(g,m);g.player.setStatusDuration('hasted',20);g.player.refreshSpeeds();
  step(g);expect(m.loc.x).toBe(9);expect(m.getStatusDuration('entranced')).toBe(24);expect(m.ticksUntilTurn).toBe(50);
  step(g);expect(m.loc.x).toBe(8);expect(m.getStatusDuration('entranced')).toBe(23);expect(m.ticksUntilTurn).toBe(50);
 });
 it('slow player cannot induce multiple follow steps; expiry resumes real AI on that objective boundary',()=>{
  const g=scene(),m=mob(g);cast(g,m);g.player.setStatusDuration('slowed',20);g.player.refreshSpeeds();step(g);expect(m.loc.x).toBe(9);expect(m.getStatusDuration('entranced')).toBe(22);
  m.setStatusDuration('entranced',1);const before={...m.loc};wait(g);expect(m.hasStatus('entranced')).toBe(false);expect(m.loc).not.toEqual(before);
 });
 it('mouse/automatic path steps also drive one opposite step; confused path uses the actual direction',()=>{
  const g=scene(),m=mob(g);cast(g,m);g.isMouseTraveling=true;g.autoPath=[{x:5,y:5},{x:6,y:5}];g.visibleItems.clear();
  g.stepAutoPath();expect(g.player.loc.x).toBe(5);expect(m.loc.x).toBe(9);g.stepAutoPath();expect(g.player.loc.x).toBe(6);expect(m.loc.x).toBe(8);
  g.player.setStatusDuration('confused',10);g.autoPath=[{x:7,y:5}];vi.spyOn(rng,'randRange').mockReturnValue(0);g.stepAutoPath();
  expect(g.player.loc).toEqual({x:6,y:4});expect(m.loc).toEqual({x:8,y:6});expect(g.autoPath).toEqual([]);
 });
 it('wait leaves an adjacent entranced enemy inert and player unharmed',()=>{
  const g=scene(),m=mob(g,'rat',5,5);cast(g,m);wait(g);expect(m.loc).toEqual({x:5,y:5});expect(g.player.hp).toBe(100);expect(m.getStatusDuration('entranced')).toBe(23);
 });
 it('follower wall collision does not sidestep/pathfind or attack; consumes player turn only',()=>{
  const g=scene(),m=mob(g);cast(g,m);m.ticksUntilTurn=900;g.grid.setTerrain(9,5,T.GRANITE);step(g);
  expect(g.player.loc).toEqual({x:5,y:5});expect(m.loc).toEqual({x:10,y:5});expect(m.ticksUntilTurn).toBe(800);
 });
 it('player wall collision with dirty render does not advance objective time or follower',()=>{
  const g=scene(),m=mob(g);cast(g,m);(g as any).needsRender=true;g.grid.setTerrain(5,5,T.GRANITE);const tick=timeSystem.currentTick;
  step(g);expect(g.player.loc).toEqual({x:4,y:5});expect(m.loc).toEqual({x:10,y:5});expect(m.getStatusDuration('entranced')).toBe(24);expect(timeSystem.currentTick).toBe(tick);expect(m.ticksUntilTurn).toBe(100);
 });
 it.each(['toggle_inventory','talk','nonsense','examine','stairs_up'])('non-turn action %s leaves actual location and budget unchanged',action=>{
  const g=scene(),m=mob(g);cast(g,m);const tick=timeSystem.currentTick;g.handlePlayerAction(action,undefined,'system');
  expect(m.loc).toEqual({x:10,y:5});expect(m.ticksUntilTurn).toBe(100);expect(m.getStatusDuration('entranced')).toBe(24);expect(timeSystem.currentTick).toBe(tick);
 });
 it('invalid movement and cancelled dive never trigger follower',()=>{
  const g=scene(),m=mob(g);cast(g,m);step(g,2,0);expect(g.player.loc).toEqual({x:4,y:5});expect(m.loc.x).toBe(10);
  g.grid.setTerrain(5,5,T.CHASM);g.onConfirmRequest=()=>false;step(g);expect(g.player.loc).toEqual({x:4,y:5});expect(m.loc.x).toBe(10);expect(m.getStatusDuration('entranced')).toBe(24);
 });
 it('directional melee even a miss follows; struck recipient releases before follow and really attacks on the next wait',()=>{
  const g=scene(),victim=mob(g,'rat',5,5),other=mob(g,'rat',12,8);cast(g,victim);other.setStatusDuration('entranced',24);victim.ticksUntilTurn=1000;
  vi.spyOn(rng,'randPercent').mockReturnValue(false);step(g);expect(g.player.loc).toEqual({x:4,y:5});expect(victim.loc).toEqual({x:5,y:5});expect(victim.hp).toBe(100);expect(victim.hasStatus('entranced')).toBe(false);expect(other.loc).toEqual({x:11,y:8});
  vi.mocked(rng.randPercent).mockReturnValue(true);victim.ticksUntilTurn=1;wait(g);expect(g.player.hp).toBeLessThan(100);expect(other.loc).toEqual({x:11,y:8});
 });
 it.each(['paralyzed','captive','web','dormant'])('%s blocks follow and leaves the actual monster in place',condition=>{
  const g=scene(),m=mob(g);cast(g,m);if(condition==='paralyzed')m.setStatusDuration('paralyzed',10);if(condition==='captive')m.isCaged=true;
  if(condition==='web')g.grid.setTerrainLayer(10,5,DungeonLayer.SURFACE,T.WEB);if(condition==='dormant'){m.isDormant=true;g.monsters=[];g.dormantMonsters=[m];}
  step(g);expect(m.loc).toEqual({x:10,y:5});expect(g.player.hp).toBe(100);
 });
 it('confusion/flitting cannot override controlled direction',()=>{
  const g=scene(),m=mob(g);m.behaviorFlags.add('MONST_FLITS');m.setStatusDuration('confused',20);cast(g,m);step(g);expect(m.loc).toEqual({x:9,y:5});
 });
});

describe('W-18 forced attack relationships, grab and real terrain',()=>{
 it('follows into same-faction enemy by attacking without swapping; target releases, caster remains entranced',()=>{
  const g=scene(),m=mob(g),victim=mob(g,'rat',9,5);m.setStatusDuration('entranced',24);victim.setStatusDuration('entranced',24);
  vi.spyOn(rng,'randPercent').mockReturnValue(true);step(g);expect(m.loc.x).toBe(10);expect(victim.loc.x).toBe(9);expect(victim.hp).toBeLessThan(100);expect(victim.hasStatus('entranced')).toBe(false);expect(m.hasStatus('entranced')).toBe(true);
 });
 it.each(['ally','player'])('hostile entranced creature can still attack %s (CE enemy fallback)',target=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);let victim: Monster|Player;
  if(target==='ally'){victim=mob(g,'rat',9,5);victim.isAlly=true;}else {g.player.loc={x:8,y:5};victim=g.player;}
  vi.spyOn(rng,'randPercent').mockReturnValue(true);step(g);expect(m.loc).toEqual({x:10,y:5});expect(victim.hp).toBeLessThan(100);
 });
 it('entranced ally neither attacks nor swaps with player teammate',()=>{
  const g=scene(),m=mob(g),friend=mob(g,'rat',9,5);m.isAlly=friend.isAlly=true;m.setStatusDuration('entranced',24);
  vi.spyOn(rng,'randPercent').mockReturnValue(true);step(g);expect(m.loc.x).toBe(10);expect(friend.loc.x).toBe(9);expect(friend.hp).toBe(100);
 });
 it.each(['MA_ATTACKS_PENETRATE','MA_ATTACKS_EXTEND','MA_ATTACKS_ALL_ADJACENT'])('controlled %s uses real P4-6 attack output',ability=>{
  const g=scene(),m=mob(g),victim=mob(g,'rat',9,5);m.abilityFlags.add(ability);m.setStatusDuration('entranced',24);
  vi.spyOn(rng,'randPercent').mockReturnValue(true);step(g);expect(victim.hp).toBeLessThan(100);expect(m.loc.x).toBe(10);
 });
 it('ally AI does not pursue/attack entranced enemy; damage bolt selection also skips it',()=>{
  const g=scene(),m=mob(g,'rat',10,5),ally=mob(g,'rat',11,5);m.setStatusDuration('entranced',24);ally.isAlly=true;
  ally.takeTurn(g,10);expect(m.hp).toBe(100);expect(m.hasStatus('entranced')).toBe(true);
  const caster=mob(g,'dar_priestess',8,5);caster.isAlly=true;expect(specificallyValidBoltTarget(caster,m,'SPARK',g)).toBe(false);
 });
 it('CE enemy catalog gate rejects same-team entrancement; actual negation contact still frees it',()=>{
  const g=scene(),caster=mob(g,'dar_priestess',8,5),m=mob(g,'rat',10,5);m.setStatusDuration('entranced',24);
  expect(specificallyValidBoltTarget(caster,m,'NEGATION',g)).toBe(false);g.castMonsterBolt(caster,m,'NEGATION');expect(m.hasStatus('entranced')).toBe(false);
  const before=m.loc.x;m.ticksUntilTurn=1;wait(g);expect(m.loc.x).toBeLessThan(before);
 });
 it('entranced seizer cannot hold player; moving seizer clears its own grip',()=>{
  const g=scene(),m=mob(g,'bog_monster',4,6);m.behaviorFlags.delete('MONST_RESTRICTED_TO_LIQUID');m.seizing=true;g.player.seized=true;m.setStatusDuration('entranced',24);
  step(g);expect(g.player.loc).toEqual({x:5,y:5});expect(g.player.seized).toBe(false);expect(m.loc).toEqual({x:3,y:6});expect(m.seizing).toBe(false);
 });
 it('seized entranced monster spends movement budget but stays held',()=>{
  const g=scene(),m=mob(g),seizer=mob(g,'rat',10,6);seizer.isAlly=true;seizer.seizing=true;m.seized=true;m.setStatusDuration('entranced',24);m.ticksUntilTurn=900;
  step(g);expect(m.loc).toEqual({x:10,y:5});expect(m.seized).toBe(true);expect(m.ticksUntilTurn).toBe(100);
 });
 it('living immobile target is eligible: CE moveMonster itself has no immobile gate',()=>{
  const g=scene(),m=mob(g);m.behaviorFlags.add('MONST_IMMOBILE');cast(g,m);step(g);expect(m.loc).toEqual({x:9,y:5});
 });
 it('restricted-liquid follower cannot step onto land',()=>{
  const g=scene(),m=mob(g,'eel');g.grid.setTerrain(10,5,T.WATER_DEEP);m.setStatusDuration('entranced',24);step(g);expect(m.loc).toEqual({x:10,y:5});
 });
 it('diagonal corner blocks follow and secret door admits it via placement',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);g.grid.setTerrain(9,5,T.GRANITE);step(g,1,1);expect(m.loc).toEqual({x:10,y:5});
  g.grid.setTerrain(9,5,T.SECRET_DOOR);step(g,1,0);expect(m.loc).toEqual({x:9,y:5});expect(g.grid.getCell(9,5)!.layers).not.toContain(T.SECRET_DOOR);
 });
 it('deep water is legal and does not drown; lava actually kills',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);g.grid.setTerrain(9,5,T.WATER_DEEP);step(g);expect(m.loc).toEqual({x:9,y:5});expect(m.hp).toBe(100);
  g.grid.setTerrain(8,5,T.LAVA);step(g);expect(m.loc).toEqual({x:8,y:5});expect(m.hp).toBe(0);expect(g.monsters).not.toContain(m);
 });
 it('fire immunity protects on lava; flight prevents chasm descent',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);m.setStatusDuration('immune_fire',10);g.grid.setTerrain(9,5,T.LAVA);step(g);expect(m.hp).toBe(100);
  m.setStatusDuration('levitating',10);g.grid.setTerrain(8,5,T.CHASM);step(g);expect(m.loc.x).toBe(8);expect(m.falling).toBe(false);expect(g.monsters).toContain(m);
 });
 it('follow onto gas pressure plate actually triggers terrain DF',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);g.grid.setTerrain(9,5,T.GAS_TRAP_POISON_HIDDEN);step(g);
  expect(m.loc).toEqual({x:9,y:5});expect(g.grid.getCell(9,5)!.layers[DungeonLayer.GAS]).toBe(T.POISON_GAS);expect(g.grid.getCell(9,5)!.volume).toBeGreaterThan(0);
 });
 it('chasm: W11 marks falling, C5 transfers survivor once and clears entrancement/grabs',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);g.grid.setTerrain(9,5,T.CHASM);g.player.setStatusDuration('hasted',20);g.player.refreshSpeeds();
  const place=g.placeCreature.bind(g);let marked=false;vi.spyOn(g,'placeCreature').mockImplementation((who,to,options)=>{const ok=place(who,to,options);marked=m.falling;return ok;});
  step(g);expect(m.loc).toEqual({x:9,y:5});expect(marked).toBe(true);expect(g.monsters).not.toContain(m);expect(m.hp).toBeGreaterThanOrEqual(88);expect(m.hp).toBeLessThanOrEqual(94);expect(m.hasStatus('entranced')).toBe(false);expect(m.preplaced).toBe(true);
  expect((g as any).pendingFallenByDepth.get(g.depth+1)).toEqual([m]);const hp=m.hp;wait(g);expect(m.hp).toBe(hp);
 });
});

describe('W-18 break semantics, save, and real use transaction',()=>{
 it('thrown weapon miss releases; environmental/direct generic damage and poison do not',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);m.takeDamage(1);expect(m.hasStatus('entranced')).toBe(true);
  m.addPoison(5,1);wait(g);expect(m.loc.x).toBe(10);expect(m.hasStatus('entranced')).toBe(true);
  vi.spyOn(rng,'randPercent').mockReturnValue(false);const weapon=ItemLoader.spawnWeapon('dagger',0,0)!;const r=CombatSystem.resolveThrownWeapon(g.player,m,weapon);
  expect(r.hit).toBe(false);expect(m.hasStatus('entranced')).toBe(false);m.ticksUntilTurn=1;wait(g);expect(m.loc).not.toEqual({x:10,y:5});
 });
 it('fire staff damage breaks entrancement even fully absorbed by shielding',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);m.applyShield(10000);const staff=ItemLoader.spawnStaff('staff_of_fire',0,0)!;
  g.zapBoltFromPlayer(getBoltForItem('staff_of_fire')!,staff,m.loc);expect(m.hp).toBe(100);expect(m.hasStatus('entranced')).toBe(false);m.ticksUntilTurn=1;wait(g);expect(m.loc.x).toBeLessThan(10);
 });
 it('aquatic melee rejects a levitating target before release; kamikaze also leaves recipient entranced',()=>{
  const g=scene(),m=mob(g),eel=mob(g,'eel',9,5);m.setStatusDuration('entranced',24);m.setStatusDuration('levitating',20);
  const result=CombatSystem.attack(eel,m);expect(result.hit).toBe(false);expect(m.hp).toBe(100);expect(m.hasStatus('entranced')).toBe(true);
  eel.abilityFlags.add('MA_KAMIKAZE');expect(CombatSystem.attack(eel,m).kamikazeSelfDestruct).toBe(true);expect(m.hasStatus('entranced')).toBe(true);
  step(g);expect(m.loc.x).toBe(9);
 });
 it('player-origin reflected fire damages a bystander without moralAttack release (CE Items5210)',()=>{
  const g=scene(),reflector=mob(g,'golem',8,5),m=mob(g,'rat',8,8),staff=ItemLoader.spawnStaff('staff_of_fire',0,0)!;
  m.setStatusDuration('entranced',24);vi.spyOn(rng,'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);vi.spyOn(rng,'randRange').mockImplementation((lo,hi)=>lo===0&&hi===39?16:lo);
  const r=g.zapBoltFromPlayer(getBoltForItem('staff_of_fire')!,staff,reflector.loc);expect(r.reflections).toHaveLength(1);expect(r.hits.map(h=>h.creature)).toEqual([m]);
  expect(m.hp).toBeLessThan(100);expect(m.hasStatus('entranced')).toBe(true);step(g);expect(m.loc.x).toBe(7);
 });
 it('fire immunity rejects before release',()=>{
  const g=scene(),m=mob(g);m.setStatusDuration('entranced',24);m.setStatusDuration('immune_fire',20);g.zapBoltFromPlayer(getBoltForItem('staff_of_fire')!,ItemLoader.spawnStaff('staff_of_fire',0,0)!,m.loc);
  expect(m.hasStatus('entranced')).toBe(true);step(g);expect(m.loc.x).toBe(9);
 });
 it('save/load preserves duration/timing and actual follow/wait; old missing fields invent no entrancement',()=>{
  const g=scene(),m=mob(g);cast(g,m);m.ticksUntilTurn=75;const saved=JSON.parse(JSON.stringify(g.toSnapshot()));expect(g.loadSnapshot(saved)).toBe(true);
  const restored=g.monsters.find(x=>x.id===m.id)!;expect(restored.ticksUntilTurn).toBe(75);step(g);expect(restored.loc.x).toBe(9);wait(g);expect(restored.loc.x).toBe(9);
  delete saved.monsters[0].statusDurations.entranced;delete saved.monsters[0].entrancement;g.loadSnapshot(saved);const old=g.monsters.find(x=>x.id===m.id)!;old.ticksUntilTurn=1;wait(g);expect(old.hasStatus('entranced')).toBe(false);expect(old.loc.x).toBeLessThan(10);
 });
 it.each(['jackal','eel'])('entranced %s retains actual speed/traits after JSON load, then obeys physical movement rules',id=>{
  const g=scene(),m=mob(g,id);cast(g,m);if(id==='eel')g.grid.setTerrain(10,5,T.WATER_DEEP);
  const speed=m.moveSpeed,flags=[...m.behaviorFlags];g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())));const restored=g.monsters.find(x=>x.id===m.id)!;
  expect(restored.typeId).toBe(id);expect(restored.moveSpeed).toBe(speed);expect([...restored.behaviorFlags]).toEqual(flags);
  step(g);expect(restored.loc).toEqual({x:id==='eel'?10:9,y:5});wait(g);expect(restored.loc).toEqual({x:id==='eel'?10:9,y:5});
 });
 it('dormant and test-room snapshot carriers preserve the new payload',()=>{
  const g=scene(),m=mob(g);cast(g,m);m.ticksUntilTurn=37;m.seized=true;m.isDormant=true;g.monsters=[];g.dormantMonsters=[m];const saved=JSON.parse(JSON.stringify(g.toSnapshot()));g.loadSnapshot(saved);
  const dormant=g.dormantMonsters[0]!;expect(dormant.getStatusDuration('entranced')).toBe(24);expect(dormant.ticksUntilTurn).toBe(37);expect(dormant.seized).toBe(true);
  const baseline=(g as any).serializeMonster(dormant);const reset=(g as any).createMonsterFromSnapshot(baseline) as Monster;expect(reset.getStatusDuration('entranced')).toBe(24);expect(reset.ticksUntilTurn).toBe(37);
 });
 it('selection/cancel costs nothing; confirmed fixture consumes charge/time once without follow',()=>{
  const g=scene(),m=mob(g);const staff=ItemLoader.spawnStaff('staff_of_haste',-1,-1)!;staff.charges=3;staff.enchantment=3;g.player.inventory.addItem(staff);
  const zap=g.zapBoltFromPlayer.bind(g);vi.spyOn(g,'zapBoltFromPlayer').mockImplementation((_b,it,to)=>zap(bolt(),it,to));
  g.useArcanaItem(staff);g.setArcanaTarget(10,5);g.cancelArcanaSelection();expect(staff.charges).toBe(3);expect(m.hasStatus('entranced')).toBe(false);
  g.useArcanaItem(staff);g.setArcanaTarget(10,5);g.confirmArcanaTarget();expect(staff.charges).toBe(2);expect(m.loc).toEqual({x:10,y:5});expect(m.getStatusDuration('entranced')).toBe(8);
  step(g);expect(m.loc).toEqual({x:9,y:5});
 });
});
