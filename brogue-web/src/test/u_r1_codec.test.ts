import { describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { entityCodecDeps, serializeItem, deserializeItem, serializeMonster, restoreEntityGraph } from '../engine/Core/EntitySnapshot';
import { toWholeRunSnapshot, decodeWholeRunWorld, decodePlayer } from '../engine/Core/WholeRunSnapshot';
import { getRewardRoomsGenerated } from '../engine/Generator/BlueprintEngine';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const stable = <T extends { savedAt: number }>(value: T) => {
    const { savedAt: _savedAt, ...rest } = value;
    return rest;
};

describe('UR1 extracted codec equivalence', () => {
    it('Game entry points and explicit codecs retain fields, graph cycles and both RNG streams', () => {
        const g = createHeadlessGame(4101, 'test');
        const bridge = g as any;
        const form = monsters.find(m => m.id === 'rat')! as MonsterData;
        const a = new Monster(4, 5, form), b = new Monster(5, 5, form);
        a.leader = b; b.leader = a; a.carriedMonster = b; b.carriedMonster = a;
        a.isDormant = true;
        const key = ItemLoader.spawnKey('iron_key', -1, -1)!;
        key.keyLoc = [{ loc: { x: 4, y: 5 }, machine: 17, disposableHere: false }];
        a.carriedItem = key; b.carriedItem = key;
        const before = rng.getState();
        expect(bridge.serializeItem(key)).toEqual(serializeItem(key));
        expect(bridge.serializeMonster(a)).toEqual(serializeMonster(a));
        expect(json(bridge.deserializeItem(json(serializeItem(key))))).toEqual(json(deserializeItem(json(serializeItem(key)), entityCodecDeps)));
        const restored = restoreEntityGraph([json(serializeMonster(a))], [], [], [], entityCodecDeps);
        expect(restored.monsters.get(a.id)!.carriedMonster!.carriedMonster).toBe(restored.monsters.get(a.id));
        expect(restored.monsters.get(a.id)!.carriedItem).toBe(restored.monsters.get(b.id)!.carriedItem);
        expect(rng.getState()).toEqual(before);
    });

    it('whole-run projection and decoder match the Game wrappers on an explored level with queues and recording', () => {
        const g = createHeadlessGame(731, 'test'), bridge = g as any;
        const form = monsters.find(m => m.id === 'rat')! as MonsterData;
        const sleeping = new Monster(8, 8, form); sleeping.isDormant = true;
        g.dormantMonsters.push(sleeping);
        const key = ItemLoader.spawnKey('iron_key', -1, -1)!;
        key.keyLoc = [{ loc: { x: 8, y: 8 }, machine: 2, disposableHere: true }];
        bridge.pendingFallenItemsByDepth.set(2, [key]);
        bridge.pendingFallenByDepth.set(2, [new Monster(9, 8, form)]);
        bridge.recordedInputEvents = [{ action: 'wait', turn: 0 }];
        const reloaded = createHeadlessGame(999, 'test');
        vi.spyOn(Date, 'now').mockReturnValue(123456);
        try {
            const before = rng.getState();
            const direct = toWholeRunSnapshot({
                depth: g.depth, currentLevelDepth: bridge.currentLevelDepth,
                active: bridge.activeLevelState(), levels: g.levels,
                snapshotLevel: (depth, level) => bridge.snapshotLevel(depth, level),
                pendingFallenByDepth: bridge.pendingFallenByDepth,
                pendingFallenItemsByDepth: bridge.pendingFallenItemsByDepth,
                purgatory: bridge.purgatory, monsters: g.monsters, dormantMonsters: g.dormantMonsters,
                items: g.items, player: g.player, everSeenMonsters: bridge.everSeenMonsters,
                everSeenItems: bridge.everSeenItems, visibleMonsters: g.visibleMonsters,
                visibleItems: g.visibleItems, travelTargetItem: bridge.travelTargetItem,
                isAdvancing: bridge.isAdvancing, currentSeed: bridge.currentSeed, levelSeeds: bridge.levelSeeds,
                mode: g.mode, ticksTillUpdateEnvironment: g.ticksTillUpdateEnvironment,
                pendingEnchantment: bridge.pendingEnchantment, stats: g.stats, run: bridge.snapshotRunState(),
                services: {
                    rngState: () => rng.getState(),
                    identifiedItems: () => [...ItemLoader.identifiedItems],
                    callTitles: () => Object.fromEntries(ItemLoader.callTitles),
                    magicPolarityRevealed: () => [...ItemLoader.magicPolarityRevealed],
                    flavors: () => ItemLoader.snapshotFlavors(),
                    staffFlavors: () => Object.fromEntries(ItemLoader.staffs.map(s => [s.id, ItemLoader.arcanaFlavorMap.get(s.id)!])),
                    wandFlavors: () => Object.fromEntries(ItemLoader.wands.map(w => [w.id, ItemLoader.arcanaFlavorMap.get(w.id)!])),
                    rewardRoomsGenerated: () => getRewardRoomsGenerated(),
                },
            });
            expect(stable(g.toSnapshot())).toEqual(stable(direct));
            expect(rng.getState()).toEqual(before);
            const decoded = decodeWholeRunWorld(json(direct), entityCodecDeps);
            const player = decodePlayer(json(direct).player, decoded.entityGraph.items);
            expect(player.inventory.items.map(i => i.id)).toEqual(g.player.inventory.items.map(i => i.id));
            expect(decoded.restored.get(g.depth)!.dormantMonsters!.map(m => m.id)).toEqual([sleeping.id]);
            expect(rng.getState()).toEqual(before);
            expect(reloaded.loadSnapshot(json(direct))).toBe(true);
            expect(reloaded.dormantMonsters.map(m => m.id)).toEqual([sleeping.id]);
        } finally { vi.restoreAllMocks(); }
    });
});
