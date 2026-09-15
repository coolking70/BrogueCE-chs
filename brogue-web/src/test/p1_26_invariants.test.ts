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
 * P1-29 已落地：湖泊连通性验证（CE Architect.c:2588-2688 语义）已进入
 * Architect，本断言自"已知 bug 留痕恰好 11"改为**严格 0**。
 * 注意： Architect.generateTerrain（房间+湖泊+陷阱阶段）之后的机器阶段
 * （BlueprintEngine 锁门/特征水深水）仍可能切断连通——那是不受湖泊闸门
 * 约束的独立缺陷，本断言若因此翻红，即它在履行追踪职责；
 * 解剖与证据链见 ai_docs/p1_29_lake_connectivity_report.md。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, terrainFingerprint } from './harness';
import { TerrainType, type Grid } from '../engine/Map/Grid';
import type { Game } from '../engine/Core/Game';

/** 4 个既有基线种子 + 20260916（验收方连通性探针中坏层最多的种子）。 */
const SEEDS = [424242, 777, 20260913, 31337, 20260916];
const MAX_DEPTH = 26;

/**
 * 下楼梯不可达层数。P1-29 已把**湖泊造成的**不可达清零（验收方独立探针复核：
 * 10 种子 × D1-D26 = 260 层，湖泊阶段完成态全部连通）。
 *
 * 剩下的 1 层由**机器阶段**造成，不是湖泊、也不是回归——见路线图 P1-33。
 * 铁证：seed777/D15 该层**深水为 0**（根本没有湖），是 3 个 LOCKED_DOOR
 * 恰好卡在树状走廊的割点上。CE 的顺序同样是 designLakes 在前、addMachines
 * 在后（Architect.c:2928 / 2944），但 CE 先有 addLoops（2897）造出环路，
 * 割点远比树状地牢稀少。
 *
 * 故此处沿用项目一贯的显式留痕：断言"恰好等于 1"而非 0，用"恰好"使变好变坏
 * 都翻红。P1-33 修复后请改回 0 并删掉本段说明。
 * 任何不可达都是真问题：要么生成期回归，要么机器阶段的独立缺陷
 * （锁门/特征水不受 P1-29 湖泊闸门约束，见
 * ai_docs/p1_29_lake_connectivity_report.md §与预设不符之处）。
 */
const KNOWN_UNREACHABLE_STAIRS_LEVELS = 1; // 机器阶段致（P1-33）；湖泊致已由 P1-29 清零

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

    it('上楼梯能走到下楼梯——湖泊致已清零（P1-29）；留痕：机器阶段仍致 1 层不可达，待 P1-33', () => {
        const bad = getFirstPass().filter((s) => s.down && !s.downReachable);
        const detail = bad
            .map((s) => `seed${s.seed}/D${s.depth}: 从上楼梯可达 ${s.reach}/${s.walkable} 格`)
            .join('；');
        expect(
            bad.length,
            `下楼梯不可达层数=${bad.length}（要求严格 0）。\n` +
            `湖泊闸门（P1-29，CE Architect.c:2588-2688 语义）保证湖泊阶段全连通；` +
            `若坏层的切割者是机器阶段的锁门/特征水深水（不受该闸门约束的独立缺陷），\n` +
            `解剖与证据链见 ai_docs/p1_29_lake_connectivity_report.md；` +
            `否则为本文件的真回归。\n坏层明细: ${detail}`
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
