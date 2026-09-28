import { describe, expect, it } from 'vitest';
import { createHeadlessGame } from './harness';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { TerrainType as T } from '../engine/Map/Grid';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { tickTerrainColors } from '../engine/UI/DancingColors';
import { Item, ItemCategory } from '../engine/Items/Item';
import { writeFileSync } from 'node:fs';
import { cellTerrainFlags } from '../engine/Map/DungeonFeature';
import { T_PATHING_BLOCKER } from '../engine/Map/TerrainCatalog';

type Game = ReturnType<typeof createHeadlessGame>;
const schedules = [[], [10], Array(9).fill(1), Array(20).fill(10), [1000], [3, 17, 8, 32]];

// X-2 XN02's explicit mirror fixture. Only initial state is constructed;
// commands, flare frames, targeting and replay all use the production methods.
function fixture(g = createHeadlessGame(22013, 'test')) {
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, !x || !y || x === g.grid.width - 1 || y === g.grid.height - 1 ? T.WALL : T.FLOOR);
    }
    g.player.loc = { x: 10, y: 10 };
    g.player.setStatusDuration('darkness', 100); g.player.maxStatus.darkness = 100;
    const rat = new Monster(14, 10, (monsters as MonsterData[]).find(m => m.id === 'rat')!);
    rat.state = MonsterState.HUNTING; rat.ticksUntilTurn = 100000;
    g.monsters.push(rat);
    const potion = ItemLoader.spawnPotion('potion_of_strength', -1, -1)!;
    const wand = ItemLoader.spawnWand('wand_of_slowness', -1, -1)!;
    wand.identified = true; wand.charges = 10;
    g.player.inventory.addItem(potion); g.player.inventory.addItem(wand);
    (g as any).updateVision();
    return { g, rat, potion, wand };
}

function frames(g: Game, schedule: number[]) {
    for (const delta of schedule) {
        g.tickFlareAnimation(delta);
        tickTerrainColors(g.grid, delta, g.absoluteTurnNumber);
        g.lightMap.dance();
    }
}

function state(g: Game) {
    return structuredClone({
        cursor: g.pendingArcana?.cursor ?? null,
        throwItem: g.throwItemTarget?.id ?? null, throwing: g.isThrowing,
        selection: { identify: g.pendingIdentify, enchant: g.pendingEnchantment, confirm: g.pendingUseConfirm?.id ?? null },
        inventory: g.player.inventory.items.map(i => ({ id: i.id, quantity: i.quantity, charges: i.charges,
            enchantment: i.enchantment, strength: i.strengthRequired, identified: i.identified })),
        monsters: g.monsters.map(m => ({ id: m.id, hp: m.hp, loc: m.loc, status: m.statusDurations })),
        player: { loc: g.player.loc, hp: g.player.hp, strength: g.player.strength },
        tick: timeSystem.currentTick, turn: g.absoluteTurnNumber, rng: rng.getState(),
        end: { over: g.isGameOver, won: g.gameOverWon, superVictory: g.gameOverSuperVictory, score: g.gameOverScore },
    });
}

describe('X3b display frames at the shared command boundary', () => {
    it('replays quaff -> flare -> use -> confirm without changing the default target or spending charges', () => {
        const { g, rat, potion, wand } = fixture();
        g.executeItemCommand('quaff', potion);
        g.tickFlareAnimation(10);
        expect(g.grid.getCell(rat.x, rat.y)!.isVisible).toBe(true);
        g.executeItemCommand('use', wand);
        expect(g.pendingArcana?.cursor).toEqual(g.player.loc);
        g.executeCommand('confirm_target');
        expect(wand.charges).toBe(10);
        const recording = g.exportRecording(), expected = state(g);
        expect(recording.events).toHaveLength(3);
        for (const schedule of schedules) {
            expect(g.loadReplay(recording)).toBe(true);
            fixture(g);
            for (let n = 0; n < recording.events.length; n++) {
                frames(g, schedule);
                g.replayStep();
                expect(g.replayError, JSON.stringify(schedule)).toBeNull();
                if (n === 1) expect(g.pendingArcana?.cursor).toEqual(g.player.loc);
            }
            expect(g.replayCursor).toBe(3);
            expect(state(g)).toEqual(expected);
        }
    });

    it('normalizes callback commands and autonomous steps before their consumers run', () => {
        for (const schedule of schedules) {
            const { g, potion, rat } = fixture();
            g.executeItemCommand('quaff', potion);
            frames(g, schedule);
            g.executeCommand('help', undefined, () => {
                expect(g.grid.getCell(rat.x, rat.y)!.isVisible).toBe(false);
            });
            // Re-enter through the public render-loop entry, not executeCommand.
            g.handleMouseTravel(11, 10); // New travel command clears the preceding potion message's disturbance.
            g.stepAutoPath();
            expect(g.player.loc).toEqual({ x: 11, y: 10 });
            expect(g.exportRecording().events.map(e => e.action)).toEqual(['item:command', 'help', 'auto_step']);
        }
    });

    it('keeps item selection, confirmation, throwing and a real endgame equal in animated mirrored replay', () => {
        const setup = (game?: Game) => {
            const f = fixture(game), { g, wand } = f;
            wand.identified = false;
            const identify = ItemLoader.spawnScroll('scroll_of_identify', -1, -1)!;
            const enchant = ItemLoader.spawnScroll('scroll_of_enchantment', -1, -1)!;
            const darkness = ItemLoader.spawnPotion('potion_of_darkness', -1, -1)!;
            ItemLoader.identifyItemKind(darkness);
            const amulet = new Item('amulet', ',', 0xffffff, ItemCategory.AMULET);
            amulet.identityId = 'amulet_of_yendor';
            for (const item of [identify, enchant, darkness, amulet]) g.player.inventory.addItem(item);
            g.grid.setTerrain(11, 10, T.STAIRS_UP);
            (g as any).levelSeeds[0].upStairsLoc = { x: 11, y: 10 };
            return { ...f, identify, enchant, darkness };
        };
        const { g, potion, wand, identify, enchant, darkness } = setup();
        const rows: ReturnType<typeof state>[] = [];
        const act = (action: string, data?: unknown) => {
            frames(g, [10]); g.executeCommand(action, data); settle(g); rows.push(state(g));
        };
        const use = (operation: string, item?: Item) => act('item:command', `${operation}|${item?.inventoryLetter ?? ''}|`);
        use('quaff', potion);
        use('read', enchant); expect(g.pendingEnchantment).toBe(true);
        use('enchant', g.player.equippedWeapon!); expect(g.pendingEnchantment).toBe(false);
        use('read', identify); expect(g.pendingIdentify).toBe(true);
        use('identify', wand); expect(wand.identified).toBe(true);
        use('quaff', darkness); expect(g.pendingUseConfirm).toBe(darkness);
        use('cancel'); expect(g.player.inventory.items).toContain(darkness);
        use('quaff', darkness); use('confirm'); expect(g.player.inventory.items).not.toContain(darkness);
        use('use', wand); act('move', { x: 1, y: 0 }); act('confirm_target');
        const dart = g.player.inventory.items.find(i => i.identityId === 'dart')!;
        use('throw', dart); act('mouse_travel', { x: 14, y: 10 });
        act('move', { x: 1, y: 0 });
        expect(g.isGameOver).toBe(true); expect(g.gameOverWon).toBe(true);
        const recording = g.exportRecording();
        expect(recording.events[recording.events.length - 1]!.end?.won).toBe(true);
        for (const schedule of schedules) {
            g.animationEnabled = true;
            expect(g.loadReplay(recording)).toBe(true); setup(g);
            for (let n = 0; n < recording.events.length; n++) {
                frames(g, schedule); g.replayStep(); settle(g);
                expect(g.replayError).toBeNull(); expect(g.replayCursor).toBe(n + 1);
                expect(state(g)).toEqual(rows[n]);
            }
        }
    });
});

function settle(g: Game) {
    for (let n = 0; n < 100 && g.isAdvancing; n++) g.stepAdvancement();
    expect(g.isAdvancing).toBe(false);
}

// Find a cardinal route through generated terrain without changing the map,
// position, inventory or RNG. The resulting recording imports from its own seed.
function walk(g: Game, target: { x: number; y: number }, act: (action: string, data?: unknown) => void) {
    const key = (p: { x: number; y: number }) => `${p.x},${p.y}`;
    const start = { ...g.player.loc }, queue = [start];
    const previous = new Map<string, { x: number; y: number } | null>([[key(start), null]]);
    for (let n = 0; n < queue.length && !previous.has(key(target)); n++) {
        const p = queue[n]!;
        for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
            const next = { x: p.x + dx!, y: p.y + dy! }, cell = g.grid.getCell(next.x, next.y);
            if (!cell || previous.has(key(next))) continue;
            const isTarget = key(next) === key(target);
            if (!cell.isPassable && !cell.layers.includes(T.DOOR) && !isTarget) continue;
            if (!isTarget && (cellTerrainFlags(g.grid, next.x, next.y) & T_PATHING_BLOCKER)) continue;
            if (!isTarget && cell.layers.some(t => t === T.STAIRS_DOWN || t === T.STAIRS_UP)) continue;
            previous.set(key(next), p); queue.push(next);
        }
    }
    expect(previous.has(key(target)), `route to ${key(target)}`).toBe(true);
    const path: { x: number; y: number }[] = [];
    for (let p: typeof start | null = target; p && key(p) !== key(start); p = previous.get(key(p))!) path.unshift(p);
    for (const p of path) {
        const depth = g.depth;
        for (let n = 0; n < 60 && key(g.player.loc) !== key(p); n++) {
            act('move', { x: p.x - g.player.x, y: p.y - g.player.y });
            if (g.depth !== depth) {
                expect(p).toEqual(target);
                return;
            }
        }
        expect(g.player.loc).toEqual(p);
    }
}

function publicRecording(schedule: number[]) {
    // X4-R2 generation drift: this census seed naturally supplies the same
    // wand/enchantment/strength prerequisites. Every recording assertion stays.
    const g = createHeadlessGame(1453227, 'wizard'), rows: ReturnType<typeof state>[] = [];
    const act = (action: string, data?: unknown) => {
        frames(g, schedule); g.executeCommand(action, data); settle(g); rows.push(state(g));
    };
    const use = (operation: string, item?: { inventoryLetter?: string }) => act('item:command', `${operation}|${item?.inventoryLetter ?? ''}|`);
    const collect = (id: string) => {
        const item = g.items.find(i => i.identityId === id || i.consumableId === id)!;
        expect(item, id).toBeDefined(); walk(g, item.loc, act);
        if (!g.player.inventory.items.includes(item)) act('pickup');
        expect(g.player.inventory.items).toContain(item); return item;
    };
    const wand = collect('wand_of_slowness');
    const enchant = collect('scroll_of_enchantment');
    use('read', enchant); expect(g.pendingEnchantment).toBe(true); use('enchant', g.player.equippedWeapon!);
    const strength = collect('potion_of_strength');
    const flareIndex = rows.length;
    use('quaff', strength);
    expect((g as any).activeFlares.length).toBeGreaterThan(0);
    const charges = wand.charges!;
    use('use', wand); expect(g.pendingArcana).not.toBeNull();
    act('cancel_target'); expect(wand.charges).toBe(charges);
    use('use', wand); act('move', { x: 1, y: 0 }); act('confirm_target');
    expect(wand.charges).toBe(charges - 1);
    const dart = g.player.inventory.items.find(i => i.category === ItemCategory.WEAPON && i !== g.player.equippedWeapon)!;
    use('throw', dart); act('mouse_travel', { x: g.player.x + 1, y: g.player.y });
    act('help'); act('escape'); act('toggle_inventory'); act('escape');
    const next = [[1, 0], [0, 1], [-1, 0], [0, -1]].map(([x, y]) => ({ x: g.player.x + x!, y: g.player.y + y! }))
        .find(p => g.grid.getCell(p.x, p.y)?.isPassable && !g.getMonsterAt(p.x, p.y))!;
    expect(next).toBeDefined();
    act('mouse_travel', next);
    expect(g.autoPath.length).toBeGreaterThan(0);
    while (g.autoPath.length) {
        frames(g, schedule); g.stepAutoPath(); settle(g); rows.push(state(g));
    }
    act('wait');
    const stairs = Array.from({ length: g.grid.width * g.grid.height }, (_, i) =>
        g.grid.getCell(i % g.grid.width, Math.floor(i / g.grid.width))!).find(c => c.layers.includes(T.STAIRS_DOWN))!;
    expect(stairs).toBeDefined();
    walk(g, stairs, act);
    if (g.depth === 1) act('stairs_down');
    expect(g.depth).toBe(2);
    return { g, recording: { ...g.exportRecording(), recordedAt: 0 }, rows, flareIndex };
}

describe('X3b importable public new-game command recording', () => {
    it('keeps each state equal with frames, automatic/animated playback, backward seek and strict OOS', () => {
        const plain = publicRecording([]);
        const rendered = publicRecording([10]);
        expect(rendered.recording).toEqual(plain.recording);
        expect(rendered.rows).toEqual(plain.rows);
        const { g, recording, rows, flareIndex } = rendered;
        expect(recording.events.some(e => e.action === 'auto_step')).toBe(true);
        if (process.env.X3B_CAPTURE === '1') {
            writeFileSync(new URL('../../ai_docs/reports/x3b-evidence/public-recording.json', import.meta.url), JSON.stringify(recording) + '\n');
        }
        for (const [animated, schedule] of [[false, []], [true, [10]], [true, [3, 17, 1000]]] as const) {
            g.animationEnabled = animated;
            expect(g.loadReplay(recording)).toBe(true);
            g.replayPlay();
            for (let n = 0; n < recording.events.length * 7 && g.replayStatus === 'playing'; n++) {
                const before = g.replayCursor;
                g.tickReplay(); settle(g);
                if (g.replayCursor !== before) expect(state(g)).toEqual(rows[before]);
                frames(g, [...schedule]);
            }
            expect(g.replayError).toBeNull();
            expect(g.replayCursor).toBe(recording.events.length);
            expect(state(g)).toEqual(rows[rows.length - 1]);
        }
        for (const index of [flareIndex + 2, flareIndex, recording.events.length]) {
            g.replaySeek(index);
            expect(g.replayError).toBeNull(); expect(g.replayCursor).toBe(index);
            expect(state(g)).toEqual(rows[index - 1]);
            frames(g, [10]);
        }
        // Damage every checkpoint field independently; never relax the comparator.
        for (const field of ['tick', 'turn', 'depth', 'player', 'rng0', 'rng1', 'decisions', 'end']) {
            const bad = structuredClone(recording), index = flareIndex + 2, event = bad.events[index]!;
            if (field === 'tick') event.tick++;
            else if (field === 'turn') event.turn!++;
            else if (field === 'depth') event.depth++;
            else if (field === 'player') event.player.x++;
            else if (field.startsWith('rng')) event.rng!.streams[field === 'rng0' ? 0 : 1].a = (event.rng!.streams[field === 'rng0' ? 0 : 1].a ^ 1) >>> 0;
            else if (field === 'decisions') event.decisions!.push(true);
            else event.end = { won: true, superVictory: false, score: 1 };
            expect(g.loadReplay(bad)).toBe(true);
            g.replaySeek(index + 1);
            expect(g.replayCursor).toBe(index);
            expect(g.replayError, field).toContain(`OOS at command ${index + 1}:`);
        }
    });
});
