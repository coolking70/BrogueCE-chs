import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { Game } from '../engine/Core/Game';
import { Grid, TerrainType as T, DungeonLayer as L } from '../engine/Map/Grid';
import { EnvironmentManager } from '../engine/Environment/Gas';
import { Player } from '../entities/Player';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { Item, ItemCategory } from '../engine/Items/Item';
import { getBoltForItem, type BoltConfig, type BoltResult } from '../engine/Combat/Bolt';
import { rollStaffDamage, staffDamageRange } from '../engine/Combat/StaffDamage';
import { CombatSystem } from '../engine/Combat/Combat';
import { Random, rng } from '../engine/Random';

function scene() {
    const g = Object.create(Game.prototype) as Game;
    g.grid = new Grid(18, 12);
    for (let x = 0; x < 18; x++) for (let y = 0; y < 12; y++) {
        g.grid.setTerrain(x, y, T.FLOOR);
        g.grid.getCell(x, y)!.isVisible = true;
    }
    g.player = new Player(4, 5); g.player.hp = g.player.maxHp = 100;
    g.monsters = []; g.items = []; g.environment = new EnvironmentManager(g.grid);
    g.spawnFloatingText = vi.fn(); g.spawnBlood = vi.fn();
    (g as unknown as { updateVision(): void }).updateVision = vi.fn();
    return g;
}
function monster(g: Game, x = 8, y = 5, id = 'rat') {
    const m = new Monster(x, y, (monsters as MonsterData[]).find(m => m.id === id)!);
    m.maxHp = m.hp = 100; g.monsters.push(m); return m;
}
function staff(E: number, id = 'staff_of_fire', charges = 1) {
    const item = new Item(id, '/', 0xff6600, ItemCategory.STAFF);
    Object.assign(item, { identityId: id, enchantment: E, maxCharges: E, charges, arcanaInstanceVersion: 1 });
    return item;
}
function zap(g: Game, item = staff(2), aim = { x: 8, y: 5 }, magnitude = 20) {
    return g.zapBoltFromPlayer({ ...getBoltForItem((item as Item & { identityId: string }).identityId)!, magnitude }, item, aim);
}
const burning = (c: Player | Monster) => (c.statusDurations as Record<string, number>).burning ?? 0;
const evidence: unknown[] = [];
afterAll(() => {
    if (process.env.W8_DISTRIBUTION_OUTPUT) fs.writeFileSync(process.env.W8_DISTRIBUTION_OUTPUT, JSON.stringify(evidence, null, 2) + '\n');
});
beforeEach(() => { vi.restoreAllMocks(); rng.seedRandomGenerator(8008); });

// Independent explicit CE dice: E2 U[3,9]; E3 3+U[0,4]+U[0,4];
// E8 7+U[0,6]+U[0,6]+U[0,5]. All endpoints inclusive (Math.c:40-59).
const tiers = [
    { E: 2, low: 3, high: 9, dice: [[3, 9]], weights: [1, 1, 1, 1, 1, 1, 1] },
    { E: 3, low: 3, high: 11, dice: [[0, 4], [0, 4]], weights: [1, 2, 3, 4, 5, 4, 3, 2, 1] },
    { E: 8, low: 7, high: 24, dice: [[0, 6], [0, 6], [0, 5]],
        weights: [1, 3, 6, 10, 15, 21, 27, 31, 33, 33, 31, 27, 21, 15, 10, 6, 3, 1] },
];
describe('W-8 CE E distribution and substantive rolls', () => {
    it.each(tiers)('E=$E exact dice intervals, order and full discrete distribution', ({ E, low, high, dice, weights }) => {
        expect(staffDamageRange(E)).toEqual({ low, high, clumps: dice.length });
        const random = new Random(8), observed = Array(weights.length).fill(0);
        const visit = (rolls: number[]) => {
            if (rolls.length < dice.length) {
                const [a, b] = dice[rolls.length]!;
                for (let n = a!; n <= b!; n++) visit([...rolls, n]);
                return;
            }
            let i = 0;
            const roll = vi.spyOn(random, 'randRange').mockImplementation(() => rolls[i++]!);
            observed[rollStaffDamage(E, random) - low]++;
            expect(roll.mock.calls).toEqual(dice);
            roll.mockRestore();
        };
        visit([]);
        expect(observed).toEqual(weights);
        const before = random.randomNumbersGenerated;
        rollStaffDamage(E, random);
        expect(random.randomNumbersGenerated - before).toBe(dice.length);
    });

    for (const id of ['staff_of_fire', 'staff_of_lightning']) {
        it.each(tiers)(`${id} E=$E: measured real zap distribution ignores constant 20 and charges=1`, ({ E, low, high, dice, weights }) => {
            const g = scene(), m = monster(g), item = staff(E, id), n = 6000;
            // Sampling does not retain cosmetic spy calls; real effects and RNG run.
            g.spawnFloatingText = () => {};
            const counts = Array(weights.length).fill(0);
            const seed = 88000 + E;
            rng.seedRandomGenerator(seed);
            for (let i = 0; i < n; i++) {
                m.hp = 100;
                zap(g, item);
                const damage = 100 - m.hp;
                expect(damage).toBeGreaterThanOrEqual(low); expect(damage).toBeLessThanOrEqual(high);
                counts[damage - low]++;
            }
            const rolls = rng.randomNumbersGenerated;
            expect(rolls).toBe(n * dice.length);
            const combinations = weights.reduce((a, b) => a + b, 0);
            const variation = counts.reduce((sum, c, i) => sum + Math.abs(c / n - weights[i]! / combinations), 0) / 2;
            expect(variation).toBeLessThan(0.04);
            expect(counts.every(c => c > 0)).toBe(true);
            const mean = counts.reduce((sum, c, i) => sum + c * (i + low), 0) / n;
            evidence.push({ id, E, charges: item.charges, magnitude: 20, seed, n, low, high, dice, weights, counts, mean, rolls, variation });
            expect(item.enchantment).toBe(E); expect(item.charges).toBe(1);
        });
    }

    it('same E and RNG state give identical damage despite different current charges, capacity and legacy constant', () => {
        const g = scene(), m = monster(g), item = staff(8, 'staff_of_lightning');
        const damage = [];
        for (const [charges, capacity, constant] of [[0, 2, 1], [1, 8, 20], [99, 99, 999]]) {
            item.charges = charges; item.maxCharges = capacity; m.hp = 100;
            rng.seedRandomGenerator(8712);
            zap(g, item, m.loc, constant);
            damage.push(100 - m.hp);
            expect(rng.randomNumbersGenerated).toBe(3);
        }
        expect(new Set(damage).size).toBe(1);
    });

    it('piercing rolls independently for every contact, including revisits and the reflected player', () => {
        const g = scene(), first = monster(g, 6), guardian = monster(g, 10, 5, 'stone_guardian'), behind = monster(g, 2);
        const roll = vi.spyOn(rng, 'randRange').mockReturnValueOnce(3).mockReturnValueOnce(9).mockReturnValueOnce(4).mockReturnValueOnce(8);
        const result = zap(g, staff(2, 'staff_of_lightning'), first.loc);
        expect(result.hits.map(h => h.creature)).toEqual([first, first, g.player, behind]);
        expect([first.hp, guardian.hp, g.player.hp, behind.hp]).toEqual([88, 100, 96, 92]);
        expect(roll.mock.calls).toEqual([[3, 9], [3, 9], [3, 9], [3, 9]]);
    });

    it('preview and empty travel use no damage RNG', () => {
        const g = scene(), item = staff(8), m = monster(g);
        const roll = vi.spyOn(rng, 'randClumpedRange'), before = rng.randomNumbersGenerated;
        (g as unknown as { computeBoltResult(b: BoltConfig, from: Player['loc'], to: Player['loc']): BoltResult })
            .computeBoltResult(getBoltForItem('staff_of_fire')!, g.player.loc, m.loc);
        g.monsters = []; zap(g, item);
        expect(roll).not.toHaveBeenCalled(); expect(rng.randomNumbersGenerated - before).toBe(0);
    });
});

describe('W-8 damage eligibility, burning and splitting', () => {
    it.each(['staff_of_fire', 'staff_of_lightning'])('%s harms revenants regardless of accuracy/armor; never calls physical attack', id => {
        const g = scene(), m = monster(g, 8, 5, 'revenant');
        m.defense = 9999;
        const attack = vi.spyOn(CombatSystem, 'attack');
        const item = staff(2, id), before = rng.randomNumbersGenerated;
        const r = zap(g, item);
        expect(m.hp).toBeLessThan(100); expect(r.outcome?.autoID).toBe(true);
        expect(attack).not.toHaveBeenCalled(); expect(rng.randomNumbersGenerated - before).toBe(1);
    });

    it.each(['status', 'flag', 'invulnerable'])('%s fire immunity is before damage RNG, still identifies and exposes terrain', kind => {
        const g = scene(), m = monster(g, 8, 5, kind === 'flag' ? 'salamander' : kind === 'invulnerable' ? 'Warden_of_Yendor' : 'rat');
        if (kind === 'status') m.applyStatus('immune_fire', 10);
        g.grid.setTerrainLayer(8, 5, L.SURFACE, T.GRASS);
        const roll = vi.spyOn(rng, 'randClumpedRange'), ignite = vi.spyOn(g.environment, 'ignite');
        const r = zap(g, staff(8));
        expect(m.hp).toBe(100); expect(burning(m)).toBe(0);
        expect(r.hits.map(h => h.creature)).toEqual([m]); expect(r.outcome?.autoID).toBe(true);
        expect(roll).not.toHaveBeenCalled(); expect(ignite).toHaveBeenCalledWith(8, 5);
        expect(g.grid.getCell(8, 5)!.layers[L.SURFACE]).not.toBe(T.GRASS);
    });

    it('lightning ignores fire immunity but skips invulnerability, continuing to the next creature', () => {
        const g = scene(), immune = monster(g, 6, 5, 'salamander'), warden = monster(g, 8, 5, 'Warden_of_Yendor'), next = monster(g, 10);
        const roll = vi.spyOn(rng, 'randClumpedRange');
        const item = staff(8, 'staff_of_lightning'), before = rng.randomNumbersGenerated;
        const r = zap(g, item);
        expect(r.hits.map(h => h.creature)).toEqual([immune, warden, next]);
        expect(immune.hp).toBeLessThan(100); expect(warden.hp).toBe(100); expect(next.hp).toBeLessThan(100);
        expect(roll).toHaveBeenCalledTimes(2); expect(rng.randomNumbersGenerated - before).toBe(6);
        expect(burning(next)).toBe(0);
    });

    it.each([false, true])('reflected fire checks actual player immunity=%s before rolling', immune => {
        const g = scene(), guardian = monster(g, 8, 5, 'stone_guardian');
        if (immune) g.player.applyStatus('immune_fire', 10);
        const r = zap(g, staff(8));
        expect(r.hits.map(h => h.creature)).toEqual([g.player]); expect(guardian.hp).toBe(100);
        expect(rng.randomNumbersGenerated).toBe(immune ? 0 : 3);
        expect(g.player.hp === 100).toBe(immune); expect(burning(g.player)).toBe(immune ? 0 : 7);
    });

    it('a living fire hit ignites on bare floor, refreshing to max(old,7), before terrain exposure', () => {
        const g = scene(), m = monster(g);
        const atExposure: number[] = [];
        const ignite = g.environment.ignite.bind(g.environment);
        vi.spyOn(g.environment, 'ignite').mockImplementation((x, y) => {
            if (x === 8 && y === 5) atExposure.push(burning(m));
            return ignite(x, y);
        });
        for (const old of [0, 3, 12]) {
            (m.statusDurations as Record<string, number>).burning = old;
            zap(g);
        }
        expect(atExposure).toEqual([7, 7, 12]);
    });

    it.each([false, true])('water extinguishes contact ignition only for non-levitating creatures: levitating=%s', levitating => {
        const g = scene(), m = monster(g);
        g.grid.setTerrainLayer(8, 5, L.LIQUID, T.WATER_DEEP);
        if (levitating) m.applyStatus('levitating', 10);
        zap(g);
        expect(m.hp).toBeLessThan(100); expect(burning(m)).toBe(levitating ? 7 : 0);
    });

    it.each(['staff_of_fire', 'staff_of_lightning'])('%s surviving direct hit splits after damage (fire ignites first); lethal hit never splits', id => {
        for (const lethal of [false, true]) {
            const g = scene(), m = monster(g, 8, 5, 'pink_jelly');
            if (lethal) m.hp = 3;
            // Minimum E2 damage=3. Splitting location choice remains the real path.
            vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
            const bridge = g as unknown as { trySplitMonster(m: Monster, p: Player): void };
            const original = bridge.trySplitMonster;
            const split = vi.spyOn(bridge, 'trySplitMonster');
            const burnAtSplit: number[] = [];
            split.mockImplementation(function (this: Game, m, p) { burnAtSplit.push(burning(m)); return original!.call(this, m, p); });
            zap(g, staff(2, id), m.loc);
            if (lethal) {
                expect(m.hp).toBe(0); expect(g.monsters).toHaveLength(1); expect(split).not.toHaveBeenCalled(); expect(burning(m)).toBe(0);
            } else {
                // Lightning can hit the newborn clone later if its random placement is on the ray;
                // this lower-bound placement is behind the original, already passed on this outward trip.
                expect(g.monsters.map(m => m.hp)).toEqual([49, 49]);
                expect(burnAtSplit).toEqual([id === 'staff_of_fire' ? 7 : 0]);
            }
            vi.restoreAllMocks();
        }
    });

    it.each(['creature', 'terrain'])('player fire reflected by %s damages/ignites a jelly but cannot split it (CE Items.c:5210)', reflector => {
        const g = scene();
        if (reflector === 'creature') {
            monster(g, 8, 5, 'golem');
            vi.spyOn(rng, 'randPercent').mockReturnValueOnce(true).mockReturnValueOnce(false);
        } else g.grid.setTerrain(9, 5, T.CRYSTAL_WALL);
        const jelly = monster(g, 8, 8, 'pink_jelly');
        vi.spyOn(rng, 'randRange').mockImplementation((lo, hi) => hi === 39 ? 16 : lo);
        const r = zap(g);
        expect(r.reflections).toHaveLength(1); expect(r.hits.map(h => h.creature)).toEqual([jelly]);
        expect(g.monsters.filter(m => m.typeId === 'pink_jelly').map(m => m.hp)).toEqual([97]);
        expect(burning(jelly)).toBe(7);
    });

    it('lightning splits on the outward hit only; return hits on both jellies cannot split again', () => {
        const g = scene(), jelly = monster(g, 6, 5, 'pink_jelly');
        monster(g, 10, 5, 'stone_guardian');
        vi.spyOn(rng, 'randRange').mockImplementation(lo => lo);
        const r = zap(g, staff(2, 'staff_of_lightning'), jelly.loc);
        expect(r.hits[0]!.creature).toBe(jelly);
        expect(r.hits.filter(h => h.creature === jelly)).toHaveLength(2);
        expect(r.reflections).toHaveLength(1);
        const jellies = g.monsters.filter(m => m.typeId === 'pink_jelly');
        expect(jellies.map(m => m.hp)).toEqual([46, 46]); // ceil((100-3)/2), then 3 each on return
    });
});

describe('W-8 explicit boundaries', () => {
    it.each([['FIRE', 4, 14, 2], ['SPARK', 2, 6, 1], ['DRAGONFIRE', 15, 49, 7]] as const)('U06 monster %s uses CE catalog staffDamage without physical attack', (name, low, high, clumps) => {
        const g = scene(), caster = monster(g, 12, 5, 'dragon'), target = monster(g, 8);
        const attack = vi.spyOn(CombatSystem, 'attack'), roll = vi.spyOn(rng, 'randClumpedRange');
        g.castMonsterBolt(caster, target, name);
        expect(attack).not.toHaveBeenCalled();
        expect(roll).toHaveBeenCalledWith(low, high, clumps);
    });
    it.each([['wand_of_fire', 5], ['wand_of_lightning', 8]] as const)('retired invention %s retains its old direct constant', (id, expected) => {
        const g = scene(), m = monster(g), item = new Item(id, '/', 0, ItemCategory.WAND);
        const roll = vi.spyOn(rng, 'randClumpedRange');
        item.enchantment = 8;
        g.zapBoltFromPlayer(getBoltForItem(id)!, item, m.loc);
        expect(m.hp).toBe(100 - expected); expect(roll).not.toHaveBeenCalled();
    });
});
