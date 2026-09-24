import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, DungeonLayer, TerrainType as T } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { BoltEffect, getBoltForItem, type BoltConfig } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { staffBlinkDistance, traceBolt } from '../engine/Combat/BoltTrajectory';
import { teleportCandidates } from '../engine/Movement/CreaturePlacement';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { createHeadlessGame } from './harness';

// Explicit engine-only blink: no staff identity/config or generation-pool entry.
const BLINK: BoltConfig = { id: 'w12_explicit_blink', name: 'blink', ceType: CEBoltType.BLINKING,
    effect: BoltEffect.BLINKING, magnitude: 999, char: '@', color: 0xffffff,
    maxRange: 0, piercing: false, selfTargeting: false };
function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(40, 16);
    for (let x = 0; x < 40; x++) for (let y = 0; y < 16; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        Object.assign(g.grid.getCell(x, y)!, { isVisible: true, hasMemory: true });
    }
    g.player = new Player(4, 5); g.player.hp = g.player.maxHp = 100;
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.levels = new Map();
    g.recordedInputEvents = []; g.stats = { kills: 0, gold: 0, maxDepth: 1, turns: 0 };
    g.visibleMonsters = new Set(); g.environment = new EnvironmentManager(g.grid);
    g.spawnFloatingText = vi.fn(); (g as any).updateVision = vi.fn();
    (g as any).machineCells = new Set<number>(); (g as any).playerFalling = false;
    return g;
}
function monster(g: Game, x = 12, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.hp = m.maxHp = 100; g.monsters.push(m); return m;
}
function blinkItem(E = 2) {
    const item = ItemLoader.spawnStaff('staff_of_fire', -1, -1)!;
    Object.assign(item, { enchantment: E, charges: 1, maxCharges: 99 }); return item;
}
function blink(g: Game, E = 2, aim = { x: 6, y: 5 }) {
    return g.zapBoltFromPlayer(BLINK, blinkItem(E), aim);
}
function beckon(g: Game, aim = { x: 12, y: 5 }) {
    return g.zapBoltFromPlayer(getBoltForItem('wand_of_beckoning')!,
        ItemLoader.spawnWand('wand_of_beckoning', -1, -1)!, aim);
}
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(12012); ItemLoader.identifiedItems.clear(); });

describe('W-12 blink: E travel, caster commit and collision ordering', () => {
    it.each([[2, 6], [3, 8], [8, 18]])('E%s moves exactly %s cells beyond the aim, independent of charges/config magnitude', (E, distance) => {
        const g = scene(), item = blinkItem(E), origin = { ...g.player.loc };
        const place = vi.spyOn(g, 'placeCreature'); const before = rng.randomNumbersGenerated;
        const result = g.zapBoltFromPlayer(BLINK, item, { x: 5, y: 5 });
        expect(staffBlinkDistance(E)).toBe(distance); expect(result.path).toHaveLength(distance);
        expect(g.player.loc).toEqual({ x: 4 + distance, y: 5 }); expect(result.hits).toEqual([]);
        expect(result.origin).toEqual(origin); expect(result.aimPos).toEqual({ x: 5, y: 5 });
        expect(result.outcome).toEqual({ autoID: true, casterMovement: { from: origin, to: g.player.loc } });
        expect(place).toHaveBeenCalledExactlyOnceWith(g.player, result.landingPos, { pickupBeforeVision: true });
        expect([item.enchantment, item.charges, item.maxCharges]).toEqual([E, 1, 99]);
        expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('diagonal range counts cells; a map edge truncates it safely', () => {
        const g = scene(); blink(g, 3, { x: 5, y: 6 }); expect(g.player.loc).toEqual({ x: 12, y: 13 });
        const result = blink(g, 8, { x: 13, y: 14 });
        expect(result.path).toHaveLength(2); expect(g.player.loc).toEqual({ x: 14, y: 15 });
    });
    it.each([T.WALL, T.GRANITE, T.DOOR, T.LOCKED_DOOR, T.CRYSTAL_WALL, T.PORTCULLIS_CLOSED, T.FORCEFIELD])(
        'halts before terrain %s, never hits/reflects or promotes the obstruction', terrain => {
            const g = scene(); g.grid.setTerrainLayer(8, 5, DungeonLayer.SURFACE, terrain);
            g.grid.getCell(8, 5)!.isPassable = true;
            const before = JSON.stringify(g.grid.getCell(8, 5)); const result = blink(g);
            expect(g.player.loc).toEqual({ x: 7, y: 5 }); expect(result.path).toHaveLength(3);
            expect(result.reflections).toEqual([]); expect(result.hits).toEqual([]);
            expect(JSON.stringify(g.grid.getCell(8, 5))).toBe(before);
        });
    it.each(['rat', 'stone_guardian'])('stops before %s; reflective creatures never receive blink contact', id => {
        const g = scene(), m = monster(g, 8, 5, id), item = blinkItem();
        const before = rng.randomNumbersGenerated, result = g.zapBoltFromPlayer(BLINK, item, m.loc);
        expect(g.player.loc).toEqual({ x: 7, y: 5 }); expect(m.loc).toEqual({ x: 8, y: 5 });
        expect(m.hp).toBe(100); expect(result.reflections).toEqual([]); expect(result.hits).toEqual([]);
        expect(rng.randomNumbersGenerated).toBe(before);
    });
    it.each(['wall', 'creature', 'same-origin'])('first-step %s has no landing, placement, autoID or trap activation', mode => {
        const g = scene();
        g.grid.setTerrain(4, 5, T.TRAP); g.grid.getCell(4, 5)!.trapType = 'poison_gas';
        if (mode === 'wall') g.grid.setTerrain(5, 5, T.WALL);
        if (mode === 'creature') monster(g, 5);
        const place = vi.spyOn(g, 'placeCreature');
        const result = blink(g, 2, mode === 'same-origin' ? { ...g.player.loc } : { x: 8, y: 5 });
        expect(result.path).toEqual([]); expect(result.landingPos).toBeNull();
        expect(result.outcome).toEqual({ autoID: false, casterMovement: null });
        expect(place).not.toHaveBeenCalled(); expect(g.grid.getCell(4, 5)!.terrain).toBe(T.TRAP);
    });
    it('blink first-step guard differs from ordinary HALTS_BEFORE; ordinary beams hit the blocker', () => {
        const g = scene(); g.grid.setTerrain(5, 5, T.WALL);
        const world = (g as any).boltWorld(g.player);
        expect(traceBolt(g.grid, { ...BLINK, magnitude: 2 }, g.player.loc, { x: 8, y: 5 }, world).path).toEqual([]);
        for (const id of ['staff_of_conjuration', 'wand_of_beckoning']) {
            expect(traceBolt(g.grid, getBoltForItem(id)!, g.player.loc, { x: 8, y: 5 }, world).path).toEqual([{ x: 5, y: 5 }]);
        }
    });
    it('a live dormant destination is rejected by the unchanged W-11 safety guard', () => {
        const g = scene(), m = monster(g, 10); m.isDormant = true; g.monsters = []; g.dormantMonsters = [m];
        const result = blink(g); expect(result.landingPos).toEqual({ x: 10, y: 5 });
        expect(g.player.loc).toEqual({ x: 4, y: 5 }); expect(result.outcome?.autoID).toBe(false);
    });
});

describe('W-12 beckoning uses reverse blink and the original caster', () => {
    it.each([2, 3, 4, 5, 6, 9, 18])('distance %s ends adjacent, preserves the hit snapshot and waits at least attackSpeed+1', distance => {
        const g = scene(), m = monster(g, 4 + distance); g.player.attackSpeed = 150; m.ticksUntilTurn = 12;
        const origin = { ...m.loc }, place = vi.spyOn(g, 'placeCreature');
        const result = beckon(g, origin);
        expect(m.loc).toEqual({ x: 5, y: 5 }); expect(g.player.loc).toEqual({ x: 4, y: 5 });
        expect(result.hits).toEqual([{ creature: m, pos: origin }]); expect(result.landingPos).toEqual(origin);
        expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
        expect(place).toHaveBeenCalledExactlyOnceWith(m, { x: 5, y: 5 }, { pickupBeforeVision: true }); expect(m.ticksUntilTurn).toBe(151);
    });
    it.each([[5, 5], [5, 6], [4, 6]])('adjacent (%s,%s) never releases, waits, enters caster cell or overshoots', (x, y) => {
        const g = scene(), m = monster(g, x, y); m.isCaged = true; m.ticksUntilTurn = 7;
        const place = vi.spyOn(g, 'placeCreature'), release = vi.spyOn(g, 'freeCaptive');
        const result = beckon(g, m.loc);
        expect(m.loc).toEqual({ x, y }); expect(m.isCaged).toBe(true); expect(m.ticksUntilTurn).toBe(7);
        expect(result.outcome?.autoID).toBe(false); expect(place).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled();
    });
    it('IMMOBILE prevents release and movement; INANIMATE/INVULNERABLE alone do not', () => {
        const g = scene(), m = monster(g); m.isCaged = true; m.behaviorFlags.add('MONST_IMMOBILE');
        expect(beckon(g).outcome?.autoID).toBe(false); expect(m.loc.x).toBe(12); expect(m.isCaged).toBe(true);
        m.behaviorFlags.delete('MONST_IMMOBILE'); m.behaviorFlags.add('MONST_INANIMATE'); m.behaviorFlags.add('MONST_INVULNERABLE');
        m.ticksUntilTurn = 600;
        expect(beckon(g).outcome?.autoID).toBe(true); expect(m.loc.x).toBe(5); expect(m.isAlly).toBe(true);
        expect(m.isCaged).toBe(false); expect(m.ticksUntilTurn).toBe(600);
    });
    it('reverses the forward tuned diagonal; a naive target-to-caster ray would choose the wall', () => {
        const g = scene(), m = monster(g, 6, 8); g.grid.setTerrain(5, 7, T.WALL);
        const world = (g as any).boltWorld(m);
        expect(traceBolt(g.grid, { ...BLINK, magnitude: 2 }, m.loc, g.player.loc, world).path).toEqual([]);
        const reverse = traceBolt(g.grid, { ...BLINK, magnitude: 2 }, m.loc, g.player.loc, world, undefined, { reverseBlink: true });
        expect(reverse.path).toEqual([{ x: 6, y: 7 }, { x: 5, y: 6 }]);
        const result = beckon(g, m.loc); expect(result.hits[0]?.creature).toBe(m);
        expect(m.loc).toEqual({ x: 5, y: 6 });
    });
    it('eligible but blocked secondary blink still frees, waits and identifies by visibility', () => {
        const g = scene(), m = monster(g); m.isCaged = true; m.ticksUntilTurn = 0;
        g.grid.setTerrain(11, 5, T.WALL);
        expect((g as any).beckonCreature(m, g.player)).toBe(true);
        expect(m.loc).toEqual({ x: 12, y: 5 }); expect(m.isCaged).toBe(false); expect(m.ticksUntilTurn).toBe(101);
    });
    it('secondary blink cannot jump an intervening creature and hidden targets do not autoID', () => {
        const g = scene(), m = monster(g), blocker = monster(g, 9);
        vi.spyOn(g as any, 'canObserveBoltTarget').mockReturnValue(false);
        expect((g as any).beckonCreature(m, g.player)).toBe(false);
        expect(m.loc).toEqual({ x: 10, y: 5 }); expect(blocker.loc).toEqual({ x: 9, y: 5 });
        expect(m.ticksUntilTurn).toBe(101);
    });
    it('null caster and reflected self-contact are no-ops; ordinary beckoning remains reflectable', () => {
        const g = scene(), m = monster(g, 12, 5, 'stone_guardian');
        expect((g as any).beckonCreature(m, null)).toBe(false);
        const result = beckon(g); expect(result.reflections).toHaveLength(1);
        expect(result.hits[0]?.creature).toBe(g.player); expect(result.outcome?.autoID).toBe(false);
        expect(g.player.loc).toEqual({ x: 4, y: 5 }); expect(m.loc).toEqual({ x: 12, y: 5 });
    });
    it('monster beckoning moves the actual player, picking up only their destination item', () => {
        const g = scene(), caster = monster(g, 12, 5, 'mirrored_totem');
        const item = ItemLoader.spawnFood('ration_of_food', 11, 5)!; g.items.push(item);
        const result = g.castMonsterBolt(caster, g.player, 'BECKONING')!;
        expect(g.player.loc).toEqual({ x: 11, y: 5 }); expect(caster.loc).toEqual({ x: 12, y: 5 });
        expect(result.hits).toEqual([{ creature: g.player, pos: { x: 4, y: 5 } }]);
        expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
        expect(g.player.inventory.items).toContain(item); expect(g.items).not.toContain(item);
    });
    it('monster-to-monster beckoning shares adjacency, IMMOBILE and waiting policy', () => {
        const g = scene(), caster = monster(g, 20, 5, 'mirrored_totem'), target = monster(g, 12);
        g.castMonsterBolt(caster, target, 'BECKONING'); expect(target.loc).toEqual({ x: 19, y: 5 });
        expect(target.ticksUntilTurn).toBe(101);
        target.ticksUntilTurn = 3; g.castMonsterBolt(caster, target, 'BECKONING'); expect(target.ticksUntilTurn).toBe(3);
        target.loc.x = 12; target.behaviorFlags.add('MONST_IMMOBILE');
        g.castMonsterBolt(caster, target, 'BECKONING'); expect(target.loc.x).toBe(12); expect(target.ticksUntilTurn).toBe(3);
    });
});

describe('W-12 uses W-11 placement: destination effects, pickup and P2/C-5', () => {
    it.each([false, true])('CE pickup precedes blink vision and follows teleport vision (blink=%s)', isBlink => {
        const g = scene(), item = ItemLoader.spawnFood('ration_of_food', 10, 5)!;
        g.items.push(item);
        const seenByVision: boolean[] = [];
        (g as any).updateVision = () => seenByVision.push(g.player.inventory.items.includes(item));
        if (isBlink) blink(g); else g.placeCreature(g.player, { x: 10, y: 5 });
        expect(seenByVision).toEqual([isBlink]);
        expect(g.player.inventory.items).toContain(item); expect(g.items).not.toContain(item);
    });
    it.each([false, true])('CE destination gold bypasses capacity and never occupies a slot (full=%s)', full => {
        const g = scene(), item = ItemLoader.spawnGold(47, 10, 5)!;
        if (full) for (let i = 0; i < g.player.inventory.capacity; i++) g.player.inventory.addItem(blinkItem());
        const count = g.player.inventory.items.length; g.items.push(item); blink(g);
        expect(g.stats.gold).toBe(47); expect(g.items).not.toContain(item);
        expect(g.player.inventory.items).toHaveLength(count); expect(g.player.inventory.items).not.toContain(item);
    });
    it('a full pack leaves the landing item on the floor without undoing the blink', () => {
        const g = scene(), item = ItemLoader.spawnFood('ration_of_food', 10, 5)!;
        for (let i = 0; i < g.player.inventory.capacity; i++) g.player.inventory.addItem(blinkItem());
        g.items.push(item); expect(blink(g).outcome?.autoID).toBe(true);
        expect(g.player.loc).toEqual({ x: 10, y: 5 }); expect(g.items).toContain(item);
        expect(g.player.inventory.items).not.toContain(item);
    });
    it('beckoning releases/drops at the old location before blinking and triggers only the destination trap', () => {
        const g = scene(), m = monster(g); m.isCaged = true; m.seized = true;
        const item = ItemLoader.spawnFood('ration_of_food', -1, -1)!; m.carriedItem = item;
        g.grid.setTerrain(5, 5, T.GAS_TRAP_POISON_HIDDEN);
        const result = beckon(g); expect(result.outcome?.autoID).toBe(true);
        expect(m.loc).toEqual({ x: 5, y: 5 }); expect(m.isCaged).toBe(false); expect(m.seized).toBe(false);
        expect(g.items).toContain(item); expect(item.loc).toEqual({ x: 12, y: 5 }); expect(m.carriedItem).toBeNull();
        expect(g.grid.getCell(5, 5)!.layers[DungeonLayer.GAS]).toBe(T.POISON_GAS);
    });
    it('real vision is refreshed at the actual player blink destination', () => {
        const g = createHeadlessGame(12014); g.monsters = []; g.items = [];
        g.player.loc = { x: 4, y: 5 };
        for (let x = 4; x <= 10; x++) { g.grid.setTerrain(x, 5, T.FLOOR); g.grid.getCell(x, 5)!.isVisible = false; }
        blink(g); expect(g.player.loc).toEqual({ x: 10, y: 5 }); expect(g.grid.getCell(10, 5)!.isVisible).toBe(true);
    });
    it('crossing hazards/items has no effect; only the landing item is picked up without extra time', () => {
        const g = scene(), item = ItemLoader.spawnFood('ration_of_food', 10, 5)!;
        const passed = ItemLoader.spawnFood('ration_of_food', 6, 5)!; g.items.push(passed, item);
        g.grid.setTerrain(6, 5, T.LAVA); g.grid.setTerrain(7, 5, T.CHASM);
        g.grid.setTerrain(8, 5, T.GAS_TRAP_POISON_HIDDEN); g.grid.getCell(10, 5)!.machineNumber = 7;
        const time = timeSystem.currentTick; const result = blink(g);
        expect(result.outcome?.autoID).toBe(true); expect(g.player.hp).toBe(100); expect((g as any).playerFalling).toBe(false);
        expect(g.items).toEqual([passed]); expect(g.player.inventory.items).toContain(item);
        expect(g.grid.getCell(8, 5)!.terrain).toBe(T.GAS_TRAP_POISON_HIDDEN); expect(timeSystem.currentTick).toBe(time);
    });
    it('landing poison trap emits once for the moved creature, not a second objective tick', () => {
        const g = scene(), stationary = monster(g, 20);
        g.grid.setTerrain(10, 5, T.GAS_TRAP_POISON_HIDDEN);
        const effects = vi.spyOn(g as any, 'applyEnvironmentalEffects'); blink(g);
        expect(effects).toHaveBeenCalledExactlyOnceWith(g.player);
        expect(g.grid.getCell(10, 5)!.layers[DungeonLayer.GAS]).toBe(T.POISON_GAS);
        expect(g.player.hp).toBe(100); expect(stationary.hp).toBe(100);
    });
    it('landing lava still reports committed blink even if the player dies', () => {
        const g = scene(); g.grid.setTerrain(10, 5, T.LAVA);
        const result = blink(g); expect(g.isGameOver).toBe(true); expect(g.player.loc).toEqual({ x: 10, y: 5 });
        expect(result.outcome?.autoID).toBe(true); expect(result.outcome?.casterMovement?.to).toEqual(g.player.loc);
    });
    it('nested destination teleport keeps hit/landing snapshots and reports the final caster position', () => {
        const g = scene();
        for (let y = 0; y < g.grid.height; y++) g.grid.setTerrain(15, y, T.WALL);
        const item = ItemLoader.spawnFood('ration_of_food', 25, 5)!; g.items.push(item);
        const queryTarget = new Player(10, 5);
        for (const p of teleportCandidates({ grid: g.grid, player: g.player, monsters: g.monsters, dormantMonsters: g.dormantMonsters }, queryTarget)) if (p.x !== 25 || p.y !== 5) g.grid.getCell(p.x, p.y)!.machineNumber = 1;
        g.grid.setTerrain(10, 5, T.TRAP); g.grid.getCell(10, 5)!.trapType = 'teleport';
        const effects = vi.spyOn(g as any, 'applyEnvironmentalEffects'); const result = blink(g);
        expect(result.landingPos).toEqual({ x: 10, y: 5 }); expect(g.player.loc).toEqual({ x: 25, y: 5 });
        expect(result.outcome?.casterMovement).toEqual({ from: { x: 4, y: 5 }, to: { x: 25, y: 5 } });
        expect(effects).toHaveBeenCalledTimes(2); expect(g.player.inventory.items).toContain(item);
    });
    it('web escape keeps the web and grab bookkeeping; blink does not invoke a walking attack', () => {
        const g = scene(); g.grid.setTerrainLayer(4, 5, DungeonLayer.SURFACE, T.WEB);
        g.player.seized = true; blink(g);
        expect(g.player.loc.x).toBe(10); expect(g.grid.getCell(4, 5)!.layers[DungeonLayer.SURFACE]).toBe(T.WEB);
        expect(g.player.seized).toBe(true);
    });
    it('real P2 confirmation consumes one charge/action; the beckoned monster cannot act immediately', () => {
        const g = createHeadlessGame(12012); g.monsters = []; g.items = []; g.dormantMonsters = [];
        g.player.loc = { x: 4, y: 5 };
        for (let x = 3; x <= 13; x++) for (let y = 4; y <= 6; y++) g.grid.setTerrain(x, y, T.FLOOR);
        const m = monster(g); m.ticksUntilTurn = 0; const turn = vi.spyOn(m, 'takeTurn');
        const item = ItemLoader.spawnWand('wand_of_beckoning', -1, -1)!; item.charges = 2;
        g.player.inventory.items = [item]; const time = timeSystem.currentTick;
        g.useArcanaItem(item); g.setArcanaTarget(12, 5); const result = g.confirmArcanaTarget()!;
        expect(result.hits[0]?.creature).toBe(m); expect(m.loc).toEqual({ x: 5, y: 5 });
        expect(item.charges).toBe(1); expect(timeSystem.currentTick - time).toBe(100);
        expect(turn).not.toHaveBeenCalled(); expect(m.ticksUntilTurn).toBe(1);
    });
    it('real C-5 consumes a blink landing fall once at turn end, after the movement result', () => {
        const g = createHeadlessGame(12013); g.monsters = []; g.items = []; g.player.loc = { x: 4, y: 5 };
        for (let x = 4; x <= 10; x++) g.grid.setTerrain(x, 5, T.FLOOR);
        g.grid.setTerrain(10, 5, T.CHASM); const depth = g.depth;
        const result = blink(g); expect(result.landingPos).toEqual({ x: 10, y: 5 });
        expect((g as any).playerFalling).toBe(true); expect(g.depth).toBe(depth);
        (g as any).playerTurnEnded(); expect(g.depth).toBe(depth + 1); expect((g as any).playerFalling).toBe(false);
    });
    it('W-25 blinking item exists; monster autonomous tryUseBolt still skips blink', () => {
        const g = scene(), imp = monster(g, 12, 5, 'imp'); imp.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');
        const cast = vi.spyOn(g, 'castMonsterBolt');
        expect(getBoltForItem('staff_of_blinking')?.effect).toBe(BoltEffect.BLINKING);
        expect(imp.tryUseBolt(g)).toBe(false); expect(cast).not.toHaveBeenCalled(); expect(imp.loc.x).toBe(12);
    });
});
