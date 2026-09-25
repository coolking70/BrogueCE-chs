import { describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Monster, MonsterMode, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType as T } from '../engine/Map/Grid';
import { restoreEntityGraph, serializeMonster } from '../engine/Core/EntitySnapshot';
import monsters from '../data/monsters.json';

const rat = (monsters as MonsterData[]).find(m => m.id === 'rat')!;
function scene() {
    const g = createHeadlessGame(1212, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.animationEnabled = false;
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, !x || !y || x === g.grid.width - 1 || y === g.grid.height - 1 ? T.WALL : T.FLOOR);
        g.grid.getCell(x, y)!.isVisible = false;
    }
    g.player.loc = { x: 6, y: 8 };
    g.spawnFloatingText = vi.fn();
    return g;
}

describe('U12b ally and creature mode', () => {
    it('selects a reachable enemy outside player FOV while inside its leash', () => {
        const g = scene();
        const ally = new Monster(8, 8, rat), enemy = new Monster(10, 8, rat);
        ally.isAlly = true; ally.state = MonsterState.HUNTING;
        enemy.state = MonsterState.HUNTING;
        g.monsters.push(ally, enemy);
        ally.takeTurn(g, 0);
        expect(ally.x).toBe(9);
    });

    it('lets a wounded ally retreat before pursuing the same enemy', () => {
        const g = scene();
        const ally = new Monster(8, 8, rat), enemy = new Monster(10, 8, rat);
        ally.isAlly = true; ally.state = MonsterState.HUNTING; ally.hp = 1;
        enemy.state = MonsterState.HUNTING;
        g.monsters.push(ally, enemy);
        ally.takeTurn(g, 0);
        expect(Math.max(Math.abs(ally.x - enemy.x), Math.abs(ally.y - enemy.y))).toBeGreaterThan(2);
    });

    it('preserves permanent fleeing separately from current state across snapshots', () => {
        const g = scene(), m = new Monster(8, 8, rat);
        m.state = MonsterState.FLEEING;
        m.creatureMode = MonsterMode.PERM_FLEEING;
        const row = JSON.parse(JSON.stringify(serializeMonster(m)));
        const loaded = restoreEntityGraph([row]).monsters.get(m.id)!;
        expect(loaded.creatureMode).toBe(MonsterMode.PERM_FLEEING);
        loaded.state = MonsterState.WANDERING;
        g.monsters.push(loaded);
        loaded.takeTurn(g, 0);
        expect(loaded.state).toBe(MonsterState.FLEEING);
    });

    it('defaults old snapshots to normal mode and lets ordinary flight end', () => {
        const g = scene(), m = new Monster(8, 8, rat);
        m.state = MonsterState.FLEEING;
        const row = JSON.parse(JSON.stringify(serializeMonster(m)));
        delete row.creatureMode;
        const loaded = restoreEntityGraph([row]).monsters.get(m.id)!;
        expect(loaded.creatureMode).toBe(MonsterMode.NORMAL);
        g.monsters.push(loaded);
        loaded.takeTurn(g, 0);
        expect(loaded.state).toBe(MonsterState.HUNTING);
    });
});
