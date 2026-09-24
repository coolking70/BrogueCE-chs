import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T } from '../engine/Map/Grid';
import { EnvironmentManager, GasType } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { getBoltForItem } from '../engine/Combat/Bolt';
import { CombatSystem } from '../engine/Combat/Combat';
import { staffPoison } from '../engine/Combat/Poison';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import { createHeadlessGame } from './harness';

function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(18, 12);
    for (let x = 0; x < 18; x++) for (let y = 0; y < 12; y++) {
        g.grid.setTerrain(x, y, T.FLOOR); g.grid.getCell(x, y)!.isVisible = true;
    }
    g.player = new Player(4, 5); g.player.maxHp = 300; g.player.hp = 100;
    g.monsters = []; g.items = []; g.environment = new EnvironmentManager(g.grid);
    g.stats = { kills: 0, gold: 0, turns: 0, maxDepth: 1 };
    g.spawnFloatingText = vi.fn();
    (g as any).updateVision = vi.fn();
    return g;
}
function mob(g: Game, id = 'rat', x = 8, y = 5) {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.hp = m.maxHp = 100; m.goldDropChance = m.itemDropChance = 0;
    m.ticksUntilTurn = 100000; m.state = MonsterState.HUNTING; g.monsters.push(m); return m;
}
function staff(E = 2) {
    const item = new Item('poison', '/', 0x55cc55, ItemCategory.STAFF);
    Object.assign(item, { identityId: 'staff_of_poison', enchantment: E, maxCharges: 99, charges: 1, arcanaInstanceVersion: 1 });
    return item;
}
function zap(g: Game, E = 2, aim = { x: 8, y: 5 }) {
    return g.zapBoltFromPlayer({ ...getBoltForItem('staff_of_poison')!, magnitude: 987 }, staff(E), aim);
}
const tick = (g: Game) => (g as any).tickCreatureStatuses();
function live() {
    const g = createHeadlessGame(1010, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.player.statusDurations = {}; g.player.poisonAmount = 0;
    g.player.equippedArmor = g.player.equippedWeapon = g.player.ringLeft = g.player.ringRight = null;
    g.player.inventory.items = []; g.player.maxHp = 300; g.player.hp = 100;
    g.player.loc = { x: 4, y: 5 }; g.player.regenCarry = 0;
    for (let x = 1; x < 14; x++) for (let y = 1; y < 10; y++) g.grid.setTerrain(x, y, T.FLOOR);
    return g;
}
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(1010); logger.messages = []; });

describe('W-10 CE formula and real poison staff contacts', () => {
    it('matches all 51 CE fixed-point table rows and both clamps, without pow approximation', () => {
        const ce = readFileSync('../BrogueCE-master/src/brogue/PowerTables.c', 'utf8');
        const body = ce.split('const fixpt POW_POISON[] = {')[1]!.split('};')[0]!.replace(/\/\/[^\n]*/g, '');
        const table = body.match(/\d+/g)!.map(Number);
        expect(table).toHaveLength(51);
        table.forEach((v, i) => expect(staffPoison(i + 2)).toBe(Math.floor(5 * v / 65536)));
        expect(staffPoison(-9)).toBe(5); expect(staffPoison(100)).toBe(staffPoison(52));
        expect(staffPoison(3.9)).toBe(6);
    });
    it.each([[2, 5], [3, 6], [8, 24]])('E%s gives %s, ignores charges/capacity/config magnitude, no immediate damage', (E, duration) => {
        const g = scene(), m = mob(g); const before = rng.randomNumbersGenerated;
        const r = zap(g, E);
        expect(r.hits.map(h => h.creature)).toEqual([m]); expect(r.outcome?.autoID).toBe(true);
        expect([m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([100, 1, duration]);
        expect(g.player.poisonAmount).toBe(0); expect(rng.randomNumbersGenerated).toBe(before);
    });
    it('successive staff hits add both fields; only one damage pulse per tick', () => {
        const g = scene(), m = mob(g);
        zap(g, 2); zap(g, 3); expect([m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([100, 2, 11]);
        tick(g); expect([m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([98, 2, 10]);
        zap(g, 2); tick(g); expect([m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([95, 3, 14]);
    });
    it.each(['empty', 'wall', 'origin'])('%s has no status, damage or autoID', mode => {
        const g = scene();
        if (mode === 'wall') { mob(g); g.grid.setTerrain(6, 5, T.WALL); }
        const r = zap(g, 2, mode === 'origin' ? g.player.loc : { x: 8, y: 5 });
        expect(r.hits).toEqual([]); expect(r.outcome?.autoID).toBe(false);
        expect(g.player.poisonAmount).toBe(0); g.monsters.forEach(m => expect(m.poisonAmount).toBe(0));
    });
    it('returning bolt poisons player exactly once, reflector untouched', () => {
        const g = scene(), m = mob(g, 'stone_guardian'); const r = zap(g, 8);
        expect(r.reflections).toHaveLength(1); expect(r.hits.map(h => h.creature)).toEqual([g.player]);
        expect(r.outcome?.autoID).toBe(true); expect([g.player.poisonAmount, g.player.getStatusDuration('poisoned')]).toEqual([1, 24]);
        expect(m.poisonAmount).toBe(0); tick(g); expect(g.player.hp).toBe(99);
    });
    it.each(['inanimate', 'invulnerable', 'immune', 'dead'])('%s rejects before concentration or autoID', mode => {
        const g = scene(), m = mob(g);
        if (mode === 'inanimate') m.behaviorFlags.add('MONST_INANIMATE');
        if (mode === 'invulnerable') m.behaviorFlags.add('MONST_INVULNERABLE');
        if (mode === 'immune') m.statusImmunities.add('poisoned');
        if (mode === 'dead') m.hp = 0;
        const hp = m.hp; expect(zap(g).outcome?.autoID).toBe(false);
        expect([m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([hp, 0, 0]);
    });
    it('invisibility prevents observation, not poison; weapon immunity is not poison immunity', () => {
        const g = scene(), m = mob(g); m.behaviorFlags.add('MONST_IMMUNE_TO_WEAPONS'); m.applyStatus('invisible', 100);
        expect(zap(g).outcome?.autoID).toBe(false); tick(g); expect(m.hp).toBe(99);
        g.player.applyStatus('telepathy', 100); expect(zap(g).outcome?.autoID).toBe(true); expect(m.poisonAmount).toBe(2);
    });
    it('zero duration is inert; zero concentration increments establish but do not stack a dose', () => {
        const p = new Player(0, 0); expect(p.addPoison(0)).toBe(false);
        p.addPoison(2, 0); p.addPoison(3, 0); expect([p.poisonAmount, p.getStatusDuration('poisoned')]).toEqual([1, 5]);
    });
    it('last tick deals full dose then clears concentration; re-poison starts at one', () => {
        const g = scene(), m = mob(g); m.addPoison(1, 3); tick(g);
        expect([m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([97, 0, 0]);
        tick(g); expect(m.hp).toBe(97); m.addPoison(2); expect(m.poisonAmount).toBe(1);
        m.setStatusDuration('poisoned', 0); expect(m.poisonAmount).toBe(0);
    });
    it('CE statusEffectCatalog: negation and ordinary healing both preserve poison', () => {
        const g = scene(), m = mob(g); m.hp = 50; m.addPoison(5, 3);
        g.zapBoltFromPlayer(getBoltForItem('staff_of_healing')!, Object.assign(staff(2), { identityId: 'staff_of_healing' }), m.loc);
        expect([m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([3, 5]);
        (g as any).negateCreatureMagic(m); expect([m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([3, 5]);
    });
});

describe('W-10 objective time, recovery and persistence', () => {
    it.each([['hasted', 4, 2], ['normal', 2, 2], ['slowed', 1, 2]] as const)('%s: same 200 ticks despite different action count', (speed, actions, damage) => {
        const g = live(), m = mob(g); g.player.addPoison(10); m.addPoison(10, 2);
        if (speed !== 'normal') g.player.applyStatus(speed, 100);
        for (let i = 0; i < actions; i++) g.handlePlayerAction('wait');
        expect(g.player.hp).toBe(100 - damage); expect(m.hp).toBe(100 - damage * 2);
        expect(g.player.getStatusDuration('poisoned')).toBe(8); expect(m.getStatusDuration('poisoned')).toBe(8);
        expect(g.stats.turns).toBe(actions);
    });
    it('50-tick action has no pulse, second completes the block; final poison pulse cannot regenerate', () => {
        const g = live(); g.player.addPoison(1, 2); g.player.applyStatus('hasted', 100); g.player.regenCarry = 0.75;
        g.player.applyStatus('regenerating', 100);
        g.handlePlayerAction('wait'); expect(g.player.hp).toBe(100); expect(g.player.poisonAmount).toBe(2);
        g.handlePlayerAction('wait'); expect(g.player.hp).toBe(98); expect(g.player.poisonAmount).toBe(0); expect(g.player.regenCarry).toBe(0.75);
        g.handlePlayerAction('wait'); expect(g.player.hp).toBe(100); // floor(.75 + 1/.6) = 2
    });
    it('starvation still hurts while poisoned; lethal poison cannot be healed or relabelled starvation', () => {
        const g = live(); g.player.nutrition = 0; g.player.addPoison(3, 2);
        g.handlePlayerAction('wait'); expect(g.player.hp).toBe(97);
        g.player.hp = 2; const gameover = vi.spyOn(g, 'triggerGameOver');
        g.handlePlayerAction('wait'); expect(g.player.hp).toBe(0); expect(g.lastDamageSource).toBe('poison');
        expect(g.isGameOver).toBe(true); expect(gameover).toHaveBeenCalledTimes(1);
    });
    it('monster regen pauses its counter throughout poison including last tick; resumes next objective tick', () => {
        const g = scene(), m = mob(g); m.hp = 50; m.regenTurns = 3; m.regenCounter = 2; m.addPoison(2);
        tick(g); tick(g); expect([m.hp, m.regenCounter, m.poisonAmount]).toEqual([48, 2, 0]);
        tick(g); expect([m.hp, m.regenCounter]).toEqual([49, 0]);
    });
    it('JSON save/load retains both species doses, paused regen and half-block', () => {
        const g = live(), m = mob(g); g.player.addPoison(5, 2); m.addPoison(9, 3);
        g.player.regenCarry = 0.75; m.regenTurns = 3; m.regenCounter = 2;
        g.player.applyStatus('hasted', 100); g.handlePlayerAction('wait');
        const dormant = mob(g); g.monsters.pop(); dormant.addPoison(4, 2); g.dormantMonsters = [dormant];
        const snapshot = JSON.parse(JSON.stringify(g.toSnapshot()));
        expect(snapshot.ticksTillUpdateEnvironment).toBe(50);
        expect(g.loadSnapshot(snapshot)).toBe(true);
        expect([g.player.poisonAmount, g.player.regenCarry, g.monsters[0]!.poisonAmount, g.monsters[0]!.regenCounter, g.dormantMonsters[0]!.poisonAmount]).toEqual([2, .75, 3, 2, 2]);
        g.monsters[0]!.ticksUntilTurn = 100000;
        g.handlePlayerAction('wait'); expect([g.player.hp, g.monsters[0]!.hp]).toEqual([98, 97]);
        expect(g.player.getStatusDuration('poisoned')).toBe(4);
        // U01: an inactive instance counter is still state, not a migration input.
        snapshot.player.statusDurations.poisoned = 0; snapshot.player.poisonAmount = 99;
        g.loadSnapshot(snapshot); expect(g.player.poisonAmount).toBe(99);

    });
});

describe('W-10 common attacks and one death per creature', () => {
    it.each(['player', 'monster'])('MA_POISONS physical hit: 1 contact + rolled duration, %s target', who => {
        const g = scene(), a = mob(g, 'centipede'); const target = who === 'player' ? g.player : mob(g);
        a.abilityFlags.add('MA_POISONS'); a.damageString = '6'; vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        for (let i = 0; i < 2; i++) expect(CombatSystem.attack(a, target).damage).toBe(1);
        expect([target.hp, target.poisonAmount, target.getStatusDuration('poisoned')]).toEqual([98, 2, 12]);
        tick(g); expect(target.hp).toBe(96);
    });
    it('normal melee and geometry wrappers do not apply MA_POISONS twice', () => {
        const g = scene(), a = mob(g, 'centipede', 5, 5); a.abilityFlags.add('MA_POISONS'); a.damageString = '6';
        a.state = MonsterState.HUNTING; vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        g.spawnBlood = vi.fn(); g.tryTriggerArmorRunic = vi.fn();
        (a as any).resolveGeometryAttackOn(g, g.player, 'hostile');
        expect([g.player.hp, g.player.poisonAmount, g.player.getStatusDuration('poisoned')]).toEqual([99, 1, 6]);
    });
    it('normal hostile melee uses the same single dose as geometry', () => {
        const g = live(), a = mob(g, 'centipede', 5, 5);
        a.abilityFlags.add('MA_POISONS'); a.damageString = '6';
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        a.takeTurn(g, 20);
        expect([g.player.hp, g.player.poisonAmount, g.player.getStatusDuration('poisoned')]).toEqual([99, 1, 6]);
    });
    it('damage after poison death cannot trigger a second death or revive the player', () => {
        const g = scene(), m = mob(g); m.hp = 1; m.addPoison(2);
        const death = vi.spyOn(m as any, 'die'), drops = vi.spyOn(g as any, 'dropMonsterLoot');
        (g as any).resolvePoisonDamage(m); (m.statusDurations as any).burning = 3;
        (g as any).resolveBurningDamage(m); (g as any).resolvePoisonDamage(m);
        expect(death).toHaveBeenCalledTimes(1); expect(drops).toHaveBeenCalledTimes(1);
        g.player.hp = 0; g.player.regenCarry = 10; g.player.recoverPerTurn(); expect(g.player.hp).toBe(0);
    });
    it('physical bolts share MA_POISONS; poison dart remains weakening without the ability', () => {
        const g = scene(), a = mob(g, 'dart_turret', 8, 5); a.damageString = '6'; vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        g.spawnBlood = vi.fn(); g.tryTriggerArmorRunic = vi.fn();
        g.castMonsterBolt(a, g.player, 'POISON_DART'); expect(g.player.poisonAmount).toBe(0);
        a.abilityFlags.add('MA_POISONS'); const hp = g.player.hp;
        g.castMonsterBolt(a, g.player, 'POISON_DART');
        expect([hp - g.player.hp, g.player.poisonAmount, g.player.getStatusDuration('poisoned')]).toEqual([1, 1, 6]);
    });
    it('miss, lethal contact and inanimate targets never receive a dose', () => {
        const g = scene(), a = mob(g, 'centipede'); a.abilityFlags.add('MA_POISONS'); a.damageString = '6';
        vi.spyOn(rng, 'randPercent').mockReturnValue(false); CombatSystem.attack(a, g.player); expect(g.player.poisonAmount).toBe(0);
        vi.mocked(rng.randPercent).mockReturnValue(true); g.player.hp = 1; CombatSystem.attack(a, g.player); expect(g.player.poisonAmount).toBe(0);
        const m = mob(g); m.behaviorFlags.add('MONST_INANIMATE'); CombatSystem.attack(a, m); expect(m.poisonAmount).toBe(0);
    });
    it('venom runic adds duration/dose without its old extra instant damage', () => {
        const g = scene(), m = mob(g); g.player.equippedWeapon = new Item('venom', ')', 0xffffff, ItemCategory.WEAPON); (g as any).applyWeaponRunicEffect(m, 10, 'venom');
        expect([m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([100, 1, 5]); tick(g); expect(m.hp).toBe(99);
    });
    it.each([1, 3])('burning then poison with HP%s: only actual lethal source messages/loot', hp => {
        const g = scene(), m = mob(g); m.hp = hp; m.addPoison(3, 2); (m.statusDurations as any).burning = 3;
        vi.spyOn(rng, 'randRange').mockReturnValue(1); const drops = vi.spyOn(g as any, 'dropMonsterLoot');
        tick(g); tick(g); expect(m.hp).toBe(0); expect(drops).toHaveBeenCalledTimes(hp === 1 ? 0 : 1);
        expect(g.stats.kills).toBe(hp === 1 ? 0 : 1);
    });
    it('poison death drops loot/carried item, triggers death DF and removes corpse once at same turn end', () => {
        const g = live(), m = mob(g, 'bloat'); m.behaviorFlags.delete('MONST_INANIMATE'); m.hp = 1; m.addPoison(3);
        m.goldDropChance = 1; m.carriedItem = new Item('key', ';', 0xffffff, ItemCategory.KEY);
        const carried = m.carriedItem, gas = vi.spyOn(g.environment, 'addGas'), drops = vi.spyOn(g as any, 'dropMonsterLoot');
        g.handlePlayerAction('wait');
        expect(m.hp).toBe(0); expect(g.monsters).not.toContain(m); expect(g.items.filter(it => it === carried)).toHaveLength(1);
        expect(g.items.filter(it => it.category === ItemCategory.GOLD)).toHaveLength(1);
        expect(g.stats.kills).toBe(1); expect(gas).toHaveBeenCalledTimes(1); expect(drops).toHaveBeenCalledTimes(1);
        (g as any).triggerDeathFeatures(); tick(g); expect(gas).toHaveBeenCalledTimes(1); expect(drops).toHaveBeenCalledTimes(1);
    });
    it('poison pulses never split; later physical split inherits independent poison fields', () => {
        const g = scene(), m = mob(g, 'pink_jelly'); m.addPoison(4, 2); tick(g); expect(g.monsters).toHaveLength(1);
        (g as any).trySplitMonster(m, g.player); expect(g.monsters).toHaveLength(2);
        const clone = g.monsters[1]!; expect([clone.poisonAmount, clone.getStatusDuration('poisoned')]).toEqual([2, 3]);
        m.addPoison(2); expect([clone.poisonAmount, clone.getStatusDuration('poisoned')]).toEqual([2, 3]);
    });
    it('G-3 gas stays direct terrain damage, never adds a dose or countdown', () => {
        const g = live(); g.environment.addGas(4, 5, GasType.POISON, 1000);
        (g as any).applyEnvironmentalEffects();
        expect(g.player.hp).toBe(80); expect(g.player.poisonAmount).toBe(0); expect(g.player.hasStatus('poisoned')).toBe(false);
    });
    it('UI staff submission consumes once; cancel never poisons, confirms tick once and save keeps E separate', () => {
        const g = live(), m = mob(g); const item = ItemLoader.spawnStaff('staff_of_poison', -1, -1)!;
        Object.assign(item, { enchantment: 8, charges: 1, maxCharges: 8 }); g.player.inventory.addItem(item);
        g.useArcanaItem(item); g.cancelArcanaSelection(); expect(item.charges).toBe(1); expect(m.poisonAmount).toBe(0);
        g.useArcanaItem(item); g.setArcanaTarget(8, 5); g.grid.getCell(8, 5)!.isVisible = true; g.confirmArcanaTarget();
        expect([item.charges, item.enchantment, m.hp, m.poisonAmount, m.getStatusDuration('poisoned')]).toEqual([0, 8, 99, 1, 23]);
        expect(ItemLoader.identifiedItems.has('staff_of_poison')).toBe(true);
    });
});
