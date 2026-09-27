import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { rng } from '../engine/Random';

afterEach(() => vi.restoreAllMocks());

function scene() {
    const g = createHeadlessGame(621, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        g.grid.getCell(x, y)!.isVisible = true;
    }
    g.player.loc = { x: 4, y: 5 };
    g.player.hp = 1;
    g.spawnFloatingText = vi.fn();
    const guardian = new Monster(8, 5, (monsters as MonsterData[]).find(m => m.id === 'stone_guardian')!);
    guardian.hp = guardian.maxHp = 100;
    g.monsters.push(guardian);
    return g;
}

describe('X2l player bolt reflected to its caster', () => {
    it.each([
        ['staff_of_fire', 'flame'],
        ['staff_of_lightning', 'lightning'],
    ])('%s ends on fatal contact with CE attribution', (id, boltName) => {
        const g = scene();
        const behind = new Monster(2, 5, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        behind.hp = behind.maxHp = 100;
        g.monsters.push(behind);
        g.grid.setTerrainLayer(4, 5, L.SURFACE, T.GRASS);
        const item = ItemLoader.spawnStaff(id, -1, -1)!;
        item.enchantment = 2;
        vi.spyOn(rng, 'randClumpedRange').mockReturnValue(20);
        const result = g.zapBoltFromPlayer(getBoltForItem(id)!, item, { x: 8, y: 5 });

        expect(result.reflections).toHaveLength(1);
        expect(result.hits.map(hit => hit.creature)).toEqual([g.player]);
        expect(result.landingPos).toEqual(g.player.loc);
        expect(g.player.hp).toBe(0);
        expect(behind.hp).toBe(100);
        expect(g.grid.getCell(4, 5)!.layers[L.SURFACE]).toBe(T.GRASS);
        expect(g.isGameOver).toBe(true);
        expect(g.gameOverReason).toBe(`Killed by a reflected ${boltName} on depth 1.`);
        expect(g.gameOverScore).toBeGreaterThanOrEqual(0);
    });
});
