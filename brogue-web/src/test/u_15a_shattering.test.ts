import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game, type GameSnapshot } from '../engine/Core/Game';
import { DungeonLayer as L, TerrainType as T } from '../engine/Map/Grid';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, type MonsterData } from '../entities/Monster';
import monsterData from '../data/monsters.json';
import { cellTerrainFlags, setDormantAwakener } from '../engine/Map/DungeonFeature';
import { T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_VISION } from '../engine/Map/TerrainCatalog';
import { cellAppearance, type CellAppearanceContext } from '../engine/UI/Appearance';
import { DCOLS, DROWS } from '../types';
import { rng } from '../engine/Random';

type Crystalize = { crystalizeFromPlayer(radius: number): void; updateVision(): void };
const internal = (g: Game) => g as unknown as Crystalize;
const protect = (g: Game, x: number, y: number) => g.grid.impregnableCells.add(y * DCOLS + x);
const cell = (g: Game, x = 7, y = 5) => g.grid.getCell(x, y)!;
const appearanceContext: CellAppearanceContext = {
    gas: undefined, lightChannels: null, groundItem: null, carriedItem: null,
    hallucinating: false, cosmetic: { percent: () => false, pick: <T>(xs: readonly T[]) => xs[0]! },
};

function scene(): Game {
    const g = createHeadlessGame(15015, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.grid.impregnableCells.clear();
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        Object.assign(cell(g, x, y), { hasDormantMonster: false, machineNumber: 0, isPowered: false });
    }
    g.player.loc = { x: 5, y: 5 };
    g.player.inventory.items = [];
    g.animationEnabled = false;
    return g;
}
function monster(g: Game, x = 7, y = 5, id = 'goblin'): Monster {
    const m = new Monster(x, y, (monsterData as MonsterData[]).find(d => d.id === id)!);
    m.ticksUntilTurn = 10000;
    g.monsters.push(m);
    return m;
}
function giveScroll(g: Game) {
    const s = ItemLoader.spawnScroll('scroll_of_shattering', -1, -1)!;
    expect(g.player.inventory.addItem(s)).toBe(true);
    return s;
}
afterEach(() => vi.restoreAllMocks());

describe('U15a IMPREGNABLE is an outer gate for every crystalize side effect', () => {
    it.each([T.WALL, T.LOCKED_DOOR, T.PORTCULLIS_CLOSED, T.STATUE_DORMANT, T.CRYSTAL_WALL, T.FLOOR])(
        'protected %s preserves every layer, cell field, appearance and dormant occupant', terrain => {
            const g = scene();
            // Isolate spell mutation from global FOV refresh and objective-time gas updates.
            vi.spyOn(internal(g), 'updateVision').mockImplementation(() => {});
            g.grid.setTerrainLayer(7, 5, L.DUNGEON, terrain);
            g.grid.setTerrainLayer(7, 5, L.LIQUID, T.WATER_DEEP);
            g.grid.setTerrainLayer(7, 5, L.SURFACE, T.SACRED_GLYPH);
            g.grid.setTerrainLayer(7, 5, L.GAS, T.POISON_GAS);
            Object.assign(cell(g), { volume: 80, machineNumber: 17, isPowered: true,
                hasDormantMonster: true, isDiscovered: true, autoSearched: true,
                trapType: 'poison_gas', exposedToFire: 7, isVisible: true, hasMemory: true,
                char: '#', color: 0x123456 });
            protect(g, 7, 5);
            const m = monster(g); m.isCaged = true;
            const awake = vi.fn(); setDormantAwakener(g.grid, awake);
            const before = JSON.parse(JSON.stringify(cell(g))), looks = cellAppearance(cell(g), appearanceContext);
            const count = rng.randomNumbersGenerated;
            internal(g).crystalizeFromPlayer(9);
            expect(cell(g)).toEqual(expect.objectContaining(before));
            expect(JSON.parse(JSON.stringify(cell(g)))).toEqual(before);
            expect(cellAppearance(cell(g), appearanceContext)).toEqual(looks);
            expect(g.grid.impregnableCells).toEqual(new Set([5 * DCOLS + 7]));
            expect(m.isCaged).toBe(true); expect(m.isAlly).toBe(false);
            expect(awake).not.toHaveBeenCalled(); expect(rng.randomNumbersGenerated).toBe(count);
        });

    it.each([[0, 5], [DCOLS - 1, 5], [5, 0], [5, DROWS - 1]])(
        'protected boundary (%s,%s) survives; neighboring unprotected boundary still crystallizes', (x, y) => {
            const g = scene(); g.player.loc = { x: Math.max(1, Math.min(x, DCOLS - 2)), y: Math.max(1, Math.min(y, DROWS - 2)) };
            const nx = x === 0 || x === DCOLS - 1 ? x : x + 1;
            const ny = y === 0 || y === DROWS - 1 ? y : y + 1;
            g.grid.setTerrain(x, y, T.WALL); g.grid.setTerrain(nx, ny, T.WALL); protect(g, x, y);
            internal(g).crystalizeFromPlayer(9);
            expect(cell(g, x, y).layers[L.DUNGEON]).toBe(T.WALL);
            expect(cell(g, x, y).layers[L.SURFACE]).toBe(T.NOTHING);
            expect(cell(g, nx, ny).layers[L.DUNGEON]).toBe(T.CRYSTAL_WALL);
            expect(cell(g, nx, ny).layers[L.SURFACE]).toBe(T.RUBBLE);
        });

    it.each(['MONST_ATTACKABLE_THRU_WALLS', 'MONST_TURRET'])(
        '%s dies through shielding only on the unprotected obstructing cell', flag => {
            const g = scene(); const alive = monster(g), doomed = monster(g, 8);
            for (const m of [alive, doomed]) {
                m.behaviorFlags.add(flag); m.setStatusDuration('shielded', 1000); m.maxShield = 1000;
                g.grid.setTerrain(m.x, m.y, T.WALL);
            }
            protect(g, 7, 5); const hp = alive.hp;
            internal(g).crystalizeFromPlayer(9);
            expect(alive.hp).toBe(hp); expect(doomed.hp).toBe(0);
            expect(alive.getStatusDuration('shielded')).toBe(1000);
        });

    it('DF awakens the unprotected dormant turret before lethal handling; protected one sleeps', () => {
        const g = scene(); const asleep = monster(g), doomed = monster(g, 8);
        for (const m of [asleep, doomed]) {
            m.behaviorFlags.add('MONST_TURRET');
            g.grid.setTerrain(m.x, m.y, T.STATUE_DORMANT);
            g.toggleMonsterDormancy(m);
        }
        protect(g, 7, 5);
        internal(g).crystalizeFromPlayer(9);
        expect(g.dormantMonsters).toEqual([asleep]); expect(asleep.hp).toBeGreaterThan(0);
        expect(cell(g).hasDormantMonster).toBe(true);
        expect(g.monsters).toContain(doomed); expect(doomed.hp).toBe(0);
        expect(cell(g, 8).hasDormantMonster).toBe(false);
        expect(cell(g, 8).layers[L.SURFACE]).toBe(T.RUBBLE);
    });

    it('frees an embedded captive after rubble; a protected captive stays captive', () => {
        const g = scene(); const captive = monster(g), freed = monster(g, 8);
        for (const m of [captive, freed]) { m.isCaged = true; g.grid.setTerrain(m.x, m.y, T.WALL); }
        protect(g, 7, 5);
        const original = g.freeCaptive.bind(g);
        const release = vi.spyOn(g, 'freeCaptive').mockImplementation(m => {
            expect(cell(g, m.x, m.y).layers[L.SURFACE]).toBe(T.RUBBLE);
            original(m);
        });
        internal(g).crystalizeFromPlayer(9);
        expect(release).toHaveBeenCalledExactlyOnceWith(freed);
        expect(freed.isAlly).toBe(true); expect(freed.isCaged).toBe(false);
        expect(captive.isCaged).toBe(true); expect(captive.isAlly).toBe(false);
    });

    it('only DUNGEON obstruction within Euclidean radius qualifies, regardless of visibility', () => {
        const g = scene();
        g.grid.setTerrainLayer(7, 5, L.SURFACE, T.WALL); // blocking upper layer alone is insufficient.
        g.grid.setTerrain(14, 5, T.WALL); // distance exactly 9, behind other walls.
        g.grid.setTerrain(14, 6, T.WALL); // 82 > 81.
        g.grid.setTerrain(10, 5, T.DOOR);
        g.grid.setTerrainLayer(10, 5, L.SURFACE, T.SACRED_GLYPH);
        cell(g, 14, 5).isVisible = false;
        internal(g).crystalizeFromPlayer(9);
        expect(cell(g).layers[L.DUNGEON]).toBe(T.FLOOR);
        expect(cell(g).layers[L.SURFACE]).toBe(T.WALL);
        expect(cell(g, 14, 5).layers[L.DUNGEON]).toBe(T.FORCEFIELD);
        expect(cell(g, 14, 6).layers[L.DUNGEON]).toBe(T.WALL);
        expect(cell(g, 10, 5).layers[L.DUNGEON]).toBe(T.FORCEFIELD);
        expect(cell(g, 10, 5).layers[L.SURFACE]).toBe(T.SACRED_GLYPH);
        expect(cell(g, 10, 5).isPassable).toBe(false); // glyph must not mask forcefield.
    });

    it('retained upper blocking layer continues to obstruct vision and movement', () => {
        const g = scene(); g.grid.setTerrain(7, 5, T.WALL);
        g.grid.setTerrainLayer(7, 5, L.SURFACE, T.WALL);
        internal(g).crystalizeFromPlayer(9);
        expect(cell(g).layers[L.DUNGEON]).toBe(T.FORCEFIELD);
        expect(cell(g).layers[L.SURFACE]).toBe(T.WALL);
        expect(cell(g).layers[L.LIQUID]).toBe(T.NOTHING);
        expect(cell(g).layers[L.GAS]).toBe(T.NOTHING);
        expect(cellTerrainFlags(g.grid, 7, 5) & (T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION)).toBeTruthy();
        expect(cell(g).isPassable).toBe(false); expect(cell(g).isOpaque).toBe(true);
    });
});

describe('U15a real inventory read + U01 v2 JSON round trip', () => {
    it.each([false, true])('protected machine and ordinary wall behave identically after reload=%s', reload => {
        let g = scene();
        g.grid.setTerrain(7, 5, T.LOCKED_DOOR, '+', 0xabcdef); protect(g, 7, 5);
        cell(g).machineNumber = 17;
        g.grid.setTerrain(8, 5, T.WALL);
        const trapped = monster(g); trapped.isCaged = true;
        const doomed = monster(g, 8); doomed.behaviorFlags.add('MONST_TURRET');
        doomed.setStatusDuration('shielded', 1000); doomed.maxShield = 1000;
        giveScroll(g);
        if (reload) {
            const snapshot = JSON.parse(JSON.stringify(g.toSnapshot())) as GameSnapshot;
            expect(snapshot.version).toBe(2);
            expect(snapshot.impregnableCells).toEqual([5 * DCOLS + 7]);
            g = createHeadlessGame(15151, 'test');
            g.loadSnapshot(snapshot);
        }
        const before = { layers: [...cell(g).layers], machine: cell(g).machineNumber, char: cell(g).char, color: cell(g).color };
        const scroll = g.player.inventory.items[0]!;
        const turns = g.stats.turns;
        g.readItem(scroll);
        expect(g.player.inventory.items).not.toContain(scroll);
        expect(ItemLoader.identifiedItems.has('scroll_of_shattering')).toBe(true);
        expect(g.stats.turns).toBe(turns + 1);
        expect({ layers: cell(g).layers, machine: cell(g).machineNumber, char: cell(g).char, color: cell(g).color }).toEqual(before);
        expect(g.grid.isImpregnable(7, 5)).toBe(true);
        expect(g.getMonsterAt(7, 5)?.isCaged).toBe(true);
        expect(g.getMonsterAt(8, 5)).toBeUndefined();
        expect(cell(g, 8).layers[L.DUNGEON]).toBe(T.FORCEFIELD);
        expect(cell(g, 8).layers[L.SURFACE]).toBe(T.RUBBLE);
    });
});
