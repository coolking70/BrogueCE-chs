import { describe, expect, it } from 'vitest';
import { DungeonLayer as L, DRAW_PRIORITY, TERRAIN_HOME_LAYER, TerrainType as C } from '../engine/Map/Grid';
import { TERRAIN_FLAGS as T, T_AUTO_DESCENT, T_LAVA_INSTA_DEATH, TM_IS_WIRED, TM_PROMOTES_ON_ELECTRICITY } from '../engine/Map/TerrainCatalog';
import { DF, DUNGEON_FEATURE_CATALOG as D, DFF_CLEAR_OTHER_TERRAIN } from '../engine/Map/DungeonFeatureCatalog';

describe('V-2b-9a terrain and DF carriers', () => {
  it('copies independently significant terrain columns (not merely names)', () => {
    expect([DRAW_PRIORITY[C.FLOOR_FLOODABLE], TERRAIN_HOME_LAYER[C.FLOOR_FLOODABLE], T[C.FLOOR_FLOODABLE].fireType]).toEqual([95, L.DUNGEON, 'DF_PLAIN_FIRE']);
    expect(T[C.CHASM_WITH_HIDDEN_BRIDGE].flags & T_AUTO_DESCENT).not.toBe(0);
    expect([T[C.LAVA_RETRACTABLE].flags & T_LAVA_INSTA_DEATH, T[C.LAVA_RETRACTABLE].mechFlags & TM_IS_WIRED, T[C.LAVA_RETRACTABLE].promoteType]).toEqual([T_LAVA_INSTA_DEATH, TM_IS_WIRED, 'DF_RETRACTING_LAVA']);
    expect([T[C.ELECTRIC_CRYSTAL_OFF].mechFlags & TM_PROMOTES_ON_ELECTRICITY, T[C.ELECTRIC_CRYSTAL_OFF].promoteType]).toEqual([TM_PROMOTES_ON_ELECTRICITY, 'DF_ELECTRIC_CRYSTAL_ON']);
    expect([T[C.MUD_DOORWAY].chanceToIgnite, T[C.MUD_DOORWAY].fireType, DRAW_PRIORITY[C.MUD_DOORWAY]]).toEqual([50, 'DF_EMBERS', 25]);
  });

  it('pins target rows and expands every subsequentDF edge without dangling', () => {
    const target: Array<[DF, number]> = [[DF.DF_ADD_DORMANT_CHASM_HALO,843],[DF.DF_LAVA_RETRACTABLE,846],[DF.DF_SPREADABLE_WATER_POOL,830],[DF.DF_ADD_MACHINE_COLLAPSE_EDGE_DORMANT,837],[DF.DF_MUD_DORMANT,891],[DF.DF_CATWALK_BRIDGE,917],[DF.DF_CHASM_HOLE,916],[DF.DF_LAKE_CELL,920]];
    for (const [id, line] of target) expect(D[id]?.ceLine, DF[id]).toBe(line);
    for (const entry of Object.values(D)) if (entry?.subsequentDF !== null) expect(D[entry.subsequentDF], `${DF[entry.id]} -> ${DF[entry.subsequentDF!]}`).toBeDefined();
    expect([D[DF.DF_LAKE_CELL]!.flags, D[DF.DF_LAKE_CELL]!.subsequentDF]).toEqual([DFF_CLEAR_OTHER_TERRAIN, DF.DF_LAKE_HALO]);
    expect(D[DF.DF_SPREADABLE_WATER_POOL]!.subsequentDF).toBe(DF.DF_SPREADABLE_DEEP_WATER_POOL);
  });
});
