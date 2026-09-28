import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { TerrainType as T } from '../engine/Map/Grid';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import monsters from '../data/monsters.json';
import { rng } from '../engine/Random';
import { timeSystem } from '../engine/Systems/Time';
import { logger } from '../engine/Systems/Logger';

afterEach(() => vi.restoreAllMocks());
function room(g: Game) {
    g.monsters = []; g.dormantMonsters = []; g.items = [];
    g.visibleMonsters.clear(); g.visibleItems.clear();
    for (let x = 0; x < g.grid.width; x++) for (let y = 0; y < g.grid.height; y++) {
        g.grid.setTerrain(x, y, x >= 8 && x <= 16 && y >= 8 && y <= 12 ? T.FLOOR : T.GRANITE);
        const c = g.grid.getCell(x, y)!;
        Object.assign(c, { hasMemory: true, isVisible: true, isClairvoyantVisible: false, isMagicMapped: false,
            isDiscovered: false, isExplored: true, machineNumber: 0, rememberedLayers: [...c.layers] });
    }
    g.player.loc = { x: 10, y: 10 }; g.player.hp = g.player.maxHp = 500;
    g.player.equippedWeapon = null; g.player.equippedArmor = null;
}
function scene() { const g = createHeadlessGame(33002, 'test'); room(g); return g; }
function mob(g: Game, kind: 'ally' | 'discordant' | 'captive' = 'ally', x = 11, y = 10, id = 'monkey') {
    const m = new Monster(x, y, { ...monsters.find(row => row.id === id)!, hp: 500, defense: 0 } as MonsterData);
    m.isAlly = kind !== 'captive'; m.isCaged = kind === 'captive'; m.state = MonsterState.WANDERING;
    m.ticksUntilTurn = 10000; // Observe displacement separately from the ally's subsequent AI turn.
    if (kind === 'discordant') m.setStatusDuration('discordant', 100);
    g.monsters.push(m); return m;
}
function equip(g: Game, id: string) {
    const w = ItemLoader.spawnWeapon(id, -1, -1)!;
    Object.assign(w, { enchantment: 0, runicType: undefined, isProtected: false });
    g.player.equippedWeapon = w; g.player.strength = 100; return w;
}
function state(g: Game) {
    return structuredClone({ player: { loc: g.player.loc, hp: g.player.hp, statuses: g.player.statusDurations,
        ticks: g.player.ticksUntilTurn, inventory: g.player.inventory.items }, turn: g.absoluteTurnNumber,
        stats: g.stats, tick: timeSystem.currentTick, rng: rng.getState(), items: g.items,
        monsters: g.monsters.map(m => ({ loc: m.loc, hp: m.hp, ally: m.isAlly, captive: m.isCaged,
            statuses: m.statusDurations, ticks: m.ticksUntilTurn, carriedItem: m.carriedItem })),
        layers: g.grid.getCell(11, 10)!.layers, messages: logger.getState() });
}
const move = (g: Game) => g.executeCommand('move', { x: 1, y: 0 });

function lavaOrigin(g: Game) {
    g.grid.setTerrain(10, 10, T.LAVA); g.player.setStatusDuration('levitating', 100);
}

describe('X3-U2 D05 ally swap', () => {
    it.each([undefined, 'axe', 'whip', 'spear', 'rapier', 'flail'])('%s swaps a normal ally without attacking or confirming, using movementSpeed', weapon => {
        const g = scene(), m = mob(g); if (weapon) equip(g, weapon);
        const ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const old = state(g); move(g);
        expect(g.player.loc).toEqual({ x: 11, y: 10 }); expect(m.loc).toEqual({ x: 10, y: 10 });
        expect(m.hp).toBe(500); expect(g.player.hp).toBe(500); expect(ask).not.toHaveBeenCalled();
        expect(timeSystem.currentTick - old.tick).toBe(g.player.movementSpeed);
        expect(g.absoluteTurnNumber).toBe(old.turn + 1);
        expect(g.exportRecording().events[0]?.decisions).toEqual([]);
    });
    it('swap still picks up the destination item and respects the terrain confirmation before moving either creature', () => {
        const g = scene(), m = mob(g); g.grid.setTerrain(11, 10, T.PLAIN_FIRE);
        const item = ItemLoader.spawnKey('iron_key', 11, 10)!; g.items.push(item);
        g.onConfirmRequest = () => false; const old = state(g); move(g); expect(state(g)).toEqual(old);
        g.onConfirmRequest = () => true; move(g);
        expect(m.loc).toEqual({ x: 10, y: 10 }); expect(m.hp).toBe(500);
        expect(g.player.inventory.items).toContain(item); expect(g.items).not.toContain(item);
    });
    it('lava fallback excludes the player, another monster and stairs, choosing the nearest path ties', () => {
        const g = scene(), m = mob(g); lavaOrigin(g);
        const other = mob(g, 'ally', 12, 10);
        g.grid.setTerrain(11, 9, T.STAIRS_UP); g.grid.setTerrain(11, 11, T.STAIRS_DOWN);
        move(g);
        expect(g.player.loc).toEqual({ x: 11, y: 10 }); expect(m.hp).toBe(500);
        expect([{ x: 10, y: 9 }, { x: 10, y: 11 }, { x: 12, y: 9 }, { x: 12, y: 11 }]).toContainEqual(m.loc);
        expect(other.loc).toEqual({ x: 12, y: 10 }); expect(g.getMonsterAt(m.x, m.y)).toBe(m);
    });
    it('an enclosed landing uses CE square-ring fallback across blocked diagonal corners', () => {
        const g = scene(), m = mob(g); lavaOrigin(g);
        for (const [x, y] of [[11, 9], [11, 11], [12, 10]]) g.grid.setTerrain(x!, y!, T.GRANITE);
        move(g);
        expect(g.player.loc).toEqual({ x: 11, y: 10 });
        expect([{ x: 10, y: 9 }, { x: 10, y: 11 }, { x: 12, y: 9 }, { x: 12, y: 11 }]).toContainEqual(m.loc);
    });
    it('temporary flight permits the original lava square without invoking fallback', () => {
        const g = scene(), m = mob(g); lavaOrigin(g); m.setStatusDuration('levitating', 100);
        move(g); expect(m.loc).toEqual({ x: 10, y: 10 }); expect(m.hp).toBe(500);
    });
    it('applies CE current-terrain exception after relocation: deep water does not force fallback', () => {
        const g = scene(), m = mob(g); g.grid.setTerrain(10, 10, T.WATER_DEEP);
        move(g); expect(m.loc).toEqual({ x: 10, y: 10 }); expect(m.hp).toBe(500);
    });
});

describe('X3-U2 D05 discordant attack confirmation', () => {
    it.each([undefined, 'axe', 'whip', 'spear'])('%s No changes no gameplay state; Yes attacks without swapping', weapon => {
        const g = scene(), m = mob(g, 'discordant'); if (weapon) equip(g, weapon);
        g.player.setStatusDuration('nauseous', 10);
        const ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const old = state(g); move(g);
        expect(ask).toHaveBeenCalledExactlyOnceWith('Are you sure you want to attack Monkey?');
        expect(state(g)).toEqual(old); expect(g.exportRecording().events[0]?.decisions).toEqual([false]);
        g.player.setStatusDuration('nauseous', 0); ask.mockReturnValue(true); move(g);
        expect(m.hp).toBeLessThan(500); expect(g.player.loc).toEqual({ x: 10, y: 10 }); expect(m.loc).toEqual({ x: 11, y: 10 });
        expect(g.stats.turns).toBe(old.stats.turns + 1); expect(g.exportRecording().events[1]?.decisions).toEqual([true]);
    });
    it('sweep confirms a secondary discordant ally before damaging the primary enemy; asks once for multiple allies', () => {
        const g = scene(); equip(g, 'axe'); const enemy = mob(g); enemy.isAlly = false;
        mob(g, 'discordant', 10, 9); mob(g, 'discordant', 10, 11);
        const ask = vi.fn(() => false); g.onConfirmRequest = ask; const old = state(g); move(g);
        expect(ask).toHaveBeenCalledTimes(1); expect(state(g)).toEqual(old);
        ask.mockReturnValue(true); move(g); expect(g.monsters.every(m => m.hp < 500)).toBe(true);
    });
    it('acid question precedes discordant question, with both answers in one command decision list', () => {
        const g = scene(); equip(g, 'sword'); const m = mob(g, 'discordant', 11, 10, 'acid_mound');
        const ask = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false); g.onConfirmRequest = ask;
        const old = state(g); move(g); expect(state(g)).toEqual(old); expect(m.hp).toBe(500);
        expect(ask.mock.calls[0]?.[0]).toMatch(/^Degrade your/); expect(ask.mock.calls[1]?.[0]).toMatch(/^Are you sure/);
        expect(g.exportRecording().events[0]?.decisions).toEqual([true, false]);
    });
    it('CE visibility/confusion/hallucination exemptions still apply; telepathy restores hallucination confirmation', () => {
        const g = scene(), m = mob(g, 'discordant'), ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const abort = () => (g as any).abortPlayerAttack([m]);
        expect(abort()).toBe(true); g.grid.getCell(11, 10)!.isVisible = false; expect(abort()).toBe(false);
        g.grid.getCell(11, 10)!.isClairvoyantVisible = true; expect(abort()).toBe(true);
        // CE allies remain visible through their own invisibility.
        m.setStatusDuration('invisible', 5); expect(abort()).toBe(true); m.setStatusDuration('invisible', 0);
        g.player.setStatusDuration('confused', 5); expect(abort()).toBe(false); g.player.setStatusDuration('confused', 0);
        g.player.setStatusDuration('hallucinating', 5); expect(abort()).toBe(false);
        g.player.setStatusDuration('telepathy', 5); expect(abort()).toBe(true);
    });
});

describe('X3-U2 D06 captive release', () => {
    it.each([undefined, 'mace', 'rapier'])('%s No preserves state; Yes uses attackSpeed without attack recovery, nausea or movement', weapon => {
        const g = scene(), m = mob(g, 'captive'); if (weapon) equip(g, weapon);
        g.player.attackSpeed = 200; g.player.setStatusDuration('nauseous', 10);
        const ask = vi.fn(() => false); g.onConfirmRequest = ask;
        const old = state(g); move(g); expect(ask).toHaveBeenCalledExactlyOnceWith('Free the captive Monkey?');
        expect(state(g)).toEqual(old); expect(g.exportRecording().events[0]?.decisions).toEqual([false]);
        ask.mockReturnValue(true); move(g);
        expect(m).toMatchObject({ isCaged: false, isAlly: true, hp: 500, loc: { x: 11, y: 10 } });
        expect(g.player.loc).toEqual({ x: 10, y: 10 }); expect(timeSystem.currentTick - old.tick).toBe(200);
        expect(m.ticksUntilTurn).toBe(old.monsters[0]!.ticks - 200);
        expect(g.stats.turns).toBe(old.stats.turns + 1); expect(g.exportRecording().events[1]?.decisions).toEqual([true]);
        expect(logger.messages.some(m => m.foldable || /vomit/.test(m.text))).toBe(false);
    });
    it.each([false, true])('matching cage key disposable=%s is unchanged on No and promoted/consumed only on Yes', disposable => {
        const g = scene(), m = mob(g, 'captive'); g.grid.setTerrain(11, 10, T.MONSTER_CAGE_CLOSED);
        const key = ItemLoader.spawnKey('cage_key', -1, -1)!; key.originDepth = g.depth;
        key.keyLoc = [{ loc: { x: 11, y: 10 }, machine: 77, disposableHere: disposable }]; g.player.inventory.addItem(key);
        g.onConfirmRequest = () => false; const old = state(g); move(g); expect(state(g)).toEqual(old);
        g.onConfirmRequest = () => true; move(g);
        expect(m.isCaged).toBe(false); expect(m.hp).toBe(500); expect(g.grid.getCell(11, 10)!.layers).toContain(T.MONSTER_CAGE_OPEN);
        expect(g.player.inventory.items.includes(key)).toBe(!disposable);
    });
    it('a captive behind a closed cage without a matching key cannot be freed through the wall', () => {
        const g = scene(), m = mob(g, 'captive'); g.grid.setTerrain(11, 10, T.MONSTER_CAGE_CLOSED);
        const ask = vi.fn(() => true); g.onConfirmRequest = ask; const old = state(g); move(g);
        expect(state(g)).toEqual(old); expect(ask).not.toHaveBeenCalled(); expect(m.isCaged).toBe(true);
    });
    it('uses existing freeCaptive relation and carried-item transition', () => {
        const g = scene(), m = mob(g, 'captive'), follower = mob(g, 'captive', 14, 10);
        follower.leader = m; m.carriedItem = ItemLoader.spawnKey('iron_key', -1, -1)!; const item = m.carriedItem;
        g.onConfirmRequest = () => true; move(g);
        expect(m.isAlly).toBe(true); expect(m.leader).toBeNull(); expect(m.carriedItem).toBeNull();
        expect(follower.leader).toBeNull(); expect(g.items).toContain(item); expect(m.hp).toBe(500);
    });
    it('confused movement has already committed and releases the only reachable captive without another question', () => {
        const g = scene(), m = mob(g, 'captive');
        for (let x = 9; x <= 11; x++) for (let y = 9; y <= 11; y++) {
            if ((x !== 10 || y !== 10) && (x !== 11 || y !== 10)) g.grid.setTerrain(x, y, T.GRANITE);
        }
        g.player.setStatusDuration('confused', 10); const ask = vi.fn(() => false); g.onConfirmRequest = ask;
        move(g); expect(m.isCaged).toBe(false); expect(m.hp).toBe(500); expect(ask).not.toHaveBeenCalled();
        expect(g.stats.turns).toBe(1); expect(g.exportRecording().events[0]?.decisions).toEqual([]);
    });
});

describe('X3-U2 recording and auto-travel', () => {
    it.each(['swap', 'fallback', 'discordant', 'captive'] as const)('%s public commands replay and seek with zero OOS and no UI', kind => {
        const setup = (g: Game) => { mob(g, kind === 'discordant' || kind === 'captive' ? kind : 'ally'); if (kind === 'fallback') lavaOrigin(g); };
        const g = scene(); setup(g); const old = state(g);
        if (kind === 'discordant' || kind === 'captive') { g.onConfirmRequest = () => false; move(g); expect(state(g)).toEqual(old); }
        g.onConfirmRequest = () => true; move(g); const final = state(g), recording = g.exportRecording();
        const start = g.startNewGame.bind(g);
        vi.spyOn(g, 'startNewGame').mockImplementation(options => { start(options); room(g); setup(g); });
        expect(g.loadReplay(recording)).toBe(true); g.onConfirmRequest = () => { throw new Error('Replay opened UI'); };
        for (const _event of recording.events) g.replayStep();
        const check = () => {
            const { messages, ...actual } = state(g), { messages: recordedMessages, ...expected } = final;
            expect(g.replayError).toBeNull(); expect(actual).toEqual(expected);
            // Replay's terminal UI message is intentionally outside gameplay.
            expect(messages.messages.filter(m => m.text !== 'Replay finished.')).toEqual(recordedMessages.messages);
        };
        expect(g.replayCursor).toBe(recording.events.length); check();
        g.replaySeek(0); g.replaySeek(recording.events.length); check();
    });
    it.each(['discordant', 'captive'] as const)('%s request stops automation before asking, including on Yes', kind => {
        const g = scene(); mob(g, kind); g.autoPath = [{ x: 11, y: 10 }, { x: 12, y: 10 }];
        (g as any).isAutoExploring = true; (g as any).inAutoTravelStep = true;
        const ask = vi.fn(() => { expect(g.isAutoTraveling()).toBe(false); return true; }); g.onConfirmRequest = ask;
        g.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(ask).toHaveBeenCalledTimes(1); expect(g.isAutoTraveling()).toBe(false); expect(g.autoPath).toEqual([]);
    });
});
