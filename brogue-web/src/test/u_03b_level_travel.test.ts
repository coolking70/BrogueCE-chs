import golden from './fixtures/u03b-ce-follow.json';
import {describe,it,expect,vi} from 'vitest';
import {createHeadlessGame} from './harness';
import {Grid,TerrainType,DungeonLayer} from '../engine/Map/Grid';
import {EnvironmentManager,GasType} from '../engine/Environment/Gas';
import {Monster,MonsterState,type MonsterData} from '../entities/Monster';
import monsterData from '../data/monsters.json';
import {rng} from '../engine/Random';
import {scheduleLevelFollowers,travelDistanceMap,APPROACHING_DOWNSTAIRS,APPROACHING_UPSTAIRS,APPROACHING_PIT} from '../engine/Movement/LevelTravel';
import {T_PATHING_BLOCKER,T_OBSTRUCTS_PASSABILITY} from '../engine/Map/TerrainCatalog';
import {Game} from '../engine/Core/Game';
import {timeSystem} from '../engine/Systems/Time';

const rat=(x=8,y=5)=>new Monster(x,y,monsterData.find(m=>m.id==='rat')! as MonsterData);
function grid() {
 const g=new Grid(20,12);
 for(let x=1;x<19;x++)for(let y=1;y<11;y++)g.setTerrain(x,y,TerrainType.FLOOR);
 return g;
}
function arena(g:any) {
 for(let x=0;x<g.grid.width;x++)for(let y=0;y<g.grid.height;y++) {
  const c=g.grid.getCell(x,y)!;c.layers=[TerrainType.FLOOR,TerrainType.NOTHING,TerrainType.NOTHING,TerrainType.NOTHING];
  g.grid.setTerrain(x,y,x===0||y===0||x===g.grid.width-1||y===g.grid.height-1?TerrainType.WALL:TerrainType.FLOOR);
  c.machineNumber=0;c.volume=0;c.exposedToFire=0;
 }
 g.monsters=[];g.dormantMonsters=[];g.items=[];g.machineCells.clear();g.visibleMonsters.clear();g.visibleItems.clear();
 g.environment=new EnvironmentManager(g.grid);g.pendingCaughtFireCells=[];
 g.grid.setTerrain(5,5,TerrainType.STAIRS_UP);g.grid.setTerrain(15,5,TerrainType.STAIRS_DOWN);
 g.player.loc={x:14,y:5};g.animationEnabled=false;
}
function pair() {
 const g:any=createHeadlessGame(7);arena(g);
 g.depth=2;g.generateDepth();arena(g);
 const first=g.levels.get(1)!;first.monsters=[];first.playerExitedVia={x:8,y:5};
 return {g,first};
}
const stable=(g:Game)=>{const {savedAt:_,...s}=g.toSnapshot();return JSON.parse(JSON.stringify(s));};

describe('U03b CE level travel',()=>{
 it('4608 eligibility/countdown rows match the compiled local CE loop',()=>{
  const maps=new Map<number,{grid:Grid,origin:{x:number,y:number}}>();
  for(const distance of [0,4,149,30000]) {
   const map=new Grid(155,7);
   for(let x=1;x<154;x++)for(let y=1;y<6;y++)map.setTerrain(x,y,TerrainType.FLOOR);
   if(distance===30000)for(let y=1;y<6;y++)map.setTerrain(5,y,TerrainType.WALL);
   maps.set(distance,{grid:map,origin:{x:distance===30000?7:3+distance,y:3}});
  }
  const actual=golden.cases.map(row=>{
   const [state,hp,lev,captive,flags,entranced,paralyzed,direction,speed,distance]=row as [number,number,number,number,number,number,number,number,number,number];
   const m=rat(3,3);m.state=state===1?MonsterState.HUNTING:MonsterState.ASLEEP;m.isAlly=state===2;
   m.hp=hp;m.movementSpeed=speed;m.isCaged=!!captive;m.setStatusDuration('levitating',lev);m.setStatusDuration('entranced',entranced);m.setStatusDuration('paralyzed',paralyzed);
   if(flags&1)m.behaviorFlags.add('MONST_WILL_NOT_USE_STAIRS');if(flags&2)m.behaviorFlags.add('MONST_RESTRICTED_TO_LIQUID');
   const map=maps.get(distance)!;scheduleLevelFollowers(map.grid,[m],map.origin,direction as -1|0|1);
   return [m.entersLevelIn,m.approaching*2];
  });
  expect(actual).toEqual(golden.output);
 });
 it('two maps: hazards, secret doors, diagonal walls and immune stationary creatures',()=>{
  const g=grid();for(let y=1;y<11;y++)g.setTerrain(6,y,TerrainType.WATER_DEEP);
  expect(travelDistanceMap(g,[],{x:4,y:5},T_PATHING_BLOCKER)[8]![5]).toBe(30000);
  expect(travelDistanceMap(g,[],{x:4,y:5},T_OBSTRUCTS_PASSABILITY)[8]![5]).toBe(4);
  for(let y=1;y<11;y++)g.setTerrain(6,y,TerrainType.WALL);
  g.setTerrain(6,5,TerrainType.SECRET_DOOR);
  expect(travelDistanceMap(g,[],{x:4,y:5},T_PATHING_BLOCKER)[8]![5]).toBe(4);
  const blocker=rat(6,5);blocker.behaviorFlags=new Set(['MONST_INVULNERABLE','MONST_IMMOBILE']);
  expect(travelDistanceMap(g,[blocker],{x:4,y:5},T_PATHING_BLOCKER)[8]![5]).toBe(30000);
  const corner=grid();corner.setTerrain(5,4,TerrainType.WALL);corner.setTerrain(4,5,TerrainType.WALL);
  expect(travelDistanceMap(corner,[],{x:4,y:4},T_PATHING_BLOCKER)[5]![5]).toBeGreaterThan(1);
 });
 it.each([-1,1] as const)('distance × current speed + 1, clamp 1..150 and flags direction %s',direction=>{
  const g=grid(),m=rat();m.state=MonsterState.HUNTING;m.movementSpeed=150;
  scheduleLevelFollowers(g,[m],{x:4,y:5},direction);
  expect(m.entersLevelIn).toBe(7);expect(m.approaching).toBe(direction===1?APPROACHING_DOWNSTAIRS:APPROACHING_UPSTAIRS);
  m.movementSpeed=10000;scheduleLevelFollowers(g,[m],{x:4,y:5},direction);expect(m.entersLevelIn).toBe(150);
  m.loc={x:4,y:5};scheduleLevelFollowers(g,[m],{x:4,y:5},direction);expect(m.entersLevelIn).toBe(1);
 });
 it.each(['sleep','wander','flee','captive','stairs','water','paralyzed','entranced','wall','dead','dormant','ally_fear'])('excludes %s',kind=>{
  const g=grid(),m=rat();m.state=MonsterState.HUNTING;
  if(kind==='sleep')m.state=MonsterState.ASLEEP;if(kind==='wander')m.state=MonsterState.WANDERING;if(kind==='flee')m.state=MonsterState.FLEEING;
  if(kind==='captive')m.isCaged=true;if(kind==='stairs')m.behaviorFlags.add('MONST_WILL_NOT_USE_STAIRS');
  if(kind==='water')m.behaviorFlags.add('MONST_RESTRICTED_TO_LIQUID');
  if(kind==='paralyzed'||kind==='entranced')m.setStatusDuration(kind,5);
  if(kind==='ally_fear'){m.isAlly=true;m.applyStatus('magical_fear',5);}
  if(kind==='wall')g.setTerrain(m.x,m.y,TerrainType.WALL);if(kind==='dead')m.hp=0;if(kind==='dormant')m.isDormant=true;
  scheduleLevelFollowers(g,[m],{x:4,y:5},1);expect(m.entersLevelIn).toBe(0);
 });
 it('unreachable allies get 150; hostiles need a reachable map and hazards select the flying map',()=>{
  const g=grid(),ally=rat(),hostile=rat(8,6);ally.isAlly=true;hostile.state=MonsterState.HUNTING;
  for(let y=1;y<11;y++)g.setTerrain(6,y,TerrainType.WALL);
  scheduleLevelFollowers(g,[ally,hostile],{x:4,y:5},1);expect(ally.entersLevelIn).toBe(150);expect(hostile.entersLevelIn).toBe(0);
  for(let y=1;y<11;y++)g.setTerrain(6,y,TerrainType.WATER_DEEP);
  g.setTerrain(hostile.x,hostile.y,TerrainType.WATER_DEEP);
  scheduleLevelFollowers(g,[hostile],{x:4,y:5},1);expect(hostile.entersLevelIn).toBe(5);
 });
 it('pit gates: only healthy allies or flying hunters; path origin is adjacent to chasm',()=>{
  const g=grid();g.setTerrain(4,5,TerrainType.CHASM);
  const low=rat(),high=rat(),hunt=rat(),fly=rat();
  low.isAlly=high.isAlly=true;low.hp=10;high.hp=11;hunt.state=fly.state=MonsterState.HUNTING;fly.setStatusDuration('levitating',5);
  scheduleLevelFollowers(g,[low,high,hunt,fly],{x:4,y:5},0);
  expect([low.entersLevelIn,high.entersLevelIn,hunt.entersLevelIn,fly.entersLevelIn]).toEqual([0,5,0,5]);
  expect(high.approaching).toBe(APPROACHING_PIT);
 });
 it('actual entry schedules, return cancels and restores the travelled portion',()=>{
  const g:any=createHeadlessGame(7);arena(g);g.player.loc={x:15,y:5};
  const m=rat(9,5);m.isAlly=true;g.monsters=[m];g.depth=2;g.generateDepth();
  expect(g.levels.get(1).monsters).toContain(m);expect(m.entersLevelIn).toBe(7);
  g.monstersApproachStairs();g.monstersApproachStairs();g.monstersApproachStairs();expect(m.entersLevelIn).toBe(4);
  g.depth=1;g.generateDepth(true);expect(g.monsters).toContain(m);expect(m.x).toBeGreaterThan(9);
  expect(m.entersLevelIn).toBe(0);expect(m.approaching).toBe(0);
 });
 it('adjacent only; arrival displaces a player and incurs movement-speed debt',()=>{
  const {g,first}=pair(),m=rat();m.entersLevelIn=2;m.approaching=APPROACHING_DOWNSTAIRS;first.monsters=[m];
  // Constrain the entry to one possible neighbor, so occupancy must be displaced.
  for(const [x,y] of [[4,4],[4,5],[4,6],[5,6],[6,4],[6,5],[6,6]])g.grid.setTerrain(x,y,TerrainType.WALL);
  g.player.loc={x:5,y:4};m.movementSpeed=175;m.targetCorpseLoc={x:8,y:8};m.newPowerCount=2;m.absorptionFlags='MONST_FLIES';
  const far=rat();far.entersLevelIn=2;g.levelSeeds[3].visited=true;g.levels.set(4,{...first,monsters:[far]});
  g.monstersApproachStairs();expect(m.entersLevelIn).toBe(1);expect(far.entersLevelIn).toBe(2);
  g.monstersApproachStairs();expect(g.monsters[0]).toBe(m);expect(first.monsters).toEqual([]);
  expect(m.loc).toEqual({x:5,y:4});expect(g.player.loc).not.toEqual(m.loc);expect(m.ticksUntilTurn).toBe(175);
  expect(m.targetCorpseLoc).toBeNull();expect(m.newPowerCount).toBe(2);expect(m.absorptionFlags).toBe('MONST_FLIES');
 });
 it('upstairs enters by down stair; pit uses stored exit, clumped damage/shield and levitation immunity',()=>{
  const {g,first}=pair(),up=rat();up.entersLevelIn=1;up.approaching=APPROACHING_UPSTAIRS;first.monsters=[up];
  g.monstersApproachStairs();expect(Math.abs(up.x-15)).toBeLessThanOrEqual(1);
  const fall=rat();fall.hp=30;fall.entersLevelIn=1;fall.approaching=APPROACHING_PIT;first.monsters=[fall];
  const roll=vi.spyOn(rng,'randClumpedRange').mockReturnValue(9);g.monstersApproachStairs();
  expect(fall.loc).toEqual({x:8,y:5});expect(fall.hp).toBe(21);expect(roll).toHaveBeenCalledWith(6,12,2);
  const flying=rat();flying.entersLevelIn=1;flying.approaching=APPROACHING_PIT;flying.setStatusDuration('levitating',10);first.monsters=[flying];
  roll.mockClear();g.monstersApproachStairs();expect(roll).not.toHaveBeenCalled();roll.mockRestore();
 });
 it('actual hasted actions advance approach once per 100 ticks, and off-level statuses stay frozen',()=>{
  const {g,first}=pair(),m=rat();m.entersLevelIn=3;m.approaching=APPROACHING_DOWNSTAIRS;m.setStatusDuration('paralyzed',19);first.monsters=[m];
  g.player.setStatusDuration('hasted',50);g.ticksTillUpdateEnvironment=100;
  g.handlePlayerAction('wait',undefined,'system');expect(m.entersLevelIn).toBe(3);
  g.handlePlayerAction('wait',undefined,'system');expect(m.entersLevelIn).toBe(2);expect(m.statusDurations.paralyzed).toBe(19);
 });
 it('pit entry can kill, uses shielding, and separates corpse location from learning payload',()=>{
  const {g,first}=pair(),m=rat();m.hp=5;m.entersLevelIn=1;m.approaching=APPROACHING_PIT;first.monsters=[m];
  const roll=vi.spyOn(rng,'randClumpedRange').mockReturnValue(12);g.monstersApproachStairs();expect(m.hp).toBe(0);expect(first.monsters).toEqual([]);
  const shielded=rat();shielded.hp=5;shielded.applyShield(100);shielded.entersLevelIn=1;shielded.approaching=APPROACHING_PIT;first.monsters=[shielded];
  g.monstersApproachStairs();expect(shielded.hp).toBe(3);expect(shielded.statusDurations.shielded??0).toBe(0);roll.mockRestore();
 });
 it('real entry clears an absent leader, while JSON decoding alone preserves its identity',()=>{
  const {g,first}=pair(),m=rat(),leader=rat();g.monsters=[leader];m.leader=leader;first.monsters=[m];
  const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));const loaded:any=createHeadlessGame(99);expect(loaded.loadSnapshot(snapshot)).toBe(true);
  expect(loaded.levels.get(1).monsters[0].leader).toBe(loaded.monsters[0]);
  loaded.depth=1;loaded.generateDepth(true);expect(loaded.monsters.find((n:Monster)=>n.id===m.id).leader).toBeNull();
 });
 it.each([APPROACHING_DOWNSTAIRS,APPROACHING_PIT])('save mid-approach %s preserves one graph and exact subsequent objective-block/return state',approach=>{
  const {g,first}=pair(),m=rat();m.hp=50;m.entersLevelIn=3;m.approaching=approach;m.isAlly=true;first.monsters=[m];
  const snapshot=JSON.parse(JSON.stringify(g.toSnapshot()));
  const branch=(game:any)=>{game.objectiveTimeBlock();game.objectiveTimeBlock();game.objectiveTimeBlock();expect(game.monsters.some((n:Monster)=>n.id===m.id)).toBe(true);return stable(game);};
  const expected=branch(g),loaded=createHeadlessGame(99);expect(loaded.loadSnapshot(snapshot)).toBe(true);
  expect(branch(loaded)).toEqual(expected);
  const bad=JSON.parse(JSON.stringify(snapshot));delete bad.levels[0].monsters[0].entersLevelIn;expect(loaded.loadSnapshot(bad)).toBe(false);
 });
});

describe('U03b isolated environment catch-up',()=>{
 it.each([0,1,7,100,101,500])('revisit after %s objective blocks clamps to 100 and borrows CE historical clock',away=>{
  const {g,first}=pair();g.absoluteTurnNumber=200;first.awaySince=200-away;
  const clock:number[]=[];const update=vi.spyOn(g,'updateEnvironment').mockImplementation(()=>{clock.push(g.absoluteTurnNumber);expect(g.player.loc).toEqual({x:0,y:0});});
  g.depth=1;g.generateDepth(true);
  const steps=Math.min(away,100);expect(clock).toEqual(Array.from({length:steps},(_,i)=>200-steps+i+1));
  expect(g.absoluteTurnNumber).toBe(200);expect(update).toHaveBeenCalledTimes(steps);update.mockRestore();
 });
 it('new level runs 50 after oldSeed reseed, before placement; no objective or player resources advance',()=>{
  const g:any=createHeadlessGame(7);g.absoluteTurnNumber=5;g.ticksTillUpdateEnvironment=50;
  g.player.setStatusDuration('haste',23);g.player.setStatusDuration('poisoned',12);g.player.poisonAmount=2;
  const before={player:JSON.stringify(g.toSnapshot().player),turns:g.stats.turns,tick:timeSystem.currentTick,fuse:g.monsterSpawnFuse};
  const clocks:number[]=[],order:string[]=[];
  const reseed=vi.spyOn(rng,'seedRandomGenerator');
  const update=vi.spyOn(g,'updateEnvironment').mockImplementation(()=>{clocks.push(g.absoluteTurnNumber);order.push('environment');expect(reseed).toHaveBeenCalledTimes(2);expect(g.player.loc).toEqual({x:0,y:0});});
  const place=vi.spyOn(g,'placePlayerOnLevelEntry').mockImplementation(()=>{order.push('place');});
  const objective=vi.spyOn(g,'objectiveTimeBlock');g.depth=2;g.generateDepth();
  expect(update).toHaveBeenCalledTimes(50);expect(clocks).toEqual(Array.from({length:50},(_,i)=>Math.max(5,49-i)-(49-i)));
  expect(order[50]).toBe('place');expect(objective).not.toHaveBeenCalled();
  expect(JSON.stringify(g.toSnapshot().player)).toBe(before.player);
  expect([g.absoluteTurnNumber,g.stats.turns,timeSystem.currentTick,g.monsterSpawnFuse,g.ticksTillUpdateEnvironment]).toEqual([5,before.turns,before.tick,before.fuse,50]);
  reseed.mockRestore();update.mockRestore();place.mockRestore();objective.mockRestore();
 });
 it('real gas, fire and promotion evolve, without touching player or monster states, debt, hunger, scent or resources',()=>{
  const g:any=createHeadlessGame(7);arena(g);g.absoluteTurnNumber=17;
  const m=rat(10,5);m.setStatusDuration('paralyzed',17);m.ticksUntilTurn=83;g.monsters=[m];
  g.player.loc={x:10,y:5};g.player.setStatusDuration('poisoned',9);g.player.poisonAmount=2;g.player.setStatusDuration('nauseous',5);
  g.environment.addGas(10,5,GasType.POISON,1500);g.grid.setTerrain(13,5,TerrainType.OPEN_DOOR);
  g.grid.setTerrain(40,20,TerrainType.GRASS);g.environment.ignite(40,20);
  const player=JSON.stringify(g.toSnapshot().player),mon=JSON.stringify([m.hp,m.statusDurations,m.ticksUntilTurn]);
  const counters=[g.stats.turns,g.absoluteTurnNumber,g.ticksTillUpdateEnvironment,g.monsterSpawnFuse,timeSystem.currentTick,g.scent.turnNumber,g.waypoints.getState().refreshTicker];
  const gases=vi.spyOn(g.environment,'updateGases'),fires=vi.spyOn(g.environment,'updateFires');
  g.catchUpEnvironment(7);
  expect(JSON.stringify(g.toSnapshot().player)).toBe(player);expect(JSON.stringify([m.hp,m.statusDurations,m.ticksUntilTurn])).toBe(mon);
  expect([g.stats.turns,g.absoluteTurnNumber,g.ticksTillUpdateEnvironment,g.monsterSpawnFuse,timeSystem.currentTick,g.scent.turnNumber,g.waypoints.getState().refreshTicker]).toEqual(counters);
  expect(gases).toHaveBeenCalledTimes(14);expect(fires).toHaveBeenCalledTimes(7);
  expect(g.grid.getCell(13,5).layers[DungeonLayer.DUNGEON]).toBe(TerrainType.DOOR);
  expect(g.grid.getCell(10,5).volume).toBeLessThan(1500);
  gases.mockRestore();fires.mockRestore();
 });
 it('CE gas precedes promotion/fire',()=>{
  const g:any=createHeadlessGame(7);arena(g);const events:string[]=[];
  const gas=vi.spyOn(g.environment,'updateGases').mockImplementation(()=>{events.push('gas');});
  const has=vi.spyOn(g.environment,'hasVolumetricGas').mockReturnValue(true);
  const fire=vi.spyOn(g.environment,'updateFires').mockImplementation(()=>{events.push('fire');return [];});
  g.updateEnvironment();expect(events).toEqual(['gas','gas','fire']);gas.mockRestore();has.mockRestore();fire.mockRestore();
 });
 it('borrowed clock and player position restore on exception; timer normalization is CE +100 once',()=>{
  const g:any=createHeadlessGame(7);const at={...g.player.loc};g.absoluteTurnNumber=20;
  const update=vi.spyOn(g,'updateEnvironment').mockImplementation(()=>{throw Error('probe');});
  expect(()=>g.catchUpEnvironment(3)).toThrow('probe');expect(g.player.loc).toEqual(at);expect(g.absoluteTurnNumber).toBe(20);update.mockRestore();
  g.ticksTillUpdateEnvironment=-20;g.catchUpEnvironment(0);expect(g.ticksTillUpdateEnvironment).toBe(80);
 });
});
