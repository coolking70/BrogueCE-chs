import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import i18next from 'i18next';
import golden from '../../ai_docs/reports/x4-r1-evidence/ce-additions.json';
import blueprints from '../data/blueprints.json';
import { Grid, TerrainType, DungeonLayer, DRAW_PRIORITY, TERRAIN_HOME_LAYER, FIRE_TERRAIN_TYPES } from '../engine/Map/Grid';
import * as flags from '../engine/Map/TerrainCatalog';
import { DF, DUNGEON_FEATURE_CATALOG } from '../engine/Map/DungeonFeatureCatalog';
import { catalogFeature, spawnDungeonFeature } from '../engine/Map/DungeonFeature';
import { exposeTileToFire, promoteOnPlayerBump, promoteTile, runPromotionUpdate } from '../engine/Map/Promotion';
import { terrainHealingAmount } from '../engine/Map/TerrainHealing';
import { CE_TERRAIN_GAPS, CE_DF_GAPS, CE_MACHINE_GAPS, terrainForCE } from '../engine/Map/WorldCatalogAudit';
import { LIGHT_CATALOG, LightKind } from '../engine/Map/LightCatalog';
import { TERRAIN_APPEARANCES } from '../engine/UI/TerrainAppearanceCatalog';
import { TERRAIN_COLOR_NAMES } from '../engine/UI/TerrainColorCatalog';
import { worldFeatureText, worldHealingText, worldTerrainText } from '../engine/UI/WorldCatalogText';
import zhCN from '../locales/zh_CN.json';
import { EnvironmentManager, isGasTerrain } from '../engine/Environment/Gas';
import { Architect } from '../engine/Generator/Architect';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';

const ce = readFileSync(resolve('../BrogueCE-master/src/brogue/Globals.c'), 'utf8');
const header = readFileSync(resolve('../BrogueCE-master/src/brogue/Rogue.h'), 'utf8');
function enumEntries(name: string): [string, number][] {
    const body = header.match(new RegExp(`enum\\s+${name}\\s*\\{([\\s\\S]*?)\\}`))![1]!
        .replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '');
    let id = -1;
    return body.split(',').map(s => s.trim()).filter(Boolean).map(s => {
        const [key, value] = s.split('=');
        id = value === undefined ? id + 1 : Number(value.trim());
        return [key!.trim(), id];
    });
}
function floor(): Grid {
    const grid = new Grid(15, 15);
    for (let x = 0; x < grid.width; x++) for (let y = 0; y < grid.height; y++) grid.setTerrain(x, y, TerrainType.FLOOR);
    return grid;
}
function cells(grid: Grid) {
    return Array.from({length: grid.width}, (_, x) => Array.from({length: grid.height}, (_, y) => grid.getCell(x, y)!)).flat();
}
function spawn(grid: Grid, df: DF, x = 7, y = 7) {
    return spawnDungeonFeature(grid, x, y, catalogFeature(df)!, false);
}
const mask = (text: string): number => text.replace(/[()]/g, '').split('|').reduce((v, name) =>
    v | (name.trim() === '0' ? 0 : (flags as unknown as Record<string, number>)[name.trim()]!), 0);

describe('X4-R1 CE identities, field fidelity and explicit scope ledger', () => {
    it('preserves every CE field of the fifteen new terrain and their visuals', () => {
        for (const [name, expected] of Object.entries(golden.tiles)) {
            const tile = terrainForCE(name)!;
            const f = expected.fields;
            // Golden provenance is checked against the actual checked-in CE line.
            const line = ce.split('\n')[expected.ceLine - 1]!;
            expect(line).toContain(`/*${name}*/`);
            for (const field of f) expect(line).toContain(field);
            expect(flags.TERRAIN_FLAGS[tile]).toEqual({ flags: mask(f[10]!), mechFlags: mask(f[11]!),
                chanceToIgnite: Number(f[4]), fireType: f[5] === '0' ? '' : f[5],
                discoverType: f[6] === '0' ? '' : f[6], promoteType: f[7] === '0' ? '' : f[7],
                promoteChance: Number(f[8]), glowLight: LightKind[f[9] as keyof typeof LightKind], webOnly: false });
            expect(DRAW_PRIORITY[tile]).toBe(Number(f[3]));
            expect(TERRAIN_HOME_LAYER[tile]).toBe(name === 'HEALING_CLOUD' ? DungeonLayer.GAS : DungeonLayer.SURFACE);
            expect(TERRAIN_APPEARANCES[tile]).toEqual(expected.appearance);
            expect(TERRAIN_COLOR_NAMES[tile]).toEqual(expected.colors);
            expect(LIGHT_CATALOG[flags.TERRAIN_FLAGS[tile].glowLight]).toBeDefined();
        }
        expect(DRAW_PRIORITY[TerrainType.BLOODFLOWER_STALK]).toBe(10);
        expect(flags.TERRAIN_FLAGS[TerrainType.BLOODFLOWER_STALK]).toMatchObject({chanceToIgnite: 20, promoteChance: 100, promoteType: 'DF_BLOODFLOWER_PODS_GROW'});
    });

    it('uses actual CE IDs and complete fields for all nineteen new DFs', () => {
        const ids = Object.fromEntries(enumEntries('dungeonFeatureTypes'));
        for (const [name, expected] of Object.entries(golden.dfs)) {
            const id = DF[name as keyof typeof DF];
            expect(id).toBe(ids[name]);
            const f = expected.fields;
            const entry = DUNGEON_FEATURE_CATALOG[id]!;
            expect(entry).toEqual({ id, ceLine: expected.line, ceTile: f[0], tile: terrainForCE(f[0]!),
                layer: DungeonLayer[f[1] as keyof typeof DungeonLayer], startProbability: Number(f[2]), probabilityDecrement: Number(f[3]),
                flags: 0, cePropagationTerrain: '', propagationTerrain: null,
                subsequentDF: f[10] && f[10] !== '0' ? DF[f[10] as keyof typeof DF] : null,
                description: f[5] ? JSON.parse(f[5]) : '', lightFlare: f[6] && f[6] !== '0' ? f[6] : '', flashColor: '', effectRadius: 0 });
            const grid = floor();
            spawn(grid, id);
            expect(grid.getCell(7, 7)!.layers[entry.layer]).toBe(entry.tile);
            if (entry.layer === DungeonLayer.GAS) expect(grid.getCell(7, 7)!.volume).toBe(entry.startProbability);
        }
    });

    it('has no substituted DF tile or propagation carrier, and accounts for every absent CE enum', () => {
        const terrain = enumEntries('tileType').filter(([name]) => name !== 'NUMBER_TILETYPES');
        const dfs = enumEntries('dungeonFeatureTypes').filter(([name]) => name.startsWith('DF_'));
        const machines = enumEntries('machineTypes').filter(([name]) => name.startsWith('MT_') && name !== 'MT_NONE');
        const missingTerrain = terrain.filter(([name]) => terrainForCE(name) === undefined).map(([name]) => name);
        const missingDF = dfs.filter(([name]) => typeof DF[name as keyof typeof DF] !== 'number').map(([name]) => name);
        const missingMachines = machines.filter(([, id]) => !blueprints.some(b => b.ceBlueprintId === id)).map(([name]) => name);
        expect(missingTerrain.sort()).toEqual(Object.keys(CE_TERRAIN_GAPS).sort());
        expect(missingDF.sort()).toEqual(Object.keys(CE_DF_GAPS).sort());
        expect(missingMachines.sort()).toEqual(Object.keys(CE_MACHINE_GAPS).sort());
        expect([terrain.length, dfs.length, machines.length]).toEqual([215, 218, 72]);
        for (const entry of Object.values(DUNGEON_FEATURE_CATALOG)) {
            expect(entry.tile, DF[entry.id]).toBe(terrainForCE(entry.ceTile));
            if (entry.cePropagationTerrain) expect(entry.propagationTerrain).toBe(terrainForCE(entry.cePropagationTerrain));
            if (entry.subsequentDF !== null) expect(DUNGEON_FEATURE_CATALOG[entry.subsequentDF]).toBeDefined();
        }
        for (const tile of Object.values(flags.TERRAIN_FLAGS)) for (const name of [tile.fireType, tile.promoteType, tile.discoverType]) {
            if (name) expect(DUNGEON_FEATURE_CATALOG[DF[name as keyof typeof DF]], name).toBeDefined();
        }
        if (process.env.X4_R1_LEDGER === '1') {
            const rows = [
                '# X4-R1 CE 枚举 ↔ web 实体全账本', '',
                '本表登记实体身份与缺位范围；存在实体不等于所有 Game 消费点已接通。', '',
                '| 类别 | CE ID | CE 枚举 | web 实体 / 缺位原因 |', '|---|---:|---|---|',
                ...terrain.map(([name, id]) => `| 地形 | ${id} | ${name} | ${terrainForCE(name) === undefined ? CE_TERRAIN_GAPS[name] : TerrainType[terrainForCE(name)!]} |`),
                ...dfs.map(([name, id]) => `| DF | ${id} | ${name} | ${typeof DF[name as keyof typeof DF] === 'number' ? name : CE_DF_GAPS[name]} |`),
                ...machines.map(([name, id]) => `| 机器 | ${id} | ${name} | ${blueprints.find(b => b.ceBlueprintId === id)?.id ?? CE_MACHINE_GAPS[name]} |`), '',
            ];
            writeFileSync('ai_docs/reports/x4-r1-evidence/catalog-ledger.md', rows.join('\n'));
        }
    });
});

describe('X4-R1 bloodwort generation, growth, bursting and healing contract', () => {
    it('the real Game move command bursts an adjacent pod; healing gas survives a save round trip', () => {
        const game = createHeadlessGame(1719, 'test');
        for (let x = 1; x < game.grid.width - 1; x++) for (let y = 1; y < game.grid.height - 1; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR);
            game.grid.getCell(x, y)!.volume = 0;
        }
        game.monsters = []; game.dormantMonsters = []; game.items = []; game.purgatory = [];
        game.player.loc = {x: 10, y: 10}; game.animationEnabled = false;
        game.grid.setTerrainLayer(11, 10, DungeonLayer.SURFACE, TerrainType.BLOODFLOWER_POD);
        game.handlePlayerAction('move', {x: 1, y: 0}, 'system');
        expect(game.player.loc).toEqual({x: 10, y: 10}); // CE bump consumes a turn in place.
        expect(game.grid.getCell(11, 10)!.layers).not.toContain(TerrainType.BLOODFLOWER_POD);
        expect(cells(game.grid).some(cell => cell.layers.includes(TerrainType.HEALING_CLOUD) && cell.volume > 0)).toBe(true);
        const snapshot = JSON.parse(JSON.stringify(game.toSnapshot()));
        const before = cells(game.grid).map(cell => ({layers: [...cell.layers], volume: cell.volume}));
        expect(game.loadSnapshot(snapshot)).toBe(true);
        expect(cells(game.grid).map(cell => ({layers: [...cell.layers], volume: cell.volume}))).toEqual(before);
    });

    it('real natural generation produces stalks and pods; a grown pod bursts through the player bump path and supplies healing spores', () => {
        let found: Grid | undefined;
        for (let seed = 1; seed <= 24 && !found; seed++) {
            rng.seedRandomGenerator(seed);
            const architect = new Architect();
            const grid = architect.generateLevel(1);
            if (cells(grid).some(cell => cell.layers.includes(TerrainType.BLOODFLOWER_POD))) found = grid;
        }
        expect(found, 'Natural CE58 must create actual bloodwort pods').toBeDefined();
        const stalk = cells(found!).find(cell => cell.layers.includes(TerrainType.BLOODFLOWER_STALK))!;
        expect(stalk).toBeDefined();
        const grid = floor();
        grid.setTerrain(7, 7, TerrainType.BLOODFLOWER_STALK);
        rng.seedRandomGenerator(712);
        for (let turn = 0; turn < 4000 && !cells(grid).some(cell => cell.layers.includes(TerrainType.BLOODFLOWER_POD)); turn++) {
            runPromotionUpdate(grid, { keyOnTileAt: () => false });
        }
        expect(grid.getCell(7, 7)!.layers).toContain(TerrainType.BLOODFLOWER_STALK);
        const pod = cells(grid).find(cell => cell.layers.includes(TerrainType.BLOODFLOWER_POD))!;
        expect(pod, 'STALK promoteChance must grow POD without replacing STALK').toBeDefined();
        expect(promoteOnPlayerBump(grid, pod.x, pod.y)).toBe(true);
        expect(pod.layers).not.toContain(TerrainType.BLOODFLOWER_POD);
        expect(pod.layers[DungeonLayer.GAS]).toBe(TerrainType.HEALING_CLOUD);
        expect(pod.volume).toBe(350);
        expect(pod.isPassable).toBe(true);
        // R6 adapter contract: the gradual exposure call adds the returned HP.
        const actor = { hp: 5, maxHP: 30 };
        actor.hp += terrainHealingAmount(pod, actor.hp, actor.maxHP, 100);
        expect(actor.hp).toBe(7);
        expect(isGasTerrain(TerrainType.HEALING_CLOUD)).toBe(true);
        const env = new EnvironmentManager(grid);
        env.updateGases();
        expect(cells(grid).filter(cell => cell.layers.includes(TerrainType.HEALING_CLOUD)).length).toBeGreaterThan(1);
    });

    it('burning bursts a pod into healing gas; burning hay produces stench and ordinary fire', () => {
        const grid = floor();
        grid.setTerrain(7, 7, TerrainType.BLOODFLOWER_POD);
        expect(exposeTileToFire(grid, 7, 7, true).ignited).toBe(true);
        expect(grid.getCell(7, 7)!.layers[DungeonLayer.GAS]).toBe(TerrainType.HEALING_CLOUD);
        expect(grid.getCell(7, 7)!.layers[DungeonLayer.SURFACE]).toBe(TerrainType.NOTHING);
        grid.setTerrain(3, 3, TerrainType.HAY);
        expect(exposeTileToFire(grid, 3, 3, true).ignited).toBe(true);
        expect(grid.getCell(3, 3)!.layers[DungeonLayer.GAS]).toBe(TerrainType.STENCH_SMOKE_GAS);
        expect(grid.getCell(3, 3)!.volume).toBe(50);
        expect(grid.getCell(3, 3)!.layers[DungeonLayer.SURFACE]).toBe(TerrainType.PLAIN_FIRE);
    });

    it('healing retains CE integer order, minimum, cap and inanimate/submerged exclusions', () => {
        const grid = floor();
        const cell = grid.getCell(7, 7)!;
        expect(terrainHealingAmount(cell, 1, 44, 100)).toBe(0);
        spawn(grid, DF.DF_BLOODFLOWER_POD_BURST);
        // Literal CE oracle cases exercise both integer divisions and the minimum.
        for (const [maxHP, ticks, gain] of [[1, 100, 1], [14, 250, 1], [15, 50, 1], [29, 250, 2], [30, 250, 5], [44, 150, 3], [1000, 150, 99]]) {
            expect(terrainHealingAmount(cell, 0, maxHP!, ticks!)).toBe(gain);
        }
        expect(terrainHealingAmount(cell, 1, 44, 150)).toBe(3); // Not floor(44 * 150 / 1500) = 4.
        expect(terrainHealingAmount(cell, 43, 44, 100)).toBe(1);
        expect(terrainHealingAmount(cell, 44, 44, 100)).toBe(0);
        expect(terrainHealingAmount(cell, 1, 44, 100, true)).toBe(0);
        expect(terrainHealingAmount(cell, 1, 44, 100, false, true)).toBe(0);
    });
});

describe('X4-R1 lifetime, lights and localized text', () => {
    it('urine evaporates, guardian glow vanishes and burned carpet retains its own surface identity', () => {
        const grid = floor();
        spawn(grid, DF.DF_URINE);
        promoteTile(grid, 7, 7, DungeonLayer.SURFACE, false);
        expect(grid.getCell(7, 7)!.layers[DungeonLayer.SURFACE]).toBe(TerrainType.NOTHING);
        spawn(grid, DF.DF_GUARDIAN_STEP);
        runPromotionUpdate(grid, {keyOnTileAt: () => false});
        expect(grid.getCell(7, 7)!.layers[DungeonLayer.SURFACE]).toBe(TerrainType.NOTHING);
        spawn(grid, DF.DF_REMNANT);
        expect(grid.getCell(7, 7)!.layers[DungeonLayer.DUNGEON]).toBe(TerrainType.CARPET);
        expect(grid.getCell(7, 7)!.layers[DungeonLayer.SURFACE]).toBe(TerrainType.BURNED_CARPET);
    });

    it('independent fire identities have CE successors, light and burning membership', () => {
        for (const [tile, next] of [[TerrainType.FLAMEDANCER_FIRE, TerrainType.OBSIDIAN], [TerrainType.DART_EXPLOSION, TerrainType.NOTHING], [TerrainType.CREATURE_FIRE, TerrainType.EMBERS]] as const) {
            const grid = floor();
            grid.setTerrain(7, 7, tile);
            expect(FIRE_TERRAIN_TYPES).toContain(tile);
            expect(grid.getCell(7, 7)!.isBurning).toBe(true);
            promoteTile(grid, 7, 7, DungeonLayer.SURFACE, false);
            expect(grid.getCell(7, 7)!.layers[DungeonLayer.SURFACE]).toBe(next);
        }
        expect(flags.TERRAIN_FLAGS[TerrainType.DART_EXPLOSION].flags & flags.T_CAUSES_EXPLOSIVE_DAMAGE).toBe(0);
        expect(LIGHT_CATALOG[flags.TERRAIN_FLAGS[TerrainType.DART_EXPLOSION].glowLight]!.radius.lowerBound).toBe(1500);
        expect(flags.TERRAIN_FLAGS[TerrainType.UNICORN_POOP].glowLight).toBe(LightKind.UNICORN_POOP_LIGHT);
        expect(flags.TERRAIN_FLAGS[TerrainType.GUARDIAN_GLOW].glowLight).toBe(LightKind.GLYPH_LIGHT_BRIGHT);
    });

    it('new descriptions, flavor and two activation messages use i18next and Chinese resources', async () => {
        await i18next.init({lng:'zh_CN', resources:{zh_CN:{translation:zhCN}}});
        for (const name of [...Object.keys(golden.tiles), 'BLOODFLOWER_STALK']) for (const field of ['description','flavor'] as const) {
            expect(worldTerrainText(terrainForCE(name)!, field)).toMatch(/[\u4e00-\u9fff]/);
        }
        for (const id of [DF.DF_GUARDIAN_STEP, DF.DF_MIRROR_TOTEM_STEP]) expect(worldFeatureText(DUNGEON_FEATURE_CATALOG[id]!.description)).toMatch(/[\u4e00-\u9fff]/);
        expect(worldHealingText()).toBe('你感觉好多了。');
        i18next.addResource('zh_CN', 'translation', 'world.terrain.HAY.description', '译文覆盖');
        expect(worldTerrainText(TerrainType.HAY, 'description')).toBe('译文覆盖');
    });
});
