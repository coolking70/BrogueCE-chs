import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { endgameScore } from '../engine/Core/Endgame';
import { readHighScores } from '../engine/Core/HighScores';
import { TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';

afterEach(() => vi.unstubAllGlobals());

// CE RogueMain.c:1312-1313 sums quantity; :1364-1370 selects 0/1/plural.
const cases = [
    { label: 'zero gems', quantities: [], suffix: '!', value: 0 },
    { label: 'one gem', quantities: [1], suffix: ' with a lumenstone!', value: 5000 },
    { label: 'one stack of three', quantities: [3], suffix: ' with 3 lumenstones!', value: 15000 },
    { label: '25 gems from 14 depths', quantities: [3, 3, 3, 2, 2, 2, 2, 2, 1, 1, 1, 1, 1, 1],
        suffix: ' with 25 lumenstones!', value: 125000 }
];

function storeScores() {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value)
    });
    return store;
}

function givePack(game: ReturnType<typeof createHeadlessGame>, quantities: number[]) {
    game.player.inventory.items = [ItemLoader.spawnAmulet('amulet_of_yendor', 0, 0)!];
    for (const [index, quantity] of quantities.entries()) {
        const gem = ItemLoader.spawnGem(27 + index, 0, 0);
        gem.quantity = quantity;
        game.player.inventory.addItem(gem);
    }
}

describe.each([false, true])('X2n victory quantities (superVictory=%s)', superVictory => {
    it.each(cases)('$label: persists the CE description and preserves both scoring rules', ({ quantities, suffix, value }) => {
        storeScores();
        const game = createHeadlessGame(26004, 'test');
        givePack(game, quantities);
        game.stats.gold = 1234;
        const before = rng.getState();
        // Death still redeems entries, regardless of the quantity in each entry.
        expect(endgameScore(1234, game.player.inventory.items, false, false, false)).toBe(1234 + quantities.length * 500);
        game.triggerGameOver(true, undefined, superVictory);
        const score = 1234 + (superVictory ? 70000 : 35000) + value;
        expect(game.gameOverScore).toBe(score);
        expect(readHighScores()).toHaveLength(1);
        expect(readHighScores()[0]).toMatchObject({
            score, description: `${superVictory ? 'Mastered' : 'Escaped'} the Dungeons of Doom${suffix}`
        });
        expect(rng.getState()).toEqual(before);
    });

    it('records and replays a real terminal command with the 25-gem pack', () => {
        const store = storeScores();
        const game = createHeadlessGame(26005);
        // Explicit mirrored fixtures: this is a terminal checkpoint test, not a D1-to-D40 run.
        const arrange = () => {
            givePack(game, cases[3]!.quantities);
            game.stats.gold = 0;
            game.depth = superVictory ? 40 : 1;
            game.grid.setTerrain(game.player.loc.x, game.player.loc.y,
                superVictory ? TerrainType.DUNGEON_PORTAL : TerrainType.STAIRS_UP);
        };
        arrange();
        game.handlePlayerAction(superVictory ? 'stairs_down' : 'stairs_up');
        const recording = game.exportRecording();
        const score = superVictory ? 195000 : 160000;
        expect(recording.events).toHaveLength(1);
        expect(recording.events[0]!.end).toEqual({ won: true, superVictory, score });
        expect(readHighScores()[0]).toMatchObject({
            score, description: `${superVictory ? 'Mastered' : 'Escaped'} the Dungeons of Doom with 25 lumenstones!`
        });
        const savedScores = [...store.entries()];
        expect(game.loadReplay(recording)).toBe(true);
        arrange();
        game.replayStep();
        expect(game.replayError).toBeNull();
        expect(game.replayCursor).toBe(1);
        expect(game.gameOverScore).toBe(score);
        expect(game.gameOverSuperVictory).toBe(superVictory);
        expect([...store.entries()]).toEqual(savedScores);
    });
});
