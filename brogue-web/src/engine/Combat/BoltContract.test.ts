import { describe, expect, it, vi } from 'vitest';
import { Game } from '../Core/Game';
import { Grid, TerrainType, DCOLS, DROWS } from '../Map/Grid';
import { Player } from '../../entities/Player';
import { Monster, type MonsterData } from '../../entities/Monster';
import monsterData from '../../data/monsters.json';
import { ItemLoader } from '../Items/ItemLoader';
import { rng } from '../Random';
import { timeSystem } from '../Systems/Time';
import { CEBoltType } from './BoltCatalog';
import { BoltEffect, createBoltResult, getBoltForItem, type BoltConfig, type BoltOutcome, type BoltResult } from './Bolt';
import type { Pos } from '../../types';

// Local route fixture: real Grid/Player/Monster and Game methods; no generation.
// Only rendering is stubbed. No effect function is replaced.
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
    game.spawnFloatingText = vi.fn();
    return game;
}
const monsters = monsterData as MonsterData[];
const rat = (x: number) => new Monster(x, 5, monsters.find(m => m.id === 'rat')!);
const trace = (g: Game, bolt: BoltConfig, aim: Pos) => (g as unknown as {
    computeBoltResult(b: BoltConfig, origin: Pos, target: Pos): BoltResult;
}).computeBoltResult(bolt, g.player.loc, aim);

describe('W-1 caster/contact/landing/outcome contracts with W-3 actual routes', () => {
    it('packages nullable caster, player contacts, independent aim/landing and unresolved versus false autoID without aliasing positions', () => {
        const game = scene(), origin = { x: 2, y: 5 }, aim = { x: 9, y: 5 };
        const path = [{ x: 3, y: 5 }, { x: 4, y: 5 }];
        const result = createBoltResult(getBoltForItem('wand_of_slowness')!, null, origin, aim, path,
            [{ creature: game.player, pos: game.player.loc }]);
        expect(result.caster).toBeNull();
        expect(result.hits[0]!.creature).toBe(game.player);
        expect(result.landingPos).toEqual({ x: 4, y: 5 });
        expect(result.aimPos).toEqual({ x: 9, y: 5 });
        expect(result.outcome).toBeNull();
        origin.x = aim.x = path[1]!.x = game.player.loc.x = 20;
        expect(result.origin).toEqual({ x: 2, y: 5 });
        expect(result.aimPos).toEqual({ x: 9, y: 5 });
        expect(result.path[1]).toEqual({ x: 4, y: 5 });
        expect(result.hits[0]!.pos).toEqual({ x: 4, y: 5 });
        const noIdentification: BoltOutcome = { autoID: false, casterMovement: null };
        const moved: BoltOutcome = { autoID: true, casterMovement: { from: { x: 2, y: 5 }, to: { x: 4, y: 5 } } };
        expect(noIdentification.autoID).toBe(false);
        expect(moved.casterMovement!.to).toEqual(result.landingPos);
    });

    it('W-3 reverses the old empty wall path: ordinary lightning reaches the adjacent wall with zero RNG/ticks', () => {
        const game = scene();
        game.grid.setTerrain(5, 5, TerrainType.WALL);
        const beforeRng = rng.randomNumbersGenerated, beforeTick = timeSystem.currentTick;
        const result = trace(game, getBoltForItem('staff_of_lightning')!, { x: 9, y: 5 });
        expect(result.caster).toBe(game.player);
        expect(result.path).toEqual([{ x: 5, y: 5 }]);
        expect(result.hits).toEqual([]);
        expect(result.landingPos).toEqual({ x: 5, y: 5 });
        expect(result.impactPos).toEqual({ x: 5, y: 5 });
        expect(result.frames).toHaveLength(1);
        expect(result.outcome).toBeNull();
        expect(game.grid.getCell(5, 5)!.terrain).toBe(TerrainType.WALL);
        expect(rng.randomNumbersGenerated).toBe(beforeRng);
        expect(timeSystem.currentTick).toBe(beforeTick);
    });

    it('W-3 reverses target truncation and origin contact while preserving ordered contacts', () => {
        const game = scene(), first = rat(6), second = rat(8);
        game.monsters.push(first, second);
        const fire = trace(game, getBoltForItem('staff_of_fire')!, { x: 10, y: 5 });
        expect(fire.hits.map(h => h.creature)).toEqual([first]);
        expect(fire.impactPos).toEqual(first.loc);
        expect(fire.magnitude).toBe(6);
        const lightning = trace(game, getBoltForItem('staff_of_lightning')!, { x: 10, y: 5 });
        expect(lightning.hits.map(h => h.creature)).toEqual([first, second]);
        expect(lightning.landingPos).toEqual({ x: DCOLS - 1, y: 5 });
        const aimedAtFirst = trace(game, getBoltForItem('staff_of_lightning')!, first.loc);
        // W-1 stopped at the aim; W-3 must continue through the second creature.
        expect(aimedAtFirst.hits.map(h => h.creature)).toEqual([first, second]);
        expect(aimedAtFirst.landingPos).toEqual({ x: DCOLS - 1, y: 5 });
        // An included obstruction cell is also part of the legacy damage path.
        // Keep its contact even though the path terminates before another step.
        game.grid.setTerrain(6, 5, TerrainType.CRYSTAL_WALL);
        const blockedOnCreature = trace(game, getBoltForItem('staff_of_lightning')!, { x: 10, y: 5 });
        expect(blockedOnCreature.landingPos).toEqual(first.loc);
        expect(blockedOnCreature.hits.map(h => h.creature)).toEqual([first]);
        // W-1 returned [origin]; CE Items.c:4162/5587 rejects same-origin travel.
        expect(trace(game, getBoltForItem('staff_of_fire')!, game.player.loc).path).toEqual([]);
    });

    it('monster return values carry caster and player/monster contacts; W-9 retires old 25 percent healing for catalog E5 = 50 percent', () => {
        const game = scene(), caster = rat(8), ally = rat(6);
        game.monsters.push(caster, ally);
        for (const target of [game.player, ally]) {
            // Keep each formula fixture unobstructed. The old test shot through
            // ally at x=6 to heal the player at x=4; interception is tested in W-3.
            game.monsters = target === game.player ? [caster] : [caster, ally];
            target.maxHp = 100; target.hp = 10;
            const result = game.castMonsterBolt(caster, target, 'HEALING')!;
            expect(result.caster).toBe(caster);
            expect(result.hits[0]!.creature).toBe(target);
            expect(result.hits[0]!.pos).toEqual(target.loc);
            expect(result.landingPos).toEqual(target.loc);
            expect(result.bolt.ceType).toBe(CEBoltType.HEALING);
            // W-2: execution now observes CE :5366-5370; tracing above remains unresolved.
            expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
            // W-9: CE Items.c:5367 -> heal(5 * 10, false), 50% of maxHP.
            expect(target.hp).toBe(60);
        }
    });

    it('blocked monster SPARK returns no contact and still cannot damage the target', () => {
        const game = scene(), caster = rat(8);
        game.monsters.push(caster);
        game.grid.setTerrain(6, 5, TerrainType.WALL);
        const hp = game.player.hp, before = rng.randomNumbersGenerated;
        const result = game.castMonsterBolt(caster, game.player, 'SPARK')!;
        expect(result.caster).toBe(caster);
        expect(result.hits).toEqual([]);
        expect(result.aimPos).toEqual(game.player.loc);
        expect(result.landingPos).toEqual({ x: 6, y: 5 });
        // W-2: blocked execution is evaluated false, not W-1 unresolved null.
        expect(result.outcome).toEqual({ autoID: false, casterMovement: null });
        expect(game.player.hp).toBe(hp);
        expect(rng.randomNumbersGenerated).toBe(before);
    });

    // W-19 supersedes only the POLYMORPH member of W-1's type-only guard.
    // CE Items.c:4572-4634/5260-5268 now changes the actual contact in place;
    // W-20 below now implements PLENTY through the same player exit.
    it('W-19 polymorph preserves contact identity but replaces form/status with one species draw', () => {
        const game = scene(), target = rat(6);
        Object.assign(game, { updateVision: vi.fn() }); // This fixture has no FOV renderer.
        game.monsters.push(target);
        target.hp = 3; // CE rat max=6 -> jackal max=8: max(4 proportional, 5 same injury)=5.
        target.isAlly = true;
        target.setStatusDuration('hasted', 8);
        const id = target.id, loc = target.loc;
        const item = ItemLoader.spawnWand('wand_of_slowness', 4, 5)!;
        const bolt = { ...getBoltForItem('wand_of_slowness')!, effect: BoltEffect.POLYMORPH, ceType: CEBoltType.POLYMORPH };
        const unchanged = () => JSON.stringify({ player: game.player, grid: game.grid, item, tick: timeSystem.currentTick });
        const before = unchanged(), draw = vi.spyOn(rng, 'randRange').mockReturnValue(3); // CE MK_JACKAL.
        try {
            const result = game.zapBoltFromPlayer(bolt, item);
            expect(result.caster).toBe(game.player);
            expect(result.hits[0]!.creature).toBe(target);
            expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
            expect(target).toMatchObject({ id, typeId: 'jackal', hp: 5, maxHp: 8, isAlly: false, moveSpeed: 25, attackSpeed: 50, ticksUntilTurn: 101 });
            expect(target.statusDurations).toEqual({});
            expect(target.loc).toBe(loc);
            expect(game.monsters).toEqual([target]);
            expect(draw).toHaveBeenCalledExactlyOnceWith(1, 67);
            expect(unchanged()).toBe(before);
        } finally { draw.mockRestore(); }
    });

    it('W-20 plenty duplicates the contact through the real player exit', () => {
        const game = scene(), target = rat(6);
        game.monsters.push(target);
        target.hp = 5;
        const item = ItemLoader.spawnWand('wand_of_slowness', -1, -1)!;
        const bolt = { ...getBoltForItem('wand_of_slowness')!, effect: BoltEffect.PLENTY, ceType: CEBoltType.PLENTY };
        const result = game.zapBoltFromPlayer(bolt, item);
        expect(result.hits[0]!.creature).toBe(target);
        expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
        expect(game.monsters).toHaveLength(2);
        const clone = game.monsters[1]!;
        expect([target.hp, clone.hp]).toEqual([3, 3]);
        expect(clone.id).not.toBe(target.id);
        expect(clone.leader).toBe(target);
    });

    it('knowing the full CE catalog does not enable monster blink, web or vines', () => {
        const game = scene();
        for (const id of ['imp', 'spider', 'mangrove_dryad']) {
            const caster = new Monster(8, 5, monsters.find(m => m.id === id)!);
            game.monsters = [caster];
            const before = JSON.stringify({ loc: caster.loc, hp: game.player.hp, grid: game.grid });
            for (let i = 0; i < 30; i++) expect(caster.tryUseBolt(game)).toBe(false);
            expect(JSON.stringify({ loc: caster.loc, hp: game.player.hp, grid: game.grid })).toBe(before);
            if (id !== 'imp') expect(game.castMonsterBolt(caster, game.player, caster.bolts[0]!)).toBeUndefined();
        }
    });
});
