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

describe('W-1 caster/contact/landing/outcome contracts preserve legacy routes', () => {
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

    it('a wall next to caster produces no landing or hits, preserving the old origin fallback and zero RNG/ticks', () => {
        const game = scene();
        game.grid.setTerrain(5, 5, TerrainType.WALL);
        const beforeRng = rng.randomNumbersGenerated, beforeTick = timeSystem.currentTick;
        const result = trace(game, getBoltForItem('staff_of_lightning')!, { x: 9, y: 5 });
        expect(result.caster).toBe(game.player);
        expect(result.path).toEqual([]);
        expect(result.hits).toEqual([]);
        expect(result.landingPos).toBeNull();
        expect(result.impactPos).toEqual(game.player.loc);
        expect(result.frames).toEqual([]);
        expect(result.outcome).toBeNull();
        expect(game.grid.getCell(5, 5)!.terrain).toBe(TerrainType.WALL);
        expect(rng.randomNumbersGenerated).toBe(beforeRng);
        expect(timeSystem.currentTick).toBe(beforeTick);
    });

    it('player tracing records ordered contacts while piercing and target truncation keep their old behavior', () => {
        const game = scene(), first = rat(6), second = rat(8);
        game.monsters.push(first, second);
        const fire = trace(game, getBoltForItem('staff_of_fire')!, { x: 10, y: 5 });
        expect(fire.hits.map(h => h.creature)).toEqual([first]);
        expect(fire.impactPos).toEqual(first.loc);
        expect(fire.magnitude).toBe(6);
        const lightning = trace(game, getBoltForItem('staff_of_lightning')!, { x: 10, y: 5 });
        expect(lightning.hits.map(h => h.creature)).toEqual([first, second]);
        expect(lightning.landingPos).toEqual({ x: 10, y: 5 });
        const aimedAtFirst = trace(game, getBoltForItem('staff_of_lightning')!, first.loc);
        expect(aimedAtFirst.hits.map(h => h.creature)).toEqual([first]);
        expect(aimedAtFirst.landingPos).toEqual(first.loc);
        // An included obstruction cell is also part of the legacy damage path.
        // Keep its contact even though the path terminates before another step.
        game.grid.setTerrain(6, 5, TerrainType.CRYSTAL_WALL);
        const blockedOnCreature = trace(game, getBoltForItem('staff_of_lightning')!, { x: 10, y: 5 });
        expect(blockedOnCreature.landingPos).toEqual(first.loc);
        expect(blockedOnCreature.hits.map(h => h.creature)).toEqual([first]);
        // W-3 will change CE same-origin and aim-extension behavior, not W-1.
        expect(trace(game, getBoltForItem('staff_of_fire')!, game.player.loc).path).toEqual([game.player.loc]);
    });

    it('monster return values carry caster and player/monster contacts while healing retains the old 25 percent formula', () => {
        const game = scene(), caster = rat(8), ally = rat(6);
        game.monsters.push(caster, ally);
        for (const target of [game.player, ally]) {
            target.maxHp = 100; target.hp = 10;
            const result = game.castMonsterBolt(caster, target, 'HEALING')!;
            expect(result.caster).toBe(caster);
            expect(result.hits[0]!.creature).toBe(target);
            expect(result.hits[0]!.pos).toEqual(target.loc);
            expect(result.landingPos).toEqual(target.loc);
            expect(result.bolt.ceType).toBe(CEBoltType.HEALING);
            // W-2: execution now observes CE :5366-5370; tracing above remains unresolved.
            expect(result.outcome).toEqual({ autoID: true, casterMovement: null });
            expect(target.hp).toBe(35);
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

    it.each([
        [BoltEffect.POLYMORPH, CEBoltType.POLYMORPH],
        [BoltEffect.PLENTY, CEBoltType.PLENTY],
    ])('new effect %s is type-only through the real player exit: no HP/location/entity/status/RNG changes', (effect, ceType) => {
        const game = scene(), target = rat(6);
        game.monsters.push(target);
        const item = ItemLoader.spawnWand('wand_of_slowness', 4, 5)!;
        const bolt = { ...getBoltForItem('wand_of_slowness')!, effect, ceType };
        const state = () => JSON.stringify({ player: game.player, monsters: game.monsters, grid: game.grid, item,
            random: rng.randomNumbersGenerated, tick: timeSystem.currentTick });
        const before = state();
        const result = game.zapBoltFromPlayer(bolt, item);
        expect(result.caster).toBe(game.player);
        expect(result.hits[0]!.creature).toBe(target);
        // W-2: type-only branches cannot claim an observed effect.
        expect(result.outcome).toEqual({ autoID: false, casterMovement: null });
        expect(state()).toBe(before);
        expect(game.monsters).toEqual([target]);
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
