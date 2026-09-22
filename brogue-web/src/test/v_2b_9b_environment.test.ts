import { describe, expect, it } from 'vitest';
import data from '../data/blueprints.json';
import { BlueprintEngine, type BlueprintDef } from '../engine/Generator/BlueprintEngine';
import { Grid, DungeonLayer, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { readFileSync } from 'node:fs';
import { promoteTile } from '../engine/Map/Promotion';
import { rng } from '../engine/Random';

describe('V-2b-9b environment machines', () => {
  it('contains the nine literal CE blueprint rows and keeps 38/39 in-pool because their escape items are implemented', () => {
    const rows = (data as BlueprintDef[]).filter(b => [31,34,36,37,38,39,44,65,66].includes(b.ceBlueprintId ?? -1));
    expect(rows.map(b => b.ceBlueprintId)).toEqual([31,34,36,37,38,39,44,65,66]);
    expect(rows.find(b => b.ceBlueprintId === 38)?.features.map(f => f.itemId).filter(Boolean))
      .toEqual(['potion_of_levitation', 'potion_of_fire_immunity']);
    expect(rows.find(b => b.ceBlueprintId === 65)?.flags).toContain('BP_REQUIRE_BLOCKING');
  });

  it('bulk promote uses the common spawnDungeonFeature propagation path for water, collapse, bridge and lava', () => {
    const cases: Array<[TerrainType, TerrainType]> = [
      [TerrainType.MACHINE_FLOOD_WATER_DORMANT, TerrainType.MACHINE_FLOOD_WATER_SPREADING],
      [TerrainType.MACHINE_COLLAPSE_EDGE_DORMANT, TerrainType.MACHINE_COLLAPSE_EDGE_SPREADING],
      [TerrainType.CHASM_WITH_HIDDEN_BRIDGE_ACTIVE, TerrainType.STONE_BRIDGE],
      [TerrainType.LAVA_RETRACTABLE, TerrainType.LAVA_RETRACTING],
    ];
    for (const [source, payoff] of cases) {
      rng.seedRandomGenerator(0x29b);
      const g = new Grid(9, 9);
      g.setTerrainLayer(4, 4, DungeonLayer.LIQUID, source);
      if (source === TerrainType.CHASM_WITH_HIDDEN_BRIDGE_ACTIVE) {
        g.setTerrainLayer(5, 4, DungeonLayer.LIQUID, TerrainType.CHASM_WITH_HIDDEN_BRIDGE);
      }
      if (source === TerrainType.LAVA_RETRACTABLE) {
        g.setTerrainLayer(5, 4, DungeonLayer.LIQUID, TerrainType.LAVA);
      }
      const result = promoteTile(g, 4, 4, DungeonLayer.LIQUID, false);
      expect(result.deferred, `missing carrier for ${TerrainType[source]}`).toBeNull();
      expect(result.spawn?.builtCells.length).toBeGreaterThan(0);
      expect(g.getCell(4, 4)?.layers).toContain(payoff);
    }
  });

  it('BP_TREAT_AS_BLOCKING accepts a non-disconnecting interior (reversed predicate rejects it)', () => {
    rng.seedRandomGenerator(0x29b);
    const g = new Grid(DCOLS, DROWS);
    for (let x=1;x<DCOLS-1;x++) for (let y=1;y<DROWS-1;y++) g.setTerrain(x,y,TerrainType.FLOOR);
    const engine = new BlueprintEngine(g, 5, []);
    const bp: BlueprintDef = { id:'probe', name:'probe', depthRange:[1,26], roomSize:[1,1], frequency:0,
      category:'thematic', flags:['BP_TREAT_AS_BLOCKING'], features:[] };
    const cells = (engine as unknown as { fillVestibuleInterior(b: BlueprintDef, p:{x:number;y:number}): {x:number;y:number}[] | null })
      .fillVestibuleInterior(bp,{x:7,y:7});
    expect(cells).not.toBeNull();
    expect(cells).toHaveLength(1);
  });

  it('等 9e 激活的占位：判据正确且被前厅消费，区域路径未接线、零活载体', () => {
    // blockingMap 以 y * DCOLS + x 索引，必须用真实地图尺寸；
    // 15x15 舞台会把“切断列”写到错误偏移，无法验证判据。
    const g = new Grid(DCOLS, DROWS);
    for (let x=1;x<DCOLS-1;x++) for (let y=1;y<DROWS-1;y++) g.setTerrain(x,y,TerrainType.FLOOR);
    const engine = new BlueprintEngine(g, 5, []);
    const bp: BlueprintDef = { id:'area-probe', name:'area-probe', depthRange:[1,26], roomSize:[1,1], frequency:0,
      category:'thematic', flags:['BP_TREAT_AS_BLOCKING'], features:[] };
    const validate = (engine as unknown as {
      interiorSatisfiesBlockingFlags(b: BlueprintDef, p: {x:number;y:number}[]): boolean
    }).interiorSatisfiesBlockingFlags.bind(engine);
    expect(validate(bp,[{x:7,y:7}]), '开阔区域不得被把“不切断”判据抄反').toBe(true);
    const corridor = new Grid(DCOLS, DROWS);
    for (let x=0;x<DCOLS;x++) for (let y=0;y<DROWS;y++) corridor.setTerrain(x,y,TerrainType.GRANITE);
    for (let x=1;x<DCOLS-1;x++) corridor.setTerrain(x,Math.floor(DROWS/2),TerrainType.FLOOR);
    const corridorEngine = new BlueprintEngine(corridor, 5, []);
    const corridorValidate = (corridorEngine as unknown as {
      interiorSatisfiesBlockingFlags(b: BlueprintDef, p: {x:number;y:number}[]): boolean
    }).interiorSatisfiesBlockingFlags.bind(corridorEngine);
    expect(corridorValidate(bp,[{x:Math.floor(DCOLS/2),y:Math.floor(DROWS/2)}]),
      '真实尺寸舞台上一格切断 1 宽走廊，必须被判据否决').toBe(false);

    const source = readFileSync(new URL('../engine/Generator/BlueprintEngine.ts', import.meta.url), 'utf8');
    expect(source.match(/interiorSatisfiesBlockingFlags\(bp, cells\)/g)?.length,
      '当前只有 fillVestibuleInterior 消费判据；区域 interior 生长机制留待 9e').toBe(1);
    const liveVestibuleCarriers = (data as BlueprintDef[]).filter(b => b.frequency > 0
      && b.flags.includes('BP_VESTIBULE')
      && (b.flags.includes('BP_TREAT_AS_BLOCKING') || b.flags.includes('BP_REQUIRE_BLOCKING')));
    expect(liveVestibuleCarriers, '前厅路径已消费判据，但当前零活载体').toEqual([]);
  });
});
