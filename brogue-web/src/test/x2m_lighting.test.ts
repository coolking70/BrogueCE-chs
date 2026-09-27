import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { createHeadlessGame } from './harness';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { LightKind, LIGHT_CATALOG } from '../engine/Map/LightCatalog';
import { rng, RNGType } from '../engine/Random';
import { sampleLight, cosmeticDraw } from '../engine/Lighting/CosmeticLight';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { visibleMonsterRows } from '../engine/UI/MonsterSidebar';
import { terrainAppearance, cellAppearance } from '../engine/UI/Appearance';
import { terrainRandomValues, tickTerrainColors, bakeTerrainColor } from '../engine/UI/DancingColors';
import { DUNGEON_FEATURE_CATALOG, DF } from '../engine/Map/DungeonFeatureCatalog';
import { spawnDungeonFeature, catalogFeature } from '../engine/Map/DungeonFeature';

function scene() {
    const g = createHeadlessGame(22013, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    for (let x = 1; x < g.grid.width - 1; x++) for (let y = 1; y < g.grid.height - 1; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        Object.assign(g.grid.getCell(x, y)!, { isExplored: false, hasMemory: false, rememberedLayers: [], rememberedItem: null });
    }
    g.player.loc = { x: 10, y: 10 };
    g.player.setStatusDuration('darkness', 100);
    g.player.maxStatus.darkness = 100;
    (g as any).updateVision();
    return g;
}
function mob(g: ReturnType<typeof scene>, id = 'rat', x = 14, y = 10) {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(d => d.id === id)!);
    m.ticksUntilTurn = 100000;
    g.monsters.push(m);
    return m;
}
const main = () => { const s = rng.getState(); return [s.streams[0], s.randomNumbersGenerated, s.currentRNG]; };

describe('X2m CE transient knowledge and presentation', () => {
    it('reveals dark FOV, shares sidebar gates, remembers items, restores base light/shadows and hides identity afterward', () => {
        const g = scene(), m = mob(g), cell = g.grid.getCell(m.x, m.y)!;
        const item = ItemLoader.spawnWand('wand_of_empowerment', m.x, m.y)!; g.items.push(item);
        const before = { ...g.lightMap.lightAt(m.x, m.y)! }, shadow = g.lightMap.inShadowAt(m.x, m.y), state = main();
        expect(cell.isVisible).toBe(false);
        expect(visibleMonsterRows(g.player, g.grid, g.monsters)).toHaveLength(0);
        g.createFlare(12, 10, LightKind.SCROLL_ENCHANTMENT_LIGHT); g.tickFlareAnimation(10);
        expect(cell.isVisible).toBe(true);
        expect(visibleMonsterRows(g.player, g.grid, g.monsters)).toHaveLength(1);
        m.setStatusDuration('invisible', 10);
        expect(visibleMonsterRows(g.player, g.grid, g.monsters)).toHaveLength(0);
        expect(cell.rememberedItem?.name).toBe(item.displayName);
        expect(g.lightMap.lightAt(m.x, m.y)).toEqual(before);
        expect(g.lightMap.inShadowAt(m.x, m.y)).toBe(shadow);
        g.tickFlareAnimation(10000);
        expect(cell.isVisible).toBe(false); expect(cell.isExplored && cell.hasMemory).toBe(true);
        expect(g.flareLightAt(m.x, m.y)).toBeNull(); expect(main()).toEqual(state);
    });

    it('does not reveal through a wall or cursed clairvoyance', () => {
        const g = scene();
        for (let y = 1; y < g.grid.height - 1; y++) g.grid.setTerrain(12, y, T.WALL);
        g.createFlare(15, 10, LightKind.EXPLOSION_FLARE_LIGHT); g.tickFlareAnimation(10);
        expect(g.grid.getCell(15, 10)!.isVisible).toBe(false);
        expect(g.grid.getCell(15, 10)!.hasMemory).toBe(false);
        g.tickFlareAnimation(10000);
        const ring = ItemLoader.spawnRing('ring_of_clairvoyance', -1, -1)!;
        ring.enchantment = -4; g.player.ringLeft = ring;
        g.createFlare(10, 10, LightKind.EXPLOSION_FLARE_LIGHT); g.tickFlareAnimation(10);
        expect(g.grid.getCell(11, 10)!.isVisible).toBe(false);
    });

    it('negative runic light can temporarily extinguish visibility without altering base channels', () => {
        const g = scene(); g.player.setStatusDuration('darkness', 0); (g as any).updateVision();
        const cell = g.grid.getCell(10, 10)!;
        const before = { ...g.lightMap.lightAt(10, 10)! };
        g.createFlare(10, 10, LightKind.QUIETUS_FLARE_LIGHT);
        g.createFlare(10, 10, LightKind.SLAYING_FLARE_LIGHT); g.tickFlareAnimation(10);
        expect(cell.isVisible).toBe(false);
        g.tickFlareAnimation(10000); expect(cell.isVisible).toBe(true);
        expect(g.lightMap.lightAt(10, 10)).toEqual(before);
    });

    it('skipped frames, fine playback and save during playback preserve identical knowledge and both RNG states', () => {
        const run = (fine: boolean) => {
            const g = scene(); g.createFlare(14, 10, LightKind.SUMMONING_FLASH_LIGHT);
            if (fine) for (let i = 0; i < 100; i++) g.tickFlareAnimation(10);
            else g.tickFlareAnimation(1000);
            const s = g.toSnapshot(); s.savedAt = 0; return { grid: s.grid, rng: rng.getState() };
        };
        expect(run(true)).toEqual(run(false));
        const g = scene(); g.createFlare(14, 10, LightKind.GENERIC_FLASH_LIGHT); g.tickFlareAnimation(10);
        const saved = g.toSnapshot();
        expect(saved.grid.find(c => c.x === 14 && c.y === 10)).toMatchObject({ isVisible: false, hasMemory: true });
        expect(g.loadSnapshot(saved)).toBe(true); expect(g.flareLightAt(14, 10)).toBeNull();
    });

    it('expires stale turn entries and discards light across level travel', () => {
        const g = scene(); g.absoluteTurnNumber = 10;
        g.createFlare(10, 10, LightKind.GENERIC_FLASH_LIGHT); g.absoluteTurnNumber = 12;
        g.tickFlareAnimation(10); expect(g.flareLightAt(10, 10)).toBeNull();
        g.createFlare(10, 10, LightKind.GENERIC_FLASH_LIGHT); g.tickFlareAnimation(10);
        g.depth = 2; (g as any).generateDepth(false);
        expect(g.flareLightAt(10, 10)).toBeNull(); expect(g.tickFlareAnimation(10)).toBe(false);
    });
});

describe('X2m real sources and CE catalog', () => {
    it.each([false, true])('empowerment actually casts on hidden=%s; light has no identity-observation gate', hidden => {
        const g = scene(), m = mob(g);
        if (hidden) m.setStatusDuration('invisible', 20);
        const r = g.zapBoltFromPlayer(getBoltForItem('wand_of_empowerment')!, ItemLoader.spawnWand('wand_of_empowerment', -1, -1)!, m.loc);
        expect(m.totalPowerCount).toBe(1); expect(r.outcome?.autoID).toBe(false);
        expect((g as any).activeFlares.some((f: any) => f.kind === LightKind.EMPOWERMENT_LIGHT)).toBe(true);
        g.tickFlareAnimation(10); expect(g.visualLightAt(m.x, m.y)!.g).toBeGreaterThan(0);
        expect(visibleMonsterRows(g.player, g.grid, g.monsters)).toHaveLength(hidden ? 0 : 1);
    });

    it('summoning uses random-only CE color and remains neutral to substantive RNG during animation', () => {
        const g = scene(), m = mob(g, 'goblin_conjurer');
        expect(g.summonMinionsFor(m)).toBe(true);
        const before = main(); g.tickFlareAnimation(10);
        const light = g.flareLightAt(m.x, m.y)!;
        expect(light.r + light.b).toBeGreaterThan(0); expect(main()).toEqual(before);
    });

    it('real falling move creates the landing flare on the destination level', () => {
        const g = scene(); g.grid.setTerrain(11, 10, T.CHASM);
        g.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(g.depth).toBe(2);
        expect((g as any).activeFlares).toContainEqual({ x: g.player.x, y: g.player.y,
            kind: LightKind.GENERIC_FLASH_LIGHT, coeff: 100000, change: -15 });
        g.tickFlareAnimation(10); expect(g.flareLightAt(g.player.x, g.player.y)!.r).toBeGreaterThan(0);
    });

    it.each(['speed', 'quietus', 'slaying'])('real %s runic dispatcher queues CE flare and respects submersion', runic => {
        const g = scene(), m = mob(g), weapon = g.player.equippedWeapon!;
        expect(weapon).toBeTruthy(); (g as any).applyWeaponRunicEffect(m, 1, runic);
        expect((g as any).activeFlares).toHaveLength(1);
        const h = scene(), submerged = mob(h); submerged.submerged = true;
        (h as any).applyWeaponRunicEffect(submerged, 1, runic);
        expect((h as any).activeFlares).toHaveLength(0);
    });

    it('checks every DF flare symbol against its CE source row and executes explosion DF', () => {
        const lines = fs.readFileSync('../BrogueCE-master/src/brogue/Globals.c', 'utf8').split('\n');
        let checked = 0;
        for (const feature of Object.values(DUNGEON_FEATURE_CATALOG)) {
            const row = lines[feature.ceLine - 1]!;
            // Strip quoted text before splitting (descriptions may contain commas).
            const fields = row.replace(/"(?:\\.|[^"\\])*"/g, '""').split(',');
            const flare = fields[6]?.trim().replace(/}.*/, '') ?? '0';
            if (feature.lightFlare || flare.endsWith('_LIGHT')) {
                expect(feature.lightFlare, `${feature.id} CE:${feature.ceLine}`).toBe(flare);
                checked++;
            }
        }
        expect(checked).toBeGreaterThan(20);
        const g = scene(); (g as any).bindDungeonFeatureEffects();
        spawnDungeonFeature(g.grid, 16, 10, catalogFeature(DF.DF_BLOAT_EXPLOSION), false);
        expect((g as any).activeFlares.some((f: any) => f.kind === LightKind.EXPLOSION_FLARE_LIGHT)).toBe(true);
        g.tickFlareAnimation(10); expect(g.grid.getCell(16, 10)!.isVisible).toBe(true);
    });
});

describe('X2m cosmetic colors', () => {
    it('confusion gas consumes its background random channels and preserves the terrain glyph', () => {
        const g = scene(), cell = g.grid.getCell(11, 10)!;
        g.grid.setTerrainLayer(11, 10, L.GAS, T.CONFUSION_GAS); cell.volume = 60; cell.isVisible = true;
        const draw = (value: number) => cellAppearance(cell, { gas: undefined, lightChannels: { r: 100, g: 100, b: 100 },
            groundItem: null, carriedItem: null, hallucinating: false, cosmetic: { percent: () => false, pick: list => list[0]! },
            terrainRandomValues: Array(8).fill(value) })!;
        const low = draw(0), high = draw(1000);
        expect(low.char).toBe(terrainAppearance(T.FLOOR, true).char);
        expect(high.char).toBe(low.char); expect(high.bgColor!).toBeGreaterThan(low.bgColor!);
    });

    it('bakes separate fore/back random channels with CE integer arithmetic', () => {
        const vals = [1000, 500, 0, 0, 500, 1000, 250, 750];
        // Globals.c fireForeColor {70,20,0,15,10,0,0,true}.
        expect(bakeTerrainColor('fireForeColor', 1, vals, false)).toBe('#d83f00');
        expect(bakeTerrainColor('fireForeColor', 1, vals, true)).toBe('#b23f00');
        const field = terrainAppearance(T.FORCEFIELD, true, 1, vals);
        expect(field.char).toBe('#'); expect(field.color).not.toBe('#000000');
    });

    it('keeps terrain samples stable between renders, dances only visible dancers, never draws main RNG', () => {
        const g = scene(), cell = g.grid.getCell(11, 10)!;
        g.grid.setTerrainLayer(11, 10, L.SURFACE, T.PLAIN_FIRE); cell.isVisible = true;
        const state = main(), initial = [...terrainRandomValues(cell)!];
        expect(terrainRandomValues(cell)).toEqual(initial);
        for (let i = 0; i < 300; i++) tickTerrainColors(g.grid, 50, 1);
        expect(terrainRandomValues(cell)).not.toEqual(initial);
        const held = [...terrainRandomValues(cell)!]; cell.isVisible = false;
        for (let i = 0; i < 100; i++) tickTerrainColors(g.grid, 50, 1);
        expect(terrainRandomValues(cell)).toBeUndefined(); cell.isVisible = true;
        expect(terrainRandomValues(cell)).toEqual(held); expect(main()).toEqual(state);
    });

    it('samples light color/radius and preserves stream selection even on exceptions; base light never dances', () => {
        const g = scene(), state = main(), base = { ...g.lightMap.lightAt(10, 10)! };
        const draws = Array.from({ length: 10 }, () => sampleLight(LIGHT_CATALOG[LightKind.SUMMONING_FLASH_LIGHT]!));
        expect(new Set(draws.map(d => d.color.red)).size).toBeGreaterThan(1);
        g.lightMap.dance(); expect(g.lightMap.lightAt(10, 10)).toEqual(base); expect(main()).toEqual(state);
        rng.setRNG(RNGType.RNG_COSMETIC);
        expect(() => cosmeticDraw(() => { throw new Error('probe'); })).toThrow('probe');
        expect(rng.getState().currentRNG).toBe(RNGType.RNG_COSMETIC);
        rng.setRNG(RNGType.RNG_SUBSTANTIVE);
    });

    it('idle render color draws do not move either recorded RNG stream or later flare knowledge', () => {
        const run = (idle: boolean) => {
            const g = scene(); g.grid.setTerrainLayer(11, 10, L.SURFACE, T.PLAIN_FIRE);
            (g as any).updateVision();
            const before = rng.getState();
            if (idle) for (let i = 0; i < 20; i++) {
                terrainRandomValues(g.grid.getCell(11, 10)!, g.grid);
                tickTerrainColors(g.grid, 50, 1); g.lightMap.dance();
            }
            expect(rng.getState()).toEqual(before);
            g.createFlare(14, 10, LightKind.SUMMONING_FLASH_LIGHT); g.tickFlareAnimation(1000);
            return { grid: g.toSnapshot().grid, rng: rng.getState() };
        };
        expect(run(true)).toEqual(run(false));
    });
});
