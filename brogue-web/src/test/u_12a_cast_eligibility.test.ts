import { describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Monster, MonsterState, generallyValidBoltTarget, specificallyValidBoltTarget, monstersAreEnemies, monstersAreTeammates } from '../entities/Monster';
import type { MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { DungeonLayer, TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';

const rat = (monsters as MonsterData[]).find(m => m.id === 'rat')!;
function scene() {
    const g = createHeadlessGame(1212, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.animationEnabled = false;
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++)
        g.grid.setTerrain(x, y, x === 0 || y === 0 || x === g.grid.width - 1 || y === g.grid.height - 1 ? TerrainType.WALL : TerrainType.FLOOR);
    g.player.loc = {x: 4, y: 9};
    const caster = new Monster(8, 8, rat), target = new Monster(12, 8, rat);
    caster.state = target.state = MonsterState.HUNTING;
    caster.hp = caster.maxHp = target.hp = target.maxHp = 100;
    g.monsters.push(caster, target);
    return {g, caster, target};
}

describe('U12a CE general monster bolt gates', () => {
    it('uses follower or allied relationships, discord, captive and domination in the two faction gates', () => {
        const {g, caster, target} = scene();
        expect(monstersAreTeammates(caster, target)).toBe(false);
        expect(specificallyValidBoltTarget(caster, target, 'INVISIBILITY', g)).toBe(false);
        target.leader = caster;
        expect(specificallyValidBoltTarget(caster, target, 'INVISIBILITY', g)).toBe(true);
        target.setStatusDuration('discordant', 10);
        expect(monstersAreTeammates(caster, target)).toBe(true);
        expect(monstersAreEnemies(caster, target)).toBe(true);
        expect(specificallyValidBoltTarget(caster, target, 'INVISIBILITY', g)).toBe(false);
        target.setStatusDuration('discordant', 0); target.leader = null;
        target.isAlly = true; target.dominated = true;
        expect(specificallyValidBoltTarget(caster, target, 'SLOW', g)).toBe(true);
        target.isCaged = true;
        expect(specificallyValidBoltTarget(caster, target, 'SLOW', g)).toBe(false);
    });

    it('allows gas outlined invisibility and teammate invisibility, while dormant targets stay hidden', () => {
        const {g, caster, target} = scene();
        target.setStatusDuration('invisible', 10);
        expect(generallyValidBoltTarget(caster, target, g)).toBe(false);
        g.grid.getCell(target.x, target.y)!.layers[DungeonLayer.GAS] = TerrainType.POISON_GAS;
        expect(generallyValidBoltTarget(caster, target, g)).toBe(true);
        g.grid.getCell(target.x, target.y)!.layers[DungeonLayer.GAS] = TerrainType.NOTHING;
        target.leader = caster;
        expect(generallyValidBoltTarget(caster, target, g)).toBe(true);
        target.isDormant = true;
        expect(generallyValidBoltTarget(caster, target, g)).toBe(false);
    });

    it('applies common reflection and fiery gates before any ability roll', () => {
        const {g, caster, target} = scene();
        caster.isAlly = true;
        target.behaviorFlags.add('MONST_REFLECT_50');
        expect(specificallyValidBoltTarget(caster, target, 'FIRE', g)).toBe(false);
        target.behaviorFlags.delete('MONST_REFLECT_50');
        target.setStatusDuration('immune_fire', 10);
        expect(specificallyValidBoltTarget(caster, target, 'FIRE', g)).toBe(false);
        target.setStatusDuration('immune_fire', 0);
        g.grid.setTerrain(caster.x, caster.y, TerrainType.GRASS);
        expect(specificallyValidBoltTarget(caster, target, 'FIRE', g)).toBe(false);
        const roll = vi.spyOn(rng, 'randPercent');
        caster.bolts = ['FIRE'];
        expect(caster.tryUseBolt(g)).toBe(false);
        expect(roll).not.toHaveBeenCalled();
        caster.behaviorFlags.add('MONST_IMMUNE_TO_FIRE');
        expect(specificallyValidBoltTarget(caster, target, 'FIRE', g)).toBe(true);
        roll.mockRestore();
    });

    it('tries the player first, then monster insertion order, and rolls only after qualification', () => {
        const {g, caster, target} = scene();
        caster.bolts = ['INVISIBILITY', 'SLOW'];
        caster.isAlly = true;
        target.isAlly = false;
        const roll = vi.spyOn(rng, 'randPercent').mockReturnValueOnce(false).mockReturnValueOnce(true);
        const cast = vi.spyOn(g, 'castMonsterBolt').mockImplementation(() => ({outcome: null} as never));
        expect(caster.tryUseBolt(g)).toBe(true);
        expect(roll.mock.calls).toEqual([[30], [30]]);
        expect(cast).toHaveBeenCalledWith(caster, target, 'SLOW');
        roll.mockRestore(); cast.mockRestore();
    });
});
