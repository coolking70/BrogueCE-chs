import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import * as dungeonFeatures from '../engine/Map/DungeonFeature';
import * as promotions from '../engine/Map/Promotion';
import { DF } from '../engine/Map/DungeonFeatureCatalog';
import { Grid, DungeonLayer, TerrainType as T } from '../engine/Map/Grid';
import { EnvironmentManager, GasType } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { teleportCandidates, canPlaceCreature, teleportForbiddenFlags, captiveItemDropCandidates } from '../engine/Movement/CreaturePlacement';
import { T_IS_FIRE, T_IS_DF_TRAP, T_LAVA_INSTA_DEATH, T_IS_DEEP_WATER, T_AUTO_DESCENT } from '../engine/Map/TerrainCatalog';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { createHeadlessGame } from './harness';

// Two disconnected rooms: right room is outside the TARGET's geometric FOV.
// Unlike a random-coordinate stub this fixture permits real CE teleport search.
function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(26, 14);
    for (let x = 0; x < 26; x++) for (let y = 0; y < 14; y++) {
        g.grid.setTerrain(x, y, x === 0 || y === 0 || x === 25 || y === 13 || x === 12 ? T.WALL : T.FLOOR);
        g.grid.getCell(x, y)!.isVisible = true; // must NOT be used for teleport FOV
    }
    g.player = new Player(4, 5); g.player.hp = g.player.maxHp = 100;
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.levels = new Map();
    g.visibleMonsters = new Set(); g.environment = new EnvironmentManager(g.grid);
    g.spawnFloatingText = vi.fn();
    (g as any).updateVision = vi.fn();
    (g as any).machineCells = new Set<number>();
    (g as any).playerFalling = false;
    return g;
}
function monster(g: Game, x = 8, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.hp = m.maxHp = 100; g.monsters.push(m); return m;
}
function zap(g: Game) {
    const item = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
    return g.zapBoltFromPlayer(getBoltForItem('wand_of_teleportation')!, item, { x: 8, y: 5 });
}
const candidates = (g: Game, target: Player | Monster) => teleportCandidates({
    grid: g.grid, player: g.player, monsters: g.monsters, dormantMonsters: g.dormantMonsters,
}, target);
function onlyDestination(g: Game, target: Player | Monster, at: { x: number; y: number }) {
    for (const p of candidates(g, target)) if (p.x !== at.x || p.y !== at.y) g.grid.getCell(p.x, p.y)!.machineNumber = 1;
}
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(11011); ItemLoader.identifiedItems.clear(); });

describe('W-11 CE teleport destination policy', () => {
    it('enumerates x-major unseen destinations; player visibility does not hide or authorize cells', () => {
        const g = scene(), m = monster(g), before = rng.randomNumbersGenerated;
        const cells = candidates(g, m);
        expect(cells).toHaveLength(12 * 12);
        expect(cells[0]).toEqual({ x: 13, y: 1 }); expect(cells[cells.length - 1]).toEqual({ x: 24, y: 12 });
        expect(cells.every(p => p.x > 12)).toBe(true);
        expect(g.grid.getCell(13, 1)!.isVisible).toBe(true);
        expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('full-layer walls/forcefields, machines, stairs, live player/monsters and dormant occupants are excluded', () => {
        const g = scene(), m = monster(g);
        g.grid.setTerrainLayer(13, 1, DungeonLayer.SURFACE, T.FORCEFIELD);
        g.grid.getCell(13, 1)!.isPassable = true; // stale presentation cache must not bypass layer flags
        g.grid.getCell(13, 2)!.machineNumber = 7;
        // U04c: CE IS_IN_MACHINE comes from the grid, including this second machine.
        g.grid.getCell(13, 3)!.machineNumber = 8;
        g.grid.setTerrain(13, 4, T.STAIRS_UP); g.grid.setTerrain(13, 5, T.STAIRS_DOWN);
        g.player.loc = { x: 13, y: 6 }; monster(g, 13, 7);
        const sleeper = monster(g, 13, 8); sleeper.isDormant = true;
        g.monsters.pop(); g.dormantMonsters.push(sleeper);
        const corpse = monster(g, 13, 9); corpse.hp = 0;
        const cells = candidates(g, m);
        for (let y = 1; y <= 8; y++) expect(cells).not.toContainEqual({ x: 13, y });
        expect(cells).toContainEqual({ x: 13, y: 9 });
    });
    it('distance is four-way path length with a strict width/2 cutoff, not Chebyshev radius', () => {
        const g = scene(), m = monster(g);
        // Join the rooms only via their far bottom corners.
        g.grid.setTerrain(12, 12, T.FLOOR);
        // (13,5) is only 5 cells away geometrically but 19 steps along the path.
        expect(candidates(g, m)).toContainEqual({ x: 13, y: 5 });
        // Origin (8,5) -> (13,12) is 12 steps: too near despite occlusion.
        expect(candidates(g, m)).not.toContainEqual({ x: 13, y: 12 });
        expect(candidates(g, m)).not.toContainEqual({ x: 13, y: 11 }); // exactly width/2=13
        expect(candidates(g, m)).toContainEqual({ x: 14, y: 11 }); // 14 steps
    });
    it.each([
        ['MONST_FLIES', T_AUTO_DESCENT | T_IS_DF_TRAP | T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER],
        ['MONST_IMMUNE_TO_FIRE', T_LAVA_INSTA_DEATH | T_IS_FIRE],
        ['MONST_IMMUNE_TO_WATER', T_IS_DEEP_WATER],
        ['MONST_INVULNERABLE', T_LAVA_INSTA_DEATH | T_IS_FIRE],
    ] as const)('%s uses native species flags (not current statuses)', (flag, removed) => {
        const g = scene(), m = monster(g);
        const original = teleportForbiddenFlags(m);
        m.applyStatus('levitating', 10); m.applyStatus('immune_fire', 10);
        expect(teleportForbiddenFlags(m)).toBe(original);
        m.behaviorFlags.add(flag);
        expect(teleportForbiddenFlags(m) & removed).toBe(0);
    });
    it('a flyer may land on chasm/trap/lava/deep water but still cannot land in fire', () => {
        const g = scene(), m = monster(g, 8, 5, 'bloat');
        const terrain = [T.CHASM, T.TRAP, T.LAVA, T.WATER_DEEP, T.PLAIN_FIRE];
        terrain.forEach((t, i) => g.grid.setTerrain(13, i + 1, t));
        const cells = candidates(g, m);
        for (let y = 1; y <= 4; y++) expect(cells).toContainEqual({ x: 13, y });
        expect(cells).not.toContainEqual({ x: 13, y: 5 });
    });
    it('all-visible empty room fails without retry, mutation, random draws, or a forced coordinate', () => {
        const g = scene(), m = monster(g);
        for (let y = 0; y < 14; y++) g.grid.setTerrain(12, y, T.FLOOR);
        const before = { ...m.loc }, draws = rng.randomNumbersGenerated;
        expect((g as any).teleportCreature(m)).toBe(false);
        expect(m.loc).toEqual(before); expect(rng.randomNumbersGenerated).toBe(draws);
        expect((g as any).updateVision).not.toHaveBeenCalled();
    });
    it('no unoccupied destination fails safely; one rare legal cell always succeeds (no 100-attempt cap)', () => {
        const g = scene(), m = monster(g), at = { x: 24, y: 12 };
        onlyDestination(g, m, at);
        const blocker = monster(g, at.x, at.y);
        const before = { ...m.loc }, draws = rng.randomNumbersGenerated;
        expect((g as any).teleportCreature(m)).toBe(false);
        expect(m.loc).toEqual(before); expect(rng.randomNumbersGenerated).toBe(draws);
        blocker.hp = 0;
        expect((g as any).teleportCreature(m)).toBe(true); expect(m.loc).toEqual(at);
    });
});

describe('W-11 teleport effect and captive semantics', () => {
    it('successful wand teleport moves the hit, never identifies, and leaves the old occupancy vacant', () => {
        const g = scene(), m = monster(g); onlyDestination(g, m, { x: 13, y: 1 });
        const r = zap(g);
        expect(r.hits.map(h => h.creature)).toEqual([m]); expect(r.hits[0]!.pos).toEqual({ x: 8, y: 5 });
        expect(m.loc).toEqual({ x: 13, y: 1 }); expect(g.getMonsterAt(8, 5)).toBeUndefined();
        expect(g.getMonsterAt(13, 1)).toBe(m); expect(r.outcome?.autoID).toBe(false);
        expect((g as any).updateVision).toHaveBeenCalledTimes(1);
    });
    it('IMMOBILE gates both release and teleport; invulnerability alone does not forbid teleport', () => {
        const g = scene(), m = monster(g); m.isCaged = true; m.behaviorFlags.add('MONST_IMMOBILE');
        const move = vi.spyOn(g as any, 'teleportCreature');
        zap(g); expect(move).not.toHaveBeenCalled(); expect(m.isCaged).toBe(true); expect(m.isAlly).toBe(false);
        m.behaviorFlags.delete('MONST_IMMOBILE'); m.behaviorFlags.add('MONST_INVULNERABLE');
        zap(g); expect(move).toHaveBeenCalledOnce(); expect(m.isCaged).toBe(false); expect(m.isAlly).toBe(true);
        expect(m.loc.x).toBeGreaterThan(12);
    });
    it('failed teleport still frees the captive before search, drops its item at origin and detaches old leadership', () => {
        const g = scene(), m = monster(g), leader = monster(g, 7, 4), follower = monster(g, 7, 6);
        m.isCaged = true; m.seized = true; m.leader = leader; follower.leader = m;
        const item = ItemLoader.spawnFood('ration_of_food', 8, 5)!; m.carriedItem = item;
        for (const p of candidates(g, m)) g.grid.getCell(p.x, p.y)!.machineNumber = 1;
        const result = zap(g);
        expect(m.loc).toEqual({ x: 8, y: 5 }); expect(m.isCaged).toBe(false); expect(m.isAlly).toBe(true);
        expect(m.leader).toBeNull(); expect(m.seized).toBe(false); expect(follower.leader).toBeNull();
        expect(g.items).toContain(item); expect(item.loc).toEqual({ x: 8, y: 5 }); expect(m.carriedItem).toBeNull();
        expect(result.outcome?.autoID).toBe(false);
    });
    it('captive item drop uses nearest path distance, excludes items/player/stairs and leaves other monsters eligible', () => {
        const g = scene(), m = monster(g);
        const oldItem = ItemLoader.spawnFood('ration_of_food', 8, 5)!; g.items.push(oldItem);
        g.player.loc = { x: 7, y: 4 };
        g.grid.setTerrain(7, 5, T.STAIRS_UP); g.grid.setTerrain(7, 6, T.WALL);
        monster(g, 9, 5);
        const options = captiveItemDropCandidates(g, m.loc, g.items);
        expect(options).not.toContainEqual({ x: 8, y: 5 });
        expect(options).not.toContainEqual({ x: 7, y: 4 });
        expect(options).not.toContainEqual({ x: 7, y: 5 });
        expect(options).not.toContainEqual({ x: 7, y: 6 });
        expect(options).toContainEqual({ x: 9, y: 5 });
        expect(options.every(p => Math.max(Math.abs(p.x - 8), Math.abs(p.y - 5)) === 1)).toBe(true);
    });
    it.each([false, true])('normal wand submission consumes one charge/turn on success or failure (blocked=%s), never autoID', blocked => {
        const g = scene(), m = monster(g);
        if (blocked) for (const p of candidates(g, m)) g.grid.getCell(p.x, p.y)!.machineNumber = 1;
        g.pendingArcana = null; g.autoPath = []; g.isInventoryOpen = false;
        (g as any).pendingIdentify = false; (g as any).playerTurnEnded = vi.fn(); (g as any).recordInputEvent = vi.fn();
        const item = ItemLoader.spawnWand('wand_of_teleportation', -1, -1)!;
        g.player.inventory.addItem(item); const charges = item.charges!;
        g.useArcanaItem(item); g.setArcanaTarget(8, 5); const result = g.confirmArcanaTarget();
        expect(result?.outcome?.autoID).toBe(false); expect(ItemLoader.identifiedItems.has('wand_of_teleportation')).toBe(false);
        expect(item.charges).toBe(charges - 1); expect((g as any).playerTurnEnded).toHaveBeenCalledTimes(1);
        expect(m.loc.x > 12).toBe(!blocked);
    });
    it('reflected teleport moves the actual player, retains hit coordinates and never identifies', () => {
        const g = scene(); monster(g, 8, 5, 'stone_guardian');
        onlyDestination(g, g.player, { x: 13, y: 1 });
        const r = zap(g);
        expect(r.hits.map(h => h.creature)).toEqual([g.player]); expect(r.hits[0]!.pos).toEqual({ x: 4, y: 5 });
        expect(r.outcome).toEqual({ autoID: false, casterMovement: { from: { x: 4, y: 5 }, to: { x: 13, y: 1 } } });
    });
    it('seize flags are not blanket-cleared; moving either participant makes the old distant grab invalid', () => {
        const g = scene(), m = monster(g, 5, 5); m.seizing = true; g.player.seized = true;
        expect((g as any).findLiveSeizer()).toBe(m);
        expect(g.placeCreature(m, { x: 13, y: 1 })).toBe(true);
        expect((g as any).findLiveSeizer()).toBeUndefined(); expect(m.seizing).toBe(true); expect(g.player.seized).toBe(true);
    });
});

describe('W-11 generic placement and C-5 entry effects', () => {
    it.each([{ x: -1, y: 1 }, { x: 100, y: 1 }, { x: 1.5, y: 2 }, { x: 12, y: 5 }, { x: 4, y: 5 }])('invalid destination %o is an atomic no-op', at => {
        const g = scene(), m = monster(g), before = { ...m.loc }, draws = rng.randomNumbersGenerated;
        expect(g.placeCreature(m, at)).toBe(false); expect(m.loc).toEqual(before);
        expect((g as any).updateVision).not.toHaveBeenCalled(); expect(rng.randomNumbersGenerated).toBe(draws);
    });
    it('commit revalidates live occupation, including dormant; same-cell no-op has no trap effects', () => {
        const g = scene(), m = monster(g), at = { x: 13, y: 1 };
        expect(canPlaceCreature(g, m, at)).toBe(true);
        const blocker = monster(g, 13, 1); blocker.isDormant = true;
        expect(g.placeCreature(m, at)).toBe(false); expect(g.placeCreature(m, m.loc)).toBe(false);
        expect((g as any).updateVision).not.toHaveBeenCalled();
    });
    it('hazards and machines are allowed by generic placement; falls are marked, not executed', () => {
        const g = scene(), m = monster(g); const at = { x: 13, y: 1 };
        g.grid.setTerrain(at.x, at.y, T.CHASM); g.grid.getCell(at.x, at.y)!.machineNumber = 1;
        const fall = vi.spyOn(g as any, 'playerFalls');
        expect(g.placeCreature(g.player, at)).toBe(true); expect((g as any).playerFalling).toBe(true);
        expect(fall).not.toHaveBeenCalled(); expect(g.player.hp).toBe(100);
        g.grid.setTerrain(13, 2, T.CHASM);
        expect(g.placeCreature(m, { x: 13, y: 2 })).toBe(true); expect(m.falling).toBe(true);
        expect(g.monsters).toContain(m); expect(m.hp).toBe(100);
    });
    it('levitation prevents fall/traps, deep water extinguishes without damage, lava kills instantly', () => {
        const g = scene(), m = monster(g); m.applyStatus('levitating', 10);
        g.grid.setTerrain(13, 1, T.CHASM); expect(g.placeCreature(m, { x: 13, y: 1 })).toBe(true); expect(m.falling).toBe(false);
        m.setStatusDuration('levitating', 0);
        g.grid.setTerrain(13, 2, T.WATER_DEEP);
        (g as any).setBurningDuration(m, 7);
        expect(g.placeCreature(m, { x: 13, y: 2 })).toBe(true); expect(m.hp).toBe(100); expect((g as any).burningDuration(m)).toBe(0);
        g.grid.setTerrain(13, 3, T.LAVA);
        expect(g.placeCreature(m, { x: 13, y: 3 })).toBe(true); expect(m.hp).toBe(0);
    });
    it('only the moved creature gets entry status; caustic gas is not an extra objective damage tick', () => {
        const g = scene(), m = monster(g), stationary = monster(g, 14, 1);
        m.statusImmunities.clear(); stationary.statusImmunities.clear();
        g.environment.addGas(13, 1, GasType.POISON, 1000);
        g.environment.addGas(14, 1, GasType.CONFUSION, 1000);
        g.placeCreature(m, { x: 13, y: 1 });
        expect(m.hp).toBe(100); expect(stationary.hasStatus('confused')).toBe(false);
        g.environment.addGas(13, 2, GasType.CONFUSION, 1000);
        expect(g.placeCreature(m, { x: 13, y: 2 })).toBe(true);
        expect(g.grid.getCell(13, 2)!.layers[DungeonLayer.GAS]).toBe(T.CONFUSION_GAS);
        expect(m.getStatusDuration('confused')).toBe(25);
    });
    it('door promotion and trap entry happen immediately, flying ignores the pressure plate', () => {
        const g = scene(), m = monster(g);
        g.grid.setTerrain(13, 1, T.DOOR); g.placeCreature(m, { x: 13, y: 1 });
        expect(g.grid.getCell(13, 1)!.layers).toContain(T.OPEN_DOOR);
        g.grid.setTerrain(13, 2, T.TRAP); g.grid.getCell(13, 2)!.trapType = 'poison_gas';
        m.applyStatus('levitating', 10); g.placeCreature(m, { x: 13, y: 2 });
        expect(g.grid.getCell(13, 2)!.layers).toContain(T.TRAP);
        m.setStatusDuration('levitating', 0); g.placeCreature(m, { x: 13, y: 3 }); g.placeCreature(m, { x: 13, y: 2 });
        expect(g.grid.getCell(13, 2)!.layers).toContain(T.CHARRED_FLOOR);
        expect(g.grid.getCell(13, 2)!.layers[DungeonLayer.GAS]).toBe(T.POISON_GAS);
    });
    it('CE flag-based poison traps emit their DF on entry instead of requiring the legacy TRAP id', () => {
        const g = scene(), m = monster(g);
        g.grid.setTerrain(13, 1, T.GAS_TRAP_POISON_HIDDEN);
        expect(g.placeCreature(m, { x: 13, y: 1 })).toBe(true);
        expect(g.grid.getCell(13, 1)!.layers[DungeonLayer.GAS]).toBe(T.POISON_GAS);
        expect(g.grid.getCell(13, 1)!.volume).toBeGreaterThan(0);
        expect(m.hp).toBe(100); // emission is immediate; gradual gas damage is not
    });
    it('CE fire-trap depression prevents retrigger until the next objective environmental update', () => {
        const g = scene(), m = monster(g); m.applyStatus('immune_fire', 100);
        g.grid.setTerrain(13, 1, T.FLAMETHROWER_HIDDEN);
        const spawn = vi.spyOn(dungeonFeatures, 'spawnDungeonFeature');
        const fireCalls = () => spawn.mock.calls.filter(call => JSON.stringify(call[3]) === JSON.stringify(dungeonFeatures.catalogFeature(DF.DF_FLAMETHROWER))).length;
        g.placeCreature(m, { x: 13, y: 1 });
        expect(fireCalls()).toBe(1);
        g.placeCreature(m, { x: 14, y: 1 }); g.placeCreature(m, { x: 13, y: 1 });
        expect(fireCalls()).toBe(1);
        (g as any).applyEnvironmentalEffects();
        g.placeCreature(m, { x: 14, y: 1 }); g.placeCreature(m, { x: 13, y: 1 });
        expect(fireCalls()).toBe(2);
    });
    it.each([false, true])('nested teleport trap uses the actual entrant and evaluates its destination only once (plate=%s)', plate => {
        const g = scene(), m = monster(g), playerBefore = { ...g.player.loc };
        const destination = { x: 13, y: 1 };
        onlyDestination(g, m, destination);
        g.grid.setTerrain(10, 5, plate ? T.PRESSURE_PLATE : T.TRAP);
        const trapX = plate ? 11 : 10;
        g.grid.setTerrain(trapX, 5, T.TRAP); g.grid.getCell(trapX, 5)!.trapType = 'teleport';
        const effects = vi.spyOn(g as any, 'applyEnvironmentalEffects');
        const entryPromotion = vi.spyOn(promotions, 'promoteLayersWithMechFlag');
        expect(g.placeCreature(m, { x: 10, y: 5 })).toBe(true);
        expect(m.loc).toEqual(destination); expect(g.player.loc).toEqual(playerBefore);
        expect(effects).toHaveBeenCalledTimes(2); // entry + nested destination; never a third application
        expect(effects.mock.calls.every(call => call[0] === m)).toBe(true);
        expect(entryPromotion).toHaveBeenCalledTimes(1); // nested destination only; outer entry must return
        expect(entryPromotion.mock.calls[0]!.slice(1, 3)).toEqual([destination.x, destination.y]);
    });
    it('layered entanglement protects from lava/fall, and native fire immunity protects from lava', () => {
        const g = scene(), m = monster(g);
        g.grid.setTerrain(13, 1, T.LAVA); g.grid.setTerrainLayer(13, 1, DungeonLayer.SURFACE, T.WEB);
        g.placeCreature(m, { x: 13, y: 1 }); expect(m.hp).toBe(100);
        g.grid.setTerrain(13, 2, T.CHASM); g.grid.setTerrainLayer(13, 2, DungeonLayer.SURFACE, T.WEB);
        g.placeCreature(m, { x: 13, y: 2 }); expect(m.falling).toBe(false);
        m.applyStatus('immune_fire', 20); g.grid.setTerrain(13, 3, T.LAVA);
        g.placeCreature(m, { x: 13, y: 3 }); expect(m.hp).toBe(100);
    });
    it('monster falling is consumed by C-5 at turn end, only once, with its own fall damage range', () => {
        const g = createHeadlessGame(11012); g.monsters = [];
        const at = { x: g.player.loc.x + 2, y: g.player.loc.y };
        g.grid.setTerrain(at.x, at.y, T.CHASM);
        const m = monster(g, g.player.loc.x + 1, g.player.loc.y);
        const damage = vi.spyOn(rng, 'randClumpedRange').mockReturnValue(8);
        expect(g.placeCreature(m, at)).toBe(true); expect(m.falling).toBe(true); expect(damage).not.toHaveBeenCalled();
        (g as any).monstersFall();
        expect(g.monsters).not.toContain(m); expect(m.hp).toBe(92);
        expect(damage).toHaveBeenCalledExactlyOnceWith(6, 12, 2);
        (g as any).monstersFall(); expect(damage).toHaveBeenCalledTimes(1);
    });
    it('player automatically collects the destination item without spending an extra turn', () => {
        const g = scene(), item = ItemLoader.spawnFood('ration_of_food', 13, 1)!; g.items.push(item);
        const before = timeSystem.currentTick;
        expect(g.placeCreature(g.player, { x: 13, y: 1 })).toBe(true);
        expect(g.player.inventory.items).toContain(item); expect(g.items).not.toContain(item);
        expect(timeSystem.currentTick).toBe(before);
    });
    it('real visibility is recomputed immediately at a previously hidden player destination', () => {
        const g = createHeadlessGame(11013);
        const at = candidates(g, g.player).find(p => !g.grid.getCell(p.x, p.y)!.isVisible)!;
        expect(at).toBeDefined();
        expect(g.placeCreature(g.player, at)).toBe(true);
        expect(g.player.loc).toEqual(at); expect(g.grid.getCell(at.x, at.y)!.isVisible).toBe(true);
    });
    it('real C-5 player turn end consumes the falling flag, changes depth and never gives the old monster a turn', () => {
        const g = createHeadlessGame(11011); g.monsters = []; g.items = [];
        const at = { x: g.player.loc.x + 1, y: g.player.loc.y };
        g.grid.setTerrain(at.x, at.y, T.CHASM);
        const oldDepth = g.depth;
        expect(g.placeCreature(g.player, at)).toBe(true); expect(g.depth).toBe(oldDepth);
        (g as any).playerTurnEnded();
        expect(g.depth).toBe(oldDepth + 1); expect((g as any).playerFalling).toBe(false);
    });
});
