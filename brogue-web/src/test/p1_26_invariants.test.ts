/**
 * src/test/p1_26_invariants.test.ts — P1-26：生成器不变量断言（Phase C 前置）
 *
 * 设计依据：ai_docs/phase_c_generator_proposal.md §6.2；路线图 P1-26。
 *
 * 为什么需要它：p2_*_baseline 一类"相位快照"把当时的生成结果逐字锁死，
 * 任何正当改动都会打红它们，抓不出真回归（详见
 * p2_3_objective_time.test.ts 顶部与 F 段的退役说明）。本文件反其道而行：
 * 只断言**不依赖具体坐标**的长期不变量——Phase C 的每一步重构都不应
 * 打红这里；打红即真回归，或不变量本身需随设计变更而有意修订。
 *
 * 判据口径：可走性一律用 Game.canMoveTo 的**实际移动规则**（经只读转型
 * 直接调用，与 harness.defaultTurnPolicy 同款做法），排除
 * GRANITE / WALL / SECRET_DOOR / LOCKED_DOOR / WATER_DEEP，不排除 LAVA。
 * 绝不用 cell.isPassable 量连通性——深水的 isPassable 是 true，用它量
 * 会让深水阻隔的 bug 完全隐形（phase_c 提案 §四 自我纠错记录；
 * 本轮反向验证 RV1 实证：isPassable 判据下 11 层坏层全部"消失"）。
 *
 * 已知 bug 留痕（P1-29 待修）：web 缺 CE 的湖泊连通性验证
 * （CE Architect.c:2588-2688：每提议一个湖就 flood-fill 验证，不通过
 * 换位重试、仍不行则放弃该湖），部分层的下楼梯从上楼梯走不到。
 * 因此「上楼梯 → 下楼梯」不变量按项目一贯的显式留痕做法写成
 * "不可达层数**恰好等于**实测值"：变好变坏都会翻红，P1-29 修复落地时
 * 必须有人回来把它改成严格 0，不会被悄悄忽略。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, terrainFingerprint } from './harness';
import { TerrainType, type Grid } from '../engine/Map/Grid';
import type { Game } from '../engine/Core/Game';

/** 4 个既有基线种子 + 20260916（验收方连通性探针中坏层最多的种子）。 */
const SEEDS = [424242, 777, 20260913, 31337, 20260916];
const MAX_DEPTH = 26;

/**
 * 下楼梯不可达层数的现状实测值（2026-09-15，5 种子 × D1-D26 = 130 层，
 * 其中 125 层有下楼梯；11 层不可达。明细见
 * ai_docs/p1_26_invariant_assertions_report.md）。
 *
 * ★ 这是已知 bug（P1-29 待修）的现状留痕，**不是期望值**。
 * P1-29（对齐 CE 湖泊连通性验证）落地后，必须把本值改为 0，
 * 并把断言名里的"已知 bug"字样一并清除。
 */
const KNOWN_UNREACHABLE_STAIRS_LEVELS = 11;

/** 可走格占比的宽区间（占全格比例）。2026-09-15 实测 130 层为
 *  178~516 格（全格 79×29=2291，即 7.8%~22.5%）。区间两侧留约 2 倍
 *  余量：只抓"生成器彻底失灵"（凿不开洞 / 忘了墙），不抓正常波动。 */
const WALKABLE_MIN_FRACTION = 0.03;
const WALKABLE_MAX_FRACTION = 0.4;

type Pos = { x: number; y: number };
type MovePredicate = (x: number, y: number) => boolean;

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/** 游戏的实际移动规则：只读转型后直接调用 Game 的私有 canMoveTo。 */
function realMoveRule(game: Game): MovePredicate {
    return (x, y) => (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo(x, y);
}

interface LevelScan {
    seed: number;
    depth: number;
    up: Pos | null;
    down: Pos | null;
    /** canMoveTo 口径下的可走格数 */
    walkable: number;
    /** 全格数（grid.width × grid.height） */
    gridArea: number;
    /** 从上楼梯出发（8 向泛洪）可达的格数；无上楼梯时为 -1 */
    reach: number;
    /** 下楼梯是否从上楼梯可达 */
    downReachable: boolean;
    fp: string;
}

function flood(grid: Grid, start: Pos, passable: MovePredicate): Set<number> {
    const seen = new Set<number>([start.y * grid.width + start.x]);
    const queue: Pos[] = [start];
    while (queue.length > 0) {
        const p = queue.pop()!;
        for (const [dx, dy] of DIRS8) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
            const key = ny * grid.width + nx;
            if (seen.has(key)) continue;
            if (!passable(nx, ny)) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen;
}

function scanLevel(game: Game, seed: number, depth: number): LevelScan {
    const grid = game.grid;
    const passable = realMoveRule(game);
    let up: Pos | null = null;
    let down: Pos | null = null;
    let walkable = 0;
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const cell = grid.getCell(x, y);
            if (!cell) continue;
            if (cell.terrain === TerrainType.STAIRS_UP) up = { x, y };
            else if (cell.terrain === TerrainType.STAIRS_DOWN) down = { x, y };
            if (passable(x, y)) walkable++;
        }
    }
    let reach = -1;
    let downReachable = false;
    if (up) {
        const seen = flood(grid, up, passable);
        reach = seen.size;
        downReachable = !!down && seen.has(down.y * grid.width + down.x);
    }
    return { seed, depth, up, down, walkable, gridArea: grid.width * grid.height, reach, downReachable, fp: terrainFingerprint(grid) };
}

/** 与 p2_3 / generation_baseline 同款驱动：D1 来自 startNewGame，
 *  D2 起置 depth 后 generateDepth(false, false) 逐层新造。 */
function walkAllSeeds(visit: (scan: LevelScan) => void): void {
    for (const seed of SEEDS) {
        const game = createHeadlessGame(seed);
        visit(scanLevel(game, seed, 1));
        for (let d = 2; d <= MAX_DEPTH; d++) {
            (game as unknown as { depth: number }).depth = d;
            (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
            visit(scanLevel(game, seed, d));
        }
    }
}

/** 首趟扫描结果按需缓存（文件内用例顺序执行，无并发风险）。 */
let firstPassCache: LevelScan[] | null = null;
function getFirstPass(): LevelScan[] {
    if (!firstPassCache) {
        const rows: LevelScan[] = [];
        walkAllSeeds((s) => rows.push(s));
        firstPassCache = rows;
    }
    return firstPassCache;
}

describe('P1-26 生成器不变量（5 种子 × D1-D26，不依赖坐标）', () => {
    it('每层楼梯存在：D1-D25 上下楼梯齐全；D26（护符层）有上楼梯、无下楼梯', () => {
        // D26 无下楼梯是生成器的有意行为（populateLevel：depth < 26 才放，
        // 护符层即最深层），与 CE 一致，故作为内容断言钉住。
        const problems: string[] = [];
        for (const s of getFirstPass()) {
            if (!s.up) problems.push(`seed${s.seed}/D${s.depth} 缺上楼梯`);
            if (s.depth < MAX_DEPTH && !s.down) problems.push(`seed${s.seed}/D${s.depth} 缺下楼梯`);
            if (s.depth === MAX_DEPTH && s.down) {
                problems.push(`seed${s.seed}/D${s.depth} 不应有下楼梯（护符层即最深层）`);
            }
        }
        expect(problems, `楼梯存在性被破坏：\n${problems.join('\n')}`).toEqual([]);
    });

    it(`上楼梯能走到下楼梯——已知 bug P1-29 留痕：当前恰好 ${KNOWN_UNREACHABLE_STAIRS_LEVELS} 层不可达，修复后本断言必须改为严格 0`, () => {
        const bad = getFirstPass().filter((s) => s.down && !s.downReachable);
        const detail = bad
            .map((s) => `seed${s.seed}/D${s.depth}: 从上楼梯可达 ${s.reach}/${s.walkable} 格`)
            .join('；');
        // "恰好等于"：变好（修复落地）与变坏（新回归）都会翻红，
        // 强制有人在 P1-29 落地时回来把期望值改成严格 0。
        expect(
            bad.length,
            `下楼梯不可达层数与留痕值 ${KNOWN_UNREACHABLE_STAIRS_LEVELS} 不符` +
            `（已知 bug P1-29：web 缺 CE Architect.c:2588-2688 的湖泊连通性验证）。` +
            `若本次运行不可达层数为 0，说明 P1-29 已修复：请把 KNOWN_UNREACHABLE_STAIRS_LEVELS 改为 0 并更新断言名。\n坏层明细: ${detail}`
        ).toBe(KNOWN_UNREACHABLE_STAIRS_LEVELS);
    });

    it('每层可走格占比在宽区间内（抓生成器彻底失灵，不抓正常波动）', () => {
        const offenders = getFirstPass().filter(
            (s) => s.walkable < WALKABLE_MIN_FRACTION * s.gridArea || s.walkable > WALKABLE_MAX_FRACTION * s.gridArea
        );
        const detail = offenders
            .map((s) => `seed${s.seed}/D${s.depth}: 可走 ${s.walkable}/${s.gridArea} 格` +
                `(${((100 * s.walkable) / s.gridArea).toFixed(1)}%，区间 ` +
                `${WALKABLE_MIN_FRACTION * 100}%~${WALKABLE_MAX_FRACTION * 100}%)`)
            .join('；');
        expect(
            offenders.length,
            `可走格占比越界的层数=${offenders.length}（生成器可能彻底失灵）\n明细: ${detail}`
        ).toBe(0);
    });

    it('5 种子 × D1-D26 全部生成不抛异常', () => {
        // 独立再走一遍（不复用缓存）：任一层生成抛错都会让本用例以
        // 原始异常失败，错误栈直接指向出事的深度。
        walkAllSeeds(() => {});
    });

    it('决定性：同种子两次生成，130 层地形指纹逐一一致', () => {
        const first = getFirstPass();
        const second: string[] = [];
        walkAllSeeds((s) => second.push(`${s.seed}/D${s.depth}:${s.fp}`));
        const mismatches: string[] = [];
        for (let i = 0; i < first.length; i++) {
            const want = `${first[i]!.seed}/D${first[i]!.depth}:${first[i]!.fp}`;
            if (second[i] !== want) mismatches.push(`第 ${i} 层 want=${want} got=${second[i]}`);
        }
        expect(
            mismatches,
            `同种子两次生成的地形指纹不一致（生成混入了非种子随机源，或存在跨实例共享状态）：\n${mismatches.join('\n')}`
        ).toEqual([]);
    });
});
