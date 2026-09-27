import { describe, expect, it } from 'vitest';
import i18next from 'i18next';
import zhCN from '../locales/zh_CN.json';
import rows from '../data/monsters.json';
import { createHeadlessGame } from './harness';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { getDiscoveries } from '../engine/UI/Discoveries';
import { generateMonsterDetail } from '../engine/UI/DetailGenerator';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { logger } from '../engine/Systems/Logger';

function detailLines(monster: Monster): string[] {
    return generateMonsterDetail(monster, 100, 12, 0, null, 0, 0)
        .sections.flatMap(section => section.lines.map(line => line.text));
}

describe('X2i generated kinds and capability claims', () => {
    it('uses the same eligible potion set in the discovery numerator and denominator', () => {
        const previous = ItemLoader.identifiedItems;
        ItemLoader.identifiedItems = new Set();
        try {
            const entries = ItemLoader.genPotions;
            const group = getDiscoveries().find(g => g.label === 'potions')!;
            // 验收合并：X2g 已闭合地衣链并按 CE frequency=7 回池；发现集合 = 生成池集合的核心断言不变
            expect(entries.some(p => p.id === 'potion_of_creeping_death')).toBe(true);
            expect(new Set(group.rows.map(r => r.id))).toEqual(new Set(entries.map(e => e.id)));
            const denominator = entries.reduce((sum, e) => sum + (e.frequency ?? 0), 0);
            for (const row of group.rows) {
                const frequency = entries.find(e => e.id === row.id)!.frequency ?? 0;
                expect(row.percentage).toBe(frequency > 0 ? Math.floor(100 * frequency / denominator) : undefined);
            }
        } finally {
            ItemLoader.identifiedItems = previous;
        }
    });

    it('burns a contacted target through the real combat and fire outlets', () => {
        const game = createHeadlessGame(20260927, 'test');
        game.monsters = [];
        game.player.loc = { x: 6, y: 8 };
        for (let x = 5; x <= 9; x++) for (let y = 7; y <= 9; y++) game.grid.setTerrain(x, y, TerrainType.FLOOR);
        const row = (rows as MonsterData[]).find(r => r.id === 'rat')!;
        const attacker = new Monster(7, 8, row);
        attacker.state = MonsterState.HUNTING;
        attacker.abilityFlags.add('MA_HIT_BURN');
        attacker.damageString = '1d1';
        attacker.accuracy = 10000;
        game.monsters.push(attacker);
        attacker.takeTurn(game, 10);
        expect((game.player.statusDurations as Record<string, number>).burning).toBeGreaterThan(0);
        expect(detailLines(attacker)).toContain('命中会点燃目标');
        game.player.setStatusDuration('immune_fire', 10);
        delete (game.player.statusDurations as Record<string, number>).burning;
        game.exposeCreatureToFire(game.player);
        expect((game.player.statusDurations as Record<string, number>).burning ?? 0).toBe(0);
    });

    it('does not claim missing theft; submersion claimed once implemented (X2g MB_SUBMERGED)', () => {
        const monkey = new Monster(1, 1, (rows as MonsterData[]).find(r => r.id === 'monkey')!);
        const claims = detailLines(monkey).join(' ');
        expect(claims).toContain('攻击造成伤害后会逃跑');
        expect(claims).not.toContain('偷取物品');
        const eel = new Monster(1, 1, (rows as MonsterData[]).find(r => r.id === 'eel')!);
        // 验收合并：X2g 已实现 CE MB_SUBMERGED 运行态，描述声称有执行出口
        expect(detailLines(eel).join(' ')).toContain('可以潜入水中');
    });

    it('shows a localized replay failure while preserving the diagnostic code', () => {
        const game = createHeadlessGame(27028);
        i18next.changeLanguage('zh_CN');
        i18next.addResourceBundle('zh_CN', 'translation', zhCN, true, true);
        game.handlePlayerAction('wait');
        const recording = game.exportRecording();
        recording.events[0]!.tick += 1;
        expect(game.loadReplay(recording)).toBe(true);
        game.replayStep();
        expect(game.replayError).toContain('OOS at command 1');
        expect(game.replayErrorDisplay).toContain('回放在第 1 条命令处不同步');
        expect(game.replayErrorDisplay).not.toMatch(/[A-Za-z]/);
        expect(logger.messages[logger.messages.length - 1]?.text).toBe(game.replayErrorDisplay);
    });
});
