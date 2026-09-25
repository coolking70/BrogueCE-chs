import { describe, expect, it, vi } from 'vitest';
import ts from 'typescript';
import fs from 'node:fs';
import { createHeadlessGame } from './harness';
import { Game, type GameSnapshot } from '../engine/Core/Game';
import { CELL_FIELDS } from '../engine/Core/LevelSnapshot';
import { Cell, DCOLS, DungeonLayer, TerrainType } from '../engine/Map/Grid';
import { ScentMap } from '../engine/Map/Scent';
import { Monster, type MonsterData } from '../entities/Monster';
import { getNextEntityId, allocateEntityId } from '../entities/Creature';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng, RNGType } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';
import monsterData from '../data/monsters.json';

const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));
function stable(g: Game) {
    const { savedAt: _time, ...state } = g.toSnapshot();
    return json(state);
}
function enter(g: Game, depth: number) {
    const up = depth < g.depth;
    g.depth = depth;
    (g as any).generateDepth(up);
}
function wait(g: Game, turns = 1) {
    for (let i = 0; i < turns; i++) g.handlePlayerAction('wait', undefined, 'system');
}
function fresh(seed = 7) {
    const g = createHeadlessGame(seed); g.animationEnabled = false;
    g.player.hp = g.player.maxHp = 100000;
    return g;
}
function rat(x = 4, y = 4) { return new Monster(x, y, monsterData.find(m => m.id === 'rat')! as MonsterData); }

describe('U03 whole-run persistence', () => {
    it('every Game instance field has an explicit U00 lifecycle/persistence decision', () => {
        const source = ts.createSourceFile('Game.ts', fs.readFileSync('src/engine/Core/Game.ts', 'utf8'), ts.ScriptTarget.Latest, true);
        const declaration = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Game') as ts.ClassDeclaration;
        const fields = declaration.members.filter(ts.isPropertyDeclaration)
            .filter(n => !n.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword)).map(n => n.name.getText(source)).sort();
        const contract = JSON.parse(fs.readFileSync('scripts/u03-state-contract.json', 'utf8'));
        expect(Object.keys(contract).sort()).toEqual(fields);
    });

    it('Cell AST and own fields are explicitly covered, including volume/flags/memory', () => {
        const source = ts.createSourceFile('Grid.ts', fs.readFileSync('src/engine/Map/Grid.ts', 'utf8'), ts.ScriptTarget.Latest, true);
        const declaration = source.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'Cell') as ts.ClassDeclaration;
        const fields = declaration.members.filter(ts.isPropertyDeclaration).map(n => n.name.getText(source)).sort();
        expect([...CELL_FIELDS].sort()).toEqual(fields);
        expect(Object.keys(new Cell(2, 3)).sort()).toEqual(fields);
    });

    for (const seed of [7, 12345, 202503]) it(`seed ${seed}: D1 → D2 → JSON load → D1 → new D3 equals continuous play field-for-field`, () => {
        const g = fresh(seed);
        wait(g, 3);
        const scentD1 = g.scent.getState();
        enter(g, 2); wait(g, 2);
        expect(g.levels.get(1)!.scent!.getState()).toEqual(scentD1);
        const saved = json(g.toSnapshot());
        expect(saved.levels.map(l => l.depth)).toEqual([1]);
        const branch = (game: Game) => {
            const trace = [];
            enter(game, 1); trace.push(stable(game));
            wait(game, 3); trace.push(stable(game));
            enter(game, 2); wait(game, 1); trace.push(stable(game));
            enter(game, 3); trace.push(stable(game));
            wait(game, 2); trace.push(stable(game));
            return trace;
        };
        const direct = branch(g);
        const loaded = fresh(999);
        const reseed = vi.spyOn(rng, 'seedRandomGenerator');
        expect(loaded.loadSnapshot(saved)).toBe(true); expect(reseed).not.toHaveBeenCalled(); reseed.mockRestore();
        expect(stable(loaded)).toEqual((({ savedAt: _time, ...s }) => s)(saved));
        expect(branch(loaded)).toEqual(direct);
    });

    it('restores one object per ID across active/cached/dormant/pending/carried/leader cycles', () => {
        const g = fresh();
        const leader = rat(), follower = rat(5, 4), dormant = rat(6, 4), passenger = rat(7, 4), falling = rat(8, 4);
        const item = ItemLoader.spawnWeapon('dart', -1, -1)!;
        leader.isAlly = follower.isAlly = true; follower.leader = leader;
        dormant.isDormant = true; dormant.carriedMonster = passenger; passenger.leader = leader;
        leader.carriedMonster = passenger; passenger.carriedMonster = dormant;
        dormant.carriedItem = item; falling.carriedItem = item; falling.leader = leader;
        follower.targetCorpseLoc = { x: 3, y: 4 }; follower.corpseAbsorptionCounter = 17;
        g.monsters = [follower]; g.dormantMonsters = [dormant];
        enter(g, 2); g.monsters = [leader]; g.dormantMonsters = [];
        (g as any).pendingFallenByDepth.set(3, [falling]);
        allocateEntityId(); allocateEntityId(); // consumed and deleted IDs must not be reused
        const saved = json(g.toSnapshot()), nextId = getNextEntityId();
        const loaded = fresh(99); expect(loaded.loadSnapshot(saved)).toBe(true);
        const l = loaded.monsters[0]!, f = loaded.levels.get(1)!.monsters[0]!, d = loaded.levels.get(1)!.dormantMonsters![0]!;
        const p = d.carriedMonster!, fall = (loaded as any).pendingFallenByDepth.get(3)[0] as Monster;
        expect(f.leader).toBe(l); expect(p.leader).toBe(l); expect(p.carriedMonster).toBe(d);
        expect(l.carriedMonster).toBe(p); expect(fall.carriedItem).toBe(d.carriedItem); expect(fall.leader).toBe(l);
        expect(getNextEntityId()).toBe(nextId); expect(stable(loaded)).toEqual((({ savedAt: _time, ...s }) => s)(saved));
        enter(loaded, 3); expect(loaded.monsters).toContain(fall); expect((loaded as any).pendingFallenByDepth.has(3)).toBe(false);
        expect(fall.carriedItem).toBe(d.carriedItem);
        enter(loaded, 1); expect(loaded.monsters).toContain(f); expect(f.leader).toBeNull();
        // CE Architect.restoreMonster retires an absent leader on real entry.
        // No objective block elapsed here, so the leader has not followed.
        expect(loaded.monsters).not.toContain(l);
    });

    for (const cached of [false, true]) it(`real monster fall into ${cached ? 'cached' : 'unvisited'} D2 survives JSON and subsequent dormancy/death`, () => {
        const g = fresh();
        if (cached) { enter(g, 2); enter(g, 1); }
        const falling = rat(g.player.loc.x + 1, g.player.loc.y);
        falling.hp = falling.maxHp = 1000; falling.falling = true;
        falling.carriedItem = ItemLoader.spawnWeapon('dart', -1, -1)!;
        const id = falling.id, itemId = falling.carriedItem.id;
        g.monsters = [falling];
        (g as any).monstersFall();
        expect(g.monsters).not.toContain(falling); expect(falling.hp).toBeLessThan(1000);
        expect(falling.preplaced).toBe(true);
        const saved = json(g.toSnapshot());
        const branch = (game: Game) => {
            enter(game, 2);
            const m = game.monsters.find(m => m.id === id)!;
            expect(m.carriedItem!.id).toBe(itemId);
            game.toggleMonsterDormancy(m); expect(game.dormantMonsters).toContain(m);
            game.toggleMonsterDormancy(m); expect(game.monsters).toContain(m);
            m.hp = 0; (game as any).removeDeadMonsters();
            expect(game.items.some(i => i.id === itemId)).toBe(true);
            return stable(game);
        };
        const direct = branch(g), loaded = fresh(99);
        expect(loaded.loadSnapshot(saved)).toBe(true); expect(branch(loaded)).toEqual(direct);
    });

    it('stores every writable cell field and pending environmental effects without replaying them', () => {
        const g = fresh();
        const c = g.grid.getCell(8, 8)!;
        c.layers = [TerrainType.FLOOR, TerrainType.WATER_DEEP, TerrainType.GRASS, TerrainType.NOTHING];
        c.volume = 3; c.autoSearched = true; c.isDiscovered = true; c.trapType = 'teleport';
        c.exposedToFire = 11; c.machineNumber = 982; c.isPowered = true; c.hasDormantMonster = true;
        c.hasMemory = true; c.isExplored = true;
        g.environment.setState({ fireCaughtQueue: [{ x: 8, y: 8 }], explosiveSpawnQueue: [{ x: 9, y: 8 }] });
        (g as any).pendingCaughtFireCells = [{ x: 10, y: 8 }];
        (g as any).displacementTrapDepressions = new WeakMap([[g.grid, new Set([123])]]);
        // U04c/K31: membership is derived from actual grid numbers (CE Architect.c:1691–1699).
        // Keep the full cell/pending-state roundtrip; a separate fake footprint is no longer state.
        const expectedMachineCells = new Set(g.toSnapshot().grid.filter(c => c.machineNumber !== 0).map(c => c.y * DCOLS + c.x));
        const before = json(c), saved = json(g.toSnapshot());
        const loaded = fresh(99); expect(loaded.loadSnapshot(saved)).toBe(true);
        expect(json(loaded.grid.getCell(8, 8))).toEqual(before);
        expect(loaded.grid.getCell(8, 8)!.volume).toBe(3); // NONE-volume orphan is still simulation state
        expect(loaded.environment.getState()).toEqual(saved.environmentState);
        expect((loaded as any).pendingCaughtFireCells).toEqual([{ x: 10, y: 8 }]);
        expect((loaded as any).displacementTrapDepressions.get(loaded.grid)).toEqual(new Set([123]));
        expect((loaded as any).machineCells).toEqual(expectedMachineCells);
        loaded.grid.getCell(8, 8)!.layers[DungeonLayer.SURFACE] = TerrainType.NOTHING;
        expect(saved.grid.find(c => c.x === 8 && c.y === 8)!.layers![2]).toBe(TerrainType.GRASS);
    });

    it('restores clock, search, generation accounting, pending mandatory choices and endgame over a dirty run', () => {
        const g = fresh(), state = g as any;
        state.meteredItems[0] = { frequency: -3.25, numberSpawned: 19 }; state.foodSpawned = 4321; state.goldGenerated = 987;
        g.monsterSpawnFuse = 37; g.ticksTillUpdateEnvironment = 29; g.absoluteTurnNumber = 81; timeSystem.currentTick = 1290;
        state.searchingCharge = 12; state.justSearched = true; state.playerFalling = true; g.pendingIdentify = true;
        g.stats = { gold: 17, kills: 9, turns: 42, maxDepth: 19 }; g.lastDamageSource = 'test';
        g.isGameOver = true; g.gameOverWon = true; g.gameOverScore = 1234;
        logger.log('retained history');
        const saved = json(g.toSnapshot());
        const loaded = fresh(99); (loaded as any).pendingFallenByDepth.set(5, [rat()]);
        expect(loaded.loadSnapshot(saved)).toBe(true); expect(stable(loaded)).toEqual((({ savedAt: _time, ...s }) => s)(saved));
        expect((loaded as any).meteredItems[0]).toEqual({ frequency: -3.25, numberSpawned: 19 });
        expect([(loaded as any).foodSpawned, (loaded as any).goldGenerated, loaded.monsterSpawnFuse]).toEqual([4321, 987, 37]);
        expect([loaded.ticksTillUpdateEnvironment, loaded.absoluteTurnNumber, timeSystem.currentTick]).toEqual([29, 81, 1290]);
        expect([(loaded as any).searchingCharge, (loaded as any).justSearched, (loaded as any).playerFalling]).toEqual([12, true, true]);
        expect([loaded.isGameOver, loaded.gameOverWon, loaded.gameOverScore, loaded.lastDamageSource]).toEqual([true, true, 1234, 'test']);
        expect(loaded.pendingIdentify).toBe(true);
        expect(logger.messages[logger.messages.length - 1]!.text).toBe('retained history');
        expect(loaded.isInventoryOpen).toBe(true); expect((loaded as any).pendingFallenByDepth.size).toBe(0);
    });

    it('scent values survive reentry, share the run clock, and rewind on every visited floor', () => {
        const g = fresh(); const x = g.player.loc.x, y = g.player.loc.y;
        g.scent.turnNumber = 19999; g.scent.addScent(g.grid, x, y, 0);
        enter(g, 2); const old = g.levels.get(1)!.scent!;
        expect(g.scent.turnNumber).toBe(19999); wait(g);
        expect(old.get(x, y)).toBe(4999); expect(g.scent.turnNumber).toBe(5002);
        enter(g, 1); expect(g.scent.turnNumber).toBe(5002); expect(g.scent.get(x, y)).toBe(4999);
        const copied = ScentMap.fromState(g.scent.getState()); expect(copied.getState()).toEqual(g.scent.getState());
    });

    it('rejects incomplete/old worlds before altering the current game or RNG', () => {
        const g = fresh(); enter(g, 2); const before = stable(g);
        for (const alter of [
            (s: any) => delete s.schema, (s: any) => delete s.run, (s: any) => s.run = {}, (s: any) => s.levels = [],
            (s: any) => delete s.ticksTillUpdateEnvironment, (s: any) => delete s.pendingEnchantment,
            (s: any) => delete s.grid[0].layers, (s: any) => s.levels.push(s.levels[0]),
            (s: any) => s.currentLevelDepth = 3,
        ]) {
            const bad = json(g.toSnapshot()); alter(bad);
            expect(g.loadSnapshot(bad)).toBe(false); expect(stable(g)).toEqual(before);
        }
    });

    it('refuses suspended turns, but loading retires an old animation without its epilogue', () => {
        const g = fresh(), saved = json(g.toSnapshot());
        g.isAdvancing = true; expect(() => g.toSnapshot()).toThrow('advancement');
        expect(g.loadSnapshot(saved)).toBe(true); expect(g.isAdvancing).toBe(false);
        expect(stable(g)).toEqual((({ savedAt: _time, ...s }) => s)(saved));
    });

    it('codec does not consume either RNG stream or expose aliased run/flavor/level containers', () => {
        const g = fresh(); enter(g, 2); rng.setRNG(RNGType.RNG_COSMETIC);
        const before = rng.getState(), saved: GameSnapshot = g.toSnapshot();
        expect(rng.getState()).toEqual(before);
        saved.run.meteredItems[0]!.frequency += 17;
        saved.levels[0]!.grid[0]!.layers![0] = TerrainType.FLOOR;
        const restored = fresh(999); expect(restored.loadSnapshot(json(saved))).toBe(true);
        expect(rng.getState()).toEqual(before);
        expect((g as any).meteredItems[0].frequency).not.toBe(saved.run.meteredItems[0]!.frequency);
        saved.run.meteredItems[0]!.frequency += 17;
        expect((restored as any).meteredItems[0].frequency).not.toBe(saved.run.meteredItems[0]!.frequency);
    });
});
