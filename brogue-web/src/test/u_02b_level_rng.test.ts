import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Random, rng, RNGType } from '../engine/Random';
import { initializeLevelSeeds, isLevelSeeds } from '../engine/Core/LevelSeeds';
import { createHeadlessGame } from './harness';
import { Architect } from '../engine/Generator/Architect';
import { DCOLS, DROWS } from '../engine/Map/Grid';
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const ce = JSON.parse(fs.readFileSync('ai_docs/reports/u-02b-evidence/ce-reference.json', 'utf8'));
afterEach(() => vi.restoreAllMocks());
const tuple = (r: Random, stream = 0) => Object.values(r.getState().streams[stream]!);
const generate = (g: any, d: number, up = false) => { g.depth = d; g.generateDepth(up, false); };
const terrain = (g: any) => g.toSnapshot().grid.map((c: any) => ({x:c.x,y:c.y,layers:c.layers,machineNumber:c.machineNumber}));

describe('U02b CE extracted-C reference: uint64 initialization / raw hi-lo / interleaved level table', () => {
 for (const row of ce) it(`CE seed ${row.seed}: both tuples, eight raw64 values, all 41 seeds/stairs and count`, () => {
  const r = new Random(row.seed);
  expect([tuple(r), tuple(r,1)]).toEqual(row.initial);
  expect(Array.from({length:8},()=>r.rand64bits().toString())).toEqual(row.raw64);
  expect(r.randomNumbersGenerated).toBe(8);
  r.seedRandomGenerator(row.seed); expect(r.randomNumbersGenerated).toBe(8);
  r.resetCounters();
  expect(initializeLevelSeeds(r,row.seed)).toEqual(row.levels);
  expect(tuple(r)).toEqual(row.afterTable); expect(tuple(r,1)).toEqual(row.initial[1]);
  expect(r.randomNumbersGenerated).toBe(row.count);
 });
 it('raw64 draws exactly twice, hi before lo, on selected stream and counts once', () => {
  const r=new Random(7), initial=r.getState();
  const raw=vi.spyOn(r as any,'ranval').mockReturnValueOnce(0xdeadbeef).mockReturnValueOnce(0xfedcba98);
  r.setRNG(RNGType.RNG_COSMETIC);
  expect(r.rand64bits()).toBe(0xdeadbeeffedcba98n);
  expect(raw).toHaveBeenCalledTimes(2); expect(raw.mock.calls[0]![0]).toBe(raw.mock.calls[1]![0]);
  expect(r.randomNumbersGenerated).toBe(0);expect(r.cosmeticNumbersGenerated).toBe(1);
  expect(r.getState().streams[0]).toEqual(initial.streams[0]);
 });
 for (const seed of ['7','1099511627783']) it(`zero levelSeed uses i+1 for all slots, ${seed}`, () => {
  const r=new Random(seed); let nextX=77;
  vi.spyOn(r,'rand64bits').mockReturnValue(0n);
  vi.spyOn(r,'randRange').mockImplementation((lo,hi)=>{
   if(lo===0) return 0;
   if(hi===DCOLS-2){const x=nextX;nextX=x===77?1:77;return x;}
   return 1;
  });
  const table=initializeLevelSeeds(r,seed);
  expect(table.map(l=>l.levelSeed)).toEqual(Array.from({length:41},(_,i)=>String(i+1)));
  expect(table.every(l=>!l.visited)).toBe(true);
 });
 it('mixed raw64/range streams resume bit-for-bit through JSON and reseeding retains both counts', () => {
  const a=new Random('18446744073709551615');
  const draw=(r:Random,i:number)=>{r.setRNG(i%2);return [r.rand64bits().toString(),r.randRange(0,2147483648)];};
  for(let i=0;i<51;i++)draw(a,i);
  const checkpoint=json(a.getState()),b=new Random(9);b.setState(checkpoint);
  for(let i=0;i<256;i++)expect(draw(b,i)).toEqual(draw(a,i));
  expect(b.getState()).toEqual(a.getState());
  const before=a.getState();a.seedRandomGenerator(7);
  expect(a.randomNumbersGenerated).toBe(before.randomNumbersGenerated);
  expect(a.cosmeticNumbersGenerated).toBe(before.cosmeticNumbersGenerated);
  expect(a.getState().currentRNG).toBe(before.currentRNG);
  const streams=a.getState().streams;a.resetCounters();
  expect(a.getState().streams).toEqual(streams);
  expect([a.randomNumbersGenerated,a.cosmeticNumbersGenerated]).toEqual([0,0]);
 });
 it('stair rejection precedes the next seed draw', () => {
  const r=new Random(7), calls:string[]=[];
  const original=r.randRange.bind(r);let n=0;
  vi.spyOn(r,'randRange').mockImplementation((lo,hi)=>{
   calls.push(`${lo}:${hi}`); n++;
   if(n===3) return 38; if(n===4) return 27; // equal to the first up stair: reject
   if(n===5) return 77; if(n===6) return 1; // accept
   return original(lo,hi);
  });
  const rows=initializeLevelSeeds(r,'7');
  expect(calls.slice(0,8)).toEqual(['0:9999','0:9999','1:77','1:27','1:77','1:27','0:9999','0:9999']);
  expect(rows[1]!.upStairsLoc).toEqual({x:77,y:1});
 });
});

describe('U02b layer lifecycle and persistence', () => {
 it('first layer starts from its table seed; later entry retries zero oldSeed and returns before vision', () => {
  const g=createHeadlessGame(7);
  const original=Architect.prototype.generateLevel;
  const seen:unknown[]=[];
  vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(function(this:Architect,...args){
   seen.push(rng.getState().streams);return original.apply(this,args);
  });
  g.startNewGame({seed:'1099511627783'});
  expect(seen[0]).toEqual(new Random(g.levelSeeds[0]!.levelSeed).getState().streams);
  const counter=rng.randomNumbersGenerated;
  vi.spyOn(rng as any,'ranval').mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(0).mockReturnValueOnce(123);
  const raw64=vi.spyOn(rng,'rand64bits'), reseed=vi.spyOn(rng,'seedRandomGenerator');
  const wp=g.rebuildWaypoints.bind(g);let wpDelta=0;
  vi.spyOn(g,'rebuildWaypoints').mockImplementation(()=>{const c=rng.randomNumbersGenerated;wp();wpDelta=rng.randomNumbersGenerated-c;});
  const beforeVision:unknown[]=[];
  vi.spyOn(g as any,'updateVision').mockImplementation(()=>{beforeVision.push(rng.getState().streams);});
  generate(g,2);
  expect(raw64).toHaveBeenCalledTimes(2);
  expect(reseed.mock.calls.map(c=>c[0])).toEqual([g.levelSeeds[1]!.levelSeed,123n]);
  expect(seen[1]).toEqual(new Random(g.levelSeeds[1]!.levelSeed).getState().streams);
  expect(beforeVision).toEqual([new Random(123).getState().streams]);
  expect(wpDelta).toBe(DCOLS*DROWS-1);
  expect(rng.randomNumbersGenerated).toBeGreaterThan(counter+wpDelta+2);
  expect(g.levelSeeds.slice(0,3).map(l=>l.visited)).toEqual([true,true,false]);
 });
 it('re-entering the active or freshly loaded layer uses its live world, never regenerates it', () => {
  const g=createHeadlessGame(7), grid=g.grid, monsters=g.monsters;
  const seed=vi.spyOn(rng,'seedRandomGenerator'), raw=vi.spyOn(rng,'rand64bits');
  generate(g,1);expect(g.grid).toBe(grid);expect(g.monsters).toBe(monsters);
  const snapshot=json(g.toSnapshot());expect(g.loadSnapshot(snapshot)).toBe(true);
  const loaded=g.grid;generate(g,1);expect(g.grid).toBe(loaded);
  expect(seed).not.toHaveBeenCalled();expect(raw).not.toHaveBeenCalled();
 });
 it('revisit restores the same grid and consumes waypoints on the live stream without reseeding', () => {
  const g=createHeadlessGame(7), first=g.grid; generate(g,2);
  const reseed=vi.spyOn(rng,'seedRandomGenerator'), raw64=vi.spyOn(rng,'rand64bits');
  const c=rng.randomNumbersGenerated; generate(g,1,true);
  expect(g.grid).toBe(first);expect(reseed).not.toHaveBeenCalled();expect(raw64).not.toHaveBeenCalled();
  expect(rng.randomNumbersGenerated-c).toBeGreaterThanOrEqual(DCOLS*DROWS-1);
 });
 it('generation failure still returns the streams and does not mark a never-generated layer visited', () => {
  const g=createHeadlessGame(7), r=new Random(1);r.setState(rng.getState());const back=r.rand64bits();
  vi.spyOn(Architect.prototype,'generateLevel').mockImplementation(()=>{throw Error('injected');});
  expect(()=>generate(g,2)).toThrow('injected');
  expect(rng.getState().streams).toEqual(new Random(back).getState().streams);expect(g.levelSeeds[1]!.visited).toBe(false);
 });
 it('JSON preserves detached seed/visited metadata and rejects old algorithms/malformed tables atomically', () => {
  const g=createHeadlessGame(7);generate(g,2);const saved=json(g.toSnapshot());
  // 用户验收裁决/U03：D1→D2→存读→D1 必须等价于连续局（CE startLevel 恢复已访层）。
  // 两条支线顺序执行，避免共用 RNG/时钟/物品表互相污染；只剔除保存墙钟。
  const stable=(game:typeof g)=>{const {savedAt:_time,...state}=game.toSnapshot();return json(state);};
  const checkpoint=stable(g);
  generate(g,1,true);const continuousD1=stable(g);
  generate(g,2);const continuousD2=stable(g);
  const fresh=createHeadlessGame(99);expect(fresh.loadSnapshot(saved)).toBe(true);
  expect(stable(fresh)).toEqual(checkpoint);
  expect(fresh.levelSeeds).toEqual(saved.levelSeeds); expect(rng.getState()).toEqual(saved.rngState);
  saved.levelSeeds[0]!.visited=false; saved.levelSeeds[1]!.upStairsLoc.x++;
  expect(fresh.levelSeeds).not.toEqual(saved.levelSeeds);
  const before=json(fresh.toSnapshot());
  for(const corrupt of [
   (s:any)=>delete s.levelSeeds, (s:any)=>s.levelSeeds.pop(), (s:any)=>s.levelSeeds=new Array(41),
   (s:any)=>s.levelSeeds[1].levelSeed='0', (s:any)=>s.levelSeeds[1].levelSeed=7,
   (s:any)=>s.levelSeeds[1].visited=1, (s:any)=>s.levelSeeds[1].downStairsLoc.x=0,
   (s:any)=>s.rngState.algorithm='brogue-web-ranval32-low32-v1', (s:any)=>s.rngState.version=1,
  ]) {const bad=json(before);corrupt(bad);expect(fresh.loadSnapshot(bad)).toBe(false);expect(rng.getState()).toEqual(before.rngState);expect(fresh.levelSeeds).toEqual(before.levelSeeds);}
  expect(isLevelSeeds(new Array(41))).toBe(false);
  generate(fresh,1,true);expect(fresh.depth).toBe(1);expect(stable(fresh)).toEqual(continuousD1);
  generate(fresh,2);expect(fresh.depth).toBe(2);expect(stable(fresh)).toEqual(continuousD2);
 });
});

for(const seed of ['7','1099511627783','18446744073709551615']) it(`different actual D1 actions cannot change D2–D6 terrain, seed ${seed}`, () => {
 const run=(branch:number)=>{
  const g=createHeadlessGame(7);g.startNewGame({seed});g.animationEnabled=false;g.player.hp=g.player.maxHp=10000;
  const start={...g.player.loc};
  for(let i=0;i<6;i++) {
   if(branch===0) g.handlePlayerAction('wait',undefined,'system');
   else if(g.player.loc.x!==start.x || g.player.loc.y!==start.y) g.handlePlayerAction('search',undefined,'system');
   else {
    const step=[{x:1,y:0},{x:0,y:-1},{x:-1,y:0},{x:0,y:1}].find(p=>(g as any).canMoveTo(g.player.loc.x+p.x,g.player.loc.y+p.y)&&!g.getMonsterAt(g.player.loc.x+p.x,g.player.loc.y+p.y));
    if(step) g.handlePlayerAction('move',step,'system');else g.handlePlayerAction('search',undefined,'system');
   }
  }
  const position={...g.player.loc};
  if(branch) for(let i=0;i<257;i++) rng.randRange(0,9999);
  const consumed=rng.randomNumbersGenerated;
  const maps=[];
  for(let d=2;d<=6;d++){generate(g,d);maps.push(terrain(g));}
  return {start,position,consumed,maps};
 };
 const a=run(0),b=run(1);expect(b.position).not.toEqual(b.start);expect(b.consumed).not.toBe(a.consumed);expect(b.maps).toEqual(a.maps);
});
