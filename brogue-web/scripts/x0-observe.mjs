// Read-only runtime observation: isolated instances; no source/test edits.
// Usage: node scripts/x0-observe.mjs /tmp/brogue-x0-build
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const project = path.resolve(process.argv[2]);
const report = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../ai_docs/reports/x-0-evidence/runtime-observations.json');
const { buildSync } = require(path.join(project, 'node_modules/esbuild'));
const source = `
import { createHeadlessGame } from './src/test/harness.ts';
import { ItemLoader } from './src/engine/Items/ItemLoader.ts';
import { rng } from './src/engine/Random.ts';
import * as auto from './src/engine/Map/AutoGenerator.ts';
import * as dfs from './src/engine/Map/DungeonFeatureCatalog.ts';
import { Monster } from './src/entities/Monster.ts';
import monsterData from './src/data/monsters.json';
const { RETIRED_AUTOGENERATOR_MACHINES } = auto;
  const g = createHeadlessGame(424242, 'test');
  const spear = ItemLoader.spawnWeapon('spear', -1, -1);
  const key = ItemLoader.spawnKey('iron_key', -1, -1);
  if (!spear || !key) throw new Error('missing probe items');
  key.originDepth = 7;
  key.keyLoc = [{ loc: { x: 5, y: 5 }, machine: 3, disposableHere: true }];
  const itemRoundTrip = item => {
    const saved = g.serializeItem(item);
    const restored = g.deserializeItem(JSON.parse(JSON.stringify(saved)));
    return { before: { flags: item.flags, originDepth: item.originDepth, keyLoc: item.keyLoc }, saved, after: { flags: restored.flags, originDepth: restored.originDepth, keyLoc: restored.keyLoc } };
  };
  const items = { spear: itemRoundTrip(spear), key: itemRoundTrip(key) };
  const ordinary = new Monster(5, 5, monsterData.find(x => x.id === 'rat'));
  ordinary.carriedItem = key;
  ordinary.ticksUntilTurn = 37;
  ordinary.machineHome = 17;
  const savedMonster = g.serializeMonster(ordinary);
  const restoredMonster = g.deserializeMonster(JSON.parse(JSON.stringify(savedMonster)));
  const ordinaryMonster = { before: { carriedItem: !!ordinary.carriedItem, ticksUntilTurn: ordinary.ticksUntilTurn, machineHome: ordinary.machineHome }, after: { carriedItem: !!restoredMonster.carriedItem, ticksUntilTurn: restoredMonster.ticksUntilTurn, machineHome: restoredMonster.machineHome }, savedKeys: Object.keys(savedMonster) };
  g.stats.gold = 987; g.stats.kills = 12; g.stats.maxDepth = 18;
  g.isGameOver = true;
  g.pendingFallenByDepth.set(8, []);
  g.startNewGame({ seed: 424242, mode: 'test' });
  const restart = { stats: { ...g.stats }, isGameOver: g.isGameOver, fallenDepths: [...g.pendingFallenByDepth.keys()] };
  g.isGameOver = false;
  g.levels.set(8, { marker: 'probe' });
  g.meteredItems[0].frequency = 12345;
  const snapshot = g.toSnapshot();
  const rngBefore = JSON.stringify(rng);
  const countBefore = rng.randomNumbersGenerated;
  g.loadSnapshot(JSON.parse(JSON.stringify(snapshot)));
  const persistence = { keys: Object.keys(snapshot), levelsAfter: [...g.levels.keys()], countBefore, countAfter: rng.randomNumbersGenerated, rngStateEqual: rngBefore === JSON.stringify(rng), meteredFrequencyAfter: g.meteredItems[0].frequency };
  const autogens = Object.values(auto).find(v => Array.isArray(v) && v[0]?.carrier);
  const output = { scope: 'Synthetic headless instances, direct existing serialization methods; not natural generation or browser E2E.', items, ordinaryMonster, restart, persistence,
    autoGeneratorExports: Object.keys(auto),
    autogens: autogens?.map(x => ({ id: x.id, ceLine: x.ceLine, carrier: x.carrier, machine: x.machine, note: x.note })),
    retiredAutogenerators: [...RETIRED_AUTOGENERATOR_MACHINES],
    dfCount: Object.keys(dfs.DUNGEON_FEATURE_CATALOG).length, missingTiles: dfs.DF_MISSING_TILES,
    missingTileDetails: dfs.DF_MISSING_TILES.map(id => ({ id, ...dfs.DUNGEON_FEATURE_CATALOG[id] })),
  };
export default output;
`;
const outfile = path.join(project, 'x0-observe-bundle.mjs');
buildSync({ stdin: { contents: source, loader: 'ts', resolveDir: project }, bundle: true, platform: 'node', format: 'esm', outfile });
const output = (await import(pathToFileURL(outfile))).default;
fs.writeFileSync(report, JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify({ restart: output.restart, persistence: output.persistence, dfCount: output.dfCount, missingTiles: output.missingTiles, autogenCount: output.autogens?.length }, null, 2));
