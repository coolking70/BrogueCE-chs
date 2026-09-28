import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { createHeadlessGame } from './harness';
import { TerrainType as T } from '../engine/Map/Grid';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';
import { normalizeMapGlyph } from '../ui/mapGlyph';
import { TERRAIN_APPEARANCES } from '../engine/UI/TerrainAppearanceCatalog';
import zh from '../locales/zh_CN.json';

afterEach(() => vi.restoreAllMocks());
function scene() {
    const g = createHeadlessGame(44001, 'test');
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleMonsters.clear(); g.visibleItems.clear();
    g.player.loc = { x: 10, y: 10 };
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { isVisible: true, hasMemory: true, isExplored: true, rememberedLayers: [...c.layers], rememberedItem: null });
    }
    for (let x = 9; x <= 16; x++) for (let y = 9; y <= 12; y++) tile(g, x, y, T.FLOOR);
    vi.spyOn(g as any, 'updateVision').mockImplementation(() => {});
    return g;
}
function tile(g: ReturnType<typeof scene>, x: number, y: number, terrain: T, unknown = false) {
    g.grid.setTerrain(x, y, terrain);
    const c = g.grid.getCell(x, y)!;
    Object.assign(c, { isVisible: !unknown, hasMemory: !unknown, isExplored: !unknown, rememberedLayers: unknown ? [] : [...c.layers] });
    return c;
}
function markGoal(g: ReturnType<typeof scene>, x = 15, y = 10) { tile(g, x, y, T.FLOOR, true); }

describe('X4a per-step known exploration/travel', () => {
    it('rebuilds after a wall is revealed, detours and continues past the old frontier without path-blocked text', () => {
        const g = scene(); markGoal(g);
        g.handlePlayerAction('auto_explore');
        const oldNext = { ...g.autoPath[0]! };
        tile(g, oldNext.x, oldNext.y, T.GRANITE);
        const move = vi.spyOn(g, 'handlePlayerAction');
        g.stepAutoPath();
        expect(g.player.loc).not.toEqual({ x: 10, y: 10 });
        expect(g.player.loc).not.toEqual(oldNext);
        expect(move).toHaveBeenCalledWith('move', expect.any(Object), 'system');
        expect(g.autoPath.length).toBeGreaterThan(0);
        // A new frontier after arriving at the old one must remain queued.
        tile(g, 15, 10, T.FLOOR); markGoal(g, 16, 12);
        for (let i = 0; i < 10 && g.autoPath.length; i++) {
            g.stepAutoPath();
            const at = g.grid.getCell(g.player.x, g.player.y)!;
            at.isExplored = true; at.hasMemory = true; at.isVisible = true; at.rememberedLayers = [...at.layers];
        }
        expect(g.player.loc).toEqual({ x: 16, y: 12 });
        expect(logger.messages.map(m => m.text).join('\n')).not.toMatch(/此路不通|Path blocked/);
    });
    it('silently rejects a known obstruction later in the route BEFORE moving', () => {
        const g = scene(); g.handleMouseTravel(15, 10);
        tile(g, 14, 10, T.GRANITE);
        const before = { loc: { ...g.player.loc }, turn: g.stats.turns, rng: rng.getState(), log: logger.getState() };
        g.stepAutoPath();
        expect(g.autoPath).toEqual([]);
        expect({ loc: g.player.loc, turn: g.stats.turns, rng: rng.getState(), log: logger.getState() }).toEqual(before);
    });
    it('uses remembered terrain, not hidden live walls/hazards, when validating the remaining route', () => {
        const g = scene(); g.handleMouseTravel(15, 10);
        const c = g.grid.getCell(14, 10)!; c.isVisible = false;
        g.grid.setTerrain(14, 10, T.GRANITE);
        g.stepAutoPath();
        expect(g.player.loc).toEqual({ x: 11, y: 10 });
        expect(g.autoPath.length).toBeGreaterThan(0);
    });
    it('does not read unknown next-cell passability before dispatching the shared movement entry', () => {
        const g = scene(); tile(g, 11, 10, T.GRANITE, true);
        g.handleMouseTravel(11, 10);
        const move = vi.spyOn(g, 'handlePlayerAction');
        g.stepAutoPath();
        expect(move).toHaveBeenCalledWith('move', { x: 1, y: 0 }, 'system');
        expect(g.player.loc).toEqual({ x: 10, y: 10 });
        expect(g.stats.turns).toBe(0); expect(g.autoPath).toEqual([]);
    });
    it('checks newly known diagonal corners throughout the route', () => {
        const g = scene(); g.handleMouseTravel(12, 12);
        tile(g, 12, 11, T.GRANITE);
        g.stepAutoPath();
        expect(g.player.loc).toEqual({ x: 10, y: 10 }); expect(g.autoPath).toEqual([]);
    });
    it.each(['confused', 'trapped'])('refuses %s exploration with no turn/RNG consumption', status => {
        const g = scene(); markGoal(g);
        if (status === 'confused') g.player.setStatusDuration('confused', 10);
        else tile(g, 10, 10, T.GRANITE);
        const state = rng.getState(); g.handlePlayerAction('auto_explore');
        expect(g.autoPath).toEqual([]); expect(g.stats.turns).toBe(0); expect(rng.getState()).toEqual(state);
    });
    it.each(['monster', 'item'])('stops when a new %s becomes visible', kind => {
        const g = scene(); markGoal(g); g.handlePlayerAction('auto_explore');
        if (kind === 'monster') {
            const m = new Monster(15, 10, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
            g.monsters.push(m); g.grid.getCell(15, 10)!.isVisible = true;
        } else {
            // X3-U4: CE only interrupts on a key in a newly discovered cell.
            const i = ItemLoader.spawnKey('iron_key', 15, 10)!; g.items.push(i);
            (g as any).updateFieldOfViewDisplay(() => 1000);
        }
        // Publish the simulated sighting before the next automatic command;
        // the renderer no longer owns visible-set/discovery side effects.
        (g as any).refreshVisibleEntities();
        g.stepAutoPath(); expect(g.autoPath).toEqual([]); expect(g.stats.turns).toBe(0);
    });
    it('stops in the revealing step itself, without requiring another auto_step', () => {
        const g = scene(); markGoal(g); g.handlePlayerAction('auto_explore');
        const item = ItemLoader.spawnKey('iron_key', 15, 11)!;
        tile(g, 15, 11, T.FLOOR, true);
        vi.spyOn(g as any, 'updateVision').mockImplementation(() => {
            if (!g.items.includes(item)) g.items.push(item);
            (g as any).updateFieldOfViewDisplay(() => 1000);
        });
        g.stepAutoPath();
        expect(g.stats.turns).toBe(1); expect(g.autoPath).toEqual([]);
        expect(g.exportRecording().events.map(e => e.action)).toEqual(['auto_explore', 'auto_step']);
    });
    it('prioritizes a known adjacent enemy through the common attack entry', () => {
        const g = scene(); markGoal(g);
        const enemy = new Monster(11, 10, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
        enemy.hp = enemy.maxHp = 100; enemy.ticksUntilTurn = 10000;
        g.monsters.push(enemy); g.visibleMonsters.add(enemy);
        const attack = vi.spyOn(g as any, 'resolvePlayerMeleeAttackOn');
        g.handlePlayerAction('auto_explore');
        expect(attack).toHaveBeenCalledWith(enemy);
        expect(g.player.loc).toEqual({ x: 10, y: 10 }); expect(g.stats.turns).toBe(1);
    });
    it('automatic movement runs the same special-tile entry exactly once', () => {
        const g = scene(); tile(g, 11, 10, T.SIGN); g.signTexts.set('11,10', 'X4a fixture');
        const entry = vi.spyOn(g as any, 'handleSpecialTileEntry');
        g.handleMouseTravel(11, 10); g.stepAutoPath();
        expect(entry).toHaveBeenCalledTimes(1); expect(g.player.loc).toEqual({ x: 11, y: 10 });
        expect(g.stats.turns).toBe(1);
    });
    it('walking pickup, terrain entry and timing match manual movement and record only auto_step', () => {
        const run = (auto: boolean) => {
            const g = scene(); const item = ItemLoader.spawnWeapon('dart', 11, 10)!;
            g.items.push(item); g.visibleItems.add(item);
            if (auto) { g.executeCommand('mouse_travel', { x: 11, y: 10 }); g.stepAutoPath(); }
            else g.handlePlayerAction('move', { x: 1, y: 0 });
            expect(g.items).not.toContain(item); expect(g.player.inventory.items).toContain(item);
            expect(g.stats.turns).toBe(1);
            expect(g.exportRecording().events.map(e => e.action)).toEqual(auto ? ['mouse_travel', 'auto_step'] : ['move']);
            return { loc: g.player.loc, tick: timeSystem.currentTick, turn: g.absoluteTurnNumber, rng: rng.getState() };
        };
        expect(run(true)).toEqual(run(false));
    });
    it('known-item pickup disturbs exploration in the movement turn', () => {
        const g = scene(); markGoal(g, 16, 12);
        const item = ItemLoader.spawnWeapon('dart', 11, 10)!; g.items.push(item); g.visibleItems.add(item);
        g.handlePlayerAction('auto_explore'); g.stepAutoPath();
        expect(g.player.loc).toEqual({ x: 11, y: 10 }); expect(g.items).not.toContain(item);
        expect(g.autoPath).toEqual([]); expect(g.stats.turns).toBe(1);
    });
    it('retains exploration mode across a whole-run snapshot and clears it on manual interruption', () => {
        const g = scene(); markGoal(g); g.handlePlayerAction('auto_explore');
        const save = g.toSnapshot(); expect(save.run.isAutoExploring).toBe(true);
        expect(g.loadSnapshot(save)).toBe(true);
        expect(g.toSnapshot().run.isAutoExploring).toBe(true);
        g.handlePlayerAction('wait'); expect(g.toSnapshot().run.isAutoExploring).toBeUndefined();
    });
    it('preserves no-target and no-initial-route messages', () => {
        const g = scene(); g.handlePlayerAction('auto_explore');
        expect(logger.messages.some(m => m.text.includes('I see no path for further exploration.'))).toBe(true);
        g.handleMouseTravel(0, 0);
        expect(logger.messages.some(m => m.text.includes('No path is available.'))).toBe(true);
    });
});

describe('X4a throw cancellation', () => {
    it('escape clears targeting without using resources, a turn or either RNG stream; replays as escape', () => {
        const g = createHeadlessGame(44002, 'test');
        const item = g.player.inventory.items[0]!;
        g.executeItemCommand('throw', item);
        const before = { tick: timeSystem.currentTick, turn: g.absoluteTurnNumber, rng: rng.getState(), items: JSON.stringify(g.player.inventory.items) };
        g.handlePlayerAction('escape');
        expect(g.isThrowing).toBe(false); expect(g.throwItemTarget).toBeNull();
        expect({ tick: timeSystem.currentTick, turn: g.absoluteTurnNumber, rng: rng.getState(), items: JSON.stringify(g.player.inventory.items) }).toEqual(before);
        const rec = g.exportRecording(); expect(rec.events.map(e => e.action)).toEqual(['item:command', 'escape']);
        expect(g.loadReplay(rec)).toBe(true);
        for (const _ of rec.events) g.replayStep();
        expect(g.replayError).toBeNull(); expect(g.isThrowing).toBe(false); expect(g.throwItemTarget).toBeNull();
    });
    it('an open inventory takes precedence; the next escape cancels throwing', () => {
        const g = scene(); g.executeItemCommand('throw', g.player.inventory.items[0]!); g.isInventoryOpen = true;
        g.handlePlayerAction('escape'); expect(g.isInventoryOpen).toBe(false); expect(g.isThrowing).toBe(true);
        g.handlePlayerAction('escape'); expect(g.isThrowing).toBe(false);
    });
});

describe('X4a text presentation at all Pixi text boundaries', () => {
    function check(raw: string) {
        const normalized = normalizeMapGlyph(raw);
        const points = [...normalized];
        for (let i = 0; i < points.length; i++) if (/\p{Emoji}/u.test(points[i]!)) expect(points[i + 1], raw).toBe('\uFE0E');
        expect(normalizeMapGlyph(normalized)).toBe(normalized);
        expect(normalized).not.toContain('\uFE0F');
    }
    it('covers every Emoji=Yes code point in both required symbol blocks, including emoji-default Aries', () => {
        let count = 0;
        for (const [start, end] of [[0x2600, 0x27bf], [0x2b00, 0x2bff]]) for (let cp = start!; cp <= end!; cp++) {
            const char = String.fromCodePoint(cp);
            if (/\p{Emoji}/u.test(char)) { count++; check(char); check(char + '\uFE0F'); }
        }
        expect(count).toBeGreaterThan(100);
        expect(normalizeMapGlyph('♈♠')).toBe('♈\uFE0E♠\uFE0E');
        expect(normalizeMapGlyph('@中·')).toBe('@中·');
        expect(TERRAIN_APPEARANCES[T.FOLIAGE].char).toBe('♈');
    });
    it('normalizes every terrain/entity catalog glyph and short glyph literal in engine/entity sources', () => {
        for (const entry of Object.values(TERRAIN_APPEARANCES)) check(entry.char);
        let checked = 0;
        function walk(dir: string) {
            for (const ent of readdirSync(dir, { withFileTypes: true })) {
                const file = join(dir, ent.name);
                if (ent.isDirectory()) walk(file);
                else if (/\.(ts|json)$/.test(file) && !file.endsWith('.test.ts')) {
                    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
                    function visit(node: ts.Node) {
                        if (ts.isStringLiteral(node) && [...node.text].length <= 4 && /\p{Emoji}/u.test(node.text)) { checked++; check(node.text); }
                        ts.forEachChild(node, visit);
                    }
                    visit(source);
                }
            }
        }
        for (const dir of ['src/engine', 'src/entities', 'src/data']) walk(dir);
        expect(checked).toBeGreaterThan(30);
    });
    it('wires terrain, entities, bolts, floating text and throw cancel; removes obsolete i18n keys', () => {
        const canvas = readFileSync('src/components/GameCanvas.vue', 'utf8');
        for (const call of ['normalizeMapGlyph(char)', 'normalizeMapGlyph(text)', 'normalizeMapGlyph(boltFrame.char)', 'normalizeMapGlyph(ft.text)']) expect(canvas).toContain(call);
        const target = readFileSync('src/components/TargetBar.vue', 'utf8');
        expect(target).toContain("dispatch('escape')"); expect(target).not.toContain('cancelUnsupported');
        expect(zh).not.toHaveProperty('move.path_blocked'); expect(zh).not.toHaveProperty('mobile.target.throw_cancel_unsupported');
        const game = readFileSync('src/engine/Core/Game.ts', 'utf8');
        const step = game.slice(game.indexOf('private stepAutoPathInner'), game.indexOf('public triggerGameOver'));
        expect(step).not.toMatch(/player\.loc\.[xy]\s*=\s*[^=]|isPassable/);
        expect(step).toContain("handlePlayerAction('move'");
    });
});
