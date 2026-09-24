import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CombatSystem } from '../engine/Combat/Combat';
import { accuracyFraction, damageFraction, defenseFraction, hitProbability, clumpedRoll, playerDefense } from '../engine/Combat/CombatFormulas';
import { rng } from '../engine/Random';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import weapons from '../data/weapons.json';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { deserializeItem, serializeItem, serializeMonster, restoreEntityGraph } from '../engine/Core/EntitySnapshot';
import { createHeadlessGame } from './harness';
import { TerrainType } from '../engine/Map/Grid';

const golden = JSON.parse(fs.readFileSync('ai_docs/reports/u-13-evidence/ce-combat.json', 'utf8')) as {
    hits: { accuracy: number; defense: number; enchant: number | null; hit: number }[];
    fractions: { enchant: number; accuracy: number; damage: number }[];
    defenses: { defense: number; fraction: number }[];
    equipment: { lo: number; hi: number; clump: number; enchant: number; strength: number; scaledLo: number; scaledHi: number; defense: number }[];
    ranges: { lo: number; hi: number; clump: number; dice: number[][]; combinations: number; weights: number[] }[];
};
const data = (id: string) => (monsters as MonsterData[]).find(m => m.id === id)!;
function mob(id = 'rat') {
    const m = new Monster(5, 5, data(id));
    m.hp = m.maxHp = 10000; m.state = MonsterState.HUNTING;
    return m;
}
function player(weapon?: string) {
    const p = new Player(4, 5); p.hp = p.maxHp = 10000;
    if (weapon) {
        p.equippedWeapon = ItemLoader.spawnWeapon(weapon, -1, -1)!;
        p.equippedWeapon.enchantment = 0; p.equippedWeapon.runicType = undefined;
        p.strength = p.equippedWeapon.strengthRequired!;
    }
    return p;
}
afterEach(() => vi.restoreAllMocks());

describe('U13 compiled original CE mathematics', () => {
    it('1215 hit probabilities include zero/negative defense/short maxima and every integer enchant', () => {
        for (const r of golden.hits) expect(hitProbability(r.accuracy, r.defense, r.enchant ?? undefined), JSON.stringify(r)).toBe(r.hit);
    });
    it('all 281 enchant table entries and 711 defense boundary inputs match exactly', () => {
        for (const r of golden.fractions) {
            expect(accuracyFraction(r.enchant) * 65536).toBe(r.accuracy);
            expect(damageFraction(r.enchant) * 65536).toBe(r.damage);
        }
        for (const r of golden.defenses) expect(defenseFraction(r.defense) * 65536).toBe(r.fraction);
        expect(accuracyFraction(-100)).toBe(accuracyFraction(-20));
        expect(damageFraction(100)).toBe(damageFraction(50));
    });
    it.each(golden.ranges)('every tuple and RNG range of {$lo,$hi,$clump} matches CE', r => {
        const counts = Array(r.weights.length).fill(0);
        for (let n = 0; n < r.combinations; n++) {
            let tuple = n; const calls: number[][] = [];
            const result = clumpedRoll(r.lo, r.hi, r.clump, (lo, hi) => {
                calls.push([lo, hi]); const v = lo + tuple % (hi - lo + 1);
                tuple = Math.trunc(tuple / (hi - lo + 1)); return v;
            });
            counts[result - r.lo]++;
            expect(calls).toEqual(r.dice);
        }
        expect(counts).toEqual(r.weights);
    });
    it('168 original recalculateEquipmentBonuses cases reach actual player melee, including negative enchant and strength boundaries', () => {
        const p = player('javelin'), m = mob();
        let high = false;
        vi.spyOn(rng, 'randRange').mockImplementation((lo, hi) => high ? hi : lo);
        for (const r of golden.equipment) {
            Object.assign(p.equippedWeapon!, { damage: `${r.lo}-${r.hi}`, clumping: r.clump, enchantment: r.enchant, strengthRequired: 12 });
            p.strength = r.strength;
            // Captive bypasses hit probability without a damage multiplier.
            m.isCaged = true; high = false;
            expect(CombatSystem.attack(p, m).damage, JSON.stringify(r)).toBe(r.scaledLo);
            high = true;
            expect(CombatSystem.attack(p, m).damage, JSON.stringify(r)).toBe(r.scaledHi);
            expect(playerDefense(3, r.enchant, r.strength, 12)).toBe(r.defense);
        }
    });
});

describe('U13 complete damage ranges through actual actors', () => {
    it.each(['eel', 'ogre', 'spider', 'troll', 'dragon'])('%s melee consumes the CE distribution, not just its mean', id => {
        const m = mob(id), p = player(); m.accuracy = 100;
        const parts = CombatSystem.parseDamageString(m.damageString);
        const r = golden.ranges.find(r => r.lo === parts.min && r.hi === parts.max && r.clump === m.damageClumping)!;
        const counts = Array(r.weights.length).fill(0);
        let tuple = 0;
        const roll = vi.spyOn(rng, 'randRange').mockImplementation((lo, hi) => {
            if (hi === 99) return 0;
            const n = lo + tuple % (hi - lo + 1); tuple = Math.trunc(tuple / (hi - lo + 1)); return n;
        });
        for (let n = 0; n < r.combinations; n++) {
            tuple = n; p.hp = p.maxHp; p.statusDurations = {}; p.poisonAmount = 0; roll.mockClear();
            const hit = CombatSystem.attack(m, p);
            const rolled = id === 'spider' ? p.statusDurations.poisoned! : hit.damage;
            if (id === 'spider') expect(hit.damage).toBe(1);
            counts[rolled - r.lo]++;
            expect(roll.mock.calls).toEqual([[0, 99], ...r.dice]);
        }
        expect(counts).toEqual(r.weights);
    });
    it('javelin clump survives loading and melee; enchanted endpoints scale before rolling', () => {
        const p = player('javelin'), m = mob(); m.defense = 0;
        expect(p.equippedWeapon!.clumping).toBe(3);
        p.equippedWeapon!.enchantment = 10; // CE floor({3,11}*123020/65536)={5,20}
        const roll = vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
        expect(CombatSystem.attack(p, m).damage).toBe(5);
        expect(roll.mock.calls).toEqual([[0, 99], [0, 5], [0, 5], [0, 5]]);
        // This range can roll 6; scaling an already rolled base die cannot.
        roll.mockClear(); let first = true;
        roll.mockImplementation((_lo, hi) => hi === 99 ? 0 : first ? (first = false, 1) : 0);
        expect(CombatSystem.attack(p, m).damage).toBe(6);
    });
    it('unarmed is CE {1,2,1}; zero ranges have no minimum-one damage or random draw', () => {
        const p = player(), m = mob(); m.defense = 0;
        const roll = vi.spyOn(rng, 'randRange').mockImplementation((_lo, hi) => hi === 99 ? 0 : hi);
        expect(CombatSystem.attack(p, m).damage).toBe(2);
        expect(roll.mock.calls).toEqual([[0, 99], [1, 2]]);
        m.damageString = '0d1'; m.damageClumping = 0; m.accuracy = 100; roll.mockClear();
        expect(CombatSystem.attack(m, p).damage).toBe(0);
        expect(roll.mock.calls).toEqual([[0, 99]]);
        expect(CombatSystem.parseDamageString('0').min).toBe(0);
    });
    it('all catalog clumps survive constructor/form/empower/clone/JSON restore without new draws', () => {
        for (const row of monsters) {
            const m = mob(row.id); expect(m.damageClumping).toBe(row.clumping);
            const before = rng.randomNumbersGenerated; m.empower();
            expect(m.damageClumping).toBe(row.clumping); expect(m.snapshotForm().clumping).toBe(row.clumping);
            const saved = JSON.parse(JSON.stringify(serializeMonster(m)));
            const restored = restoreEntityGraph([saved]).monsters.get(m.id)!;
            expect(restored.damageClumping).toBe(row.clumping);
            expect(rng.randomNumbersGenerated).toBe(before);
            expect(m.copyForClone().damageClumping).toBe(row.clumping);
        }
        for (const row of weapons.filter(w => w.id !== 'halberd')) {
            const w = ItemLoader.spawnWeapon(row.id, 0, 0)!;
            expect(w.clumping).toBe(row.clumping);
            expect(deserializeItem(JSON.parse(JSON.stringify(serializeItem(w)))).clumping).toBe(row.clumping);
        }
    });
    it('polymorph installs the new species clump', () => {
        const m = mob('ogre'); m.polymorph(() => {});
        expect(m.damageClumping).toBe(data(m.typeId).clumping);
    });
});

describe('U13 short circuits, multipliers, order, and real substantive counts', () => {
    it.each([['rat', 2], ['eel', 3], ['spider', 2], ['troll', 4], ['dragon', 5]] as const)('%s substantive count=%s (a 0..0 clump call consumes no random number)', (id, count) => {
        const a = mob(id), p = player(); a.accuracy = 100;
        rng.seedRandomGenerator(13); const before = rng.randomNumbersGenerated;
        expect(CombatSystem.attack(a, p).hit).toBe(true);
        expect(rng.randomNumbersGenerated - before).toBe(count);
    });
    it.each(['sleep', 'wander', 'paralyzed', 'lunge', 'captive', 'inanimate-paralyzed'] as const)('%s has no hit die and only the CE multiplier', mode => {
        const p = player('dagger'), m = mob(); m.defense = 32767;
        const beforeTicks = m.ticksUntilTurn;
        if (mode === 'sleep') m.state = MonsterState.ASLEEP;
        if (mode === 'wander') m.state = MonsterState.WANDERING;
        if (mode.includes('paralyzed')) m.statusDurations.paralyzed = 5;
        if (mode === 'inanimate-paralyzed') m.behaviorFlags.add('MONST_INANIMATE');
        if (mode === 'captive') m.isCaged = true;
        rng.seedRandomGenerator(13); const before = rng.randomNumbersGenerated;
        const roll = vi.spyOn(rng, 'randRange');
        const result = CombatSystem.attack(p, m, { lungeAttack: mode === 'lunge' });
        const backstab = ['sleep', 'wander', 'paralyzed'].includes(mode);
        expect(result.hit).toBe(true); expect(result.backstab).toBe(backstab);
        expect([3, 4].map(n => n * (backstab || mode === 'lunge' ? 5 : 1))).toContain(result.damage);
        expect(roll.mock.calls).toEqual([[3, 4]]); expect(rng.randomNumbersGenerated - before).toBe(1);
        expect(m.ticksUntilTurn).toBe(beforeTicks + (backstab ? 100 : 0));
        if (backstab) expect(m.state).toBe(MonsterState.HUNTING);
    });
    it('sleep/paralysis/lunge overlap multiplies only once; ally wandering and inanimate sleep have no bonus', () => {
        const p = player('dagger'), m = mob(); m.state = MonsterState.ASLEEP; m.statusDurations.paralyzed = 5;
        vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
        expect(CombatSystem.attack(p, m, { lungeAttack: true }).damage).toBe(15);
        m.statusDurations = {}; m.state = MonsterState.WANDERING; m.isAlly = true;
        expect(CombatSystem.attack(p, m).backstab).toBe(false);
        m.isAlly = false; m.state = MonsterState.ASLEEP; m.behaviorFlags.add('MONST_INANIMATE');
        expect(CombatSystem.attack(p, m).backstab).toBe(false);
    });
    it('monster→sleeping monster / paralyzed player uses generic ×3 and no hit roll', () => {
        const a = mob('ogre'), d = mob(), p = player(); d.state = MonsterState.ASLEEP; p.statusDurations.paralyzed = 4;
        const roll = vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
        expect(CombatSystem.attack(a, d).damage).toBe(27); expect(CombatSystem.attack(a, p).damage).toBe(27);
        expect(roll.mock.calls).toEqual([[0, 2], [0, 2], [0, 2], [0, 2]]);
    });
    it('ordinary 100% and seized 100% still consume a hit die; first seizure/kamikaze/aquatic rejection consume none', () => {
        const a = mob('bog_monster'), p = player(); a.accuracy = 0;
        rng.seedRandomGenerator(13); const roll = vi.spyOn(rng, 'randRange'), before = rng.randomNumbersGenerated;
        expect(CombatSystem.attack(a, p).seized).toBe(true); expect(roll).not.toHaveBeenCalled();
        expect(CombatSystem.attack(a, p).hit).toBe(true); expect(roll.mock.calls).toEqual([[0, 99], [3, 4]]);
        expect(rng.randomNumbersGenerated - before).toBe(2);
        const b = mob('bloat'); roll.mockClear(); CombatSystem.attack(b, p); expect(roll).not.toHaveBeenCalled();
        p.statusDurations.levitating = 4; roll.mockClear(); CombatSystem.attack(a, p); expect(roll).not.toHaveBeenCalled();
    });
    it('miss/immune skip damage dice; immune sneak still wakes and delays; zero damage never calls armor callback', () => {
        const a = mob('ogre'), d = mob(); a.accuracy = 0;
        const roll = vi.spyOn(rng, 'randRange').mockImplementation(lo => lo), armor = vi.fn(n => n);
        expect(CombatSystem.attack(a, d).hit).toBe(false); expect(roll.mock.calls).toEqual([[0, 99]]);
        a.accuracy = 100; d.behaviorFlags.add('MONST_IMMUNE_TO_WEAPONS'); d.state = MonsterState.ASLEEP;
        const ticks = d.ticksUntilTurn; roll.mockClear();
        expect(CombatSystem.attack(a, d, { beforeDamage: armor }).damage).toBe(0);
        expect(roll).not.toHaveBeenCalled(); expect(armor).not.toHaveBeenCalled(); expect(d.ticksUntilTurn).toBe(ticks + 100);
        expect(d.state).toBe(MonsterState.HUNTING);
    });
    it('invisibility has no extra multiplier and weakened duration cannot substitute for U14 weaknessAmount', () => {
        const p = player('sword'), m = mob('ogre'); m.defense = 0;
        vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
        const normal = CombatSystem.attack(p, m).damage;
        p.statusDurations.invisible = p.statusDurations.weakened = 10;
        expect(CombatSystem.attack(p, m).damage).toBe(normal);
        m.accuracy = 100; const monsterNormal = CombatSystem.attack(m, p).damage;
        m.statusDurations.weakened = 10; expect(CombatSystem.attack(m, p).damage).toBe(monsterNormal);
    });
    it('real BE_ATTACK entry consumes full clump with its normal hit roll', () => {
        const g = createHeadlessGame(13, 'test'); g.monsters = []; g.items = [];
        for (let x = 3; x < 10; x++) g.grid.setTerrain(x, 5, TerrainType.FLOOR);
        g.player = player(); const a = mob('centaur'); a.loc = { x: 8, y: 5 }; a.accuracy = 100; g.monsters.push(a);
        const roll = vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
        g.castMonsterBolt(a, g.player, 'DISTANCE_ATTACK');
        expect(g.player.hp).toBe(9996);
        // Existing Game presentation tail: FloatingText ID, then spawnBlood chance.
        expect(roll.mock.calls).toEqual([[0, 99], [0, 2], [0, 2], [1, 1000000], [0, 99]]);
    });
});
