/**
 * src/test/v_1b_alternative.test.ts — MF_ALTERNATIVE / MF_ALTERNATIVE_2 几选一机制（V-1b）
 *
 * CE 语义（Architect.c:1291-1318 直译对象）：
 *   在 feature 构建循环之前，对 alternativeFlags[2] = {MF_ALTERNATIVE,
 *   MF_ALTERNATIVE_2}（Architect.c:997）各做一轮：把带旗标的 feature 全部
 *   标记 skip 并计数 totalFreq；totalFreq > 0 时掷一次 rand_range(1,
 *   totalFreq)，按顺序数到第 randIndex 个时 un-skip（只建这一个）。被选中
 *   者照常按自身 instanceCount 全建（Architect.c:1327-1331 的 skip 检查）。
 *
 * 为什么现在钉它（V-0 §5）：CE 基座大奖 = 附魔卷轴 或 生命药水 二选一
 * （GlobalsBrogue.c:218-219 两条 feature 同带 MF_ALTERNATIVE）。若 V-2 数据
 * 落地时本机制缺位，两条会同时生成 → 双份发放。当前 blueprints.json 无任何
 * 带这两旗标的 feature（本测试文件内 self-check 钉死这一前提），因此生产
 * 生成流零掷骰、generation_baseline 逐位不变——T5 用 RNG 增量把这一点钉成
 * 机制保证，而不是口头承诺。
 *
 * 对抗面（每个用例钉一种合理的错误实现）：
 *   T1  「选一条」：改成全建 / 全跳 / 永远选第一个 → 恰一条断言或分布断言红
 *   T2  「两集合独立」：两集合共享一池（合并抽一次）→ 每组恰一条断言红
 *   T3  「instanceCount 全建」：被选中者只建 1 个实例 → 数量断言红
 *   T4  「RNG 记账」：每个 feature 掷一次 / 无条件掷 → 增量断言红
 *   T6  「串行覆盖」：把两轮改成互不覆盖的独立抽签 → 单例结局断言红
 *
 * 夹具全部写在测试文件里（任务书 §3：不动生产 blueprints.json）。
 * 驱动方式与 p1_33 同源：经 unknown 视图直接调 applyBlueprint（私有），
 * 手工房间 + 手工蓝图，不经过选址。
 */
import { describe, it, expect } from 'vitest';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, FeatureDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import type { Pos } from '../types';
import { rng } from '../engine/Random';
import blueprintData from '../data/blueprints.json';

// ---------- 夹具 ----------

/** 手工房间：20 格（x2-11 × y2-3），center 固定、无门。 */
function makeRoom(): { cells: Pos[]; center: Pos; door: Pos | null } {
    const cells: Pos[] = [];
    for (let x = 2; x <= 11; x++) {
        for (let y = 2; y <= 3; y++) cells.push({ x, y });
    }
    return { cells, center: { x: 5, y: 2 }, door: null };
}

function makeGrid(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
    }
    for (let x = 2; x <= 11; x++) {
        for (let y = 2; y <= 3; y++) grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
    }
    return grid;
}

/** 物品 feature：instanceCount 恒定（[c,c] 时 count 骰在 randRange 内早退、不消耗流），落点由 itemSpawns 观察。 */
function itemFeature(id: string, flags: string[], count: [number, number] = [1, 1]): FeatureDef {
    return {
        itemCategory: 'SCROLL',
        itemId: id,
        instanceCount: count,
        flags: ['MF_GENERATE_ITEM', ...flags],
    };
}

function makeBp(features: FeatureDef[]): BlueprintDef {
    return {
        id: 'v1b_fixture',
        name: 'v1b_fixture',
        depthRange: [1, 26],
        roomSize: [6, 20],
        frequency: 1,
        category: 'test',
        flags: [],
        features,
    } as unknown as BlueprintDef;
}

/** 经 unknown 视图取私有 applyBlueprint（p1_33 同源做法）。 */
function getApplyBp(engine: BlueprintEngine) {
    return (engine as unknown as {
        applyBlueprint(bp: BlueprintDef, r: { cells: Pos[]; center: Pos; door: Pos | null }): MachineResult | null;
    }).applyBlueprint;
}

/** 固定种子跑 n 次 applyBlueprint，返回全部结果（每次消耗不同流位置 → 抽签有变化）。 */
function runMany(bp: BlueprintDef, runs: number, seed = 987654321): MachineResult[] {
    rng.seedRandomGenerator(seed);
    const engine = new BlueprintEngine(makeGrid(), 5);
    const applyBp = getApplyBp(engine);
    const room = makeRoom();
    const results: MachineResult[] = [];
    for (let i = 0; i < runs; i++) {
        results.push(applyBp.call(engine, bp, room)!);
    }
    return results;
}

/**
 * 单次 applyBlueprint 的 substantive 掷骰增量。每次测量前重新播种，
 * 使各测量互不依赖执行顺序（vitest 单 worker 复用下 rng 是跨文件单例）。
 * 房间恒 20 格 → shuffleList 消耗 19 次为公共底数；断言一律相对化
 * （带旗标夹具 − 同形无旗标夹具），不把 shuffleList 的实现细节钉死在这里。
 */
function measureDelta(bp: BlueprintDef): number {
    rng.seedRandomGenerator(20260918);
    const engine = new BlueprintEngine(makeGrid(), 5);
    const before = rng.randomNumbersGenerated;
    getApplyBp(engine).call(engine, bp, makeRoom());
    return rng.randomNumbersGenerated - before;
}

// ---------- 前提自检 ----------

describe('V-1b 前提自检', () => {
    // 原 P1 断言（V-1b 时）：「生产 blueprints.json 无任何 feature 带
    // MF_ALTERNATIVE / MF_ALTERNATIVE_2（零掷骰前提）」，期望 flagged === []。
    // V-2a 已反转：reward_pedestals 落地 CE GlobalsBrogue.c:218-219 的两条
    // 基座大奖 feature。**V-2b-2b 再反转**（本文件在 V-2b-2b 任务书 §6
    // 授权清单内按留痕反转惯例更新）：reward_pedestals 按 CE
    // GlobalsBrogue.c:206-220 拆回两条（reward_pedestal_permanent /
    // reward_pedestal_consumable），CE 3 号 Treasure room（:198-205）的
    // 药水/卷轴替代组也随蓝图落地。反转后钉死的新事实：
    //   a) 全库带 MF_ALTERNATIVE 的 feature 恰为 CE 3/4/5/23 号的替代组九条（23 号 = DOOR/SECRET_DOOR 门型替代组）
    //      （替代 feature 均 itemKind=-1 → itemId 为空记 null；consumable 的
    //      附魔卷轴/生命药水带具体 id）——多一条/少一条都红；
    //   b) MF_ALTERNATIVE_2 在 CE Brogue 目录全表零使用，生产数据零载体——
    //      有人顺手加载体时红；
    //   c) CE 19 号的两件 ALTERNATIVE 点火物（incendiary_dart /
    //      potion_of_incineration）本轮按任务书 §4 方案 2 只落药水一条、
    //      ALTERNATIVE 配对暂缺——飞镖点燃接线轮须把第 16、17 条载体补回本断言
    //      （V-2b-3 后基数 9→15，补回后为 17）。
    // **V-2b-3 二次反转**（本文件在 V-2b-3 的授权范围内——B 类留痕反转）：
    // 六条 wired 蓝图落地带来 6 条新 ALTERNATIVE 载体，9 → 15：
    //   vestibule_secret_lever（18 号）     CE GlobalsBrogue.c:306-307 两条
    //                                     （WORM_TUNNEL_OUTER_WALL / PORTCULLIS_CLOSED，
    //                                      二选一堵门体）
    //   vestibule_throwing_tutorial（22 号）:325-326 两条（PORTCULLIS_CLOSED /
    //                                     WORM_TUNNEL_OUTER_WALL）
    //   vestibule_guardian_obstacle（25 号）:340-341 两条 DOOR（守卫二选一站符文）
    // 全部 itemId 为空（地形/怪物载体，非物品）→ item 记 null；CE 原表逐条核过
    // （:304-308 / :322-326 / :338-343）。MF_ALTERNATIVE_2 仍零载体（CE Brogue
    // 目录全表零使用）。
    // **V-2b-4 三次顺延**（本文件在 V-2b-4 任务书 §4 授权清单内）：CE 2 号
    // Single category library（GlobalsBrogue.c:195-196）落地，其 RING / STAFF
    // 两条 ALTAR_CAGE_OPEN 笼中物构成一条替代组，15 → 17。新蓝图的其余
    // feature 均不带 ALTERNATIVE（1 号的三条笼中物**不是**替代组——CE :187-189
    // 无 MF_ALTERNATIVE，这是 1 号与 2 号的关键差别）。
    it('P1（V-2b-4 三次顺延）生产数据带 MF_ALTERNATIVE 的 feature 恰为 CE 2/3/4/5/23/18/22/25 号替代组十七条；MF_ALTERNATIVE_2 仍零载体', () => {
        const flagged = (blueprintData as BlueprintDef[]).flatMap(bp =>
            bp.features.map(f => ({ bpId: bp.id, f }))
                .filter(({ f }) => f.flags.includes('MF_ALTERNATIVE') || f.flags.includes('MF_ALTERNATIVE_2'))
        );
        expect(flagged.map(({ bpId, f }) => ({
            bpId,
            alt1: f.flags.includes('MF_ALTERNATIVE'),
            alt2: f.flags.includes('MF_ALTERNATIVE_2'),
            item: f.itemId ?? null,
        })).sort((a, b) => (a.item ?? '').localeCompare(b.item ?? '')),
        '替代集合载体集变动：核对 CE GlobalsBrogue.c 原表，并重捕获 generation_baseline').toEqual([
            { bpId: 'reward_treasure_room', alt1: true, alt2: false, item: null },
            { bpId: 'reward_treasure_room', alt1: true, alt2: false, item: null },
            { bpId: 'reward_pedestal_permanent', alt1: true, alt2: false, item: null },
            { bpId: 'reward_pedestal_permanent', alt1: true, alt2: false, item: null },
            { bpId: 'reward_pedestal_permanent', alt1: true, alt2: false, item: null },
            // V-2b-4 三次顺延（15 → 17）：CE 2 号 Single category library
            //（GlobalsBrogue.c:195-196）的 RING / STAFF 两条笼中物构成
            // 一条 ALTERNATIVE 替代组（每座笼子二选一）。itemId 为空
            //（itemKind=-1）→ item 记 null，故与其它地形/物品类别替代 feature
            // 同组按稳定序排列。
            { bpId: 'reward_single_category_library', alt1: true, alt2: false, item: null },
            { bpId: 'reward_single_category_library', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_pit_trap_field', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_pit_trap_field', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_secret_lever', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_secret_lever', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_throwing_tutorial', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_throwing_tutorial', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_guardian_obstacle', alt1: true, alt2: false, item: null },
            { bpId: 'vestibule_guardian_obstacle', alt1: true, alt2: false, item: null },
            { bpId: 'reward_pedestal_consumable', alt1: true, alt2: false, item: 'potion_of_life' },
            { bpId: 'reward_pedestal_consumable', alt1: true, alt2: false, item: 'scroll_of_enchantment' },
        ]);
    });
});

// ---------- 机制语义 ----------

describe('V-1b MF_ALTERNATIVE 几选一', () => {
    it('T1 三条替代 feature：每次恰建一条；3000 次分布均匀（各≈1/3）', () => {
        const bp = makeBp([
            itemFeature('v1b_alt_a', ['MF_ALTERNATIVE']),
            itemFeature('v1b_alt_b', ['MF_ALTERNATIVE']),
            itemFeature('v1b_alt_c', ['MF_ALTERNATIVE']),
        ]);
        const runs = runMany(bp, 3000);

        const counts: Record<string, number> = { v1b_alt_a: 0, v1b_alt_b: 0, v1b_alt_c: 0 };
        for (const r of runs) {
            expect(r.itemSpawns, '每次恰建一条（全建→3、全跳→0 都在此翻红）').toHaveLength(1);
            const id = r.itemSpawns[0]!.id;
            expect(counts, `出现了替代集合之外的产出 ${id}`).toHaveProperty(id!);
            counts[id!]!++;
        }
        // 期望各 1000，σ≈25.8；边界 ±5.8σ——均匀分布的系统性偏置（永远选第一个
        // → [3000,0,0]）必然翻红，同时给抽样留足余量。
        for (const id of Object.keys(counts)) {
            expect(counts[id]!, `${id} 命中 ${counts[id]} 次，分布偏离均匀 1/3`).toBeGreaterThan(850);
            expect(counts[id]!, `${id} 命中 ${counts[id]} 次，分布偏离均匀 1/3`).toBeLessThan(1150);
        }
    });

    it('T2 两个集合独立：ALT 与 ALT_2 各自恰建一条、互不侵染', () => {
        const bp = makeBp([
            itemFeature('v1b_s1_a', ['MF_ALTERNATIVE']),
            itemFeature('v1b_s1_b', ['MF_ALTERNATIVE']),
            itemFeature('v1b_s2_a', ['MF_ALTERNATIVE_2']),
            itemFeature('v1b_s2_b', ['MF_ALTERNATIVE_2']),
        ]);
        const runs = runMany(bp, 2000);

        const counts: Record<string, number> = { v1b_s1_a: 0, v1b_s1_b: 0, v1b_s2_a: 0, v1b_s2_b: 0 };
        for (const r of runs) {
            expect(r.itemSpawns, '两集合各恰建一条（共 2 件）').toHaveLength(2);
            const ids = r.itemSpawns.map(s => s.id).sort();
            const fromSet1 = ids.filter(i => i!.startsWith('v1b_s1_'));
            const fromSet2 = ids.filter(i => i!.startsWith('v1b_s2_'));
            expect(fromSet1, '第一集合恰建一条（共享一池的错误实现会在此翻红）').toHaveLength(1);
            expect(fromSet2, '第二集合恰建一条').toHaveLength(1);
            for (const id of ids) counts[id!]!++;
        }
        // 每集合内 50/50：期望各 1000，σ≈22.4；边界约 ±5σ。
        for (const id of Object.keys(counts)) {
            expect(counts[id]!, `${id} 命中 ${counts[id]} 次，集合内分布偏离均匀`).toBeGreaterThan(850);
            expect(counts[id]!, `${id} 命中 ${counts[id]} 次，集合内分布偏离均匀`).toBeLessThan(1150);
        }
    });

    it('T3 被选中者按 instanceCount 全建（不是只建 1 个实例）', () => {
        const bp = makeBp([
            itemFeature('v1b_cnt2', ['MF_ALTERNATIVE'], [2, 2]),
            itemFeature('v1b_cnt3', ['MF_ALTERNATIVE'], [3, 3]),
            itemFeature('v1b_cnt4', ['MF_ALTERNATIVE'], [4, 4]),
        ]);
        const runs = runMany(bp, 3000);

        for (const r of runs) {
            const ids = [...new Set(r.itemSpawns.map(s => s.id))];
            expect(ids, '被选中的替代 feature 是唯一产出者').toHaveLength(1);
            const id = ids[0]!;
            const expected = id === 'v1b_cnt2' ? 2 : id === 'v1b_cnt3' ? 3 : 4;
            expect(
                r.itemSpawns,
                `${id} 应按 instanceCount 全建 ${expected} 个实例（只建 1 个的错误实现在此翻红）`
            ).toHaveLength(expected);
        }
    });
});

// ---------- RNG 记账 ----------

describe('V-1b RNG 消耗记账', () => {
    // randRange(1, totalFreq) 的边界：CE rand_range 与 web randRange 在
    // upperBound <= lowerBound 时都早退、不消耗（CE Math.c:144-146 /
    // web Random.ts:98-100）。所以「恰消耗 1 次」对 |集合| ≥ 2 成立；
    // |集合| = 1 时抽签退化为确定性（必选唯一成员）且消耗 0——这也是
    // CE 的字面行为，一并钉住。掷骰只对「带旗标集合」发生。

    it('T4a 无旗标蓝图：引擎不因替代机制多掷任何一次骰（含零 feature 形态）', () => {
        const plain3 = makeBp([
            itemFeature('v1b_p1', []),
            itemFeature('v1b_p2', []),
            itemFeature('v1b_p3', []),
        ]);
        const empty = makeBp([]);
        const dPlain3 = measureDelta(plain3);
        const dEmpty = measureDelta(empty);
        // 两者都只剩 shuffleList 的底数；同房间 → 同底数。
        // 无条件掷骰的错误实现（例如按 feature 总数掷）会让 dPlain3 = dEmpty + 1。
        expect(dPlain3, '无旗标夹具只应消耗 shuffle 底数').toBeGreaterThan(0);
        expect(dPlain3, '无旗标夹具与零 feature 夹具消耗相同（shuffle 底数）').toBe(dEmpty);
    });

    it('T4b 三条替代 feature：全流程恰多消耗 1 次（不是每 feature 一次）', () => {
        const plain3 = makeBp([
            itemFeature('v1b_p1', []),
            itemFeature('v1b_p2', []),
            itemFeature('v1b_p3', []),
        ]);
        const alt3 = makeBp([
            itemFeature('v1b_p1', ['MF_ALTERNATIVE']),
            itemFeature('v1b_p2', ['MF_ALTERNATIVE']),
            itemFeature('v1b_p3', ['MF_ALTERNATIVE']),
        ]);
        expect(measureDelta(alt3) - measureDelta(plain3),
            '三条替代集合应恰多掷 1 次（每 feature 掷一次的错误实现会得 +3）').toBe(1);
    });

    it('T4c ALT_2 集合同样恰多消耗 1 次；两集合并存恰多消耗 2 次', () => {
        const plain4 = makeBp([
            itemFeature('v1b_p1', []),
            itemFeature('v1b_p2', []),
            itemFeature('v1b_p3', []),
            itemFeature('v1b_p4', []),
        ]);
        const bothSets = makeBp([
            itemFeature('v1b_p1', ['MF_ALTERNATIVE']),
            itemFeature('v1b_p2', ['MF_ALTERNATIVE']),
            itemFeature('v1b_p3', ['MF_ALTERNATIVE_2']),
            itemFeature('v1b_p4', ['MF_ALTERNATIVE_2']),
        ]);
        const alt2Only = makeBp([
            itemFeature('v1b_p1', ['MF_ALTERNATIVE_2']),
            itemFeature('v1b_p2', ['MF_ALTERNATIVE_2']),
            itemFeature('v1b_p3', ['MF_ALTERNATIVE_2']),
        ]);
        const plain3 = makeBp(plain4.features.slice(0, 3));
        expect(measureDelta(bothSets) - measureDelta(plain4),
            '两个非空集合各掷一次 → +2').toBe(2);
        expect(measureDelta(alt2Only) - measureDelta(plain3),
            'ALT_2 独立成集、同样恰掷一次').toBe(1);
    });

    it('T4d 单成员集合：rand_range(1,1) 早退、消耗 0，但语义仍是「恰建那一条」', () => {
        const plain1 = makeBp([itemFeature('v1b_solo', [])]);
        const solo = makeBp([itemFeature('v1b_solo', ['MF_ALTERNATIVE'])]);
        expect(measureDelta(solo) - measureDelta(plain1),
            '|集合|=1 时 randRange(1,1) 两边都早退，增量应为 0').toBe(0);

        const runs = runMany(solo, 50);
        for (const r of runs) {
            expect(r.itemSpawns, '单成员集合仍恰建那一条').toHaveLength(1);
            expect(r.itemSpawns[0]!.id).toBe('v1b_solo');
        }
    });
});

// ---------- CE 循环结构的字面行为（MF_ALTERNATIVE_2 在 Brogue 目录零使用，防「顺手优化」）----------

describe('V-1b 双旗标 feature 的串行覆盖（CE 循环序忠实复刻）', () => {
    it('T6 第二轮 skip 标记会覆盖第一轮的选中；单例结局真实存在', () => {
        // fd 同时带两个旗标：第一轮可能在 {fa,fb,fd} 中选中它，但第二轮
        // 的标记循环会无条件把 fd 重新标成 skip（CE Architect.c:1299-1304
        // 的字面行为），随后在第二轮 {fd,fe} 里可能再次被选中。
        // 六种结局：{fa,fe}/{fb,fe}/{fa,fd}/{fb,fd}（2 件）、{fe}/{fd}（1 件，
        // 仅当 fd 第一轮胜出且第二轮未再选中）。
        const bp = makeBp([
            itemFeature('v1b_fa', ['MF_ALTERNATIVE']),
            itemFeature('v1b_fb', ['MF_ALTERNATIVE']),
            itemFeature('v1b_fd', ['MF_ALTERNATIVE', 'MF_ALTERNATIVE_2']),
            itemFeature('v1b_fe', ['MF_ALTERNATIVE_2']),
        ]);
        const runs = runMany(bp, 3000);

        const shapes = new Map<string, number>();
        for (const r of runs) {
            const ids = r.itemSpawns.map(s => s.id).sort();
            expect(ids.length, '结局只可能是 1 件或 2 件').toBeLessThanOrEqual(2);
            expect(ids.length, '至少建成 1 件').toBeGreaterThanOrEqual(1);
            expect(new Set(ids).size, '同一 feature 不会重复产出').toBe(ids.length);
            // 同一集合的两个成员不可能同时出现（fd 双旗标也只属于每个集合一次）。
            if (ids.includes('v1b_fa')) expect(ids, 'fa 与 fb 同属第一集合，不可能同时出现').not.toContain('v1b_fb');
            if (ids.includes('v1b_fd')) expect(ids, 'fd 与 fe 同属第二轮集合，不可能同时出现').not.toContain('v1b_fe');
            shapes.set(ids.join(','), (shapes.get(ids.join(',')) ?? 0) + 1);
        }
        // 单例结局（{fe} 或 {fd} 单独出现）是「第二轮覆盖第一轮」存在的唯一直接
        // 证据：若把两轮改成互不覆盖的独立抽签，第一轮胜者必建，单例结局消失。
        const singletonFe = shapes.get('v1b_fe') ?? 0;
        const singletonFd = shapes.get('v1b_fd') ?? 0;
        expect(singletonFe + singletonFd,
            `单例结局应真实存在（实测分布：${[...shapes.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}）`).toBeGreaterThan(0);
        expect(singletonFe, 'fd 胜第一轮、fe 胜第二轮的结局应出现').toBeGreaterThan(0);
        expect(singletonFd, 'fd 连胜两轮的结局应出现').toBeGreaterThan(0);
    });
});
