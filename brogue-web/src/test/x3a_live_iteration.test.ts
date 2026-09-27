import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { iterateCreatures } from '../engine/Core/MonsterLifecycle';
import { Monster, MonsterState, countMinions, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { TerrainType as T } from '../engine/Map/Grid';
import { updateMonsterState, wakeMonster } from '../engine/Combat/MonsterAI';
import { closestBlinkEnemy, buildBlinkEnemyMap, buildBlinkAllySafetyMap, monsterAvoidsCorridor } from '../engine/Combat/MonsterBlink';
import { canSeeMonster, canDirectlySeeMonster, canDisplayMonster } from '../engine/UI/MonsterVisibility';
import { visibleMonsterRows } from '../engine/UI/MonsterSidebar';
import { arcanaTargetCandidates } from '../engine/Combat/BoltTargeting';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { Direction } from '../types';

const data = (id: string) => (monsters as MonsterData[]).find(m => m.id === id)!;
function scene() {
    const g = createHeadlessGame(22013, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = []; g.purgatory = [];
    g.animationEnabled = false;
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++)
        g.grid.setTerrain(x, y, x && y && x < g.grid.width - 1 && y < g.grid.height - 1 ? T.FLOOR : T.WALL);
    g.player.loc = { x: 10, y: 10 }; (g as any).updateVision();
    return g;
}
function mob(g: Game, id = 'rat', x = 12, y = 10) {
    const m = new Monster(x, y, data(id)); m.state = MonsterState.HUNTING;
    g.monsters.push(m); return m;
}
const sweep = (g: Game) => (g as any).removeDeadMonsters();
const dead = (m: Monster) => m.takeDamage(m.hp, true);
afterEach(() => vi.restoreAllMocks());

describe('X3a live roster, not physical unlinking', () => {
    it('matches original CE iterator for every death mask; HP zero alone is not HAS_DIED', () => {
        const rows = JSON.parse(readFileSync(new URL('../../ai_docs/reports/x3a-evidence/ce-iterator.json', import.meta.url), 'utf8'));
        const before = rng.getState();
        for (const row of rows) {
            const list = Array.from({ length: 8 }, (_, id) => ({ id, hp: id % 2, deathProcessed: !!(row.mask & (1 << id)) }));
            expect([...iterateCreatures(list)].map(m => m.id), `CE mask ${row.mask}`).toEqual(row.ids);
            expect(list).toHaveLength(8);
        }
        expect(rows).toHaveLength(256); expect(rng.getState()).toEqual(before);
    });

    it('checks later members at visit time; a stable cohort does not admit a released passenger twice', () => {
        const a = { deathProcessed: false }, b = { deathProcessed: false }, c = { deathProcessed: false };
        const list = [a, b, c], seen = [];
        for (const m of iterateCreatures([...list])) {
            seen.push(m);
            if (m === a) { b.deathProcessed = true; list.unshift({ deathProcessed: false }); }
        }
        expect(seen).toEqual([a, c]); expect(list).toHaveLength(4);
    });

    it.each([0, 1, 2])('seed22013 fear and real wait match a swept control with corpse at index %i', index => {
        const branch = (clean: boolean) => {
            const g = scene(), rat = mob(g), corpse = mob(g, 'revenant', 13), far = mob(g, 'rat', 40, 20);
            corpse.isAlly = true; far.ticksUntilTurn = 10000; rat.ticksUntilTurn = 0;
            g.monsters = [rat, far]; g.monsters.splice(index, 0, corpse);
            (g as any).updateVision(); dead(corpse);
            expect(corpse.deathProcessed).toBe(true); expect(g.monsters).toContain(corpse);
            expect(g.getMonsterAt(13, 10)).toBeUndefined();
            if (clean) sweep(g);
            const before = rng.getState(); updateMonsterState(g, rat, (g as any).calculateStealthRange());
            expect(rat.state).toBe(MonsterState.HUNTING);
            expect(rng.getState()).toEqual(before);
            g.executeCommand('wait');
            return { loc: rat.loc, hp: rat.hp, state: rat.state, rng: rng.getState(), listed: g.monsters.includes(corpse) };
        };
        expect(branch(false)).toEqual(branch(true));
    });

    it('dying DF retains occupancy and iteration; reentry cannot duplicate its effects', () => {
        const g = scene(), host = mob(g, 'bloat'); host.isAlly = true;
        host.carriedItem = ItemLoader.spawnKey('iron_key', host.x, host.y)!;
        const item = host.carriedItem, original = g.environment.addGas.bind(g.environment);
        const add = vi.spyOn(g.environment, 'addGas').mockImplementation((...args) => {
            expect(host.hp).toBe(0); expect(host.deathProcessed).toBe(false);
            expect([...iterateCreatures(g.monsters)]).toContain(host);
            expect(g.getMonsterAt(host.x, host.y)).toBe(host); expect(g.items).toContain(item);
            g.killMonster(host); return original(...args);
        });
        dead(host); expect(add).toHaveBeenCalledOnce();
        expect([...iterateCreatures(g.monsters)]).not.toContain(host);
        expect(g.monsters).toContain(host); expect(g.purgatory).toEqual([]);
        sweep(g); expect(g.purgatory).toEqual([host]); expect(add).toHaveBeenCalledOnce();
    });

    it.each([false, true])('released passenger participates only if contact survives (lethal=%s)', lethal => {
        const g = scene(), rat = mob(g), host = mob(g, 'rat', 13);
        const child = new Monster(0, 0, data('revenant')); child.isAlly = true; host.carriedMonster = child;
        if (lethal) g.grid.setTerrain(host.x, host.y, T.LAVA);
        dead(host);
        expect(host.deathProcessed).toBe(true); expect(g.monsters).toContain(host);
        expect(g.monsters.filter(m => m === child)).toHaveLength(1);
        expect([...iterateCreatures(g.monsters)].includes(child)).toBe(!lethal);
        expect(g.getMonsterAt(13, 10)).toBe(lethal ? undefined : child);
        updateMonsterState(g, rat, (g as any).calculateStealthRange());
        expect(rat.state).toBe(lethal ? MonsterState.HUNTING : MonsterState.FLEEING);
        sweep(g); g.killMonster(host);
        expect(g.monsters.filter(m => m === child)).toHaveLength(lethal ? 0 : 1);
    });

    it('explosion chain removes completed victims from live queries before sweeping', () => {
        const g = scene(), rat = mob(g, 'rat', 18), bomb = mob(g, 'explosive_bloat', 13), bloat = mob(g, 'bloat', 14);
        bloat.isAlly = true;
        const drops = vi.spyOn(g, 'makeMonsterDropItem'); dead(bomb);
        expect(bomb.deathProcessed && bloat.deathProcessed).toBe(true);
        expect(g.monsters).toEqual([rat, bomb, bloat]);
        expect([...iterateCreatures(g.monsters)]).toEqual([rat]);
        expect(drops.mock.calls.map(([m]) => m)).toEqual([bomb, bloat]);
        sweep(g); expect(drops).toHaveBeenCalledTimes(2);
    });

    it('purgatory remains a raw resurrection payload; a restored ally is live again and can die again', () => {
        const g = scene(), rat = mob(g), corpse = mob(g, 'revenant', 13); corpse.isAlly = true;
        dead(corpse); sweep(g); expect(g.purgatory).toContain(corpse);
        expect(g.loadSnapshot(JSON.parse(JSON.stringify(g.toSnapshot())))).toBe(true);
        expect(g.resurrectAlly({ x: 13, y: 10 })).toBe(true);
        const raised = g.monsters.find(m => m.id === corpse.id)!, hunter = g.monsters.find(m => m.id === rat.id)!;
        expect(raised.deathProcessed).toBe(false); expect([...iterateCreatures(g.monsters)]).toContain(raised);
        updateMonsterState(g, hunter, (g as any).calculateStealthRange()); expect(hunter.state).toBe(MonsterState.FLEEING);
        dead(raised); updateMonsterState(g, hunter, (g as any).calculateStealthRange());
        expect(hunter.state).toBe(MonsterState.HUNTING); expect(g.monsters).toContain(raised);
    });
});

describe('X3a audited live consumers', () => {
    it('DF activation leaves completed dormant corpses linked and inert until the sweep', () => {
        const g = scene(), corpse = new Monster(14, 10, data('rat')), living = new Monster(15, 10, data('rat'));
        for (const m of [corpse, living]) { m.isDormant = true; g.grid.getCell(m.x, m.y)!.hasDormantMonster = true; }
        g.dormantMonsters = [corpse, living]; dead(corpse);
        const before = rng.getState();
        (g as any).awakenDormantMonstersAt(corpse.loc, [living.loc]);
        expect(corpse.isDormant).toBe(true); expect(g.dormantMonsters).toEqual([corpse]);
        expect(g.monsters).toEqual([living]); expect(living.isDormant).toBe(false);
        expect(g.grid.getCell(corpse.x, corpse.y)!.hasDormantMonster).toBe(false);
        expect(rng.getState()).toEqual(before); sweep(g); expect(g.dormantMonsters).toEqual([]);
    });

    it.each([11, 15])('stale visible corpse at x=%i cannot divert or stop the next auto step', x => {
        const g = scene(), corpse = mob(g, 'rat', x);
        g.visibleMonsters = new Set([corpse]); dead(corpse);
        g.autoPath = [{ x: 9, y: 10 }]; g.isMouseTraveling = false;
        g.stepAutoPath();
        expect(g.player.loc).toEqual({ x: 9, y: 10 }); expect(g.everSeenMonsters).not.toContain(corpse);
    });

    it('auto-explore does not auto-attack or mark a stale visible corpse as seen', () => {
        const g = scene(), corpse = mob(g, 'rat', 11);
        g.visibleMonsters = new Set([corpse]); dead(corpse);
        const loc = { ...g.player.loc };
        (g as any).handleAutoExplore();
        expect(g.player.loc).toEqual(loc); expect(g.everSeenMonsters).not.toContain(corpse);
    });

    it('opening a cage cannot recruit a listed corpse or make it eligible for resurrection', () => {
        const g = scene(), corpse = mob(g, 'rat', 12), living = mob(g, 'rat', 12, 11);
        corpse.isCaged = living.isCaged = true; dead(corpse);
        g.grid.setTerrain(11, 10, T.MONSTER_CAGE_CLOSED);
        const key = ItemLoader.spawnKey('cage_key', -1, -1)!;
        key.originDepth = g.depth; key.keyLoc = [{ loc: { x: 11, y: 10 }, machine: 0, disposableHere: true }];
        g.player.inventory.addItem(key);
        g.handlePlayerAction('move', Direction.RIGHT);
        expect(living.isAlly).toBe(true); expect(living.isCaged).toBe(false);
        expect(corpse.isAlly).toBe(false); expect(corpse.isCaged).toBe(true);
        expect(g.purgatory).not.toContain(corpse);
    });

    it('monster spell selection neither heals a corpse nor consumes a target roll for it', () => {
        const g = scene(), caster = mob(g, 'goblin_mystic'), corpse = mob(g, 'rat', 14);
        caster.bolts = ['HEALING']; corpse.leader = caster; dead(corpse);
        const before = rng.getState(); expect(caster.tryUseBolt(g)).toBe(false); expect(rng.getState()).toEqual(before);
        expect(corpse.hp).toBe(0);
        const living = mob(g, 'rat', 14, 11); living.leader = caster; living.hp = 1;
        caster.behaviorFlags.add('MONST_ALWAYS_USE_ABILITY');
        expect(caster.tryUseBolt(g)).toBe(true); expect(living.hp).toBeGreaterThan(1); expect(corpse.hp).toBe(0);
    });

    it('scent following uses the same direction and RNG through a completed death cell', () => {
        const branch = (clean: boolean) => {
            const g = scene(), hunter = mob(g), corpse = mob(g, 'rat', 11); dead(corpse);
            if (clean) sweep(g);
            g.scent.replaceScent(g.grid, 11, 10, 0);
            const step = g.scent.stepDirection(g.grid, hunter.x, hunter.y, { canEnter: (x, y) => !g.getMonsterAt(x, y) });
            return { step, rng: rng.getState() };
        };
        const result = branch(false); expect(result.step).toEqual([-1, 0]); expect(result).toEqual(branch(true));
    });

    it('invisible dead enemies do not affect ally selection/maps or draw target RNG', () => {
        const g = scene(), ally = mob(g), corpse = mob(g, 'rat', 13), living = mob(g, 'rat', 16);
        ally.isAlly = true; corpse.applyStatus('invisible', 100); dead(corpse);
        const before = rng.getState(); expect(closestBlinkEnemy(g, ally)).toBe(living); expect(rng.getState()).toEqual(before);
        const map = buildBlinkEnemyMap(g, ally, 8), safety = buildBlinkAllySafetyMap(g);
        sweep(g); expect(buildBlinkEnemyMap(g, ally, 8)).toEqual(map); expect(buildBlinkAllySafetyMap(g)).toEqual(safety);
    });

    it('dead allies/followers do not count toward summoning or wake with the horde', () => {
        const g = scene(), leader = mob(g, 'goblin_conjurer'), corpse = mob(g, 'rat', 14), living = mob(g, 'rat', 15);
        corpse.leader = living.leader = leader; corpse.state = living.state = MonsterState.ASLEEP;
        dead(corpse); const ticks = corpse.ticksUntilTurn;
        expect(countMinions(leader, g.monsters)).toBe(1);
        wakeMonster(g, leader, 100); expect(corpse.state).toBe(MonsterState.ASLEEP); expect(corpse.ticksUntilTurn).toBe(ticks);
        leader.isAlly = corpse.isAlly = living.isAlly = true;
        expect(countMinions(leader, g.monsters)).toBe(2);
    });

    it('a dead final follower cannot keep a leader avoiding corridors', () => {
        const g = scene(), leader = mob(g, 'goblin', 10), follower = mob(g, 'rat', 20);
        follower.leader = leader;
        g.grid.setTerrain(15, 9, T.WALL); g.grid.setTerrain(15, 11, T.WALL);
        expect(monsterAvoidsCorridor(g, leader, { x: 15, y: 10 })).toBe(true);
        dead(follower);
        expect(follower.leader).toBe(leader); // delayed removal still retains the relation payload
        expect(monsterAvoidsCorridor(g, leader, { x: 15, y: 10 })).toBe(false);
        sweep(g); expect(monsterAvoidsCorridor(g, leader, { x: 15, y: 10 })).toBe(false);
    });

    it('demotion skips completed dormant followers but detaches living dormant followers', () => {
        const g = scene(), leader = mob(g), corpse = new Monster(15, 10, data('rat')), living = new Monster(16, 10, data('rat'));
        for (const m of [corpse, living]) { m.leader = leader; m.isDormant = true; }
        g.dormantMonsters = [corpse, living]; dead(corpse); dead(leader);
        expect(corpse.leader).toBe(leader); expect(living.leader).toBeNull();
    });

    it('group discord/negation leave corpses untouched and still affect living targets', () => {
        const g = scene(), corpse = mob(g), living = mob(g, 'rat', 14);
        corpse.applyStatus('hasted', 20); living.applyStatus('hasted', 20); dead(corpse);
        const status = { ...corpse.statusDurations };
        (g as any).discordBlastFromPlayer('test');
        expect(living.hasStatus('discordant')).toBe(true); expect(corpse.statusDurations).toEqual(status);
        (g as any).negationBlastFromPlayer('test', 20);
        expect(living.hasStatus('hasted')).toBe(false); expect(corpse.statusDurations).toEqual(status);
    });

    it('light, visible identity, telepathy markers, sidebar and auto-targets ignore listed corpses', () => {
        const g = scene(), corpse = mob(g, 'wisp', 13), living = mob(g, 'rat', 15);
        g.player.applyStatus('telepathy', 100); dead(corpse); (g as any).updateVision();
        expect(canSeeMonster(g.player, g.grid, corpse)).toBe(false);
        expect(canDirectlySeeMonster(g.player, g.grid, corpse)).toBe(false);
        expect(canDisplayMonster(g.player, g.grid, corpse)).toBe(false);
        expect(visibleMonsterRows(g.player, g.grid, g.monsters).map(m => m.id)).toEqual([living.id]);
        const wand = ItemLoader.spawnWand('wand_of_slowness', -1, -1)!;
        expect(arcanaTargetCandidates(g.player, g.grid, g.monsters, wand)).toEqual([living]);
        const light = Array.from({ length: g.grid.width }, (_, x) => Array.from({ length: g.grid.height }, (_, y) => ({ ...g.lightMap.lightAt(x, y) })));
        sweep(g); (g as any).updateVision();
        expect(Array.from({ length: g.grid.width }, (_, x) => Array.from({ length: g.grid.height }, (_, y) => ({ ...g.lightMap.lightAt(x, y) })))).toEqual(light);
    });
});
