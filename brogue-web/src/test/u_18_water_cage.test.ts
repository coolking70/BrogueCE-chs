import { describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { TerrainType as T } from '../engine/Map/Grid';
import { Item, ItemCategory } from '../engine/Items/Item';
import { rng } from '../engine/Random';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';

const item = (name: string) => new Item(name, '!', 0xffffff, ItemCategory.POTION);

describe('U18 CE deep water consumers', () => {
    it('allows a player to step into deep water without a hazard confirmation or damage', () => {
        const g = createHeadlessGame(17, 'test');
        g.monsters.length = 0; g.items.length = 0;
        g.player.inventory.items.length = 0;
        g.player.loc = { x: 8, y: 8 };
        g.grid.setTerrain(8, 8, T.FLOOR);
        g.grid.setTerrain(9, 8, T.WATER_DEEP);
        const hp = g.player.hp;
        g.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(g.player.loc).toEqual({ x: 9, y: 8 });
        expect(g.player.hp).toBe(hp);
        expect(g.isGameOver).toBe(false);
    });

    it('sweeps only unequipped pack items onto the player cell, and persists the result', () => {
        const g = createHeadlessGame(18, 'test');
        g.player.loc = { x: 8, y: 8 };
        g.grid.setTerrain(8, 8, T.WATER_DEEP);
        g.items.length = 0;
        g.player.inventory.items.length = 0;
        const armor = new Item('armor', '[', 0xffffff, ItemCategory.ARMOR);
        const potion = item('potion');
        g.player.inventory.addItem(armor);
        g.player.inventory.addItem(potion);
        g.player.equippedArmor = armor;
        const chance = vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        const select = vi.spyOn(rng, 'randRange').mockReturnValue(0);
        try {
            (g as any).sweepDeepWaterItem(g.player, 100);
            expect(chance).toHaveBeenCalledWith(50);
            expect(g.player.inventory.items).toEqual([armor]);
            expect(g.items).toContain(potion);
            expect(potion.loc).toEqual({ x: 8, y: 8 });
            chance.mockRestore(); select.mockRestore();
            expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);
            expect(g.player.inventory.items.map(i => i.name)).toEqual(['armor']);
            expect(g.items.some(i => i.name === 'potion' && i.x === 8 && i.y === 8)).toBe(true);
        } finally { chance.mockRestore(); select.mockRestore(); }
    });

    it('an occupied floor cell suppresses the water roll', () => {
        const g = createHeadlessGame(19, 'test');
        g.player.loc = { x: 8, y: 8 };
        g.grid.setTerrain(8, 8, T.WATER_DEEP);
        g.items.length = 0;
        const floor = item('floor'); floor.loc = { x: 8, y: 8 }; g.items.push(floor);
        const chance = vi.spyOn(rng, 'randPercent');
        try {
            (g as any).sweepDeepWaterItem(g.player, 100);
            expect(chance).not.toHaveBeenCalled();
        } finally { chance.mockRestore(); }
    });

    it('ordinary monsters avoid entering water, while aquatic monsters stay in submergible terrain', () => {
        const g = createHeadlessGame(20, 'test');
        g.grid.setTerrain(9, 8, T.WATER_DEEP);
        g.grid.setTerrain(10, 8, T.FLOOR);
        const rows = monsters as MonsterData[];
        const rat = new Monster(8, 8, rows.find(row => row.id === 'rat')!);
        const eel = new Monster(9, 8, rows.find(row => row.behaviorFlags?.includes('MONST_RESTRICTED_TO_LIQUID'))!);
        expect((rat as any).canEnterWaterTerrain(g, 9, 8)).toBe(false);
        expect((eel as any).canEnterWaterTerrain(g, 10, 8)).toBe(false);
    });

    it('moves a dropped item to an adjacent eligible cell during the environment update', () => {
        const g = createHeadlessGame(21, 'test');
        g.items.length = 0;
        g.grid.setTerrain(8, 8, T.WATER_DEEP);
        const swept = item('swept'); swept.loc = { x: 8, y: 8 }; g.items.push(swept);
        const before = { ...swept.loc };
        (g as any).driftFloorItems();
        expect(Math.max(Math.abs(swept.x - before.x), Math.abs(swept.y - before.y))).toBe(1);
        expect(g.items).toContain(swept);
    });

    it('key rescue reaches the same relation state as the magic rescue helper', () => {
        const rows = monsters as MonsterData[];
        const make = (seed: number) => {
            const g = createHeadlessGame(seed, 'test');
            g.monsters.length = 0; g.items.length = 0;
            g.player.loc = { x: 8, y: 8 };
            g.grid.setTerrain(8, 8, T.FLOOR);
            g.grid.setTerrain(9, 8, T.MONSTER_CAGE_CLOSED);
            g.grid.setTerrain(10, 8, T.FLOOR);
            const captive = new Monster(10, 8, rows.find(row => row.id === 'rat')!);
            captive.isCaged = true;
            g.monsters.push(captive);
            return { g, captive };
        };
        const keyRoute = make(22), magicRoute = make(23);
        const key = new Item('key', '-', 0xffffff, ItemCategory.KEY);
        key.originDepth = keyRoute.g.depth;
        key.keyLoc = [{ loc: { x: 9, y: 8 }, machine: 0, disposableHere: false }];
        keyRoute.g.player.inventory.addItem(key);
        keyRoute.g.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        magicRoute.g.freeCaptive(magicRoute.captive);
        const state = (m: Monster) => ({ caged: m.isCaged, ally: m.isAlly, leader: m.leader,
            carried: m.carriedItem, seized: m.seized, state: m.state });
        expect(state(keyRoute.captive)).toEqual(state(magicRoute.captive));
    });
});
