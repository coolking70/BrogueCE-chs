/**
 * src/data/monsters.test.ts — 运行时怪物表五项 CE 战斗数值接线回归
 *
 * 权威基线：BrogueCE-master/src/brogue/Globals.c 的
 *   creatureType monsterCatalog[NUMBER_MONSTER_KINDS]（表体 L1026 起），
 * 列序依 Rogue.h:2172 的 creatureType 定义：
 *   maxHP, defense, accuracy, damage{min,max,clump},
 *   turnsBetweenRegen(=web 的 regen), movementSpeed(=web 的 moveSpeed), attackSpeed
 *
 * 五字段由 scripts/merge_monster_stats.cjs 从 monsters_ce2.json 合并
 * （合并当日已逐条与 Globals.c 校验一致，ce2 与 CE 零差异）。
 * 本测试防止后续改动让字段缺失或数值漂移。
 */
import { describe, it, expect } from 'vitest';
import monstersJson from './monsters.json';

const STAT_FIELDS = ['accuracy', 'defense', 'regen', 'moveSpeed', 'attackSpeed'] as const;

function byId(id: string): (typeof monstersJson)[number] {
    const m = monstersJson.find((x) => x.id === id);
    if (!m) throw new Error(`monsters.json 中找不到 ${id}`);
    return m;
}

describe('monsters.json 五项 CE 战斗数值接线', () => {
    it('共 67 条，每条都具备 5 个有限数值字段（无 undefined）', () => {
        expect(monstersJson).toHaveLength(67);
        for (const m of monstersJson) {
            for (const f of STAT_FIELDS) {
                expect(m[f], `${m.id}.${f} 缺失`).toBeDefined();
                expect(typeof m[f], `${m.id}.${f} 不是数值`).toBe('number');
                expect(Number.isFinite(m[f]), `${m.id}.${f} 不是有限数值`).toBe(true);
            }
        }
    });

    it('取值区间合理', () => {
        for (const m of monstersJson) {
            // CE 例外：bog_monster accuracy=5000（Globals.c:1063，CE 设计为必定
            // 抓握玩家的哨兵值），超出预设 0-300 区间；以 CE 为准单点放行。
            if (m.id === 'bog_monster') {
                expect(m.accuracy).toBe(5000);
            } else {
                expect(m.accuracy, `${m.id}.accuracy 下界`).toBeGreaterThanOrEqual(0);
                expect(m.accuracy, `${m.id}.accuracy 上界`).toBeLessThanOrEqual(300);
            }
            expect(m.defense, `${m.id}.defense 下界`).toBeGreaterThanOrEqual(0);
            expect(m.defense, `${m.id}.defense 上界`).toBeLessThanOrEqual(200);
            expect(m.regen, `${m.id}.regen`).toBeGreaterThanOrEqual(0);
            expect(m.moveSpeed, `${m.id}.moveSpeed`).toBeGreaterThan(0);
            expect(m.attackSpeed, `${m.id}.attackSpeed`).toBeGreaterThan(0);
        }
    });

    it('CE 黄金值硬断言（注释中的 L 行号为 Globals.c monsterCatalog 表体）', () => {
        // L1030: {0, "rat", ..., 6, 0, 80, {1, 3, 1}, 20, 100, 100, ...}
        const rat = byId('rat');
        expect(rat.accuracy).toBe(80);
        expect(rat.defense).toBe(0);
        expect(rat.regen).toBe(20);

        // L1031: {0, "kobold", ..., 7, 0, 80, {1, 4, 1}, 20, 100, 100, ...}
        const kobold = byId('kobold');
        expect(kobold.accuracy).toBe(80);
        expect(kobold.defense).toBe(0);

        // L1032: {0, "jackal", ..., 8, 0, 70, {2, 4, 1}, 20, 50, 100, ...}
        const jackal = byId('jackal');
        expect(jackal.moveSpeed).toBe(50);

        // L1033: {0, "eel", ..., 18, 27, 100, {3, 7, 2}, 5, 50, 100, ...}
        const eel = byId('eel');
        expect(eel.defense).toBe(27);
        expect(eel.regen).toBe(5);
        expect(eel.moveSpeed).toBe(50);

        // L1061: {0, "ogre", ..., 55, 60, 125, {9, 13, 2}, 20, 100, 200, ...}
        const ogre = byId('ogre');
        expect(ogre.attackSpeed).toBe(200);
        expect(ogre.defense).toBe(60);

        // L1076: {0, "troll", ..., 65, 70, 125, {10, 15, 3}, 1, 100, 100, ...}
        const troll = byId('troll');
        expect(troll.regen).toBe(1);
        expect(troll.defense).toBe(70);
    });

    it('既有字段未被合并脚本破坏（抽样核对保留字段仍在）', () => {
        const kobold = byId('kobold');
        expect(kobold.onHitStatus).toBe('confused');
        expect(kobold.onHitChance).toBeCloseTo(0.08);
        const eel = byId('eel');
        expect(eel.behaviorFlags).toContain('MONST_RESTRICTED_TO_LIQUID');
        const rat = byId('rat');
        expect(rat.color).toBeTypeOf('number');
        expect(rat.description.length).toBeGreaterThan(0);
    });
});
