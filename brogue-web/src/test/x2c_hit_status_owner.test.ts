import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import rows from '../data/monsters.json';

const catalog = rows as MonsterData[];
function spawn(id: string, x: number, y: number) {
    const row = catalog.find(r => r.id === id)!;
    return new Monster(x, y, row);
}
function scene() {
    const game = createHeadlessGame(1212, 'test');
    game.monsters = []; game.items = [];
    for (let x = 1; x < 15; x++) for (let y = 1; y < 15; y++) {
        game.grid.setTerrain(x, y, TerrainType.FLOOR);
        game.grid.getCell(x, y)!.isVisible = true;
    }
    game.player.loc = { x: 6, y: 8 };
    return game;
}

describe('X2c CE catalog and real hit recipient', () => {
    it('keeps legacy rows in data but gives the three non-CE hits no effect', () => {
        for (const id of ['kobold', 'goblin', 'vampire']) {
            const row = catalog.find(r => r.id === id)!;
            expect(row.onHitStatus).toBeTruthy();
            const monster = spawn(id, 8, 8);
            expect(monster.onHitStatus).toBe(row.onHitStatus);
            expect(monster.hasEffectiveOnHitStatus()).toBe(false);
        }
    });

    it('ally kobold hits a rat without confusing the untouched player', () => {
        const game = scene();
        const ally = spawn('kobold', 8, 8), rat = spawn('rat', 9, 8);
        ally.isAlly = true; ally.state = MonsterState.HUNTING;
        ally.accuracy = 10000; ally.damageString = '1d1';
        rat.hp = rat.maxHp = 10000;
        game.monsters.push(ally, rat);
        ally.takeTurn(game, 10);
        expect(rat.hp).toBeLessThan(10000);
        expect(game.player.getStatusDuration('confused')).toBe(0);
        expect(rat.getStatusDuration('confused')).toBe(0);
    });

    it('targeted status helper affects only its monster recipient', () => {
        const game = scene(), rat = spawn('rat', 9, 8);
        game.monsters.push(rat);
        expect(rat.statusImmunities.has('confused')).toBe(true);
        expect(rat.statusResistTurns.paralyzed).toBe(1);
        expect(game.applyMonsterOnHitStatus(rat, 'toad', 'hallucinating', 15)).toBe(true);
        expect(rat.getStatusDuration('hallucinating')).toBe(15);
        expect(game.player.getStatusDuration('hallucinating')).toBe(0);
        expect(game.applyMonsterOnHitStatus(rat, 'kobold', 'confused', 5)).toBe(true);
        expect(rat.getStatusDuration('confused')).toBe(5);
    });

    it('native on-hit hallucination follows geometry contact onto the monster', () => {
        const game = scene(), toad = spawn('toad', 8, 8), rat = spawn('rat', 9, 8);
        toad.isAlly = true; toad.state = MonsterState.HUNTING;
        toad.accuracy = 10000; toad.damageString = '1d1';
        rat.hp = rat.maxHp = 10000;
        game.monsters.push(toad, rat);
        toad.takeTurn(game, 10);
        expect(rat.hp).toBeLessThan(10000);
        expect(rat.getStatusDuration('hallucinating')).toBe(15);
        expect(game.player.getStatusDuration('hallucinating')).toBe(0);
    });

    it('distance attack uses the contacted monster', () => {
        const game = scene(), toad = spawn('toad', 12, 8), rat = spawn('rat', 9, 8);
        toad.accuracy = 10000;
        rat.hp = rat.maxHp = 10000;
        game.monsters.push(toad, rat);
        game.castMonsterBolt(toad, rat, 'DISTANCE_ATTACK');
        expect(rat.getStatusDuration('hallucinating')).toBe(15);
        expect(game.player.getStatusDuration('hallucinating')).toBe(0);
    });

    it('penetrating geometry applies a native status to its remote recipient', () => {
        const game = scene(), goblin = spawn('goblin', 8, 8), rat = spawn('rat', 10, 8);
        goblin.isAlly = true; goblin.state = MonsterState.HUNTING;
        goblin.accuracy = 10000;
        // Exercise the CE MA status outlet with the goblin's CE spear geometry.
        goblin.abilityFlags.add('MA_HIT_HALLUCINATE');
        rat.hp = rat.maxHp = 10000;
        game.monsters.push(goblin, rat);
        goblin.takeTurn(game, 10);
        expect(rat.hp).toBeLessThan(10000);
        expect(rat.getStatusDuration('hallucinating')).toBe(15);
        expect(game.player.getStatusDuration('hallucinating')).toBe(0);
    });
});
