import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import type { Creature } from '../entities/Creature';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { CombatSystem } from '../engine/Combat/Combat';
import { MONSTER_BOLT_TABLE } from '../engine/Combat/Bolt';
import { CEBoltType, CEBoltEffect, CE_BOLT_CATALOG } from '../engine/Combat/BoltCatalog';
import { rollStaffDamage, staffDamageRange } from '../engine/Combat/StaffDamage';
import { Random, rng } from '../engine/Random';
import { Item, ItemCategory } from '../engine/Items/Item';
import { logger } from '../engine/Systems/Logger';

const families = [
    { name: 'SPARK', magnitude: 1, low: 2, high: 6, clumps: 1 },
    { name: 'FIRE', magnitude: 4, low: 4, high: 14, clumps: 2 },
    { name: 'DRAGONFIRE', magnitude: 18, low: 15, high: 49, clumps: 7 },
];
type Internals = {
    finishTurnEpilogue(): void;
    negateCreatureMagic(m: Monster): boolean;
};
const priv = (g: Game) => g as unknown as Internals;
function scene() {
    const g = createHeadlessGame(6006, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        Object.assign(g.grid.getCell(x, y)!, { isVisible: true, hasDormantMonster: false, machineNumber: 0 });
    }
    g.player.loc = { x: 4, y: 8 }; g.player.hp = g.player.maxHp = 100;
    g.spawnFloatingText = vi.fn(); g.spawnBlood = vi.fn();
    return g;
}
function mob(g: Game, x = 8, id = 'rat', y = 5) {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.hp = m.maxHp = 100; g.monsters.push(m); return m;
}
const burning = (c: Creature) => (c.statusDurations as Record<string, number>).burning ?? 0;
const messages = () => logger.messages.map(m => m.text).join('\n');
beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('U06 CE compiled staffDamage goldens and real contacts', () => {
    it.each(families)('$name catalog magnitude and exhaustive CE distribution', ({ name, magnitude, low, high, clumps }) => {
        const golden = JSON.parse(fs.readFileSync('ai_docs/reports/u-06-evidence/ce-staff-damage.json', 'utf8'))
            .find((r: { magnitude: number }) => r.magnitude === magnitude);
        expect(MONSTER_BOLT_TABLE[name]!.magnitude).toBe(magnitude);
        expect(staffDamageRange(magnitude)).toEqual({ low, high, clumps });
        const random = new Random(6), weights = Array(high - low + 1).fill(0);
        let tuple = 0, calls: number[][] = [];
        random.randRange = (lo, hi) => {
            calls.push([lo, hi]); const n = lo + tuple % (hi - lo + 1);
            tuple = Math.floor(tuple / (hi - lo + 1)); return n;
        };
        for (let n = 0; n < golden.combinations; n++) {
            tuple = n; calls = [];
            weights[rollStaffDamage(magnitude, random) - low]++;
            if (n === 0 || n === golden.combinations - 1) expect(calls).toEqual(golden.dice);
        }
        expect(weights).toEqual(golden.weights);
    });

    it.each(families)('$name ignores caster accuracy/damage/status/riders and monster armor, consumes only CE dice', ({ name, clumps, low, high }) => {
        const g = scene(), caster = mob(g, 12), target = mob(g);
        const attack = vi.spyOn(CombatSystem, 'attack'), percent = vi.spyOn(rng, 'randPercent');
        const losses: number[] = [];
        for (const [accuracy, damage, defense] of [[0, '0', 99999], [1, '1', 0], [99999, '99999', 99999]] as const) {
            caster.accuracy = accuracy; caster.damageString = damage; target.defense = defense;
            caster.abilityFlags = new Set(['MA_POISONS', 'MA_CAUSES_WEAKNESS', 'MA_HIT_HALLUCINATE', 'MA_SEIZES', 'MA_KAMIKAZE']);
            caster.onHitStatus = 'confused'; caster.onHitChance = 1; caster.onHitDuration = 99;
            caster.setStatusDuration('weakened', 10); caster.setStatusDuration('invisible', 10);
            target.hp = 100; target.state = MonsterState.ASLEEP; (target.statusDurations as Record<string, number>).burning = 0;
            rng.seedRandomGenerator(601); rng.resetCounters();
            const result = g.castMonsterBolt(caster, target, name)!;
            losses.push(100 - target.hp);
            expect(rng.randomNumbersGenerated).toBe(clumps);
            expect(result.hits.map(h => h.creature)).toEqual([target]); expect(result.outcome?.autoID).toBe(true);
            expect(target.state).toBe(MonsterState.HUNTING);
            expect(target.poisonAmount).toBe(0); expect(target.seized).toBe(false);
            expect(caster.hp).toBe(100);
        }
        expect(new Set(losses).size).toBe(1); expect(losses[0]).toBeGreaterThanOrEqual(low); expect(losses[0]).toBeLessThanOrEqual(high);
        expect(attack).not.toHaveBeenCalled(); expect(percent).not.toHaveBeenCalled();
    });

    it.each(families)('$name ignores player armor and armor runics; no melee on-hit statuses', ({ name, clumps }) => {
        const g = scene(), caster = mob(g, 12); g.player.loc = { x: 8, y: 5 };
        caster.abilityFlags.add('MA_POISONS'); caster.abilityFlags.add('MA_CAUSES_WEAKNESS'); caster.abilityFlags.add('MA_HIT_HALLUCINATE');
        caster.onHitStatus = 'confused'; caster.onHitChance = 1; caster.onHitDuration = 99;
        const hook = vi.spyOn(g, 'tryTriggerArmorRunic'), losses: number[] = [];
        for (const defense of [0, 99999]) {
            const armor = new Item('armor', ']', 0, ItemCategory.ARMOR);
            armor.armor = defense; armor.runicType = 'immunity'; armor.enchantment = 50; g.player.equippedArmor = armor;
            g.player.hp = 100; (g.player.statusDurations as Record<string, number>).burning = 0; rng.seedRandomGenerator(603); rng.resetCounters();
            g.castMonsterBolt(caster, g.player, name); losses.push(100 - g.player.hp);
            expect(rng.randomNumbersGenerated).toBe(clumps);
            for (const id of ['poisoned', 'weakened', 'hallucinating', 'confused'] as const) expect(g.player.hasStatus(id)).toBe(false);
        }
        expect(losses[0]).toBe(losses[1]); expect(hook).not.toHaveBeenCalled();
    });

    it.each(families)('$name reaches both CE endpoints with exactly the declared dice order', ({ name, low, high }) => {
        const g = scene(), caster = mob(g, 12), target = mob(g);
        for (const endpoint of ['low', 'high'] as const) {
            target.hp = 100;
            const range = vi.spyOn(rng, 'randRange').mockImplementation((lo, hi) => endpoint === 'low' ? lo : hi);
            g.castMonsterBolt(caster, target, name);
            expect(100 - target.hp).toBe(endpoint === 'low' ? low : high);
            range.mockRestore();
        }
    });
});

describe('U06 immunity, shields, survivor effects and negation', () => {
    for (const name of ['FIRE', 'DRAGONFIRE']) {
        it.each(['player', 'status', 'flag', 'invulnerable'])(`${name}: %s immunity precedes RNG, preserves shield, emits immunity and ignites terrain`, kind => {
            const g = scene(), caster = mob(g, 12), target = kind === 'player' ? g.player : mob(g, 8, kind === 'flag' ? 'salamander' : kind === 'invulnerable' ? 'Warden_of_Yendor' : 'rat');
            target.loc = { x: 8, y: 5 };
            if (kind === 'status' || kind === 'player') target.setStatusDuration('immune_fire', 10);
            target.applyShield(100); g.grid.setTerrainLayer(8, 5, L.SURFACE, T.GRASS);
            const roll = vi.spyOn(rng, 'randClumpedRange'), ignite = vi.spyOn(g.environment, 'ignite');
            const r = g.castMonsterBolt(caster, target, name)!;
            expect(target.hp).toBe(100); expect(target.getStatusDuration('shielded')).toBe(100);
            expect(!!burning(target)).toBe(false); expect(roll).not.toHaveBeenCalled();
            expect(r.outcome?.autoID).toBe(true); expect(ignite).toHaveBeenCalledWith(8, 5);
            expect(g.grid.getCell(8, 5)!.layers[L.SURFACE]).not.toBe(T.GRASS); expect(messages()).toContain('unaffected');
        });
    }
    it('spark harms fire/weapon immune targets, but invulnerability consumes no roll and does not stop piercing', () => {
        const g = scene(), caster = mob(g, 14), fireproof = mob(g, 11, 'salamander'), invulnerable = mob(g, 9, 'Warden_of_Yendor'), revenant = mob(g, 7, 'revenant');
        const range = vi.spyOn(rng, 'randClumpedRange').mockReturnValue(4);
        g.castMonsterBolt(caster, fireproof, 'SPARK');
        expect([fireproof.hp, invulnerable.hp, revenant.hp]).toEqual([96, 100, 96]); expect(range).toHaveBeenCalledTimes(2);
    });
    it.each([100, 25, 20])('shield=%i absorbs once; shield-only hits still burn and release control', shield => {
        const g = scene(), caster = mob(g, 12), target = mob(g);
        target.applyShield(shield); target.setStatusDuration('entranced', 8); target.setStatusDuration('paralyzed', 8);
        caster.attackSpeed = 70;
        vi.spyOn(rng, 'randClumpedRange').mockReturnValue(4);
        g.castMonsterBolt(caster, target, 'FIRE');
        expect(target.hp).toBe(shield === 100 ? 100 : shield === 25 ? 99 : 98);
        expect([target.getStatusDuration('shielded'), target.maxShield]).toEqual(shield === 100 ? [60, 100] : [0, 0]);
        expect(burning(target)).toBe(7); expect(target.hasStatus('entranced')).toBe(false);
        expect(target.hasStatus('paralyzed')).toBe(false); expect(target.ticksUntilTurn).toBe(69);
        expect(messages()).not.toContain('misses');
    });
    it.each([false, true])('transference remains after shields and before damage (ally=%s), including reflected self-hit', ally => {
        const g = scene(), caster = mob(g, 6), guardian = mob(g, 10, 'stone_guardian');
        caster.isAlly = ally; caster.abilityFlags.add('MA_TRANSFERENCE'); caster.hp = 10; caster.applyShield(10);
        vi.spyOn(rng, 'randClumpedRange').mockReturnValue(6);
        const r = g.castMonsterBolt(caster, guardian, 'SPARK')!;
        expect(r.hits.map(h => h.creature)).toEqual([caster]); expect(caster.hp).toBe(ally ? 7 : 9);
        expect(caster.maxShield).toBe(0);
    });
    it('negating innate fire immunity exposes the same target to the new direct damage exit', () => {
        const g = scene(), caster = mob(g, 12), target = mob(g, 8, 'salamander');
        const roll = vi.spyOn(rng, 'randClumpedRange').mockReturnValue(4);
        g.castMonsterBolt(caster, target, 'FIRE'); expect(target.hp).toBe(100); expect(roll).not.toHaveBeenCalled();
        expect(priv(g).negateCreatureMagic(target)).toBe(true); expect(target.hasStatus('immune_fire')).toBe(false);
        g.castMonsterBolt(caster, target, 'FIRE'); expect(target.hp).toBe(96); expect(roll).toHaveBeenCalledTimes(1);
        expect(burning(target)).toBe(7);
    });
    it('monster-origin reflected damage splits the surviving recipient after ignition', () => {
        const g = scene(), caster = mob(g, 6, 'pink_jelly'), guardian = mob(g, 10, 'stone_guardian');
        vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
        const r = g.castMonsterBolt(caster, guardian, 'FIRE')!;
        expect(r.hits.map(h => h.creature)).toEqual([caster]);
        const jellies = g.monsters.filter(m => m.typeId === 'pink_jelly');
        expect(jellies).toHaveLength(2); expect(jellies.map(m => m.hp)).toEqual([48, 48]);
        expect(jellies.every(m => burning(m) === 7)).toBe(true);
    });
    it('negation removes actual damage casting abilities; next turn cannot cast them', () => {
        const g = scene(), caster = mob(g, 12, 'spark_turret'); caster.bolts = ['FIRE', 'SPARK', 'DRAGONFIRE'];
        g.player.loc = { x: 8, y: 5 }; caster.state = MonsterState.WANDERING;
        vi.spyOn(rng, 'randPercent').mockReturnValue(true);
        expect(caster.tryUseBolt(g)).toBe(true); // Prove this fixture can cast before negation.
        expect(priv(g).negateCreatureMagic(caster)).toBe(true); expect(caster.bolts).toEqual([]);
        const cast = vi.spyOn(g, 'castMonsterBolt'); caster.takeTurn(g, 12); expect(cast).not.toHaveBeenCalled();
    });
});

describe('U06 reflected attribution/death and preserved BE_ATTACK', () => {
    it('reflected spark kills caster and player in order; player death stops piercing and credits original caster', () => {
        const g = scene(), caster = mob(g, 8), guardian = mob(g, 12, 'stone_guardian'), behind = mob(g, 2);
        g.player.loc = { x: 4, y: 5 }; g.player.hp = 1; caster.hp = 1;
        const name = caster.name; vi.spyOn(rng, 'randClumpedRange').mockReturnValue(2);
        const r = g.castMonsterBolt(caster, guardian, 'SPARK')!;
        expect(r.hits.map(h => h.creature)).toEqual([caster, g.player]); expect(r.landingPos).toEqual(g.player.loc);
        expect([caster.hp, g.player.hp, behind.hp, guardian.hp]).toEqual([0, 0, 100, 100]);
        expect(g.lastDamageSource).toBe(name);
        priv(g).finishTurnEpilogue();
        expect(g.isGameOver).toBe(true); expect(g.gameOverReason).toBe(`Killed by a ${name} on depth 1.`); // U26b: CE RogueMain.c:1162 includes depth
        expect(g.gameOverReason).not.toContain('reflected'); expect(g.monsters).not.toContain(caster);
    });
    it('armor reflection identifies armor and deals fixed fire damage to the original caster', () => {
        const g = scene(), caster = mob(g, 12); g.player.loc = { x: 8, y: 5 };
        const armor = new Item('reflecting armor', ']', 0, ItemCategory.ARMOR);
        armor.runicType = 'reflection'; armor.enchantment = 50; armor.strengthRequired = g.player.strength; g.player.equippedArmor = armor;
        vi.spyOn(rng, 'randPercent').mockReturnValue(true); vi.spyOn(rng, 'randClumpedRange').mockReturnValue(14);
        const r = g.castMonsterBolt(caster, g.player, 'FIRE')!;
        expect(r.hits.map(h => h.creature)).toEqual([caster]); expect([caster.hp, g.player.hp]).toEqual([86, 100]);
        expect(armor.runicKnown).toBe(true);
    });
    it('lethal flame does not ignite player or terrain after the death return', () => {
        const g = scene(), caster = mob(g, 12); g.player.loc = { x: 8, y: 5 }; g.player.hp = 1;
        g.grid.setTerrainLayer(8, 5, L.SURFACE, T.GRASS);
        vi.spyOn(rng, 'randClumpedRange').mockReturnValue(4);
        g.castMonsterBolt(caster, g.player, 'FIRE');
        expect(g.player.hp).toBe(0); expect(!!burning(g.player)).toBe(false);
        expect(g.grid.getCell(8, 5)!.layers[L.SURFACE]).toBe(T.GRASS);
    });
    it('killed bloat reaches ordinary death DF/carried-drop cleanup exactly once', () => {
        const g = scene(), caster = mob(g, 12), target = mob(g, 8, 'bloat'); target.hp = 1;
        const key = new Item('key', ';', 0, ItemCategory.KEY); target.carriedItem = key;
        const gas = vi.spyOn(g.environment, 'addGas'); vi.spyOn(rng, 'randClumpedRange').mockReturnValue(4);
        g.castMonsterBolt(caster, target, 'FIRE'); expect(target.hp).toBe(0); expect(!!burning(target)).toBe(false);
        priv(g).finishTurnEpilogue(); priv(g).finishTurnEpilogue();
        expect(gas).toHaveBeenCalledTimes(1); expect(g.items.filter(i => i === key)).toHaveLength(1);
        expect(g.monsters).not.toContain(target);
    });
    it.each(['DISTANCE_ATTACK', 'POISON_DART'])('%s retains accuracy miss, weapon immunity, attack damage/riders and RNG', name => {
        const g = scene(), caster = mob(g, 12), target = mob(g);
        target.state = MonsterState.HUNTING; // CE: an asleep target bypasses the accuracy roll.
        const attack = vi.spyOn(CombatSystem, 'attack'), staff = vi.spyOn(rng, 'randClumpedRange');
        caster.accuracy = 0; const percent = vi.spyOn(rng, 'randPercent').mockReturnValue(false);
        g.castMonsterBolt(caster, target, name); expect(target.hp).toBe(100);
        expect(attack).toHaveBeenCalledWith(caster, target, { isWeaponAttack: true }); expect(percent).toHaveBeenCalled(); expect(staff).not.toHaveBeenCalled();
        percent.mockReturnValue(true); caster.damageString = '6'; caster.abilityFlags.add('MA_POISONS');
        g.castMonsterBolt(caster, target, name); expect(target.hp).toBe(99); expect(target.poisonAmount).toBe(1);
        target.behaviorFlags.add('MONST_IMMUNE_TO_WEAPONS'); const hp = target.hp;
        g.castMonsterBolt(caster, target, name); expect(target.hp).toBe(hp);
    });
    it('BE_ATTACK on an ASLEEP target short-circuits a false accuracy mock and wakes it', () => {
        for (const name of ['DISTANCE_ATTACK', 'POISON_DART']) {
            const g = scene(), caster = mob(g, 12), target = mob(g);
            const attack = vi.spyOn(CombatSystem, 'attack'), staff = vi.spyOn(rng, 'randClumpedRange');
            const percent = vi.spyOn(rng, 'randPercent').mockReturnValue(false);
            target.state = MonsterState.ASLEEP;
            caster.accuracy = 0; caster.damageString = '3';
            g.castMonsterBolt(caster, target, name);
            expect(attack).toHaveBeenCalledWith(caster, target, { isWeaponAttack: true });
            expect(attack).toHaveLastReturnedWith(expect.objectContaining({ hit: true, damage: 9, backstab: true }));
            expect(target.hp).toBe(91); expect(target.state).toBe(MonsterState.HUNTING);
            expect(percent).not.toHaveBeenCalled(); expect(staff).not.toHaveBeenCalled();
            vi.restoreAllMocks();
        }
    });
    it('WHIP remains CE BE_ATTACK on the existing geometry route, with no monster bolt-table addition', () => {
        const g = scene(), caster = mob(g, 8), target = g.player; target.loc = { x: 5, y: 5 };
        caster.abilityFlags.add('MA_ATTACKS_EXTEND');
        expect(CE_BOLT_CATALOG[CEBoltType.WHIP].effect).toBe(CEBoltEffect.ATTACK);
        expect(MONSTER_BOLT_TABLE.WHIP).toBeUndefined();
        const attack = vi.spyOn(CombatSystem, 'attack'), staff = vi.spyOn(rng, 'randClumpedRange');
        const acted = (caster as unknown as { performWhipAttack(g: Game, x: number, y: number): boolean }).performWhipAttack(g, -1, 0);
        expect(acted).toBe(true); expect(attack.mock.calls[0]!.slice(0, 2)).toEqual([caster, target]); expect(staff).not.toHaveBeenCalled();
    });
});
