import { describe, expect, it, vi } from 'vitest';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { createHeadlessGame } from './harness';
import { catalogFeature, spawnDungeonFeature } from '../engine/Map/DungeonFeature';
import { DF } from '../engine/Map/DungeonFeatureCatalog';
import { DFF_RESURRECT_ALLY } from '../engine/Map/DungeonFeatureCatalog';
import { DungeonLayer, TerrainType } from '../engine/Map/Grid';
import { promoteTile } from '../engine/Map/Promotion';
import { Item, ItemCategory } from '../engine/Items/Item';

const species = (id: string) => (monsters as MonsterData[]).find(m => m.id === id)!;
const monster = (id: string, x: number, y: number) => new Monster(x, y, species(id));
const altarFeature = () => ({ ...catalogFeature(DF.DF_ALTAR_INERT), flags: DFF_RESURRECT_ALLY });

describe('U16 CE death and resurrection lifecycle', () => {
    it('releases a carried monster before leadership election, once, at 200 ticks', () => {
        const g = createHeadlessGame(1601, 'test');
        g.monsters = [];
        const host = monster('rat', 12, 8), passenger = monster('vampire', 2, 2);
        const follower = monster('rat', 13, 8);
        host.carriedMonster = passenger;
        follower.leader = host;
        g.monsters.push(host, follower);
        vi.spyOn(g as any, 'applyDisplacementTileEntry').mockImplementation(() => {});
        vi.spyOn(g as any, 'applyEnvironmentalEffects').mockImplementation(() => {});
        host.hp = 0;
        (g as any).removeDeadMonsters();
        expect(g.monsters).toContain(passenger);
        expect(g.monsters).not.toContain(host);
        expect(passenger.loc).toEqual({ x: 12, y: 8 });
        expect(passenger.ticksUntilTurn).toBe(200);
        expect(host.carriedMonster).toBeNull();
        expect(follower.leader).toBeNull();
        (g as any).removeDeadMonsters();
        expect(g.monsters.filter(m => m === passenger)).toHaveLength(1);
    });

    it('stores an entering summoner in the final new host and elects followers across floors', () => {
        const g = createHeadlessGame(1604, 'test');
        g.monsters = [];
        const summoner = monster('vampire', 20, 10);
        g.monsters.push(summoner);
        expect(g.summonMinionsFor(summoner)).toBe(true);
        expect(g.monsters).not.toContain(summoner);
        expect(g.monsters.filter(m => m.carriedMonster === summoner)).toHaveLength(1);

        const leader = monster('rat', 25, 10), local = monster('rat', 26, 10);
        const remote = monster('rat', 27, 10);
        leader.isAlly = local.isAlly = remote.isAlly = true;
        g.monsters = [leader, local];
        local.leader = remote.leader = leader;
        (g as any).levels = new Map([[2, { monsters: [remote], dormantMonsters: [] }]]);
        leader.hp = 0;
        (g as any).removeDeadMonsters();
        expect(local.leader).toBeNull();
        expect(local.leaderlessAfterDemotion).toBe(true);
        expect(remote.leader).toBe(local);
        local.hp = 0;
        (g as any).removeDeadMonsters();
        expect(g.purgatory).toContain(leader);
        expect(g.purgatory).not.toContain(local);
    });

    it('drops carried equipment once into an unoccupied item cell', () => {
        const g = createHeadlessGame(1605, 'test');
        g.monsters = [];
        const host = monster('rat', 20, 10);
        const existing = new Item('old', '?', 0xffffff, ItemCategory.KEY);
        const carried = new Item('carried', '?', 0xffffff, ItemCategory.KEY);
        existing.loc = { ...host.loc };
        host.carriedItem = carried;
        g.items = [existing];
        g.monsters.push(host);
        host.hp = 0;
        (g as any).removeDeadMonsters();
        expect(g.items.filter(i => i === carried)).toHaveLength(1);
        expect(carried.loc).not.toEqual(existing.loc);
        expect(host.carriedItem).toBeNull();
    });

    it('keeps eligible allies across a whole-run save and resurrects the strongest through the DF', () => {
        const g = createHeadlessGame(1602, 'test');
        g.monsters = [];
        const weak = monster('rat', 12, 8), strong = monster('goblin', 14, 8);
        weak.isAlly = strong.isAlly = true;
        weak.totalPowerCount = 1;
        strong.totalPowerCount = 3;
        weak.hp = strong.hp = 0;
        g.monsters.push(weak, strong);
        (g as any).removeDeadMonsters();
        expect(g.purgatory).toHaveLength(2);
        const saved = JSON.parse(JSON.stringify(g.toSnapshot()));
        expect(g.loadSnapshot(saved)).toBe(true);
        const raised = g.purgatory.find(m => m.typeId === 'goblin')!;
        g.grid.setTerrain(20, 10, TerrainType.RESURRECTION_ALTAR);
        expect(promoteTile(g.grid, 20, 10, DungeonLayer.DUNGEON, false).spawn?.succeeded).toBe(true);
        expect(g.grid.getCell(20, 10)?.terrain).toBe(TerrainType.RESURRECTION_ALTAR_INERT);
        expect(g.monsters).toContain(raised);
        expect(raised.hp).toBe(raised.maxHp);
        expect(g.purgatory).toHaveLength(1);
        expect(g.purgatory[0]!.typeId).toBe('rat');
        expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);
    });

    it('leaves the altar unchanged when purgatory is empty', () => {
        const g = createHeadlessGame(1603, 'test');
        g.purgatory = [];
        g.grid.setTerrain(20, 10, TerrainType.RESURRECTION_ALTAR);
        const before = g.grid.getCell(20, 10)?.terrain;
        expect(spawnDungeonFeature(g.grid, 20, 10, altarFeature(), false).succeeded).toBe(false);
        expect(g.grid.getCell(20, 10)?.terrain).toBe(before);
        expect(promoteTile(g.grid, 20, 10, DungeonLayer.DUNGEON, false).spawn?.succeeded).toBe(false);
        expect(g.grid.getCell(20, 10)?.terrain).toBe(before);
    });
});
