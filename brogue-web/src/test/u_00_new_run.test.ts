import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game, type GameMode, type GameRecording } from '../engine/Core/Game';
import { createHeadlessGame } from './harness';
import { rng, RNGType } from '../engine/Random';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { allocateEntityId } from '../entities/Creature';
import { logger } from '../engine/Systems/Logger';
import { timeSystem } from '../engine/Systems/Time';
import { BlueprintEngine, type BlueprintDef, getRewardRoomsGenerated } from '../engine/Generator/BlueprintEngine';
import * as DFModule from '../engine/Map/DungeonFeature';
import { Grid, DCOLS, DROWS, TerrainType } from '../engine/Map/Grid';
import { DF } from '../engine/Map/DungeonFeatureCatalog';

// All own state, including private/nested fields, Maps/Sets, class identity and
// graph aliases. Never use the lossy save DTO as the equivalence oracle.
function graph(value: unknown, seen = new Map<object, number>()): unknown {
    if (value === undefined) return { undefined: true };
    if (typeof value === 'function') throw new Error('Unclassified callback in state graph');
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) return { ref: seen.get(value) };
    const id = seen.size;
    seen.set(value, id);
    if (value instanceof WeakMap || value instanceof WeakSet) throw new Error('Opaque weak collection in new run');
    if (value instanceof Map) return { id, map: [...value].map(([k, v]) => [graph(k, seen), graph(v, seen)]) };
    if (value instanceof Set) return { id, set: [...value].map(v => graph(v, seen)) };
    if (Array.isArray(value)) return { id, array: value.map(v => graph(v, seen)) };
    return { id, type: value.constructor.name, fields: Object.fromEntries(Object.keys(value).sort().map(k =>
        [k, graph((value as any)[k], seen)])) };
}
// Observe the module-local machine allocator by its next real allocation.
// Empty fixture has no random features and never touches the game's grid.
function nextMachineNumber(): number {
    const grid = new Grid(DCOLS, DROWS);
    const center = { x: 4, y: 4 };
    grid.setTerrain(4, 4, TerrainType.FLOOR);
    const bp: BlueprintDef = { id: 'u00-counter', name: 'counter', depthRange: [1, 26],
        roomSize: [1, 1], frequency: 1, category: 'test', flags: [], features: [] };
    const machine = (new BlueprintEngine(grid, 1, [bp]) as any).applyBlueprint(bp, { cells: [center], center, door: null });
    expect(machine).not.toBeNull();
    return machine.machineNumber;
}
function state(g: Game) {
    const fields = { ...g } as any;
    // Session wiring is asserted by identity separately; the sole wall clock
    // timestamp is recording metadata, not simulation time.
    delete fields.onRenderRequested;
    delete fields.onConfirmRequest;
    delete fields.recordingStartAt;
    const loader = Object.fromEntries([
        'potionFlavorMap', 'scrollFlavorMap', 'arcanaFlavorMap', 'staffFlavorSlots',
        'identifiedItems', 'callTitles', 'magicPolarityRevealed',
    ].map(k => [k, (ItemLoader as any)[k]]));
    return graph({ game: fields, rng, loader, logger, timeSystem,
        rewards: getRewardRoomsGenerated(), nextEntityId: allocateEntityId(), nextMachineNumber: nextMachineNumber() });
}
function measured(action: () => void) {
    const r = rng as any;
    const original = r.ranval;
    const draws = [0, 0];
    const spy = vi.spyOn(r, 'ranval').mockImplementation((s: any) => {
        const index = r.rngStates.indexOf(s);
        if (index < 0) throw new Error('Unknown RNG stream');
        draws[index]!++;
        return original.call(r, s);
    });
    try { action(); } finally { spy.mockRestore(); }
    return draws;
}
function dirty(g: Game) {
    const a = g as any;
    g.handlePlayerAction('wait');
    a.depth = 2;
    a.generateDepth(false, false); // real prior layer cache and world generation
    const oldItem = g.player.inventory.items[0]!;
    const oldMonster = g.monsters[0]!;
    expect(oldMonster).toBeDefined();
    g.dormantMonsters.push(oldMonster);
    oldMonster.leader = g.monsters[1] ?? null;
    a.pendingFallenByDepth.set(1, [oldMonster]);
    a.pendingFallenByDepth.set(3, [oldMonster]);
    nextMachineNumber(); nextMachineNumber();
    g.stats = { gold: 987, kills: 12, turns: 91, maxDepth: 18 };
    Object.assign(a, {
        playerFalling: true, displacementTrapDepressions: new WeakMap([[g.grid, new Set([1])]]),
        pendingCaughtFireCells: [{ x: 2, y: 2 }], lastPromotionUpdate: { dirty: true },
        travelTargetItem: oldItem, isInventoryOpen: true, pendingIdentify: true,
        pendingEnchantment: true, pendingArcana: { item: oldItem, cursor: { x: 1, y: 1 } },
        pendingUseConfirm: oldItem, isThrowing: true, throwItemTarget: oldItem,
        isExamining: true, inspectTarget: { title: 'old run' }, hoveredCell: { x: 2, y: 2 }, hoveredText: 'old',
        pendingBoltFrames: [{ old: true }], currentBoltFrameIndex: 2, boltAnimStartTime: 123,
        justRested: true, justSearched: true, searchingCharge: 99, secretScanDepth: 1,
        levelHasSecrets: true, poisonedDuringTurn: true, updatedSafetyMapThisTurn: true,
        lastDamageSource: 'old', gameOverWon: true, gameOverReason: 'old',
        gameOverInventory: [{ name: 'old', category: 1, enchantment: 99, color: 0 }], gameOverScore: 999,
        autoPath: [{ x: 3, y: 2 }], isMouseTraveling: true, inAutoTravelStep: true,
        floatingTexts: [{ text: 'old' }], lastAdvancementError: new Error('old'),
        animationAccumulatorMs: 45, animationLockDeadline: Date.now() + 5000, pendingPauseMs: 25,
        isAdvancing: true, replayFrameAccumulator: 5,
    });
    // A real suspended iterator with a finalizer proves retirement occurs once,
    // before the new run's clock/stats are initialized.
    let retired = 0;
    a.advancementIter = (function* () { try { yield 25; } finally { retired++; timeSystem.currentTick += 777; } })();
    a.advancementIter.next();
    g.examinedEntityIds.add(oldMonster.id);
    g.visibleItems.add(oldItem); g.everSeenItems.add(oldItem);
    g.visibleMonsters.add(oldMonster); g.everSeenMonsters.add(oldMonster);
    g.safetyMap[0]![0] = 123;
    g.signTexts.set('old', 'old'); g.resetPlateRoomByPos.set('old', 9);
    a.testRooms.set(9, { old: true }); g.currentTestCategory = 'enemies';
    ItemLoader.identifiedItems.add('potion_of_life');
    ItemLoader.callTitles.set('potion_of_life', 'old');
    ItemLoader.magicPolarityRevealed.add('potion_of_life');
    ItemLoader.arcanaFlavorMap.set('wand_of_fire', 'old');
    rng.setRNG(RNGType.RNG_COSMETIC); rng.randRange(1, 100);
    return () => expect(retired).toBe(1);
}
const recording: GameRecording = {
    version: 1, recordedAt: 1234, seed: 12345, mode: 'normal', startDepth: 1,
    events: Array.from({ length: 3 }, (_, index) => ({ index, tick: index * 100, depth: 1,
        player: { x: 0, y: 0 }, action: 'wait', data: null })),
};
afterEach(() => vi.restoreAllMocks());

describe('U00 full new-run equivalence', () => {
    for (const mode of ['normal', 'easy', 'wizard', 'test'] as GameMode[]) {
        for (const entrance of ['title', 'death', 'restart', 'seek'] as const) {
            it(`${entrance} → ${mode}: reused A→B equals fresh B, whole graph and both RNG streams`, () => {
                const g = createHeadlessGame(777);
                const confirm = () => false;
                const render = () => {};
                g.onConfirmRequest = confirm;
                g.onRenderRequested = render;
                g.animationEnabled = true;
                const retired = dirty(g);
                const oldLevels = g.levels;
                const oldStats = g.stats;
                const oldKnowledge = ItemLoader.identifiedItems;
                const oldGrids = [g.grid, ...[...g.levels.values()].map(l => l.grid)];
                const rec = { ...recording, mode };
                const enter = (game: Game) => {
                    if (entrance === 'restart' || entrance === 'seek') {
                        game.replayRecording = rec;
                        if (entrance === 'restart') game.replayRestart(); else game.replaySeek(2);
                    } else game.startNewGame({ seed: rec.seed, mode });
                };
                if (entrance === 'death') {
                    g.player.hp = 0;
                    (g as any).triggerGameOver(false);
                    expect(g.isGameOver).toBe(true);
                } else if (entrance === 'title') {
                    g.isGameOver = false; // App.handleReturnToTitle delegates next start to Game.
                }
                const bindings = vi.spyOn(DFModule, 'setDormantAwakener');
                const reusedDraws = measured(() => enter(g));
                retired();
                expect(g.onConfirmRequest).toBe(confirm);
                expect(g.onRenderRequested).toBe(render);
                expect(g.animationEnabled).toBe(true);
                expect(bindings.mock.calls.filter(([, fn]) => fn !== null)).toHaveLength(1);
                for (const grid of oldGrids) expect(bindings.mock.calls.some(([key, fn]) => key === grid && fn === null)).toBe(true);
                expect(g.levels).not.toBe(oldLevels);
                expect(oldLevels.size).toBeGreaterThan(0);
                expect(oldStats.gold).toBe(987);
                expect(oldKnowledge.has('potion_of_life')).toBe(true);
                const reused = state(g);
                const fresh = new Game();
                fresh.onConfirmRequest = confirm; fresh.onRenderRequested = render;
                fresh.animationEnabled = true;
                const freshDraws = measured(() => enter(fresh));
                expect(reusedDraws).toEqual(freshDraws);
                expect(reused).toEqual(state(fresh));
            });
        }
    }

    it('old grid cannot wake B; current grid wakes exactly once after repeated starts', () => {
        const g = createHeadlessGame(12345);
        const old = g.grid;
        g.startNewGame({ seed: 12345 });
        g.startNewGame({ seed: 12345 });
        const spy = vi.spyOn(g as any, 'awakenDormantMonstersAt');
        const feature = DFModule.catalogFeature(DF.DF_SHATTERING_SPELL);
        DFModule.spawnDungeonFeature(old, g.player.loc.x, g.player.loc.y, feature, false);
        expect(spy).not.toHaveBeenCalled();
        DFModule.spawnDungeonFeature(g.grid, g.player.loc.x, g.player.loc.y, feature, false);
        expect(spy).toHaveBeenCalledTimes(1);
    });
});
