"""Apply only expired catalog premises, after the unchanged-guard HEAD proof.
The fire-list order failure is fixed in production; its assertion stays intact.
"""
from pathlib import Path
import json
import re

root = Path(__file__).resolve().parents[1]
evidence = root / 'ai_docs/reports/x4-r1-evidence'
proof = json.loads((evidence / 'counterfactual-old-tests.json').read_text(encoding='utf-8'))
assert proof['numFailedTests'] == 0 and proof['numPassedTests'] > 0
golden = json.loads((evidence / 'ce-additions.json').read_text(encoding='utf-8'))
tiles = golden['tiles']
df_ids = [row['index'] for row in golden['dfs'].values()]


def edit(name, transform):
    path = root / 'src/test' / name
    text = path.read_text(encoding='utf-8')
    updated = transform(text)
    assert updated != text, name
    path.write_text(updated, encoding='utf-8', newline='\n')


def terrain(text):
    # Keep the historical projected count and all existing field checks.
    marker = "&& !['LICHEN',"
    assert marker in text
    text = text.replace(marker, "&& ![" + ', '.join(repr(n) for n in tiles) + ", 'LICHEN',", 1)
    marker = 'const POST_LEGACY_TILES = new Set<TerrainType>(['
    text = text.replace(marker, marker + '\n        C.BLOODFLOWER_POD, // X4-R1 CE :514 blocks; independently tested with the real Game bump path.')
    text = text.replace('expect(names.length).toBe(193);', 'expect(names.length).toBe(208); // X4-R1 appends 15 CE identities.')
    return text


def layers(text):
    text = text.replace('expect(TERRAIN_HOME_LAYER).toEqual({', 'expect(TERRAIN_HOME_LAYER).toEqual({\n' + '\n'.join(
        f"            [C.{n}]: L.{'GAS' if n == 'HEALING_CLOUD' else 'SURFACE'}, // X4-R1 CE :{row['ceLine']}"
        for n, row in tiles.items()), 1)
    text = text.replace('expect(DRAW_PRIORITY).toEqual({', 'expect(DRAW_PRIORITY).toEqual({\n' + '\n'.join(
        f"            [C.{n}]: {row['fields'][3]}, // X4-R1 CE :{row['ceLine']}" for n, row in tiles.items()), 1)
    text = text.replace('[C.BLOODFLOWER_STALK]: 20,', '[C.BLOODFLOWER_STALK]: 10, // X4-R1 CE :513; POD must not overwrite STALK.')
    return text


def lights(text):
    marker = 'const EXPECTED_GLOW: Record<TerrainType, number> = {'
    text = text.replace(marker, marker + '\n' + '\n'.join(
        f"        [TerrainType.{n}]: LightKind.{row['fields'][9]}, // X4-R1 CE :{row['ceLine']}" for n, row in tiles.items()), 1)
    text = text.replace('非零恰 51 个（X2g 加入黑暗气云）', '非零恰 56 个（X4-R1 新增五个发光载体）')
    text = text.replace('expect(nonzero).toEqual([', 'expect(nonzero).toEqual([\n' + '\n'.join(
        f'            TerrainType.{n}, // X4-R1 CE glow carrier' for n, row in tiles.items() if row['fields'][9] != 'NO_LIGHT'), 1)
    text = text.replace('const CARRIER_KINDS = new Set([', "const CARRIER_KINDS = new Set([\n        'UNICORN_POOP_LIGHT', // X4-R1 actual UNICORN_POOP terrain + DF47.", 1)
    return text


def gas(text):
    text = text.replace('HEALING 尚无载体；X2g 的 ROT/DARKNESS 具有完整 CE 来源', 'X4-R1 HEALING 与 X2g ROT/DARKNESS 均有真实 CE 地形和 DF 来源')
    start = text.index('        // "只登记"的形态')
    end = text.index('        // X2g: absence', start)
    text = text[:start] + '''        // X4-R1: the absent-tile premise expired. GasType convenience aliases
        // remain absent; native GAS-layer identities are the storage contract.
        const names = (TerrainType as unknown as Record<string, unknown>);
        expect(isGasTerrain(C.HEALING_CLOUD)).toBe(true);
        expect(catalogFeature(DF.DF_BLOODFLOWER_POD_BURST).tile).toBe(C.HEALING_CLOUD);
''' + text[end:]
    start = text.index('        // 24 条 GAS 目录里')
    end = text.index('\n    });', start)
    text = text[:start] + '''        // X4-R1 closes the two remaining entries of this historical boundary:
        // real POD -> healing spores, real HAY -> stench smoke -> ordinary fire.
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_BLOODFLOWER_POD_BURST]).toMatchObject({
            tile: C.HEALING_CLOUD, startProbability: 350,
        });
        expect(DUNGEON_FEATURE_CATALOG[DF.DF_STENCH_BURN]).toMatchObject({
            tile: C.STENCH_SMOKE_GAS, startProbability: 50, subsequentDF: DF.DF_PLAIN_FIRE,
        });''' + text[end:]
    return text


def features(text):
    # Original 135-row projection remains unchanged; R1 independently checks
    # the added rows against CE and checks the full 218-entry gap partition.
    text = text.replace('![36, 38, 32,', '![' + ', '.join(map(str, df_ids)) + ', 36, 38, 32,')
    marker = '        const closure = new Set<DF>();'
    roots = [n for n in golden['dfs'] if n not in ['DF_BLOODFLOWER_POD_BURST', 'DF_STENCH_BURN']]
    text = text.replace(marker, '''        // X4-R1 explicitly authorized catalog roots: species blood/periodic/
        // activation/dart/death consumers are handed to R3/R6, not claimed live.
        // POD burst and stench burn enter through the real terrain fields above.
        for (const id of [
''' + '\n'.join(f'            DF.{n},' for n in roots) + '\n        ]) start.add(id);\n' + marker, 1)
    text = text.replace('DUNGEON_FEATURE_CATALOG[217 as DF]).toBeUndefined(); // DF_STENCH_BURN',
                        'DUNGEON_FEATURE_CATALOG[34 as DF]).toBeUndefined(); // DF_BLOAT_DEATH remains catalog-absent; dedicated behavior exists.')
    text = text.replace('catalogFeature(217 as DF)).toThrow', 'catalogFeature(34 as DF)).toThrow')
    # Only the two new tuples actually observed in the historical F3 corpus.
    # Exact coordinates and writer stacks are in new-terrain-cold-cells.json
    # and layer-writes.json.gz. Do not widen into a terrain Cartesian product.
    marker = 'const verified9eLayers: ReadonlyArray<readonly TerrainType[]> = ['
    text = text.replace(marker, marker + '''
            // X4-R1 CE58 POD (Globals.c:699), pure SURFACE writer:
            // 424242/D1 (27,11) and D9 (26,21); exact writer trace in report.
            [C.FLOOR, C.NOTHING, C.NOTHING, C.BLOODFLOWER_POD],
            [C.NOTHING, C.WATER_SHALLOW, C.NOTHING, C.BLOODFLOWER_POD],
''', 1)
    text = text.replace('if (cell.layers[L.SURFACE] === C.BLOODFLOWER_STALK\n',
                        'if ([C.BLOODFLOWER_STALK, C.BLOODFLOWER_POD].includes(cell.layers[L.SURFACE] as TerrainType)\n', 1)
    text = text.replace('HAY 在 web 由 GRASS 承载（DungeonFeatureCatalog），只写 SURFACE。', '旧 GRASS 组合仍可能来自 DF_GRASS；DF_HAY 现落真实 HAY（见上方）。')
    return text


def appearance(text):
    text = text.replace("import x2gTerrainGoldens from './fixtures/x2g-ce-terrain.json';",
                        "import x2gTerrainGoldens from './fixtures/x2g-ce-terrain.json';\nimport x4r1TerrainGoldens from './fixtures/x4-r1-ce-terrain.json';")
    text = text.replace('...priorTerrainGoldens, ...x2gTerrainGoldens }',
                        '...priorTerrainGoldens, ...x2gTerrainGoldens, ...x4r1TerrainGoldens }')
    text = text.replace('当前 193 个', '当前 208 个')
    text = text.replace('![TerrainType.LICHEN,', '![' + ', '.join('TerrainType.' + n for n in tiles) + ', TerrainType.LICHEN,', 1)
    text = text.replace('expect(ALL_TERRAINS.length).toBe(193);', 'expect(ALL_TERRAINS.length).toBe(208);')
    return text


def historical_df(text):
    return text.replace('![36,38,32,', '![' + ','.join(map(str, df_ids)) + ',36,38,32,', 1)


def search_fixture(text):
    marker = '            craftRoom(game, 10);'
    assert text.count(marker) == 1
    return text.replace(marker, marker + '''
            // X4-R1: full search turns now grow natural bloodwort outside FOV.
            // seed42511 has stalks at (17,3), (69,16), (77,7); three DF spread
            // rolls, zero search rolls. Isolate this ambient producer only.
            // Keep all zero-roll, visibility and hidden-door assertions intact.
            for (let x = 0; x < game.grid.width; x++) for (let y = 0; y < game.grid.height; y++) {
                const cell = game.grid.getCell(x, y)!;
                for (let layer = 0; layer < 4; layer++) {
                    if (cell.layers[layer] === TerrainType.BLOODFLOWER_STALK)
                        game.grid.setTerrainLayer(x, y, layer, TerrainType.NOTHING);
                }
            }''', 1)


# Supplement generated from CE source evidence, not from web output. Preserve
# both prior appearance fixtures byte-for-byte and keep full visible/memory checks.
appearance_rows = {n: dict(ceTile=n, ceLine=row['ceLine'], **{
    k: row['appearance'][k] for k in ['char', 'color', 'bgColor']}) for n, row in tiles.items()}
(root / 'src/test/fixtures/x4-r1-ce-terrain.json').write_text(
    json.dumps(appearance_rows, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

for name, transform in [
    ('c_4a_terrain_catalog.test.ts', terrain),
    ('c_4a_0_layer_model.test.ts', layers),
    ('c_7_lighting.test.ts', lights),
    ('g_2_gas_df_wiring.test.ts', gas),
    ('c_4b_dungeon_feature.test.ts', features),
    ('r_1_appearance.test.ts', appearance),
    ('u_17a_df_transaction.test.ts', historical_df),
    ('u_08_terrain_bolts.test.ts', historical_df),
    ('p1_42_secret_door_search.test.ts', search_fixture),
]: edit(name, transform)
print('Updated eight catalog premises and one search fixture; no behavior assertion removed.')
