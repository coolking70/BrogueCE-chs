/** Diagnostic only: retain failing natural continuation evidence and attribute it.
 * Counterfactual navigation restoration is test-side, never a production save fallback. */
import fs from 'node:fs';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { createHeadlessGame } from '../src/test/harness';
import { rng, Random, RNGType } from '../src/engine/Random';
import type { Game } from '../src/engine/Core/Game';
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const hash = (v: unknown) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
function state(g: Game) { const { savedAt: _, ...s } = g.toSnapshot(); return json(s); }
function step(g: Game) {
 rng.setRNG(RNGType.RNG_COSMETIC); for(let i=0;i<17;i++)rng.randRange(0,999);
 rng.setRNG(RNGType.RNG_SUBSTANTIVE);g.handlePlayerAction('wait',undefined,'system');return state(g);
}
function firstDiff(a: any,b: any,path=''): unknown {
 if(JSON.stringify(a)===JSON.stringify(b))return null;
 if(a && b && typeof a==='object' && typeof b==='object') {
  for(const k of new Set([...Object.keys(a),...Object.keys(b)])) {
   const found=firstDiff(a[k],b[k],`${path}/${k}`);if(found)return found;
  }
 }
 return {path,continuous:a,loaded:b};
}
const results=[];
for(const checkpoint of [0,3,11]) {
 const g=createHeadlessGame(7);g.animationEnabled=false;
 for(let i=0;i<checkpoint;i++)step(g);
 const saved=json(g.toSnapshot());
 const navigation=g.waypoints.getState();
 const direct=Array.from({length:12},()=>step(g));
 const fresh=createHeadlessGame(999);fresh.animationEnabled=false;fresh.loadSnapshot(saved);
 const rngRestored=JSON.stringify(rng.getState())===JSON.stringify(saved.rngState);
 const a=new Random(9),b=new Random(9);a.setState(saved.rngState);b.setState(rng.getState());
 const nextDrawsEqual=Array.from({length:100},()=>a.randRange(0,999999)).every(v=>v===b.randRange(0,999999));
 const differentWaypointCoordinates=JSON.stringify(fresh.waypoints.coordinates)!==JSON.stringify(navigation.coordinates);
 const resumed=Array.from({length:12},()=>step(fresh));
 fresh.loadSnapshot(saved);
 // Reintroduce only the old load-time reshuffle: the live RNG remains restored.
 fresh.rebuildWaypoints();
 const withReshuffle=Array.from({length:12},()=>step(fresh));
 assert.deepEqual(resumed,direct);
 if(checkpoint>0)assert.notDeepEqual(withReshuffle,direct);
 results.push({checkpoint,rngRestored,nextDrawsEqual,differentWaypointCoordinates,
  directSha256:hash(direct),loadedSha256:hash(resumed),withOldReshuffleSha256:hash(withReshuffle),
  firstDifference:firstDiff(direct,resumed),counterfactualDifference:firstDiff(direct,withReshuffle)});
}
fs.writeFileSync('ai_docs/reports/u-02a-evidence/continuation.json',JSON.stringify(results,null,2)+'\n');
console.log(JSON.stringify(results,null,2));
