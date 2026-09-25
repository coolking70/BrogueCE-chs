import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHeadlessGame } from './harness';
import { Item, ItemCategory } from '../engine/Items/Item';
import { endgameScore, itemValue } from '../engine/Core/Endgame';
import { readHighScores, saveHighScore } from '../engine/Core/HighScores';

const pack = [
    { category: ItemCategory.AMULET, quantity: 1 },
    { category: ItemCategory.GEM, quantity: 2 },
    { category: ItemCategory.WEAPON, quantity: 1 },
    { category: ItemCategory.SCROLL, quantity: 3 }
];

afterEach(() => vi.unstubAllGlobals());

describe('U26b CE endgame settlement', () => {
    it('uses CE gold, death gem redemption, amulet and lumenstone values for three endings', () => {
        expect(itemValue(pack[0]!)).toBe(35000);
        expect(itemValue(pack[1]!)).toBe(10000);
        expect(itemValue(pack[2]!)).toBe(0);
        // 验收修订：CE 死亡按宝石"件数"计 500（numberOfMatchingPackItems 计条目，RogueMain.c:1170），
        // 同层宝石叠放为一件（Items.c:988-992）；胜利 itemValue 才乘 quantity（Items.c:8867）
        expect(endgameScore(1234, pack, false, false, false)).toBe(1734);
        expect(endgameScore(1234, [{ category: ItemCategory.GEM, quantity: 1 }, { category: ItemCategory.GEM, quantity: 1 }], false, false, false)).toBe(2234);
        expect(endgameScore(1234, pack, true, false, false)).toBe(46234);
        expect(endgameScore(1234, pack, true, true, false)).toBe(81234);
        expect(endgameScore(1234, pack, true, true, true)).toBe(8123);
    });

    it('Game settles death, escape and carried gem super victory fixtures', () => {
        for (const [index, won, superVictory, expected] of [
            [0, false, false, 1734], [1, true, false, 46234], [2, true, true, 81234]
        ] as const) {
            const game = createHeadlessGame(26002 + index);
            game.stats.gold = 1234;
            game.stats.kills = 99;
            game.stats.maxDepth = 40;
            for (const entry of pack) {
                const item = new Item('fixture', '!', 0xffffff, entry.category);
                item.quantity = entry.quantity;
                game.player.inventory.items.push(item);
            }
            game.triggerGameOver(won, undefined, superVictory);
            expect(game.gameOverSuperVictory).toBe(superVictory);
            expect(game.gameOverScore).toBe(expected);
        }
    });

    it('a replay checks terminal outcome in its command checkpoint', () => {
        const game = createHeadlessGame(26003);
        game.handlePlayerAction('wait');
        const recording = game.exportRecording();
        recording.events[0]!.end = { won: true, superVictory: false, score: 35000 };
        expect(game.loadReplay(recording)).toBe(true);
        game.replayStep();
        expect(game.replayError).toContain('endgame mismatch');
    });
});

describe('U26b independent high scores', () => {
    it('keeps 30 scores, ranks descending, and uses CE local date and description', () => {
        const map = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => map.get(key) ?? null,
            setItem: (key: string, value: string) => { map.set(key, value); }
        });
        for (let score = 1; score <= 30; score++) {
            expect(saveHighScore(score, `Run ${score}`, new Date(2026, 8, 26))).toBe(true);
        }
        expect(saveHighScore(0, 'Below cutoff')).toBe(false);
        expect(saveHighScore(31, 'Top run')).toBe(true);
        const rows = readHighScores();
        expect(rows).toHaveLength(30);
        expect(rows[0]).toMatchObject({ score: 31, description: 'Top run' });
        expect(rows[rows.length - 1]?.score).toBe(2);
        expect(rows.find(row => row.score === 30)?.date).toBe('2026-09-26');
    });

    it('survives denied storage reads and writes', () => {
        vi.stubGlobal('localStorage', {
            getItem: () => { throw new Error('denied'); },
            setItem: () => { throw new Error('denied'); }
        });
        expect(readHighScores()).toEqual([]);
        expect(saveHighScore(100, 'Run')).toBe(false);
    });
});
