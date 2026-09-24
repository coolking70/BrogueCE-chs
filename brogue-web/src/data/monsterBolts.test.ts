/**
 * src/data/monsterBolts.test.ts — P4-1a：monsters.json 的 bolts 字段接线回归
 *
 * 权威基线：BrogueCE-master/src/brogue/Globals.c 的
 *   creatureType monsterCatalog[NUMBER_MONSTER_KINDS]（表体 L1026 起），
 * `enum boltType bolts[20]` 字段定义见 Rogue.h:2189（creatureType 结构体）。
 *
 * 本轮（P4-1a）只把 CE 的 bolts 数据搬进 monsters.json，不实现任何施法逻辑，
 * 详见 scripts/extract_monster_bolts.cjs 与 ai_docs/p4_1a_monster_bolts_data_report.md。
 *
 * 这份测试是对抗性的：
 *   - 数量断言能在"漏抽/多抽某只怪物"时失败；
 *   - 顺序断言能在"实现时手滑排序了数组"时失败（CE 的 bolts 是有序数组，
 *     施法优先级可能与顺序相关，排序会悄悄改变游戏行为）；
 *   - 映射断言能在"下一轮引入了 CE 不存在的 bolt 名字"或
 *     "把已知缺口伪装成已支持"时失败。
 */
import { describe, it, expect } from 'vitest';
import monstersJson from './monsters.json';
import { BoltEffect } from '../engine/Combat/Bolt';

type MonsterEntry = (typeof monstersJson)[number] & { bolts?: string[] };

function byId(id: string): MonsterEntry {
    const m = monstersJson.find((x) => x.id === id) as MonsterEntry | undefined;
    if (!m) throw new Error(`monsters.json 中找不到 ${id}`);
    return m;
}

// CE boltType 名字（去掉 "BOLT_" 前缀）里，web 的 BoltEffect 枚举（Bolt.ts:14 起）
// U08 已接通两种地形 bolt 的 NONE 执行出口；无需新增 effect 枚举。
const KNOWN_GAP_BOLT_NAMES = new Set<string>(); // U08: both use BE_NONE terrain effects.

// CE 里 boltType 的字符串名字与 boltEffect（BoltEffect 枚举对应的效果种类）不是一一对应：
// BOLT_SLOW 与 BOLT_SLOW_2 都使用 BE_SLOW 这个效果，仅强度不同
// （GlobalsBrogue.c:62 "slowing spell" BE_SLOW power=10，line 81 power=2）。
// 数据字段里如实保留 CE 的原始名字 "SLOW_2"（不是本轮该做的归并决定），
// 这里只是为了校验"能映射到现有 BoltEffect"时，显式声明这一个别名关系。
const BOLT_NAME_ALIASES: Record<string, keyof typeof BoltEffect> = {
    SLOW_2: 'SLOW',
    SPIDERWEB: 'NONE',
    ANCIENT_SPIRIT_VINES: 'NONE',
};

describe('monsters.json 的 bolts 字段（P4-1a 数据接线）', () => {
    it('每条怪物都具备 bolts 数组字段（无 undefined，缺省为空数组）', () => {
        expect(monstersJson).toHaveLength(67);
        for (const m of monstersJson as MonsterEntry[]) {
            expect(Array.isArray(m.bolts), `${m.id}.bolts 不是数组`).toBe(true);
        }
    });

    it('带 bolts 的怪物恰好 25 只（Globals.c monsterCatalog 逐条核对结果）', () => {
        const withBolts = (monstersJson as MonsterEntry[]).filter((m) => (m.bolts?.length ?? 0) > 0);
        expect(withBolts).toHaveLength(25);
    });

    // 逐条硬断言：单 bolt / 多 bolt、施法者 / 炮塔都覆盖到，注明 Globals.c 行号。
    it('goblin_mystic：单 bolt，法师型（Globals.c:1045）', () => {
        expect(byId('goblin_mystic').bolts).toEqual(['SHIELDING']);
    });

    it('goblin_totem：双 bolt，固定顺序 HASTE 在前（Globals.c:1047）', () => {
        expect(byId('goblin_totem').bolts).toEqual(['HASTE', 'SPARK']);
    });

    it('arrow_turret：单 bolt，炮塔型（Globals.c:1055）', () => {
        expect(byId('arrow_turret').bolts).toEqual(['DISTANCE_ATTACK']);
    });

    it('spider：单 bolt，U08 DF 施法 SPIDERWEB（Globals.c:1067）', () => {
        expect(byId('spider').bolts).toEqual(['SPIDERWEB']);
    });

    it('spark_turret：单 bolt，炮塔型（Globals.c:1069）', () => {
        expect(byId('spark_turret').bolts).toEqual(['SPARK']);
    });

    it('dart_turret：单 bolt，炮塔型（Globals.c:1100）', () => {
        expect(byId('dart_turret').bolts).toEqual(['POISON_DART']);
    });

    it('dar_priestess：四 bolt，顺序为源码原始顺序而非字母序（Globals.c:1088）', () => {
        // 源码里是 {BOLT_NEGATION, BOLT_HEALING, BOLT_HASTE, BOLT_SPARK}——
        // 若实现时误排序成字母序会是 [HASTE, HEALING, NEGATION, SPARK]，与此不同。
        const bolts = byId('dar_priestess').bolts;
        expect(bolts).toEqual(['NEGATION', 'HEALING', 'HASTE', 'SPARK']);
        expect(bolts).not.toEqual([...(bolts ?? [])].sort());
    });

    it('dar_battlemage：三 bolt，含已知缺口 SLOW_2（Globals.c:1090）', () => {
        expect(byId('dar_battlemage').bolts).toEqual(['FIRE', 'SLOW_2', 'DISCORD']);
    });

    it('pixie：四 bolt，顺序为源码原始顺序（Globals.c:1108）', () => {
        const bolts = byId('pixie').bolts;
        expect(bolts).toEqual(['NEGATION', 'SLOW_2', 'DISCORD', 'SPARK']);
        expect(bolts).not.toEqual([...(bolts ?? [])].sort());
    });

    it('dragon：单 bolt，DRAGONFIRE（Globals.c:1123）', () => {
        expect(byId('dragon').bolts).toEqual(['DRAGONFIRE']);
    });

    it('vampire：双 bolt，BLINKING 在前（Globals.c:1131）', () => {
        expect(byId('vampire').bolts).toEqual(['BLINKING', 'DISCORD']);
    });

    it('mangrove_dryad：单 bolt，U08 DF 施法 ANCIENT_SPIRIT_VINES（Globals.c:1163）', () => {
        expect(byId('mangrove_dryad').bolts).toEqual(['ANCIENT_SPIRIT_VINES']);
    });

    it('无 bolts 的怪物一律为空数组（抽样：rat 无远程攻击）', () => {
        expect(byId('rat').bolts).toEqual([]);
    });

    it('每条 bolts 里的名字，要么能映射到现有 BoltEffect 枚举，要么在已知缺口清单内——不允许第三类未知名字', () => {
        for (const m of monstersJson as MonsterEntry[]) {
            for (const boltName of m.bolts ?? []) {
                const isKnownGap = KNOWN_GAP_BOLT_NAMES.has(boltName);
                const effectiveName = BOLT_NAME_ALIASES[boltName] ?? boltName;
                const isMappedEffect = (BoltEffect as unknown as Record<string, number>)[effectiveName] !== undefined;
                expect(
                    isKnownGap || isMappedEffect,
                    `${m.id} 的 bolt "${boltName}" 既不在 BoltEffect 枚举中，也不在已知缺口清单 (${[...KNOWN_GAP_BOLT_NAMES].join(', ')}) 内`
                ).toBe(true);
            }
        }
    });

    it('SLOW_2 不在 BoltEffect 里单独存在（CE 用 BE_SLOW 复用同一效果，仅强度不同——GlobalsBrogue.c:62,81）', () => {
        expect('SLOW_2' in BoltEffect).toBe(false);
        expect('SLOW' in BoltEffect).toBe(true);
    });

    it('汇总：带 bolts 的怪物涉及的 bolt 种类恰好 15 种', () => {
        const names = new Set<string>();
        for (const m of monstersJson as MonsterEntry[]) {
            for (const b of m.bolts ?? []) names.add(b);
        }
        expect(names.size).toBe(15);
    });
});
