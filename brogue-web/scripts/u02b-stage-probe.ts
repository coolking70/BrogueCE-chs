import { createHeadlessGame, terrainFingerprint } from '../src/test/harness';
import { rng } from '../src/engine/Random';
import { TerrainType } from '../src/engine/Map/Grid';
import { ItemLoader } from '../src/engine/Items/ItemLoader';
import { createHash } from 'node:crypto';
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const results: Record<string, unknown[]> = {};
for (const seed of ['424242', '777', '20260913', '31337', '1099511627783', '18446744073709551615']) {
 const g: any = createHeadlessGame(7); g.startNewGame({seed});
 const rows = [];
 for(let depth=1; depth<=26; depth++) {
  if(depth>1) { g.depth=depth; g.generateDepth(false,false); }
  rows.push({d:depth, fp:terrainFingerprint(g.grid), n:g.monsters.length,
   species:[...new Set(g.monsters.map((m:any)=>m.name))].sort().join(','), items:g.items.length,
   waypoints:hash(g.waypoints.getState()), rng:hash(rng.getState()),
   flavors:hash([[...ItemLoader.potionFlavorMap],[...ItemLoader.scrollFlavorMap],[...ItemLoader.arcanaFlavorMap]]),
   stairs:g.toSnapshot().grid.filter((c:any)=>c.layers.includes(TerrainType.STAIRS_UP) || c.layers.includes(TerrainType.STAIRS_DOWN))});
 }
 results[seed]=rows;
}
console.log('U02B_RESULT '+JSON.stringify(results));
