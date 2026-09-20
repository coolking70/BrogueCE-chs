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
 * P1-33 已落地：机器阶段（BlueprintEngine 锁门/特征水深水）的切断缺陷
 * 已用 chokeMap 门位选址根治，坏层集合现为**空集**——本断言翻红即
 * 生成期新回归，不再是留痕职责。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame, terrainFingerprint, analysisAllowsMove } from './harness';
import { TerrainType, type Grid } from '../engine/Map/Grid';
import type { Game } from '../engine/Core/Game';

/** 4 个既有基线种子 + 20260916（验收方连通性探针中坏层最多的种子）。 */
const SEEDS = [424242, 777, 20260913, 31337, 20260916];
const MAX_DEPTH = 26;

/**
 * 下楼梯不可达层数，要求严格 0。P1-29 已把**湖泊造成的**不可达清零；
 * 剩下的机器阶段坏层（424242/D19、20260916/D16、999/D18——LOCKED_DOOR/
 * 特征水深水卡在走廊割点上）已由 P1-33（chokeMap 门位选址 + 锁门验证 +
 * 密库地板退出楼梯牌堆）根治：15 种子 × D1-D26 复验坏层=0
 * （p1_33_machine_chokepoint.test.ts）。任何翻红都是生成期新回归。
 */
const KNOWN_UNREACHABLE_STAIRS_LEVELS = 0; // P1-29（湖泊致）+ P1-33（机器致）先后清零

/**
 * 可走格占比的宽区间（占全格比例）。2026-09-15 C-1 合并后实测 130 层为
 * 30.4%~49.5%（p50 39.5%、p98 47.0%，峰值 424242/D4）。
 *
 * 上限 0.55 的校准依据（2026-09-15 补做，失灵变体均为生产代码临时改坏实测，
 * 跑完即还原，见 c_1_room_profile_report.md §验收补做）：
 * - CE 忠实算法 + 79×29 画布存在物理密度天花板：attachRooms 的 3×3 光环
 *   净空使房间不可能无限密——把 attach 参数翻倍（35→70）后 130 层 max 仍只
 *   有 48.5%。即**参数级失灵推不高占比**，本守卫本就不覆盖它。
 * - 上界要抓的是"大面积错误开凿"级的结构失灵：真实发生过的移植错误
 *   "去掉 3×3 光环净空"（roomFitsAt 恒 true）使分布右移到 p90 56.1%、
 *   max 61.6%（18/130 层越界，守卫稳翻红）；"忘墙/整图凿穿"≈100%。
 *   0.55 位于两者之间：生产 p98 47.0% 之上留约 8 个百分点，失灵侧 56%+ 稳越界。
 * - 下限 0.03 不变：生产 min 30.4%，"凿不开洞"（只挖出首房间碎块）远低于 3%。
 */
const WALKABLE_MIN_FRACTION = 0.03;
const WALKABLE_MAX_FRACTION = 0.55;

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

/** 连通性分析口径：放行密门。理由与限制见 harness.ts 的 analysisAllowsMove。 */
function analysisRule(game: Game, grid: Grid): MovePredicate {
    return analysisAllowsMove(grid, realMoveRule(game));
}

interface LevelScan {
    seed: number;
    depth: number;
    up: Pos | null;
    down: Pos | null;
    /** canMoveTo 口径下的可走格数（V-2b-5 起剔除机器格） */
    walkable: number;
    /** 全格数（grid.width × grid.height） */
    gridArea: number;
    /** V-2b-5：机器格数（网格 machineNumber≠0），占比的分母同步剔除 */
    machineCells: number;
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
    // V-2b-5：机器格（网格 machineNumber≠0，CE IS_IN_MACHINE）不进占比。
    // 依据：CE Architect.c:862-871 prepareInteriorWithMachineFlags 的
    // BP_PURGE_INTERIOR 把 interior **全部**格（含墙）改铺 FLOOR——BP1
    // Mixed item library（BP_OPEN_INTERIOR 扩到 4 轮）落在大湖/多墙层时，
    // interior 可达 1287 格，可走占比 64.6%（实测 seed777/D8），是 CE 字面
    // 行为而非生成器失灵。占比守卫的本意是抓"大面积错误开凿"级的**生成器
    // 本体**失灵；机器地形由 p1_33（chokepoint 选址）/p1_37（机器格布点）
    // 另行把守，故在此剔除，保持守卫对生成器本体的原有分辨力
    //（0.55 上界对"去掉 3×3 光环净空"变体 max 61.6% 仍稳翻红）。
    let machineCells = 0;
    let walkableMachine = 0;
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            const cell = grid.getCell(x, y);
            if (!cell) continue;
            const isMachine = cell.machineNumber !== 0;
            if (isMachine) machineCells++;
            if (cell.terrain === TerrainType.STAIRS_UP) up = { x, y };
            else if (cell.terrain === TerrainType.STAIRS_DOWN) down = { x, y };
            if (passable(x, y)) {
                walkable++;
                if (isMachine) walkableMachine++;
            }
        }
    }
    // 占比口径：分子只剔可走的机器格，分母剔全部机器格（见上方 V-2b-5 注）。
    walkable -= walkableMachine;
    let reach = -1;
    let downReachable = false;
    if (up) {
        // 可走格计数 walkable 仍按 canMoveTo 的字面口径；
        // 洪泛按 CE 的分析口径（放行密门）。见 analysisRule 的注释。
        const seen = flood(grid, up, analysisRule(game, grid));
        reach = seen.size;
        downReachable = !!down && seen.has(down.y * grid.width + down.x);
    }
    return { seed, depth, up, down, walkable, gridArea: grid.width * grid.height, machineCells, reach, downReachable, fp: terrainFingerprint(grid) };
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

    it('上楼梯能走到下楼梯——严格 0（P1-29 清湖泊致、P1-33 清机器致）', () => {
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
        // V-2b-5：占比 = (可走 − 机器格) / (全格 − 机器格)。机器 interior 的
        // 铺地是 CE prepareInteriorWithMachineFlags 的字面行为（见 scanLevel
        // 的 V-2b-5 注），不属"生成器本体失灵"，剔除后原上界 0.55 保持校准。
        const offenders = getFirstPass().filter((s) => {
            const denom = s.gridArea - s.machineCells;
            const frac = s.walkable / denom;
            return frac < WALKABLE_MIN_FRACTION || frac > WALKABLE_MAX_FRACTION;
        });
        const detail = offenders
            .map((s) => `seed${s.seed}/D${s.depth}: 可走 ${s.walkable}/${s.gridArea - s.machineCells} 格` +
                `(机器格 ${s.machineCells} 已剔除，` +
                `${((100 * s.walkable) / (s.gridArea - s.machineCells)).toFixed(1)}%，区间 ` +
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
