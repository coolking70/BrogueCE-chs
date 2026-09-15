/**
 * src/test/c_2_lakes_e2e.test.ts — C-2：真实生成关卡上的湖泊行为断言与实测统计
 * （湖泊阶段扫描：深度门槛实测、黑曜石镶边、留痕、合同与统计。
 *   端到端坏层闸门与决定性在 c_2_lakes_gate.test.ts——拆文件是为了让
 *   两个重扫描能被 vitest 并行调度，缩短整段套件的墙钟时间。）
 *
 * 口径：
 * - 湖泊阶段 = Architect.generateTerrain（房间+环路+湖泊+液体+清理+桥，
 *   机器/陷阱/楼梯之前的阶段）——液体组成以这一阶段为准。
 * - 15 种子同 P1-26/P1-29/P1-33。
 */
import { describe, it, expect } from 'vitest';
import { Architect } from '../engine/Generator/Architect';
import { terrainAllowsMove, DIRS8 } from '../engine/Map/Connectivity';
import { cleanUpLakeBoundaries } from '../engine/Map/LakeSystem';
import { Grid, TerrainType } from '../engine/Map/Grid';
import { rng } from '../engine/Random';
import { terrainFingerprint } from './harness';

/** P1-26/P1-29/P1-33 同款 15 种子。 */
const SEEDS = [424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555, 2, 3, 5, 7, 11];
const MAX_DEPTH = 26;

/** 重扫描用例的显式超时：整段套件并行满载时 390 层生成会越过全局 120s。 */
const HEAVY = 300_000;

type Pos = { x: number, y: number };

function countTerrain(g: Grid, t: TerrainType): number {
    let n = 0;
    for (let x = 0; x < g.width; x++) {
        for (let y = 0; y < g.height; y++) {
            if (g.getCell(x, y)?.terrain === t) n++;
        }
    }
    return n;
}

function collectDry(g: Grid): { cells: Pos[], first: Pos | null } {
    const cells: Pos[] = [];
    let first: Pos | null = null;
    for (let x = 0; x < g.width; x++) {
        for (let y = 0; y < g.height; y++) {
            const cell = g.getCell(x, y);
            if (cell && terrainAllowsMove(cell.terrain)) {
                cells.push({ x, y });
                if (!first) first = { x, y };
            }
        }
    }
    return { cells, first };
}

function floodDry(g: Grid, start: Pos): Set<number> {
    const seen = new Set<number>([start.y * g.width + start.x]);
    const queue: Pos[] = [start];
    while (queue.length > 0) {
        const p = queue.pop()!;
        for (const [dx, dy] of DIRS8) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= g.width || ny >= g.height) continue;
            const key = ny * g.width + nx;
            if (seen.has(key)) continue;
            const cell = g.getCell(nx, ny);
            if (!cell || !terrainAllowsMove(cell.terrain)) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen;
}

interface LevelStats {
    seed: number;
    depth: number;
    fp: string;
    lava: number;
    deep: number;
    shallow: number;
    brimstone: number;
    obsidian: number;
    chasmFamily: number;   // CHASM + CHASM_EDGE + BRIDGE + BRIDGE_EDGE
    dryTotal: number;
    dryReached: number;    // 湖泊阶段干地连通块（闸门合同）
    cleanupIdempotent: boolean;
    diagonalOpenings: number; // C-3 留痕：FLOOR 斜向豁口（正交两侧全是墙）
}

/** 斜向豁口：A=(x,y) 与 B=(x+1,y+1) 均为 FLOOR，而 (x+1,y)、(x,y+1) 均为墙/花岗岩。 */
function countDiagonalOpenings(g: Grid): number {
    const solid = (x: number, y: number): boolean => {
        const t = g.getCell(x, y)?.terrain;
        return t === TerrainType.WALL || t === TerrainType.GRANITE;
    };
    let n = 0;
    for (let x = 0; x < g.width - 1; x++) {
        for (let y = 0; y < g.height - 1; y++) {
            const a = g.getCell(x, y)?.terrain === TerrainType.FLOOR;
            const b = g.getCell(x + 1, y + 1)?.terrain === TerrainType.FLOOR;
            if (a && b && solid(x + 1, y) && solid(x, y + 1)) n++;
        }
    }
    return n;
}

/** 黑曜石是否在某个硫矿格的切比雪夫 2 格内（createWreath 圆盘半径=2）。 */
function obsidianNearBrimstone(g: Grid, x: number, y: number): boolean {
    for (let i = x - 2; i <= x + 2; i++) {
        for (let j = y - 2; j <= y + 2; j++) {
            if (g.getCell(i, j)?.terrain === TerrainType.INERT_BRIMSTONE) return true;
        }
    }
    return false;
}

/** 单趟 15 种子 × D1-D26 湖泊阶段扫描，边扫边断言，缓存聚合结果。 */
let sweepCache: LevelStats[] | null = null;
function getSweep(): LevelStats[] {
    if (sweepCache) return sweepCache;
    const rows: LevelStats[] = [];
    const statsBefore = { ...Architect.lakeGateStats };
    for (const seed of SEEDS) {
        rng.seedRandomGenerator(seed);
        const arch = new Architect();
        for (let depth = 1; depth <= MAX_DEPTH; depth++) {
            const g = arch.generateTerrain(depth);

            // 湖泊阶段连通性合同（P1-29 语义：terrainAllowsMove 口径 8 向一块）
            const { cells, first } = collectDry(g);
            const reached = first ? floodDry(g, first) : new Set<number>();

            // 清理幂等（真实关卡：饱和后再跑零改动）
            const before: number[] = [];
            for (let y = 0; y < g.height; y++) {
                for (let x = 0; x < g.width; x++) before.push(g.getCell(x, y)!.terrain);
            }
            cleanUpLakeBoundaries(g);
            let idempotent = true;
            outer:
            for (let y = 0; y < g.height; y++) {
                for (let x = 0; x < g.width; x++) {
                    if (g.getCell(x, y)!.terrain !== before[y * g.width + x]) {
                        idempotent = false;
                        break outer;
                    }
                }
            }

            // 黑曜石只随硫矿（对每格校验，越界格由 getCell 返回 null 自然排除）
            let obsidianOk = true;
            for (let x = 0; x < g.width; x++) {
                for (let y = 0; y < g.height; y++) {
                    if (g.getCell(x, y)?.terrain === TerrainType.OBSIDIAN && !obsidianNearBrimstone(g, x, y)) {
                        obsidianOk = false;
                    }
                }
            }
            expect(obsidianOk,
                `seed${seed}/D${depth}：存在切比雪夫 2 格内无硫矿的黑曜石——镶边液体/宽度取错`).toBe(true);

            rows.push({
                seed, depth, fp: terrainFingerprint(g),
                lava: countTerrain(g, TerrainType.LAVA),
                deep: countTerrain(g, TerrainType.WATER_DEEP),
                shallow: countTerrain(g, TerrainType.WATER_SHALLOW),
                brimstone: countTerrain(g, TerrainType.INERT_BRIMSTONE),
                obsidian: countTerrain(g, TerrainType.OBSIDIAN),
                chasmFamily: countTerrain(g, TerrainType.CHASM) + countTerrain(g, TerrainType.CHASM_EDGE)
                    + countTerrain(g, TerrainType.BRIDGE) + countTerrain(g, TerrainType.BRIDGE_EDGE),
                dryTotal: cells.length,
                dryReached: reached.size,
                cleanupIdempotent: idempotent,
                diagonalOpenings: countDiagonalOpenings(g),
            });
        }
    }
    const stats = Architect.lakeGateStats;
    console.log(`[c_2] 湖泊阶段扫描：${SEEDS.length * MAX_DEPTH} 层，闸门 ` +
        `placed=${stats.placed - statsBefore.placed} skipped=${stats.skipped - statsBefore.skipped}`);
    sweepCache = rows;
    return rows;
}

function band(rows: LevelStats[], lo: number, hi: number): LevelStats[] {
    return rows.filter(r => r.depth >= lo && r.depth <= hi);
}

function sum(rows: LevelStats[], pick: (r: LevelStats) => number): number {
    return rows.reduce((acc, r) => acc + pick(r), 0);
}

describe('C-2 实测（15 种子 × D1-D26 真实生成）', () => {
    it('对抗 AD-B1：深度门槛实测——D1-3 无岩浆/硫矿/黑曜石；D4-16 无硫矿/黑曜石；D4+/D17+ 各自真的出现', () => {
        const rows = getSweep();
        const early = band(rows, 1, 3);
        const mid = band(rows, 4, 16);
        const late = band(rows, 17, 26);

        expect(sum(early, r => r.lava), `D1-3 出现岩浆格（minimumLavaLevel=4 被写反或漏判）`).toBe(0);
        expect(sum(early, r => r.brimstone), 'D1-3 出现硫矿格').toBe(0);
        expect(sum(early, r => r.obsidian), 'D1-3 出现黑曜石（硫矿镶边）格').toBe(0);
        expect(sum(mid, r => r.brimstone), 'D4-16 出现硫矿格（minimumBrimstoneLevel=17 被写反或漏判）').toBe(0);
        expect(sum(mid, r => r.obsidian), 'D4-16 出现黑曜石格').toBe(0);

        expect(sum(band(rows, 4, 26), r => r.lava), 'D4+ 逐层全无岩浆——岩浆候选被错误排除').toBeGreaterThan(0);
        expect(sum(late, r => r.brimstone), 'D17+ 逐层全无硫矿——硫矿候选被错误排除（深层不出硫矿）').toBeGreaterThan(0);
        expect(sum(late, r => r.obsidian), 'D17+ 硫矿湖应有黑曜石镶边').toBeGreaterThan(0);
    }, HEAVY);

    it('对抗 AD-B3：黑曜石只作为硫矿镶边出现（每格都在某硫矿的圆盘半径 2 内）', () => {
        // 校验发生在 getSweep() 的单趟扫描里（对每格做邻域检查）；
        // 这里补一个总量哨兵：本轮实现下黑曜石只能来自 createWreath。
        const rows = getSweep();
        expect(sum(rows, r => r.obsidian)).toBeGreaterThan(0);
    }, HEAVY);

    it('留痕：深渊族地形恒 0（CHASM/CHASM_EDGE/BRIDGE/BRIDGE_EDGE）——C-5 坠落落地后解除', () => {
        const rows = getSweep();
        const total = sum(rows, r => r.chasmFamily);
        expect(total,
            '深渊族地形出现——风险裁决 1（CHASM 不生成）被推翻却未同步坠落子系统（P1-22/C-5）。' +
            '若 C-5 已落地，请删除本断言、把 liquidType 候选域中的 2 加回，并以 CE T_AUTO_DESCENT 语义补坠落。').toBe(0);
        console.log(`[c_2] 留痕：${SEEDS.length * MAX_DEPTH} 层深渊族地形总数 = ${total}（CHASM 不生成 → 桥无料可架，buildABridge 每层空转）`);
    }, HEAVY);

    // C-2 立的留痕，C-3 落地后由验收方按其自带指示翻转（原断言：斜向豁口 > 0）。
    // 这是留痕机制少数一次**按设计工作**的实例：断言消息自己写明了翻转条件，
    // 验收时无需重新判断"这条红是回归还是预期"。
    it('C-3 已落地：removeDiagonalOpenings 扫到收敛，斜向豁口恒为 0', () => {
        const rows = getSweep();
        const total = sum(rows, r => r.diagonalOpenings);
        const levels = rows.filter(r => r.diagonalOpenings > 0).length;
        console.log(`[c_2] C-3 后：斜向豁口总数 = ${total}，残留层数 = ${levels}/${rows.length}`);
        expect(total, 'CE digDungeon 在湖泊后有 removeDiagonalOpenings（C-3 已实现）；' +
            '若本断言翻红说明它没扫到收敛，或后续阶段又制造了新的斜向豁口').toBe(0);
    }, HEAVY);

    it('湖泊阶段合同：干地全连通 + cleanUpLakeBoundaries 幂等（真实关卡）', () => {
        const rows = getSweep();
        const broken = rows.filter(r => r.dryReached !== r.dryTotal);
        const dirty = rows.filter(r => !r.cleanupIdempotent);
        expect(broken.map(r => `seed${r.seed}/D${r.depth}: 干地 ${r.dryTotal} 中仅 ${r.dryReached} 格连通`),
            '湖泊阶段完成态存在不连通层——P1-29 合同被 C-2 新阶段（液体/镶边/清理）破坏').toEqual([]);
        expect(dirty.map(r => `seed${r.seed}/D${r.depth}`),
            '饱和后的清理再跑一遍有改动（幂等被破坏）').toEqual([]);
    }, HEAVY);

    it('实测统计（报告数据源）：四类液体随深度的分布', () => {
        const rows = getSweep();
        const bands: Array<[string, number, number]> = [['D1-3', 1, 3], ['D4-9', 4, 9], ['D10-16', 10, 16], ['D17-26', 17, 26]];
        const lines: string[] = [];
        for (const [label, lo, hi] of bands) {
            const b = band(rows, lo, hi);
            const levels = b.length;
            lines.push(
                `${label}: 层数=${levels} 深水=${sum(b, r => r.deep)}(均值${(sum(b, r => r.deep) / levels).toFixed(1)}) ` +
                `浅水=${sum(b, r => r.shallow)} 岩浆=${sum(b, r => r.lava)} 硫矿=${sum(b, r => r.brimstone)} ` +
                `黑曜石=${sum(b, r => r.obsidian)} 有岩浆层数=${b.filter(r => r.lava > 0).length} ` +
                `有硫矿层数=${b.filter(r => r.brimstone > 0).length}`
            );
        }
        console.log(`[c_2] 液体分布：\n${lines.join('\n')}`);
        // 宽哨兵（不是精确值断言）：深水与浅水仍是湖泊主体；液体分布非零
        expect(sum(rows, r => r.deep)).toBeGreaterThan(0);
        expect(sum(rows, r => r.shallow)).toBeGreaterThan(0);
    }, HEAVY);
});
