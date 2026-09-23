import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData, monstersAreEnemies, specificallyValidBoltTarget } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { BoltEffect as B, getBoltForItem, type BoltConfig, type BoltResult } from '../engine/Combat/Bolt';
import { CEBoltType } from '../engine/Combat/BoltCatalog';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { createHeadlessGame } from './harness';

function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(18, 12);
    for (let x = 0; x < 18; x++) for (let y = 0; y < 12; y++) {
        g.grid.setTerrain(x, y, T.FLOOR); g.grid.getCell(x, y)!.isVisible = true;
    }
    g.player = new Player(4, 5); g.player.maxHp = 101; g.player.hp = 1;
    g.monsters = []; g.items = []; g.environment = new EnvironmentManager(g.grid);
    g.spawnFloatingText = vi.fn();
    (g as unknown as { updateVision(): void }).updateVision = vi.fn();
    return g;
}
function monster(g: Game, x = 8, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.maxHp = 101; m.hp = 1; g.monsters.push(m); return m;
}
const cases = [
    { id: 'wand_of_slowness', effect: B.SLOW, status: 'slowed', duration: 50 },
    { id: 'staff_of_haste', effect: B.HASTE, status: 'hasted', duration: 14 },
    { id: 'staff_of_healing', effect: B.HEALING, status: null, duration: 0 },
    { id: 'wand_of_invisibility', effect: B.INVISIBILITY, status: 'invisible', duration: 150 },
    { id: 'staff_of_discord', effect: B.DISCORD, status: 'discordant', duration: 12 },
] as const;
type Case = typeof cases[number];
function fixture(c: Case, E = 3) {
    const category = c.id.startsWith('staff') ? ItemCategory.STAFF : ItemCategory.WAND;
    const item = new Item(c.id, '/', 0xffffff, category);
    Object.assign(item, { identityId: c.id, enchantment: E, maxCharges: 99, charges: 1, arcanaInstanceVersion: 1 });
    // DISCORD has a CE identity but no web item yet. Exercise the effect without adding it to any pool.
    const bolt: BoltConfig = c.effect === B.DISCORD
        ? { ...getBoltForItem('staff_of_haste')!, id: c.id, effect: B.DISCORD, ceType: CEBoltType.DISCORD }
        : { ...getBoltForItem(c.id)! };
    bolt.magnitude = 987; // decoy legacy value; neither it nor charges/capacity is E.
    return { item, bolt };
}
function zap(g: Game, c: Case, E = 3, aim = { x: 8, y: 5 }) {
    const { item, bolt } = fixture(c, E);
    return g.zapBoltFromPlayer(bolt, item, aim);
}
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(9009); ItemLoader.identifiedItems.clear(); });

describe('W-9 real hits, misses and reflected recipients', () => {
    it.each(cases)('$id changes the contact, never the caster', c => {
        const g = scene(), m = monster(g); m.isAlly = true;
        const beforeRng = rng.randomNumbersGenerated;
        const r = zap(g, c);
        expect(r.hits.map(h => h.creature)).toEqual([m]); expect(r.outcome?.autoID).toBe(true);
        expect(g.player.hp).toBe(1); expect(g.player.statusDurations).toEqual({});
        if (c.status) expect(m.getStatusDuration(c.status)).toBe(c.duration);
        else expect(m.hp).toBe(31); // floor(30% of 101), not fixed 8 or 30% current HP
        expect(m.hasStatus('confused')).toBe(false);
        expect(rng.randomNumbersGenerated).toBe(beforeRng);
    });
    for (const mode of ['empty', 'wall', 'off-axis', 'origin'] as const) {
        it.each(cases)(`${mode}: $id has no hit, buff, healing or autoID`, c => {
            const g = scene();
            if (mode === 'wall') { g.grid.setTerrain(6, 5, T.WALL); monster(g); }
            if (mode === 'off-axis') monster(g, 8, 6);
            const r = zap(g, c, 3, mode === 'origin' ? g.player.loc : { x: 8, y: 5 });
            expect(r.hits).toEqual([]); expect(r.outcome?.autoID).toBe(false);
            expect(g.player.hp).toBe(1); expect(g.player.statusDurations).toEqual({});
            for (const m of g.monsters) { expect(m.hp).toBe(1); expect(m.statusDurations).toEqual({}); }
        });
    }
    it.each(cases)('$id returning from a reflector actually hits and affects the player', c => {
        const g = scene(), reflector = monster(g, 8, 5, 'stone_guardian');
        const original = { ...reflector.statusDurations };
        const r = zap(g, c);
        expect(r.reflections.map(r => r.creature)).toEqual([reflector]);
        expect(r.hits.map(h => h.creature)).toEqual([g.player]); expect(r.outcome?.autoID).toBe(true);
        expect(reflector.hp).toBe(1); expect(reflector.statusDurations).toEqual(original);
        if (c.status) expect(g.player.getStatusDuration(c.status)).toBe(c.duration);
        else expect(g.player.hp).toBe(31);
        expect(g.player.hasStatus('confused')).toBe(false);
    });
    it.each(cases)('$id random deflection into empty space is not a self-hit', c => {
        const g = scene(); monster(g, 8, 5, 'golem');
        vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        vi.spyOn(rng, 'randRange').mockReturnValue(16);
        const r = zap(g, c);
        expect(r.reflections).toHaveLength(1); expect(r.hits).toEqual([]);
        expect(r.outcome?.autoID).toBe(false); expect(g.player.hp).toBe(1); expect(g.player.statusDurations).toEqual({});
    });
    it.each(cases)('$id random deflection affects the bystander regardless of faction', c => {
        const g = scene(); monster(g, 8, 5, 'golem'); const bystander = monster(g, 8, 8); bystander.isAlly = true;
        vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        vi.spyOn(rng, 'randRange').mockReturnValue(16);
        const r = zap(g, c);
        expect(r.hits.map(h => h.creature)).toEqual([bystander]); expect(r.outcome?.autoID).toBe(true);
        expect(g.player.hp).toBe(1); expect(g.player.statusDurations).toEqual({});
        if (c.status) expect(bystander.getStatusDuration(c.status)).toBe(c.duration);
        else expect(bystander.hp).toBe(31);
    });
    it('discord changes allegiance checks used by the existing monster-on-monster attack', () => {
        const g = scene(), m = monster(g), neighbor = monster(g, 9);
        expect(monstersAreEnemies(m, neighbor)).toBe(false);
        zap(g, cases[4]);
        expect(monstersAreEnemies(m, neighbor)).toBe(true);
        expect(m.hasStatus('confused')).toBe(false);
    });
});

describe('W-9 CE numeric and state rules', () => {
    it.each([2, 3, 8, 12])('E=%s uses floor(maxHP*10E/100), clamps to max, and does not cure status', E => {
        const g = scene(), m = monster(g);
        m.setStatusDuration('poisoned', 19); m.setStatusDuration('slowed', 22);
        zap(g, cases[2], E);
        expect(m.hp).toBe(Math.min(101, 1 + Math.floor(101 * E / 10)));
        expect(m.statusDurations).toEqual({ poisoned: 19, slowed: 22 });
        m.hp = 100; zap(g, cases[2], E); expect(m.hp).toBe(101);
    });
    it('healing has no minimum one, and visible full-health/zero-rounding contacts still identify', () => {
        const g = scene(), m = monster(g); m.maxHp = 3; m.hp = 1;
        expect(zap(g, cases[2], 2).outcome?.autoID).toBe(true); expect(m.hp).toBe(1);
        m.hp = 3; expect(zap(g, cases[2], 2).outcome?.autoID).toBe(true); expect(m.hp).toBe(3);
    });
    it.each([2, 3, 8])('E=%s haste/discord are 2+4E/4E independent of charges/capacity', E => {
        const g = scene(), m = monster(g);
        zap(g, cases[1], E); expect(m.getStatusDuration('hasted')).toBe(2 + 4 * E);
        zap(g, cases[4], E); expect(m.getStatusDuration('discordant')).toBe(4 * E);
    });
    it.each([2, 8, 99])('wand enchantment=%s never replaces catalog magnitude 10', E => {
        const g = scene(), m = monster(g);
        zap(g, cases[0], E); expect(m.getStatusDuration('slowed')).toBe(50);
        zap(g, cases[3], E); expect(m.getStatusDuration('invisible')).toBe(150);
    });
    it.each([false, true])('speed overwrite, mutual exclusion including haste alias, expiry: player=%s', player => {
        const g = scene();
        const target = player ? g.player : monster(g);
        if (player) monster(g, 8, 5, 'stone_guardian');
        const baseMove = target.movementSpeed, baseAttack = target.attackSpeed;
        target.applyStatus('haste', 300); target.applyStatus('hasted', 300);
        zap(g, cases[0]);
        expect(target.getStatusDuration('slowed')).toBe(50);
        expect(target.hasStatus('haste')).toBe(false); expect(target.hasStatus('hasted')).toBe(false);
        expect([target.movementSpeed, target.attackSpeed]).toEqual([baseMove * 2, baseAttack * 2]);
        target.setStatusDuration('slowed', 300); zap(g, cases[0]); expect(target.getStatusDuration('slowed')).toBe(50);
        zap(g, cases[1], 8); expect(target.getStatusDuration('hasted')).toBe(34);
        zap(g, cases[1], 2); expect(target.getStatusDuration('hasted')).toBe(10);
        expect(target.hasStatus('slowed')).toBe(false);
        expect([target.movementSpeed, target.attackSpeed]).toEqual([Math.floor(baseMove / 2), Math.floor(baseAttack / 2)]);
        for (let i = 0; i < 10; i++) target.tickStatuses();
        expect([target.movementSpeed, target.attackSpeed]).toEqual([baseMove, baseAttack]);
    });
    it('invisibility overwrites while discord keeps max(old,4E), neither stacks', () => {
        const g = scene(), m = monster(g); m.isAlly = true;
        m.setStatusDuration('invisible', 300); zap(g, cases[3]); expect(m.getStatusDuration('invisible')).toBe(150);
        m.setStatusDuration('discordant', 300); expect(zap(g, cases[4]).outcome?.autoID).toBe(true);
        expect(m.getStatusDuration('discordant')).toBe(300);
        m.setStatusDuration('discordant', 1); zap(g, cases[4]); expect(m.getStatusDuration('discordant')).toBe(12);
    });
    for (const flag of ['MONST_INANIMATE', 'MONST_INVULNERABLE']) {
        it.each(cases)(`${flag}: $id applies exact CE effect gate (healing is allowed)`, c => {
            const g = scene(), m = monster(g); m.behaviorFlags.add(flag); m.isAlly = true;
            const r = zap(g, c);
            expect(r.hits.map(h => h.creature)).toEqual([m]);
            expect(m.statusDurations).toEqual({}); expect(m.hp).toBe(c.effect === B.HEALING ? 31 : 1);
            expect(r.outcome?.autoID).toBe([B.SLOW, B.HASTE, B.HEALING].includes(c.effect));
        });
    }
    it('native invisibility rejects imbue, ordinary temporary invisibility permits repeat; dormant is no hit', () => {
        const g = scene(), m = monster(g); m.isAlly = true; m.behaviorFlags.add('MONST_INVISIBLE');
        expect(zap(g, cases[3]).outcome?.autoID).toBe(false); expect(m.hasStatus('invisible')).toBe(false);
        m.behaviorFlags.delete('MONST_INVISIBLE');
        expect(zap(g, cases[3]).outcome?.autoID).toBe(true); expect(zap(g, cases[3]).outcome?.autoID).toBe(true);
        m.isDormant = true; const r = zap(g, cases[1]); expect(r.hits).toEqual([]); expect(r.outcome?.autoID).toBe(false);
    });
    it('CE directed states do not inherit custom web status immunity/resistance; generic entry remains separate', () => {
        const g = scene(), m = monster(g); m.isAlly = true;
        for (const c of cases) if (c.status) { m.statusImmunities.add(c.status); m.statusResistTurns[c.status] = 9; }
        for (const c of [cases[0], cases[1], cases[3], cases[4]]) {
            zap(g, c); expect(m.getStatusDuration(c.status!)).toBe(c.duration);
        }
    });
});

describe('W-9 observation and shared-entry boundaries', () => {
    it.each([cases[2], cases[4]])('$id only identifies an observable recipient, telepathy restores observation', c => {
        const g = scene(), m = monster(g); m.setStatusDuration('invisible', 99);
        expect(zap(g, c).outcome?.autoID).toBe(false);
        g.player.applyStatus('telepathy', 10); expect(zap(g, c).outcome?.autoID).toBe(true);
    });
    it('invisibility enemy disappearance is ambiguous; ally and telepathically revealed recipients identify', () => {
        const g = scene(), m = monster(g);
        expect(zap(g, cases[3]).outcome?.autoID).toBe(false);
        m.setStatusDuration('invisible', 0); g.player.applyStatus('telepathy', 10);
        expect(zap(g, cases[3]).outcome?.autoID).toBe(true);
        g.player.setStatusDuration('telepathy', 0); m.isAlly = true;
        g.grid.getCell(8, 5)!.isVisible = false; expect(zap(g, cases[3]).outcome?.autoID).toBe(true);
    });
    it('monster HEALING uses catalog E5=50%, HASTE E2=10, SLOW_2=10, DISCORD E10=40', () => {
        const g = scene(), caster = monster(g, 12), m = monster(g);
        m.maxHp = 101; m.hp = 1;
        expect(g.castMonsterBolt(caster, m, 'HEALING')!.hits.map(h => h.creature)).toEqual([m]); expect(m.hp).toBe(51);
        g.castMonsterBolt(caster, m, 'HASTE'); expect(m.getStatusDuration('hasted')).toBe(10);
        g.castMonsterBolt(caster, m, 'SLOW_2'); expect(m.getStatusDuration('slowed')).toBe(10); expect(m.hasStatus('hasted')).toBe(false);
        g.castMonsterBolt(caster, m, 'DISCORD'); expect(m.getStatusDuration('discordant')).toBe(40);
    });
    it('monster selection still rejects player discord, but reflected discord may hit the original caster', () => {
        const g = scene(), caster = monster(g, 12), reflector = monster(g, 8, 5, 'stone_guardian');
        expect(specificallyValidBoltTarget(caster, g.player, 'DISCORD', g)).toBe(false);
        const r = g.castMonsterBolt(caster, reflector, 'DISCORD')!;
        expect(r.hits.map(h => h.creature)).toEqual([caster]); expect(caster.getStatusDuration('discordant')).toBe(40);
        // A player in the flight path is a real contact even though not an AI candidate.
        g.player.loc = { x: 10, y: 5 };
        const r2 = g.castMonsterBolt(caster, reflector, 'DISCORD')!;
        expect(r2.hits.map(h => h.creature)).toEqual([g.player]); expect(g.player.getStatusDuration('discordant')).toBe(40);
    });
    it('P4-1b ally healing still selects only its teammate and now restores 50% max HP', () => {
        const g = scene(), caster = monster(g, 12, 5, 'unicorn'), ally = monster(g, 10);
        caster.isAlly = ally.isAlly = true; caster.hp = caster.maxHp; caster.bolts = ['HEALING'];
        caster.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY'); caster.state = MonsterState.HUNTING;
        g.player.hp = g.player.maxHp;
        expect(caster.tryUseBolt(g)).toBe(true); expect(ally.hp).toBe(51); expect(g.player.hp).toBe(101);
    });
    it('scroll discord still applies 30/max-refresh and preserves web immunity/resistance; negation clears states', () => {
        const g = scene(), normal = monster(g), resist = monster(g, 8, 6), immune = monster(g, 8, 7);
        resist.statusResistTurns.discordant = 7; immune.statusImmunities.add('discordant');
        const bridge = g as unknown as { discordBlastFromPlayer(s: string): void; negateCreatureMagic(c: Monster): void };
        bridge.discordBlastFromPlayer('scroll');
        expect(normal.getStatusDuration('discordant')).toBe(30); expect(resist.getStatusDuration('discordant')).toBe(23);
        expect(immune.getStatusDuration('discordant')).toBe(0);
        zap(g, cases[4], 12); bridge.discordBlastFromPlayer('scroll'); expect(normal.getStatusDuration('discordant')).toBe(48);
        bridge.negateCreatureMagic(normal); expect(normal.hasStatus('discordant')).toBe(false);
    });
    it.each([false, true])('real P2 confirmation with haste reflected=%s charges once; caster ticks follow actual recipient', reflected => {
        const g = createHeadlessGame(909);
        for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
            g.grid.setTerrain(x, y, T.FLOOR); g.grid.getCell(x, y)!.isVisible = true;
        }
        g.player.loc = { x: 4, y: 5 }; g.monsters = []; g.items = [];
        g.environment = new EnvironmentManager(g.grid); g.animationEnabled = false;
        const m = monster(g, 8, 5, reflected ? 'stone_guardian' : 'rat'); m.ticksUntilTurn = 100000;
        const item = ItemLoader.spawnStaff('staff_of_haste', -1, -1)!;
        Object.assign(item, { enchantment: 2, charges: 1, maxCharges: 2 }); g.player.inventory.items = [item];
        const tick = timeSystem.currentTick;
        g.useArcanaItem(item); g.setArcanaTarget(8, 5); const r = g.confirmArcanaTarget()!;
        expect(r.hits.map(h => h.creature)).toEqual([reflected ? g.player : m]); expect(item.charges).toBe(0);
        expect(timeSystem.currentTick - tick).toBe(reflected ? 50 : 100);
        expect(g.player.hasStatus('hasted')).toBe(reflected); expect(m.hasStatus('hasted')).toBe(!reflected);
    });
    it('preview is pure and discord remains absent from generated and directly constructible items', () => {
        const g = scene(), m = monster(g), { bolt } = fixture(cases[4]); const before = rng.randomNumbersGenerated;
        const r = (g as unknown as { computeBoltResult(b: BoltConfig, f: Player['loc'], t: Player['loc']): BoltResult })
            .computeBoltResult(bolt, g.player.loc, m.loc);
        expect(r.outcome).toBeNull(); expect(m.statusDurations).toEqual({}); expect(rng.randomNumbersGenerated).toBe(before);
        expect(ItemLoader.spawnStaff('staff_of_discord', -1, -1)).toBeNull();
    });
});
