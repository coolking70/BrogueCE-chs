import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { ItemCategory, type Item } from '../engine/Items/Item';
import { getBoltForItem, type BoltResult } from '../engine/Combat/Bolt';
import { timeSystem } from '../engine/Systems/Time';
import { rng } from '../engine/Random';
import { Direction } from '../types';
import { logger } from '../engine/Systems/Logger';
import { createHeadlessGame } from './harness';

// Real effects/map/entities; only turn scheduling/rendering are spied in local
// transaction fixtures. The final test also uses the real P2 scheduler.
const inside = (game: Game) => game as unknown as {
    playerTurnEnded: ReturnType<typeof vi.fn>;
    updateVision: ReturnType<typeof vi.fn>;
    recordInputEvent: ReturnType<typeof vi.fn>;
};
function scene() {
    const game = Object.create(Game.prototype) as Game;
    game.grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
        game.grid.setTerrain(x, y, TerrainType.FLOOR);
        game.grid.getCell(x, y)!.isVisible = true;
    }
    game.player = new Player(4, 5);
    game.monsters = [];
    game.items = [];
    game.environment = new EnvironmentManager(game.grid);
    game.pendingArcana = null;
    game.autoPath = [];
    game.isInventoryOpen = false;
    game.pendingIdentify = false;
    inside(game).playerTurnEnded = vi.fn();
    game.spawnFloatingText = vi.fn();
    inside(game).updateVision = vi.fn();
    inside(game).recordInputEvent = vi.fn();
    return game;
}
function monster(game: Game, x = 8, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    game.monsters.push(m);
    return m;
}
function item(game: Game, id: string, known = false) {
    const obj = id.startsWith('staff_') ? ItemLoader.spawnStaff(id, -1, -1)! : ItemLoader.spawnWand(id, -1, -1)!;
    game.player.inventory.addItem(obj);
    if (known) ItemLoader.identifyItemKind(obj);
    return obj;
}
function fire(game: Game, item: Item, x = 8, y = 5) {
    game.useArcanaItem(item);
    game.setArcanaTarget(x, y);
    return game.confirmArcanaTarget();
}
beforeEach(() => { ItemLoader.identifiedItems.clear(); ItemLoader.magicPolarityRevealed.clear(); logger.messages = []; });

describe('W-2 choose / cancel / commit (CE Items.c:6361-6516,7340-7440)', () => {
    it('11 existing CE items enter selection without charge, turn, identity or RNG changes; Escape cancels', () => {
        for (const id of ['staff_of_fire', 'staff_of_lightning', 'staff_of_poison', 'staff_of_conjuration',
            'staff_of_healing', 'staff_of_haste', 'wand_of_teleportation', 'wand_of_slowness',
            'wand_of_beckoning', 'wand_of_invisibility', 'wand_of_empowerment']) {
            const g = scene(), obj = item(g, id);
            const before = [obj.charges, obj.rechargeCounter, obj.timesUsed, timeSystem.currentTick, rng.randomNumbersGenerated];
            g.autoPath = [{ x: 5, y: 5 }];
            g.useArcanaItem(obj);
            expect(g.pendingArcana?.item).toBe(obj);
            expect(g.isTimePaused()).toBe(true);
            expect(g.autoPath).toEqual([]);
            for (const action of ['wait', 'search', 'stairs_down', 'toggle_inventory', 'apply_item', 'auto_explore', 'pickup']) g.handlePlayerAction(action);
            g.handlePlayerAction('move', Direction.UPRIGHT);
            expect(g.pendingArcana?.cursor).toEqual({ x: 5, y: 4 });
            expect(g.player.loc).toEqual({ x: 4, y: 5 });
            g.handlePlayerAction('escape');
            expect(g.pendingArcana).toBeNull();
            g.useArcanaItem(obj);
            g.handlePlayerAction('cancel_target'); // CE moveCursor ACKNOWLEDGE_KEY (space)
            expect(g.pendingArcana).toBeNull();
            expect([obj.charges, obj.rechargeCounter, obj.timesUsed, timeSystem.currentTick, rng.randomNumbersGenerated]).toEqual(before);
            expect(inside(g).playerTurnEnded).not.toHaveBeenCalled();
            expect(ItemLoader.identifiedItems.has(id)).toBe(false);
        }
    });

    it.each([50, 100, 200])('confirm spends one existing charge and exactly movementSpeed=%s ticks once', speed => {
        const g = scene(), obj = item(g, 'wand_of_slowness');
        g.player.movementSpeed = speed;
        obj.rechargeCounter = 17;
        const charge = obj.charges!, tick = timeSystem.currentTick;
        const result = fire(g, obj)!;
        expect(result.aimPos).toEqual({ x: 8, y: 5 });
        expect(result.outcome).toEqual({ autoID: false, casterMovement: null });
        expect(obj.charges).toBe(charge - 1);
        expect(obj.rechargeCounter).toBe(17);
        expect(obj.timesUsed).toBe(1);
        expect(timeSystem.currentTick - tick).toBe(speed);
        expect(inside(g).playerTurnEnded).toHaveBeenCalledTimes(1);
        expect(g.confirmArcanaTarget()).toBeNull();
        expect(inside(g).playerTurnEnded).toHaveBeenCalledTimes(1);
        expect(ItemLoader.identifiedItems.has('wand_of_slowness')).toBe(false);
        expect(logger.messages.map(m => m.text).join(' ')).not.toContain(obj.name);
        expect(result.frames.every(f => f.color === 0xaaaaaa && f.char === '*')).toBe(true);
    });

    it('known empty instance is free; kind-known/max-known but instance-unknown empty requires confirmation and costs a turn', () => {
        for (const category of [ItemCategory.WAND, ItemCategory.STAFF]) {
            const g = scene(), obj = item(g, category === ItemCategory.WAND ? 'wand_of_slowness' : 'staff_of_poison', true);
            obj.charges = 0;
            const tick = timeSystem.currentTick;
            obj.identified = true;
            g.useArcanaItem(obj);
            expect(g.pendingArcana).toBeNull();
            expect(obj.maxChargesKnown).toBe(false);
            expect(timeSystem.currentTick).toBe(tick);
            obj.identified = false;
            g.useArcanaItem(obj);
            g.cancelArcanaSelection();
            expect(obj.maxChargesKnown).toBe(false);
            expect(timeSystem.currentTick).toBe(tick);
            expect(fire(g, obj)).toBeNull();
            expect(obj.maxChargesKnown).toBe(true);
            expect(obj.timesUsed ?? 0).toBe(0);
            expect(timeSystem.currentTick - tick).toBe(100);
            fire(g, obj); // MAX_CHARGES_KNOWN still doesn't reveal current charge.
            expect(timeSystem.currentTick - tick).toBe(200);
        }
    });

    it('origin, stale inventory reference, paralysis and input lock cannot submit; manual ineligible grid aim remains legal', () => {
        const g = scene(), obj = item(g, 'wand_of_empowerment', true);
        const target = monster(g);
        expect(g.getArcanaCandidates(obj)).toEqual([]); // hostile excluded from automatic ally spell
        const charge = obj.charges;
        g.useArcanaItem(obj);
        g.confirmArcanaTarget(); // origin cancels
        expect(obj.charges).toBe(charge);
        g.useArcanaItem(obj);
        expect(g.setArcanaTarget(NaN, 5)).toBe(false);
        expect(g.setArcanaTarget(-1, 5)).toBe(false);
        g.setArcanaTarget(8, 5);
        const lock = vi.spyOn(g, 'isInputLocked').mockReturnValue(true);
        g.handlePlayerAction('confirm_target');
        g.handleMouseTravel(8, 5);
        expect(obj.charges).toBe(charge);
        lock.mockRestore();
        const hp = target.maxHp;
        g.handleMouseTravel(8, 5);
        expect(obj.charges).toBe(charge! - 1);
        expect(target.maxHp).toBe(hp + 12); // W-21 CE empowerMonster: fixed repeatable increment
        g.useArcanaItem(obj);
        g.setArcanaTarget(8, 5);
        g.player.inventory.items.splice(g.player.inventory.items.indexOf(obj), 1);
        expect(g.confirmArcanaTarget()).toBeNull();
        expect(obj.charges).toBe(charge! - 1);
        g.player.inventory.addItem(obj);
        g.player.applyStatus('paralyzed', 5);
        g.useArcanaItem(obj);
        expect(g.pendingArcana).toBeNull();
    });

    it('Tab cycles eligible candidates in both directions, and missing candidates leave the cursor unchanged', () => {
        const g = scene(), obj = item(g, 'wand_of_slowness', true);
        const a = monster(g, 6, 5), b = monster(g, 4, 9);
        g.useArcanaItem(obj);
        expect(g.pendingArcana?.cursor).toEqual(a.loc);
        g.handlePlayerAction('cycle_target', 1);
        expect(g.pendingArcana?.cursor).toEqual(b.loc);
        g.handlePlayerAction('cycle_target', -1);
        expect(g.pendingArcana?.cursor).toEqual(a.loc);
        g.monsters = [];
        g.cycleArcanaTarget();
        expect(g.pendingArcana?.cursor).toEqual(a.loc);
    });
});

describe('W-2 automatic candidates (CE Items.c:5935-6032)', () => {
    it.each([
        ['staff_of_fire', 'enemy'], ['staff_of_lightning', 'enemy'], ['staff_of_poison', 'enemy'],
        ['staff_of_conjuration', 'enemy'], ['staff_of_healing', 'ally'], ['staff_of_haste', 'ally'],
        ['wand_of_teleportation', 'enemy'], ['wand_of_slowness', 'enemy'], ['wand_of_beckoning', 'enemy'],
        ['wand_of_invisibility', 'ally'], ['wand_of_empowerment', 'ally'],
    ])('%s uses its known CE target flags (%s), then consumes only one existing charge', (id, team) => {
        const g = scene(), obj = item(g, id!, true);
        const enemy = monster(g, 8, 5), ally = monster(g, 4, 9);
        ally.isAlly = true; ally.hp--;
        expect(g.getArcanaCandidates(obj)).toEqual(team === 'ally' ? [ally] : team === 'enemy' ? [enemy] : []);
        const charge = obj.charges!, counter = obj.rechargeCounter;
        const result = fire(g, obj, 8)!;
        expect(result.outcome).not.toBeNull();
        expect(obj.charges).toBe(charge - 1);
        expect(obj.rechargeCounter).toBe(counter);
        expect(obj.timesUsed ?? 0).toBe(obj.category === ItemCategory.WAND ? 1 : 0);
    });

    it('unknown kind targets enemies; revealed bad polarity targets allies; known flags override and captives count as allies', () => {
        const g = scene(), obj = item(g, 'wand_of_invisibility');
        const enemy = monster(g, 8, 5), ally = monster(g, 4, 8), captive = monster(g, 1, 5);
        ally.isAlly = true; captive.isCaged = true;
        expect(g.getArcanaCandidates(obj)).toEqual([enemy]);
        obj.magicDetected = true;
        expect(g.getArcanaCandidates(obj)).toEqual([ally, captive]);
        ItemLoader.identifyItemKind(obj);
        expect(g.getArcanaCandidates(obj)).toEqual([ally, captive]);
        const attack = item(g, 'staff_of_fire', true);
        expect(g.getArcanaCandidates(attack)).toEqual([enemy]);
    });

    it('known forbidden flags/fire immunity/near beckoning/full-health allies filter, unknown identity never leaks eligibility', () => {
        const g = scene(), target = monster(g, 6, 5, 'goblin_totem');
        const slow = item(g, 'wand_of_slowness');
        expect(g.getArcanaCandidates(slow)).toEqual([target]);
        ItemLoader.identifyItemKind(slow);
        expect(g.getArcanaCandidates(slow)).toEqual([]);
        const teleport = item(g, 'wand_of_teleportation', true);
        expect(g.getArcanaCandidates(teleport)).toEqual([]);
        g.monsters = [];
        const rat = monster(g, 5, 5);
        rat.applyStatus('immune_fire', 10);
        expect(g.getArcanaCandidates(item(g, 'staff_of_fire', true))).toEqual([]);
        expect(g.getArcanaCandidates(item(g, 'wand_of_beckoning', true))).toEqual([]);
        rat.isAlly = true;
        const heal = item(g, 'staff_of_healing', true);
        expect(g.getArcanaCandidates(heal)).toEqual([]);
        rat.hp--;
        expect(g.getArcanaCandidates(heal)).toEqual([rat]);
    });

    it('invisibility, hallucination, guaranteed reflection and intervening creature/terrain gates use perception and open path', () => {
        const g = scene(), obj = item(g, 'wand_of_slowness');
        const rat = monster(g);
        rat.applyStatus('invisible', 20);
        expect(g.getArcanaCandidates(obj)).toEqual([]);
        g.player.applyStatus('telepathy', 20);
        expect(g.getArcanaCandidates(obj)).toEqual([rat]);
        g.player.statusDurations = {};
        rat.statusDurations = {};
        g.player.applyStatus('hallucinating', 20);
        expect(g.getArcanaCandidates(obj)).toEqual([]);
        g.player.statusDurations = {};
        g.grid.setTerrain(6, 5, TerrainType.CRYSTAL_WALL);
        expect(g.getArcanaCandidates(obj)).toEqual([]);
        g.grid.setTerrain(6, 5, TerrainType.FLOOR);
        const blocker = monster(g, 6, 5);
        expect(g.getArcanaCandidates(obj)).toEqual([blocker]);
        g.monsters = [];
        monster(g, 8, 5, 'stone_guardian');
        expect(g.getArcanaCandidates(obj)).toEqual([]);
    });
});

describe('W-2 actual autoID (CE Items.c:5112-5119,5220-5413,5444-5465,5470-5567)', () => {
    it('teleport hit stays unknown; slow hit identifies kind only', () => {
        const g = scene(); monster(g);
        const teleport = item(g, 'wand_of_teleportation');
        expect(fire(g, teleport)!.outcome?.autoID).toBe(false);
        expect(ItemLoader.identifiedItems.has('wand_of_teleportation')).toBe(false);
        const slow = item(g, 'wand_of_slowness');
        monster(g, 7, 5);
        expect(fire(g, slow, 7)!.outcome?.autoID).toBe(true);
        expect(ItemLoader.identifiedItems.has('wand_of_slowness')).toBe(true);
        expect(slow.identified).toBe(false);
    });

    it('W-16: conjuration identifies only after creating real allied blades', () => {
        const g = scene(); monster(g);
        const conjure = item(g, 'staff_of_conjuration'); conjure.enchantment = 3;
        expect(fire(g, conjure)!.outcome?.autoID).toBe(true);
        const blades = g.monsters.filter(m => m.typeId === 'spectral_blade');
        expect(blades).toHaveLength(4);
        expect(blades.every(m => m.isAlly && g.getMonsterAt(m.loc.x, m.loc.y) === m)).toBe(true);
        expect(ItemLoader.identifiedItems.has('staff_of_conjuration')).toBe(true);
        expect(conjure.identified).toBe(false);
    });

    it('poison requires an observed eligible applied status; invisible/immune targets cannot identify', () => {
        const g = scene(), obj = item(g, 'staff_of_poison'), target = monster(g);
        target.applyStatus('invisible', 20);
        expect(fire(g, obj)!.outcome?.autoID).toBe(false);
        target.statusDurations = {};
        target.statusImmunities.add('poisoned');
        expect(fire(g, obj)!.outcome?.autoID).toBe(false);
        obj.charges = 1; // fixture only; no production charge model change
        target.statusImmunities.clear();
        expect(fire(g, obj)!.outcome?.autoID).toBe(true);
    });

    it('damage identifies on contact even with reflection; empty floor misses do not, real ignition does', () => {
        const g = scene(), obj = item(g, 'staff_of_fire');
        const guardian = monster(g, 8, 5, 'stone_guardian');
        const hp = guardian.hp;
        expect(fire(g, obj)!.outcome?.autoID).toBe(true);
        expect(guardian.hp).toBe(hp);
        ItemLoader.identifiedItems.clear(); g.monsters = []; obj.charges = 3;
        expect(fire(g, obj)!.outcome?.autoID).toBe(false);
        g.grid.setTerrain(6, 5, TerrainType.GRASS);
        expect(fire(g, obj)!.outcome?.autoID).toBe(true);
    });

    it('actual lightning crystal promotion identifies even when SPARK is stopped before its target', () => {
        const g = scene(), obj = item(g, 'staff_of_lightning');
        expect(g.zapBoltFromPlayer(getBoltForItem('staff_of_lightning')!, obj, { x: 10, y: 5 }).outcome?.autoID).toBe(false);
        g.grid.setTerrain(6, 5, TerrainType.ELECTRIC_CRYSTAL_OFF);
        expect(g.zapBoltFromPlayer(getBoltForItem('staff_of_lightning')!, obj, { x: 10, y: 5 }).outcome?.autoID).toBe(true);
        g.grid.setTerrain(6, 5, TerrainType.ELECTRIC_CRYSTAL_OFF);
        const caster = monster(g, 10, 5), hp = g.player.hp;
        const result = g.castMonsterBolt(caster, g.player, 'SPARK')!;
        expect(result.hits).toEqual([]);
        expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
        expect(g.player.hp).toBe(hp);
    });

    it('invisibility CE ally/revealed condition and beckoning actual movement are observed; casterMovement is not target movement', () => {
        const g = scene(), target = monster(g), invis = item(g, 'wand_of_invisibility');
        expect(fire(g, invis)!.outcome?.autoID).toBe(false); // ordinary enemy disappearance is ambiguous in CE
        target.isAlly = true;
        expect(fire(g, invis)!.outcome?.autoID).toBe(true);
        const beckon = item(g, 'wand_of_beckoning');
        const result = fire(g, beckon)!;
        expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
        // W-12 / CE Items.c:5076-5089: reverse blink stops adjacent to (4,5), not the legacy two-cell pull.
        expect(target.loc).toEqual({ x: 5, y: 5 });
    });

    it('W-9 retires legacy self heal/haste/miss-invisibility; observation follows actual hits', () => {
        const g = scene(), target = monster(g);
        target.maxHp = 100; target.hp = 1;
        g.player.hp = 5;
        const heal = item(g, 'staff_of_healing'); heal.enchantment = 2;
        expect(fire(g, heal)!.outcome?.autoID).toBe(true);
        expect(g.player.hp).toBe(5); expect(target.hp).toBe(21); // CE 20% of target maxHP
        const tick = timeSystem.currentTick;
        expect(fire(g, item(g, 'staff_of_haste'))!.outcome?.autoID).toBe(true);
        expect(g.player.hasStatus('hasted')).toBe(false); expect(target.hasStatus('hasted')).toBe(true);
        expect(timeSystem.currentTick - tick).toBe(100); // Caster was not hit; no self haste.
        g.monsters = [];
        expect(fire(g, item(g, 'wand_of_invisibility'))!.outcome?.autoID).toBe(false);
        expect(g.player.hasStatus('invisible')).toBe(false);
        expect(ItemLoader.identifiedItems.has('wand_of_invisibility')).toBe(false);
    });

    it('monster exits evaluate visible healing versus hidden healing and blocked/no-effect paths', () => {
        const g = scene(), caster = monster(g, 12, 5), target = monster(g);
        target.maxHp = 100; target.hp = 1;
        expect(g.castMonsterBolt(caster, target, 'HEALING')!.outcome?.autoID).toBe(true);
        target.applyStatus('invisible', 20);
        expect(g.castMonsterBolt(caster, target, 'HEALING')!.outcome?.autoID).toBe(false);
        g.grid.setTerrain(10, 5, TerrainType.WALL);
        expect(g.castMonsterBolt(caster, target, 'SPARK')!.outcome).toEqual({ autoID: false, casterMovement: null });
        expect(g.castMonsterBolt(caster, target, 'BLINKING')!.outcome?.autoID).toBe(false);
        // U08 BE_NONE executes DF but does not auto-identify (CE update/detonate).
        for (const name of ['SPIDERWEB', 'ANCIENT_SPIRIT_VINES']) {
            const result = g.castMonsterBolt(caster, target, name)!;
            expect(result.landingPos).toEqual({ x: 10, y: 5 });
            expect(result.outcome).toEqual({ autoID: false, casterMovement: null });
        }
    });

    it('confirmed slow-speed casting runs real P2 advancement and locks repeated UI entry until completion', () => {
        const g = createHeadlessGame(42);
        g.monsters = [];
        const obj = item(g, 'wand_of_slowness');
        g.animationEnabled = true;
        g.player.applyStatus('slowed', 20);
        const charge = obj.charges!, tick = timeSystem.currentTick;
        g.useArcanaItem(obj);
        g.setArcanaTarget(g.player.loc.x + 1, g.player.loc.y);
        const result = g.confirmArcanaTarget() as BoltResult;
        expect(result.outcome).not.toBeNull();
        expect(timeSystem.currentTick - tick).toBe(200);
        expect(g.isInputLocked()).toBe(true);
        g.useArcanaItem(obj);
        g.handlePlayerAction('apply_item');
        expect(g.pendingArcana).toBeNull();
        expect(obj.charges).toBe(charge - 1);
        for (let n = 0; n < 100 && g.isInputLocked(); n++) g.tickAdvancement(100);
        expect(g.isInputLocked()).toBe(false);
        expect(g.lastAdvancementError).toBeNull();
        g.useArcanaItem(obj);
        expect(g.pendingArcana).not.toBeNull();
        const snapshot = g.toSnapshot();
        g.loadSnapshot(snapshot);
        expect(g.pendingArcana).toBeNull();
        expect(g.player.inventory.items.find(i => i.id === obj.id)?.charges).toBe(charge - 1);
    });
});
