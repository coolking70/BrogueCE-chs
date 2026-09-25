import fs from 'node:fs';
import crypto from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { rng } from '../src/engine/Random';
const base=JSON.parse(fs.readFileSync('src/test/fixtures/generation_baseline.json','utf8'));
const hash=(value:unknown)=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const rows=[];
for(const seed of base.seeds){
 const g:any=createHeadlessGame(seed);
 for(let depth=1;depth<=26;depth++){
  if(depth>1){g.depth=depth;g.generateDepth(false,false);}
  const snapshot=g.toSnapshot();
  rows.push({seed,depth,fp:terrainFingerprint(g.grid),n:g.monsters.length,
   species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','),items:g.items.length,
   layers:hash(g.grid.cells.map((column:any[])=>column.map(c=>[c.layers,c.volume]))),
   terrain:hash(g.grid.cells),monsters:hash(snapshot.monsters??snapshot.levels),
   player:hash(snapshot.player),itemsState:hash(g.items),rng:rng.getState()});
 }
}
fs.writeFileSync(process.argv[2]!,gzipSync(JSON.stringify(rows)));
console.log(`Captured ${rows.length} layers and entity/RNG fingerprints.`);
