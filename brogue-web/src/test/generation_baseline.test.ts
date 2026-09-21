import { describe, it, expect } from 'vitest';
import { createHeadlessGame, terrainFingerprint } from './harness';
import base from './fixtures/generation_baseline.json';

/**
 * 滚动生成基线——检测**非预期的**地图生成漂移。
 *
 * ★ 治理（2026-09-22 用户裁决，方案 A）：**本文件已移出默认门禁。**
 *   - `npm test` / `npx vitest run` 用 --exclude 跳过它；
 *   - 单独跑：`npm run test:drift`。
 *   理由：它同时承担两种相反含义——对交互期改动是"不该移动生成流"的强哨兵，
 *   对合法生成改动则**必然先红**、待归因后重采。混在没有结果分类的默认门禁里，
 *   红灯无法区分"意外回归 / 预期漂移待审核 / 已批准重采"三种状态
 *   （实证：V-2a 的 60 处偏离、V-2b-1 的 98/104 层）。
 *
 *   ⚠️ **移出默认门禁的代价是它可能被漏跑。** 缓解：验收方的验收七步里
 *   `npm run test:drift` 与全量门禁**并列为必跑项**；凡改动
 *   `src/engine/Generator/`、`src/engine/Map/`、`src/data/blueprints.json`
 *   的轮次，任务书必须显式要求跑它。
 *
 * 与已退役的 p2_*_baseline 阶段快照不同：这份基线不绑定任何阶段，
 * 只在生成确实应当改变时**有意重采**，并在提交信息中说明是哪次改动、为什么。
 *
 * 重采方式：用 createHeadlessGame + terrainFingerprint 按本文件的字段口径
 * 重新生成 fixtures/generation_baseline.json（见 P1-20 提交）。
 *
 * 若本测试失败而你**没有**故意改生成逻辑，说明有改动意外泄漏进了地图生成——
 * 这正是它存在的目的，请先查清成因再决定是否重采。
 */
describe('滚动生成基线：地图生成无非预期漂移', () => {
    it('4 seed × D1-D26：地形指纹 / 怪物数 / 物种集合 / 物品数与基线一致', () => {
        const b: any = base;
        const diffs: string[] = [];
        for (const seed of b.seeds) {
            const g: any = createHeadlessGame(seed);
            const rows = b.levels[String(seed)];
            for (let d = 1; d <= 26; d++) {
                if (d > 1) { g.depth = d; g.generateDepth(false, false); }
                const c: Record<string, number> = {};
                for (const m of g.monsters) c[m.name] = (c[m.name] || 0) + 1;
                const now: Record<string, unknown> = {
                    fp: terrainFingerprint(g.grid), n: g.monsters.length,
                    species: Object.keys(c).sort().join(','), items: g.items.length,
                };
                for (const k of ['fp', 'n', 'species', 'items']) {
                    if (String(now[k]) !== String(rows[d - 1][k]))
                        diffs.push(`seed${seed} D${d} ${k}: 基线=${rows[d - 1][k]} 现在=${now[k]}`);
                }
            }
        }
        expect(diffs, `生成结果偏离基线 ${diffs.length} 处（若非有意改动，请查清成因）`).toEqual([]);
    });
});
