/**
 * src/test/horde_selection.test.ts — horde 抽取逻辑对齐 BrogueCE 的验收测试
 *
 * 对应 CE 权威实现（BrogueCE-master/src/brogue/）：
 *   - Monsters.c:511   pickHordeType    frequency 加权抽取
 *   - Monsters.c:1085  populateMonsters 两套过滤口径之"开局铺怪"（禁用
 *                      IS_SUMMONED | MACHINE_ONLY），可用 85 条
 *   - Monsters.c:1133  spawnPeriodicHorde 周期刷怪口径（额外禁用
 *                      LEADER_CAPTIVE | NO_PERIODIC_SPAWN），可用 58 条
 *   - Monsters.c:797   spawnHorde       10% out-of-depth（深度 1 不触发）
 *   - RogueMain.c:403 / Time.c:2322/2666  monsterSpawnFuse = rand_range(125,175)
 *   - 数据层：scripts/extract_hordes.cjs 把 MK_* 枚举名映射为 CE 目录显示名
 *     （hordes.json 与 monsters.json 按 id 零失配）
 *
 * 说明：加权测试的 "偏差 < 5%" 按"占比绝对偏差 < 5 个百分点"解释并叠加
 * 卡方聚合检验——D5 候选池最小份额条目（0.86%）在 N=10000 下的相对统计
 * 噪声约 ±11%，逐条相对 5% 在统计上不可行；卡方检验则能可靠区分加权与
 * 均匀抽样（均匀时 RAT 一项的 χ² 贡献即 >400，远超 17 自由度 0.1% 显著
 * 水平的临界值 40.8）。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import {
    Game,
    HORDE_POPULATE_FORBIDDEN_FLAGS,
    HORDE_PERIODIC_FORBIDDEN_FLAGS,
    type HordeEntry,
} from '../engine/Core/Game';
import { MonsterState } from '../entities/Monster';
import { rng } from '../engine/Random';
import monstersJson from '../data/monsters.json';
import hordesJson from '../data/hordes.json';

const WEIGHT_SEED = 20260914;
const OOD_SEED = 20260915;
const FUSE_SEED = 20260916;
/** 与修复前基线（ai_docs/headless_harness_report.md §6）同 seed，便于定性对照；
 *  注意 P1-3 开局装备与本轮改动均已使 rng 流偏移，不能逐格对比。 */
const TABLE_SEED = 424242;

describe('horde 抽取 — 两套过滤口径（CE Monsters.c:1090 / 1133）', () => {
    it('开局铺怪候选池 >= 80 条，且包含 HORDE_LEADER_CAPTIVE 的 horde', () => {
        const game = createHeadlessGame(1);
        const pool = game.hordeCandidates(null, HORDE_POPULATE_FORBIDDEN_FLAGS);
        expect(pool.length).toBeGreaterThanOrEqual(80);
        expect(pool.length).toBe(85); // CE 锚点
        const captives = pool.filter(h => h.flags.includes('HORDE_LEADER_CAPTIVE'));
        expect(captives.length, '开局池应包含笼中俘虏 horde（CE 口径下为 20 条）').toBeGreaterThan(0);
    });

    it('周期刷怪候选池 >= 55 条（CE 锚点 58）', () => {
        const game = createHeadlessGame(1);
        const pool = game.hordeCandidates(null, HORDE_PERIODIC_FORBIDDEN_FLAGS);
        expect(pool.length).toBeGreaterThanOrEqual(55);
        expect(pool.length).toBe(58);
    });

    it('两套口径的开关差异：LEADER_CAPTIVE 与 NO_PERIODIC_SPAWN 只在开局池出现', () => {
        const game = createHeadlessGame(1);
        const populate = game.hordeCandidates(null, HORDE_POPULATE_FORBIDDEN_FLAGS);
        const periodic = game.hordeCandidates(null, HORDE_PERIODIC_FORBIDDEN_FLAGS);
        expect(populate.some(h => h.flags.includes('HORDE_LEADER_CAPTIVE'))).toBe(true);
        expect(periodic.some(h => h.flags.includes('HORDE_LEADER_CAPTIVE'))).toBe(false);
        expect(periodic.some(h => h.flags.includes('HORDE_NO_PERIODIC_SPAWN'))).toBe(false);
        // 两池都不含召唤圈与任何机器专用 horde
        for (const pool of [populate, periodic]) {
            expect(pool.some(h => h.flags.includes('HORDE_IS_SUMMONED'))).toBe(false);
            expect(pool.some(h => h.flags.some(f => f.startsWith('HORDE_MACHINE_')))).toBe(false);
            expect(pool.some(h => h.flags.includes('HORDE_VAMPIRE_FODDER'))).toBe(false);
            expect(pool.some(h => h.flags.includes('HORDE_SACRIFICE_TARGET'))).toBe(false);
        }
    });
});

describe('horde 抽取 — frequency 加权（CE Monsters.c:511 pickHordeType）', () => {
    it('固定 seed D5 抽 10000 次：各条占比绝对偏差 < 5 个百分点且卡方检验通过', () => {
        const game = createHeadlessGame(1);
        const candidates = game.hordeCandidates(5, HORDE_POPULATE_FORBIDDEN_FLAGS);
        expect(candidates.length).toBeGreaterThan(0);

        const totalFreq = candidates.reduce((s, h) => s + h.frequency, 0);
        const N = 10000;
        const counts = new Array<number>(candidates.length).fill(0);

        rng.seedRandomGenerator(WEIGHT_SEED);
        for (let i = 0; i < N; i++) {
            const pick = game.pickHordeType(candidates);
            expect(pick).not.toBeNull();
            const idx = candidates.indexOf(pick!);
            counts[idx] = (counts[idx] ?? 0) + 1;
        }

        let chi2 = 0;
        const lines: string[] = [];
        for (let i = 0; i < candidates.length; i++) {
            const h = candidates[i]!;
            const expectedShare = h.frequency / totalFreq;
            const actualShare = counts[i]! / N;
            const expectedHits = expectedShare * N;
            const sigma = Math.sqrt(N * expectedShare * (1 - expectedShare));
            chi2 += ((counts[i]! - expectedHits) ** 2) / expectedHits;
            lines.push(
                `${h.leader.padEnd(18)} freq=${String(h.frequency).padStart(3)} ` +
                `期望占比=${(expectedShare * 100).toFixed(2)}% 实际=${counts[i]} (${(actualShare * 100).toFixed(2)}%) ` +
                `绝对偏差=${(Math.abs(actualShare - expectedShare) * 100).toFixed(2)}pp σ=${sigma.toFixed(1)}`
            );
            // 验收口径：比例偏差 < 5%（按占比绝对偏差 < 5 个百分点解释）
            expect(Math.abs(actualShare - expectedShare), `${h.leader} freq=${h.frequency}`).toBeLessThan(0.05);
            // 统计界限：偏差不超过 4σ（固定 seed 下确定性地成立）
            expect(Math.abs(counts[i]! - expectedHits)).toBeLessThan(4 * sigma + 1e-9);
        }
        console.log(`[horde_selection] D5 加权抽取频次表（seed=${WEIGHT_SEED}, N=${N}, χ²=${chi2.toFixed(1)}, 17 自由度 0.1% 临界值 40.8）：\n${lines.join('\n')}`);
        // 卡方聚合检验：能可靠区分"按 frequency 加权"与"均匀抽样"
        // （均匀时 RAT/KOBOLD 各期望 1293 vs 均匀 556，单项 χ² 贡献 >400）
        expect(chi2).toBeLessThan(40.8);
        expect(chi2).toBeGreaterThan(0.001); // 完全贴合到不可能也是一种可疑
    });
});

describe('horde 抽取 — out-of-depth（CE Monsters.c:797-805）', () => {
    it('D1 永不触发 OOD', () => {
        const game = createHeadlessGame(1);
        rng.seedRandomGenerator(OOD_SEED);
        for (let i = 0; i < 5000; i++) {
            const r = game.rollSpawnDepth(1);
            expect(r.outOfDepth).toBe(false);
            expect(r.depth).toBe(1);
        }
    });

    it('D10 触发率接近 10%（±3%），触发时深度落在 [11,15]', () => {
        const game = createHeadlessGame(1);
        rng.seedRandomGenerator(OOD_SEED);
        const N = 10000;
        let triggered = 0;
        const depthHistogram = new Map<number, number>();
        for (let i = 0; i < N; i++) {
            const r = game.rollSpawnDepth(10);
            if (r.outOfDepth) {
                triggered++;
                depthHistogram.set(r.depth, (depthHistogram.get(r.depth) ?? 0) + 1);
                expect(r.depth).toBeGreaterThanOrEqual(11);
                expect(r.depth).toBeLessThanOrEqual(15);
            } else {
                expect(r.depth).toBe(10);
            }
        }
        const rate = triggered / N;
        console.log(`[horde_selection] D10 OOD 触发率 ${(rate * 100).toFixed(2)}%（${triggered}/${N}），深度分布：` +
            [...depthHistogram.entries()].sort((a, b) => a[0] - b[0]).map(([d, c]) => `D${d}=${c}`).join(' '));
        expect(Math.abs(rate - 0.10)).toBeLessThanOrEqual(0.03);
        // 深度增量 rand_range(1, min(5, depthLevel/2)) = rand_range(1,5)：五个深度都应出现
        expect(depthHistogram.size).toBe(5);
    });
});

describe('horde 抽取 — 周期刷怪 fuse（CE RogueMain.c:403 / Time.c:2322/2666）', () => {
    it('开局 fuse ∈ [125,175]', () => {
        const game = createHeadlessGame(FUSE_SEED);
        expect(game.monsterSpawnFuse).toBeGreaterThanOrEqual(125);
        expect(game.monsterSpawnFuse).toBeLessThanOrEqual(175);
    });

    it('fuse 归零后当回合触发刷怪并重置，新怪为 WANDERING 且在玩家视野外', () => {
        const game = createHeadlessGame(FUSE_SEED);
        game.monsterSpawnFuse = 1;
        const before = new Set(game.monsters);
        const beforeCount = game.monsters.length;

        game.handlePlayerAction('wait', undefined, 'system');

        // 触发后 fuse 必须已重置回 [125,175]
        expect(game.monsterSpawnFuse).toBeGreaterThanOrEqual(125);
        expect(game.monsterSpawnFuse).toBeLessThanOrEqual(175);

        const spawned = game.monsters.filter(m => !before.has(m));
        expect(spawned.length, 'fuse 归零应立即刷出一条 horde').toBeGreaterThan(0);
        for (const m of spawned) {
            expect(m.state, `新刷的 ${m.name} 应为 WANDERING`).toBe(MonsterState.WANDERING);
            const cell = game.grid.getCell(m.loc.x, m.loc.y);
            expect(cell?.isVisible, '新刷怪物不应出现在玩家视野内').toBe(false);
        }
        expect(game.monsters.length).toBeGreaterThan(beforeCount);
    });

    it('连续推进回合：fuse 单调递减，多次归零多次触发', () => {
        // wizard 模式（999HP 且每回合回满）：隔离引擎未播种 Math.random 带来的
        // 战局波动，让 400 回合必可跑满，专注验证 fuse 机制本身
        const game = createHeadlessGame(FUSE_SEED, 'wizard');
        let triggers = 0;
        let lastFuse = game.monsterSpawnFuse;
        for (let i = 0; i < 400 && !game.isGameOver && game.player.hp > 0; i++) {
            game.handlePlayerAction('wait', undefined, 'system');
            if (game.isGameOver || game.player.hp <= 0) break;
            if (game.monsterSpawnFuse > lastFuse) triggers++;
            lastFuse = game.monsterSpawnFuse;
        }
        console.log(`[horde_selection] 400 回合内周期刷怪触发次数：${triggers}（期望 ≈ 400/150 ≈ 2.7）`);
        expect(triggers).toBeGreaterThanOrEqual(1);
    });
});

describe('horde 抽取 — 数据层零失配与实际物种覆盖', () => {
    it('hordes.json 全部 leader/member 在 monsters.json 按 id 可查（映射后零失配）', () => {
        const ids = new Set(monstersJson.map(m => m.id));
        const missing: string[] = [];
        for (const h of hordesJson as HordeEntry[]) {
            if (!ids.has(h.leader.toLowerCase())) missing.push(h.leader);
            for (const mem of h.members) {
                if (!ids.has(mem.type.toLowerCase())) missing.push(mem.type);
            }
        }
        expect(missing, `monsters.json 缺失物种: ${[...new Set(missing)].join(', ')}`).toEqual([]);
    });

    it('D1..D26 逐层生成：全局物种数 >= 30（修复前常规池仅能产出 9 种）', () => {
        const game = createHeadlessGame(TABLE_SEED);
        const nameToId = new Map(monstersJson.map(m => [m.name, m.id] as const));
        const globalSpecies = new Set<string>();
        const table: string[] = [];

        type Privates = Omit<Game, 'generateDepth'> & { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void };
        for (let d = 1; d <= 26; d++) {
            game.depth = d;
            (game as unknown as Privates).generateDepth(false, false);
            const perSpecies = new Map<string, number>();
            for (const m of game.monsters) {
                // 变异怪剥掉前缀，回溯基础物种 id
                const baseName = m.mutation ? m.name.slice(m.mutation.name.length + 1) : m.name;
                const id = nameToId.get(baseName) ?? baseName;
                perSpecies.set(id, (perSpecies.get(id) ?? 0) + 1);
                globalSpecies.add(id);
            }
            const summary = [...perSpecies.entries()]
                .sort((a, b) => b[1] - a[1])
                .map(([id, n]) => `${id}×${n}`)
                .join(', ');
            table.push(`D${String(d).padStart(2)} | 共 ${String(game.monsters.length).padStart(3)} 只 / ${perSpecies.size} 种 | ${summary}`);
        }
        console.log(`[horde_selection] D1..D26 逐层怪物表（seed=${TABLE_SEED}）：\n${table.join('\n')}`);
        console.log(`[horde_selection] 全局物种总数：${globalSpecies.size}`);
        expect(globalSpecies.size).toBeGreaterThanOrEqual(30);
    });

    it('开局铺怪实际会刷出 HORDE_LEADER_CAPTIVE 的笼中俘虏（领袖 caged + WANDERING + HP 1/4）', () => {
        // 多 seed 扫描：开局池 20 条 captive horde 占比不高，用批量扫描保证命中
        let hit = false;
        for (let seed = 101; seed <= 140 && !hit; seed++) {
            const game = createHeadlessGame(seed * 7919);
            for (const m of game.monsters) {
                if (m.isCaged) {
                    expect(m.state).toBe(MonsterState.WANDERING);
                    expect(m.hp).toBeLessThanOrEqual(Math.floor(m.maxHp / 4) + 1);
                    hit = true;
                    break;
                }
            }
        }
        expect(hit, '40 个 seed 内应至少出现一次笼中俘虏 horde').toBe(true);
    });
});
