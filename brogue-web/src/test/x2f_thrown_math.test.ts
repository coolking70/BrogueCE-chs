import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CombatSystem } from '../engine/Combat/Combat';
import { rng } from '../engine/Random';
import { Player } from '../entities/Player';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { ItemLoader } from '../engine/Items/ItemLoader';
import monsters from '../data/monsters.json';

interface Case {
    lo: number; hi: number; clump: number; enchant: number;
    strength: number; required: number; calls: number;
    dice: number[][]; combinations: number; weights: Record<string, number>;
}
const golden = JSON.parse(fs.readFileSync('ai_docs/reports/x2f-evidence/ce-thrown.json', 'utf8')) as Case[];
const rat = (monsters as MonsterData[]).find(row => row.id === 'rat')!;
afterEach(() => vi.restoreAllMocks());

describe('X2f compiled CE thrown weapon mathematics', () => {
    it.each(golden)('instance {$lo,$hi,$clump}, enchant {$enchant}, strength {$strength}: distribution and RNG tuples', row => {
        const thrower = new Player(4, 5);
        thrower.strength = row.strength;
        const defender = new Monster(5, 5, rat);
        defender.hp = defender.maxHp = 10000;
        defender.state = MonsterState.HUNTING;
        defender.isCaged = true; // attackHit short circuit, so only damage dice remain
        const item = ItemLoader.spawnWeapon('javelin', -1, -1)!;
        item.damage = `${row.lo}-${row.hi}`;
        item.clumping = row.clump;
        item.enchantment = row.enchant;
        item.strengthRequired = row.required;
        item.runicType = undefined;
        const counts: Record<string, number> = {};
        let tuple = 0;
        const roll = vi.spyOn(rng, 'randRange').mockImplementation((lo, hi) => {
            const value = lo + tuple % (hi - lo + 1);
            tuple = Math.trunc(tuple / (hi - lo + 1));
            return value;
        });
        for (let n = 0; n < row.combinations; n++) {
            tuple = n;
            defender.hp = defender.maxHp;
            roll.mockClear();
            const result = CombatSystem.resolveThrownWeapon(thrower, defender, item);
            expect(result.hit).toBe(true);
            counts[result.damage] = (counts[result.damage] ?? 0) + 1;
            expect(roll.mock.calls).toEqual(row.dice);
            expect(roll).toHaveBeenCalledTimes(row.calls);
        }
        expect(counts).toEqual(row.weights);
    });

    it('a miss spends one hit die; auto hit spends none; immune hit spends no damage dice', () => {
        const thrower = new Player(4, 5);
        const defender = new Monster(5, 5, rat);
        defender.hp = defender.maxHp = 10000;
        defender.state = MonsterState.HUNTING;
        const item = ItemLoader.spawnWeapon('javelin', -1, -1)!;
        item.runicType = undefined;
        const roll = vi.spyOn(rng, 'randRange').mockReturnValue(99);
        expect(CombatSystem.resolveThrownWeapon(thrower, defender, item).hit).toBe(false);
        expect(roll.mock.calls).toEqual([[0, 99]]);

        roll.mockClear(); defender.isCaged = true;
        CombatSystem.resolveThrownWeapon(thrower, defender, item);
        expect(roll).toHaveBeenCalledTimes(item.clumping!);

        roll.mockClear();
        vi.spyOn(defender, 'isImmuneToWeapons').mockReturnValue(true);
        const immune = CombatSystem.resolveThrownWeapon(thrower, defender, item);
        expect(immune.damage).toBe(0);
        expect(roll).not.toHaveBeenCalled();

        roll.mockClear();
        vi.spyOn(defender, 'isImmuneToWeapons').mockReturnValue(false);
        vi.spyOn(defender, 'isInvulnerable').mockReturnValue(true);
        expect(CombatSystem.resolveThrownWeapon(thrower, defender, item).damage).toBe(0);
        expect(roll).not.toHaveBeenCalled();
    });

    it('slaying gives 100% hit probability but still consumes attackHit die', () => {
        const thrower = new Player(4, 5);
        const defender = new Monster(5, 5, rat);
        defender.state = MonsterState.HUNTING;
        defender.hp = 1;
        const item = ItemLoader.spawnWeapon('dagger', -1, -1)!;
        item.damage = '100';
        item.runicType = 'slaying';
        item.vorpalEnemy = 'animal';
        const roll = vi.spyOn(rng, 'randRange').mockReturnValue(99);
        const result = CombatSystem.resolveThrownWeapon(thrower, defender, item);
        expect(result.hit).toBe(true);
        expect(result.killed).toBe(true);
        expect(roll.mock.calls).toEqual([[0, 99]]);
    });
});
