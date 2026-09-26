/// <reference types="node" />
/**
 * src/test/c_0_add_loops.test.ts — C-0：地牢环路（addLoops）+ IN_LOOP 标志
 *
 * CE 对照（BrogueCE-master/src/brogue，只读）：
 *   addLoops Architect.c:340-396（调用点 digDungeon 2897：addLoops(grid, 20)）/
 *   门位落位 Architect.c:2898-2906（rand_percent(60) && depth<最深层 ? DOOR : FLOOR）/
 *   analyzeMap 前三步 Architect.c:192-244 / checkLoopiness 57-118 / auditLoop 121-136
 *
 * 断言策略：全部行为断言打在**真实生成的关卡**上。地形阶段断言走
 * Architect.generateTerrain 的真实管线（p1_29 同款驱动，环路发生在该阶段）；
 * 末态与集成断言走 createHeadlessGame 全管线（p1_26 同款驱动）。
 * 每条对抗性断言配一个"错误实现变体"在**同批真实 grid** 上运行，证明断言
 * 有牙（在对应错误实现下必然翻红），各自捕获：
 *   A2/A3 漏"两侧都是地板"检查 / 试了对角方向 → 门位缺正交地板轴（生产=0）
 *   A4    判据写反（< 而非 >）→ 蜂窝化，门位数暴涨（> 生产 ×3）
 *   A5    漏 costMap[x][y]=1 同步 → 后续候选距离过时，门位偏多（合计严格>）
 *   B2    漏 checkLoopiness 剥离 → loopFraction==passableFraction（生产严格<）
 *   B1    IN_LOOP 初始化口径写反 → 标到阻挡格上（生产=0）
 *   C2    addLoops 缺失（树状对照：门位回填成墙）→ 割点率显著更高
 *
 * C1 说明：CE Architect.c:377 判据 `> 20` 对 30000（两侧本就不连通）同样
 * 成立，此时门位是"补桥"而非"环边"。真实输入恒连通（52/52 层 1 个连通
 * 块），故扫描开的门应全部是真环边；另注意 web 生成器上本扫描是**稀疏
 * 开门**（~0.3 门/层，任务书"蜂窝化/深水回升"的预期不成立，见报告），
 * 数量级由 A6 用 K=6 次正确对照的散布带锚定。
 */
import { describe, it, expect } from 'vitest';

import { createHeadlessGame, terrainFingerprint } from './harness';
import { rng } from '../engine/Random';
import { Architect } from '../engine/Generator/Architect';
import { TerrainType, DCOLS, DROWS, type Grid } from '../engine/Map/Grid';
import {
    analyzeLoopMap,
    applyLoopDoorSites,
    blocksPathing,
    MINIMUM_PATHING_DISTANCE,
    WORK_FLOOR,
    WORK_DOOR_SITE,
} from '../engine/Map/LoopMap';
import { terrainAllowsMove, DIRS8 } from '../engine/Map/Connectivity';
import { DijkstraMap } from '../engine/Map/Pathfinding';
import { buildSafetyMap } from '../engine/Map/SafetyMap';
import type { Game } from '../engine/Core/Game';

const SEEDS = [424242, 777, 20260913, 31337, 20260916];
const HEAVY_SEEDS = [424242, 777];
const MAX_DEPTH = 26;

type Pos = { x: number; y: number };

/** p1_29 同款驱动：真实生成器的地形阶段（房间 → addLoops → 湖泊）。 */
function stageSweep(seeds: number[], visit: (arch: Architect, grid: Grid, seed: number, depth: number) => void): void {
    for (const seed of seeds) {
        rng.seedRandomGenerator(seed);
        const arch = new Architect();
        for (let depth = 1; depth <= MAX_DEPTH; depth++) {
            const grid = arch.generateTerrain(depth);
            visit(arch, grid, seed, depth);
        }
    }
}

/** p1_26 同款驱动：端到端管线（含陷阱/机器/怪物/楼梯/loopMap）。 */
function gameSweep(seeds: number[], visit: (game: Game, seed: number, depth: number) => void): void {
    for (const seed of seeds) {
        const game = createHeadlessGame(seed);
        visit(game, seed, 1);
        for (let d = 2; d <= MAX_DEPTH; d++) {
            (game as unknown as { depth: number }).depth = d;
            (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
            visit(game, seed, d);
        }
    }
}

function copyWork(work: number[][]): number[][] {
    return work.map((col) => col.slice());
}

/**
 * addLoops 的真实扫描输入：loopWorkGrid 是扫描**后**的 grid（含开门），
 * 把生产的开门集（loopDoorSites）回退成墙即得扫描输入。注意不能用
 * "全部 2→0"回退——attachRooms 已落的门同样是 2，回掉会人为制造碎片。
 */
function trueScanInput(arch: Architect): number[][] {
    const input = copyWork(arch.loopWorkGrid!);
    for (const s of arch.loopDoorSites) input[s.x]![s.y] = 0;
    return input;
}

function inMap(x: number, y: number): boolean {
    return x >= 0 && x < DCOLS && y >= 0 && y < DROWS;
}

/**
 * 错误实现变体（测试内的独立复刻，非生产代码）：与 CE Architect.c:360-389
 * 同构的扫描，按 flaw 注入一种具体错误。order 由调用方注入（默认 raster 序；
 * A5 需要与生产同形的洗牌序——见 lcgShuffle）。
 * flaw='none' 是**正确**的对照实现：A5 用它同序对比 noCostSync，把
 * costMap 同步的效果从顺序噪声里剥离出来。
 */
type Flaw = 'none' | 'inverted' | 'noCostSync' | 'diagonal' | 'noFlankCheck';

function flawedScan(source: number[][], flaw: Flaw, order?: number[]): number[][] {
    const work = copyWork(source);
    const costMap: number[][] = [];
    for (let x = 0; x < DCOLS; x++) {
        costMap[x] = new Array<number>(DROWS);
        for (let y = 0; y < DROWS; y++) costMap[x]![y] = work[x]![y] === 0 ? -2 : 1;
    }
    const seq = order ?? (() => {
        const o: number[] = [];
        for (let v = 0; v < DCOLS * DROWS; v++) o.push(v);
        return o;
    })();

    const dirs: ReadonlyArray<readonly [number, number]> =
        flaw === 'diagonal' ? [[1, 0], [0, 1], [1, 1], [1, -1]] : [[1, 0], [0, 1]];

    const scanner = new DijkstraMap(DCOLS, DROWS);
    const pathMap: number[][] = [];
    for (let x = 0; x < DCOLS; x++) pathMap[x] = new Array<number>(DROWS).fill(30000);

    for (let i = 0; i < seq.length; i++) {
        const x = Math.floor(seq[i]! / DROWS);
        const y = seq[i]! % DROWS;
        if (work[x]![y] !== 0) continue;
        for (const [dx, dy] of dirs) {
            const newX = x + dx!, oppX = x - dx!, newY = y + dy!, oppY = y - dy!;
            if (!inMap(newX, newY) || !inMap(oppX, oppY)) continue;
            if (flaw !== 'noFlankCheck' && !(work[newX]![newY] === WORK_FLOOR && work[oppX]![oppY] === WORK_FLOOR)) continue;
            for (let px = 0; px < DCOLS; px++) pathMap[px]!.fill(30000);
            pathMap[newX]![newY] = 0;
            scanner.batchScan(pathMap, costMap, false);
            const dist = pathMap[oppX]![oppY]!;
            const open = flaw === 'inverted'
                ? dist < MINIMUM_PATHING_DISTANCE
                : dist > MINIMUM_PATHING_DISTANCE;
            if (open) {
                work[x]![y] = WORK_DOOR_SITE;
                if (flaw !== 'noCostSync') costMap[x]![y] = 1;
                break;
            }
        }
    }
    return work;
}

/** 测试内洗牌：用生产同款 Fisher-Yates（rng.shuffleList），两变体共用同一候选序。 */
function testShuffle(order: number[]): void {
    rng.shuffleList(order);
}

/** 门位契约违例：门位不存在"正交轴两侧严格地板"的轴（CE Architect.c:371-372）。 */
function flankViolations(work: number[][]): Pos[] {
    const bad: Pos[] = [];
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (work[x]![y] !== WORK_DOOR_SITE) continue;
            const h = work[x - 1]?.[y] === WORK_FLOOR && work[x + 1]?.[y] === WORK_FLOOR;
            const v = work[x]?.[y - 1] === WORK_FLOOR && work[x]?.[y + 1] === WORK_FLOOR;
            if (!h && !v) bad.push({ x, y });
        }
    }
    return bad;
}

/** 门位的两侧地板轴（0=无 1=水平 2=垂直）。 */
function flankAxis(work: number[][], x: number, y: number): 0 | 1 | 2 {
    if (work[x - 1]?.[y] === WORK_FLOOR && work[x + 1]?.[y] === WORK_FLOOR) return 1;
    if (work[x]?.[y - 1] === WORK_FLOOR && work[x]?.[y + 1] === WORK_FLOOR) return 2;
    return 0;
}

/** C1 核心：work grid 上移除门位后，其两侧地板是否仍 4 向连通（环边判据）。 */
function stillConnectedWithoutSite(work: number[][], site: Pos): boolean {
    const axis = flankAxis(work, site.x, site.y);
    if (axis === 0) return false;
    const passable = (x: number, y: number): boolean => (work[x]?.[y] ?? 0) > 0;
    let ax: number, ay: number, bx: number, by: number;
    if (axis === 1) { ax = site.x - 1; ay = site.y; bx = site.x + 1; by = site.y; }
    else { ax = site.x; ay = site.y - 1; bx = site.x; by = site.y + 1; }
    const blocked = (x: number, y: number): boolean => (x === site.x && y === site.y) || !passable(x, y);
    const seen = new Set<number>([ay * DCOLS + ax]);
    const queue: Pos[] = [{ x: ax, y: ay }];
    while (queue.length > 0) {
        const p = queue.pop()!;
        if (p.x === bx && p.y === by) return true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nx = p.x + dx!, ny = p.y + dy!;
            if (!inMap(nx, ny) || blocked(nx, ny)) continue;
            const key = ny * DCOLS + nx;
            if (seen.has(key)) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return false;
}

/**
 * 割点判定（canMoveTo 口径的 8 向图）：把格 c 移除后，若存在某正交轴的
 * 两侧可通行邻格不再连通，则 c 是割点（树状走廊的中段格全是割点；环上的
 * 格不是）。返回 'noAxis' 表示不存在两侧都可通行的轴（贴墙/端头），不算。
 */
function cutVertexClass(grid: Grid, c: Pos): 'free' | 'cut' | 'noAxis' {
    const passable = (x: number, y: number): boolean => {
        if (x === c.x && y === c.y) return false;
        const cell = grid.getCell(x, y);
        return !!cell && terrainAllowsMove(cell.terrain);
    };
    const axes: Array<[Pos, Pos]> = [
        [{ x: c.x - 1, y: c.y }, { x: c.x + 1, y: c.y }],
        [{ x: c.x, y: c.y - 1 }, { x: c.x, y: c.y + 1 }],
    ];
    let anyAxis = false;
    for (const [a, b] of axes) {
        if (!passable(a.x, a.y) || !passable(b.x, b.y)) continue;
        anyAxis = true;
        const seen = new Set<number>([a.y * DCOLS + a.x]);
        const queue: Pos[] = [a];
        let reached = false;
        while (queue.length > 0) {
            const p = queue.pop()!;
            if (p.x === b.x && p.y === b.y) { reached = true; break; }
            for (const [dx, dy] of DIRS8) {
                const nx = p.x + dx!, ny = p.y + dy!;
                if (nx < 0 || ny < 0 || nx >= DCOLS || ny >= DROWS) continue;
                if (!passable(nx, ny)) continue;
                const key = ny * DCOLS + nx;
                if (seen.has(key)) continue;
                seen.add(key);
                queue.push({ x: nx, y: ny });
            }
        }
        if (!reached) return 'cut';
    }
    return anyAxis ? 'free' : 'noAxis';
}

/** work grid 口径（4 向、值>0 可通行）的割点占可通行格比例。 */
function articulationRateWork(work: number[][]): number {
    const passable = (x: number, y: number): boolean => (work[x]?.[y] ?? 0) > 0;
    let free = 0;
    let art = 0;
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            if (!passable(x, y)) continue;
            free++;
            let isArt = false;
            for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
                const ax = x - dx!, ay = y - dy!, bx = x + dx!, by = y + dy!;
                if (!passable(ax, ay) || !passable(bx, by)) continue;
                const seen = new Set<number>([ay * DCOLS + ax]);
                const queue: Pos[] = [{ x: ax, y: ay }];
                let reached = false;
                while (queue.length > 0) {
                    const p = queue.pop()!;
                    if (p.x === bx && p.y === by) { reached = true; break; }
                    for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
                        const nx = p.x + ddx!, ny = p.y + ddy!;
                        if (nx < 0 || ny < 0 || nx >= DCOLS || ny >= DROWS) continue;
                        if (nx === x && ny === y) continue;
                        if (!passable(nx, ny)) continue;
                        const key = ny * DCOLS + nx;
                        if (seen.has(key)) continue;
                        seen.add(key);
                        queue.push({ x: nx, y: ny });
                    }
                }
                if (!reached) { isArt = true; break; }
            }
            if (isArt) art++;
        }
    }
    return free > 0 ? art / free : 0;
}

function countLoopCells(loop: boolean[][]): number {
    let n = 0;
    for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) if (loop[x]![y]) n++;
    return n;
}

describe('C-0 地牢环路（addLoops）+ IN_LOOP', () => {

    it('A1 门位契约：真实关卡上每个门位都有正交轴两侧严格地板，且环路确实被开辟', () => {
        const violations: string[] = [];
        let totalSites = 0;
        let levelsWithLoops = 0;
        let levels = 0;
        stageSweep(SEEDS, (arch, _grid, seed, depth) => {
            levels++;
            const bad = flankViolations(arch.loopWorkGrid!);
            for (const p of bad) violations.push(`seed${seed}/D${depth}(${p.x},${p.y})`);
            totalSites += arch.loopDoorSites.length;
            if (arch.loopDoorSites.length > 0) levelsWithLoops++;
        });
        expect(
            violations,
            `门位缺"正交轴两侧地板"（候选格检查失效或试了对角）：${violations.length} 处\n` +
            violations.slice(0, 10).join('\n')
        ).toEqual([]);
        // 真实量级：web 生成器上扫描是稀疏开门（实测 ~36 门/130 层，约 1/3
        // 的层有 1 门）——阈值只需抓住"完全没开门"（addLoops 未运行/判据恒假）。
        // 数量级锚定由 A6 负责。
        expect(totalSites, `130 层合计新开门数=${totalSites}，过少 = addLoops 实际没有开门`).toBeGreaterThan(15);
        expect(levelsWithLoops, `含新环门的层数=${levelsWithLoops}/${levels}，过少`).toBeGreaterThan(20);
        console.log(`[c_0] A1 新开门合计=${totalSites}，含新环门层=${levelsWithLoops}/${levels}`);
    });

    it('A2/A3 对抗：漏"两侧地板"检查、试对角——两种错误实现在同批真实 grid 上都产生门位违例（守卫：断言非空转）', () => {
        for (const flaw of ['noFlankCheck', 'diagonal'] as const) {
            let flawViolations = 0;
            let flawSites = 0;
            stageSweep(HEAVY_SEEDS, (arch) => {
                const flawed = flawedScan(trueScanInput(arch), flaw);
                flawViolations += flankViolations(flawed).length;
                flawSites += flawed.flat().filter((v) => v === WORK_DOOR_SITE).length;
            });
            expect(
                flawViolations,
                `空转守卫失败：错误实现 ${flaw} 在真实 grid（52 层）上没有产生任何门位违例——` +
                `A1 的"违例=0"将无法捕获该错误实现，测试无牙`
            ).toBeGreaterThan(0);
            console.log(`[c_0] ${flaw}：门位=${flawSites} 违例=${flawViolations}`);
        }
    });

    it('A4 对抗（S-1 改造：锚定合成输入）：判据写反（< 而非 >）→ 蜂窝化，' +
        '门位总数暴涨（> 正确对照 ×3）', () => {
        // S-1 改造说明。原版把对照与写反变体都跑在 HEAVY_SEEDS 的 52 个真实
        // 层上——门位数本身随流位移重抽，比值守卫在随机地图上临界（C-6 实测
        // 2.978 vs 门槛 3，掷硬币式翻红）。S-1 改锚**合成工作网格**（0=墙
        // 1=地板，薄墙结构——真实地牢的形态），两个变体在同一常量输入上运行，
        // 门位数成为精确常量，比值守卫不再有抽样运气：
        //   A) 华夫格：内部 1 厚墙按 6 格划分 5×5 小间、每段墙中点开 1 格——
        //      任意内墙两侧的绕行距离都 < MINIMUM_PATHING_DISTANCE：
        //      correct（>20 才开）一门不开、inverted（<20 即开）每墙必开
        //      （蜂窝化的结构性形态，实测 190 门）。
        //   B) 双走道：y=6/y=8 两条走廊夹 1 厚墙，右端 x=76 竖连——离连接口
        //      越远侧壁距离越远：correct 在远端开真环边门（实测 2 门）、
        //      inverted 只在近端开冗余门（实测 8 门）。
        // 汇总（2026-09-17 S-1 实跑录制）：correct=6，inverted=198，比值 33×。
        // ×3 门槛保留（任务书"阈值不许松"），但因输入已常量化，门槛余量从
        // 临界 2.978 变为结构性 33×。有牙性：把本测试的 open 判据写反
        // （即 inverted 变体）后 correct/inverted 互换，ratio 断言立即翻红。
        const work: number[][] = [];
        for (let x = 0; x < DCOLS; x++) work[x] = new Array<number>(DROWS).fill(0);
        for (let x = 9; x <= 47; x++) {
            for (let y = 4; y <= 26; y++) {
                if (x % 6 === 0 || y % 6 === 0) continue;
                work[x]![y] = 1;
            }
        }
        for (const wx of [12, 18, 24, 30, 36, 42]) {
            for (const wy of [9, 15, 21]) work[wx]![wy] = 1; // 墙列中点开口
        }
        for (const wy of [6, 12, 18, 24]) {
            for (const wx of [15, 21, 27, 33, 39, 45]) work[wx]![wy] = 1; // 墙行中点开口
        }
        for (let x = 2; x <= 8; x++) for (let y = 15; y <= 16; y++) work[x]![y] = 1; // 入口走道
        for (const y of [6, 8]) for (let x = 50; x <= 76; x++) work[x]![y] = 1;
        for (let y = 6; y <= 8; y++) work[76]![y] = 1;

        const inMap = (x: number, y: number): boolean => x >= 0 && x < DCOLS && y >= 0 && y < DROWS;

        function scan(flaw: 'none' | 'inverted'): number[][] {
            const w = work.map((col) => col.slice());
            const costMap: number[][] = [];
            for (let x = 0; x < DCOLS; x++) {
                costMap[x] = new Array<number>(DROWS);
                for (let y = 0; y < DROWS; y++) costMap[x]![y] = w[x]![y] === 0 ? -2 : 1;
            }
            const scanner = new DijkstraMap(DCOLS, DROWS);
            const pathMap: number[][] = [];
            for (let x = 0; x < DCOLS; x++) pathMap[x] = new Array<number>(DROWS).fill(30000);
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    if (w[x]![y] !== 0) continue;
                    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
                        const nx = x + dx!, ox = x - dx!, ny = y + dy!, oy = y - dy!;
                        if (!inMap(nx, ny) || !inMap(ox, oy)) continue;
                        if (!(w[nx]![ny] === WORK_FLOOR && w[ox]![oy] === WORK_FLOOR)) continue;
                        for (let px = 0; px < DCOLS; px++) pathMap[px]!.fill(30000);
                        pathMap[nx]![ny] = 0;
                        scanner.batchScan(pathMap, costMap, false);
                        const dist = pathMap[ox]![oy]!;
                        const open = flaw === 'inverted'
                            ? dist < MINIMUM_PATHING_DISTANCE
                            : dist > MINIMUM_PATHING_DISTANCE;
                        if (open) {
                            w[x]![y] = WORK_DOOR_SITE;
                            costMap[x]![y] = 1;
                            break;
                        }
                    }
                }
            }
            return w;
        }

        const correctW = scan('none');
        const invertedW = scan('inverted');
        const count = (w: number[][]): number => w.flat().filter((v) => v === WORK_DOOR_SITE).length;
        const correct = count(correctW);
        const inverted = count(invertedW);
        let waffleInverted = 0;
        for (let x = 9; x <= 47; x++) {
            for (let y = 4; y <= 26; y++) {
                if (invertedW[x]![y] === WORK_DOOR_SITE) waffleInverted++;
            }
        }
        console.log(`[c_0] A4(合成输入) 正确对照=${correct} 判据写反=${inverted}（比值 ${(inverted / Math.max(1, correct)).toFixed(1)}×；华夫格 inverted=${waffleInverted}）`);

        // 常量输入 ⇒ 常量输出：偏移说明扫描器/判据变了（登记到报告再更新）。
        expect(correct, '正确对照门位数漂移（合成输入下应为常量 6：双走道真环边 2 + 华夫格远端 4）').toBe(6);
        expect(inverted, '判据写反变体门位数漂移（合成输入下应为常量 198）').toBe(198);
        expect(waffleInverted, '蜂窝化守卫：华夫格内 inverted 门位数应恒 190').toBe(190);
        expect(
            inverted,
            `判据写反的变体门位数=${inverted}，未暴涨（应 > 正确对照 ${correct} ×3）——A4 无牙`
        ).toBeGreaterThan(correct * 3);
    });

    it('A5 对抗：漏 costMap[x][y]=1 同步更新 → 后续候选用过时距离，门位合计严格偏多', () => {
        // 同序对比（洗牌序，两变体共用同一真实扫描输入）：漏同步时已开的
        // 门仍是 -2（不可通行），后续候选的绕行距离只增不减 → 更多候选越过
        // >20 门槛（可证明 noSync 门位集 ⊇ none 门位集）。
        let correct = 0;
        let noSync = 0;
        stageSweep(HEAVY_SEEDS, (arch) => {
            const input = trueScanInput(arch);
            const order: number[] = [];
            for (let v = 0; v < DCOLS * DROWS; v++) order.push(v);
            testShuffle(order);
            correct += flawedScan(input, 'none', order).flat().filter((v) => v === WORK_DOOR_SITE).length;
            noSync += flawedScan(input, 'noCostSync', order).flat().filter((v) => v === WORK_DOOR_SITE).length;
        });
        expect(
            noSync,
            `漏 costMap 同步的变体门位合计=${noSync}，未严格大于同序正确对照 ${correct}——` +
            `要么 A5 无牙，要么生产的同步更新不起作用（需排查）`
        ).toBeGreaterThan(correct);
        console.log(`[c_0] A5 同序正确对照=${correct} 漏同步=${noSync}（52 层合计）`);
    });

    it('B1 IN_LOOP 只出现在非阻挡格上（130 层逐格）', () => {
        const offenders: string[] = [];
        gameSweep(SEEDS, (game, seed, depth) => {
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    if (!game.loopMap[x]![y]) continue;
                    const cell = game.grid.getCell(x, y)!;
                    if (blocksPathing(cell)) {
                        offenders.push(`seed${seed}/D${depth}(${x},${y})=${TerrainType[cell.terrain]}`);
                    }
                }
            }
        });
        expect(
            offenders,
            `IN_LOOP 标在阻挡格上（analyzeMap 第 1 步口径写反）：\n${offenders.slice(0, 20).join('\n')}`
        ).toEqual([]);
    });

    it('B2 对抗：漏 checkLoopiness 剥离 → 整片可通行区被标环（loopFraction==passableFraction）；生产严格更小且上限受控', () => {
        let productionLoop = 0;
        let passable = 0;
        let maxFraction = 0;
        gameSweep(SEEDS, (game) => {
            let loop = 0;
            let free = 0;
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    const cell = game.grid.getCell(x, y)!;
                    if (blocksPathing(cell)) continue;
                    free++;
                    if (game.loopMap[x]![y]) loop++;
                }
            }
            productionLoop += loop;
            passable += free;
            if (free > 0) maxFraction = Math.max(maxFraction, loop / free);
        });
        expect(
            productionLoop,
            'IN_LOOP 合计 === 可通行格合计 = 漏了 checkLoopiness 剥离（整片可通行区被标环）'
        ).toBeLessThan(passable);
        expect(
            maxFraction,
            `单层 IN_LOOP 占可通行格比例峰值 ${(maxFraction * 100).toFixed(1)}% ≥ 50%——剥离逻辑可能失效`
        ).toBeLessThan(0.5);
        console.log(`[c_0] B2 IN_LOOP 合计=${productionLoop}/${passable}` +
            `（${((100 * productionLoop) / passable).toFixed(1)}%），单层峰值=${(maxFraction * 100).toFixed(1)}%`);
    });

    it('A6 生产锚定：生产新开门数落在 K=6 次同输入正确对照的散布带内（抓住生产侧的一切判据/同步/方向错误）', () => {
        // 对抗变体（A2-A5）只证明"正确 vs 错误"可区分；本条把**生产数据**
        // 锚定在正确一侧。对照只统计**新开**的门（输出 2 数 − 输入 2 数，
        // 输入里的 2 是 attachRooms 已落的门，不是扫描开的）。
        // 判据写反（数百×）、漏 costMap 同步（~8×）、试对角、漏地板检查
        // （数百×）的生产化实现都会越出散布带。
        const K = 6;
        let production = 0;
        const totals = new Array<number>(K).fill(0);
        stageSweep(HEAVY_SEEDS, (arch) => {
            production += arch.loopDoorSites.length;
            const input = trueScanInput(arch);
            const inputTwos = input.flat().filter((v) => v === WORK_DOOR_SITE).length;
            for (let k = 0; k < K; k++) {
                const order: number[] = [];
                for (let v = 0; v < DCOLS * DROWS; v++) order.push(v);
                testShuffle(order);
                const outTwos = flawedScan(input, 'none', order).flat().filter((v) => v === WORK_DOOR_SITE).length;
                totals[k]! += outTwos - inputTwos;
            }
        });
        const controlMin = Math.min(...totals);
        const controlMax = Math.max(...totals);
        expect(
            controlMax,
            '正确对照新开门数=0'
        ).toBeGreaterThan(0);
        expect(
            production,
            `生产新开门数=${production} 低于正确对照散布下界（min=${controlMin}）的 80%——生产可能漏开门`
        ).toBeGreaterThan(controlMin * 0.8);
        expect(
            production,
            `生产新开门数=${production} 超过正确对照散布上界（max=${controlMax}）的 120%——` +
            `生产侧可能判据写反/漏 costMap 同步/试对角/漏地板检查（对照 A2-A5 的各变体量级）`
        ).toBeLessThan(controlMax * 1.2);
        console.log(`[c_0] A6 生产=${production} 正确对照散布=[${controlMin}, ${controlMax}]（52 层合计，K=${K}）`);
    });

    it('C1 核心：真实环路存在——扫描开出的门位是真环边（移除后两侧仍连通 = 两条不共边路径）', () => {
        // CE Architect.c:377 的判据是 `pathMap[oppX][oppY] > minimumPathingDistance`，
        // 30000（两侧分属不同连通块）也满足——此时门位是"补桥"而非"环边"。
        // 真实输入恒连通（本轮探针实测 52/52 层 1 个连通块），故扫描开的门
        // 应当全部是真环边；若桥门成堆，说明扫描跑在了碎片化的错误输入上。
        // web 生成器上扫描是稀疏开门（~0.3 门/层），"每层至少一环"不成立，
        // 数量级问题由 A6 锚定；本条锚定"开出的门是真的环"。
        let cycleEdges = 0;
        let bridges = 0;
        stageSweep(HEAVY_SEEDS, (arch) => {
            const work = arch.loopWorkGrid!;
            for (const s of arch.loopDoorSites) {
                if (stillConnectedWithoutSite(work, s)) cycleEdges++;
                else bridges++;
            }
        });
        const totalSites = cycleEdges + bridges;
        expect(totalSites, '52 层新开门数=0').toBeGreaterThan(0);
        // 真实输入恒连通（实测），扫描开的门应全部是真环边；桥门成堆说明
        // 扫描在碎片化的错误输入上跑（或输入被错误还原）。
        expect(
            cycleEdges,
            `真环边=${cycleEdges}/${totalSites}（<80%）——大量门位不是环边`
        ).toBeGreaterThan(totalSites * 0.8);
        console.log(`[c_0] C1 新开门=${totalSites}，真环边=${cycleEdges}，桥=${bridges}`);
    });

    it('C2 对抗守卫 + 核心对照：树状对照（门位回填成墙）割点率显著高于生产——证明 C1/C2 断言有牙', () => {
        let prodRate = 0;
        let treeRate = 0;
        let n = 0;
        stageSweep(HEAVY_SEEDS, (arch) => {
            n++;
            const work = arch.loopWorkGrid!;
            // 树状对照 = 同一拓扑但 addLoops 的门位回填成墙（扫描输入态）。
            // 生产扫描只做 0→2 的改动，所以这是精确的"无 addLoops"反事实。
            const tree = copyWork(work);
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    if (tree[x]![y] === WORK_DOOR_SITE) tree[x]![y] = 0;
                }
            }
            prodRate += articulationRateWork(work);
            treeRate += articulationRateWork(tree);
        });
        expect(
            treeRate / n,
            `树状对照平均割点率 ${((treeRate / n) * 100).toFixed(1)}% 未严格高于生产 ` +
            `${((prodRate / n) * 100).toFixed(1)}%——环路没有降低割点率，C1 类断言无牙`
        ).toBeGreaterThan(prodRate / n);
        console.log(`[c_0] C2 work-grid 割点率：生产=${((prodRate / n) * 100).toFixed(1)}% ` +
            `树状对照=${((treeRate / n) * 100).toFixed(1)}%（52 层平均）`);
    });

    it('C3 末态对照：全管线关卡（经湖泊+机器）的可通行图割点率受控（树状退化即翻红）', () => {
        // 2026-09-15 校准（C-1 验收补做；失灵变体为生产代码临时改坏实测后
        // 还原，数据见 ai_docs/c_1_room_profile_report.md §验收补做）：
        //
        // 归因更正①（测量 bug）：旧断言报的"单层峰值 9.7%"其实是**跨层累计率**——
        // levelRate 用了累计的 artTotal/axisTotal（在 424242/D7 扫完时达到峰值，
        // 随后被低割点层稀释），并非单层值。真实单层分布（52 层，决定性生成）：
        // avg 4.95%、p95 13.22%、max 15.45%（424242/D7）。
        //
        // 归因更正②（不是 P1-33）：真实峰值层 424242/D7 无锁门、深水仅 5 格、
        // 主连通块占比 100%；52 层割点率前 5 名全是 D2-D9 浅层。把全部割点格
        // 按形态分类：100% 是"恰好两个相对正交邻格"的 1 宽走廊中段（0 例外），
        // 浅层（D1-9）割点率 7.7% vs 深层 3.1%。这是 CE 走廊房（attachHallwayTo）
        // + CE 深度曲线（浅层 corridorChance 90→70）的忠实形态——1 宽长走廊的
        // 中段格在拓扑上就是割点。旧阈值 8% 标定于 C-0 时代 corridorChance
        // 从未生效（走廊数为 0）的稀疏生成器，对齐 CE 后走廊首次出现，割点率
        // 上升是对齐的直接结果，不是环路机制失灵（C1/C2/A6 全绿互证）。
        //
        // 新阈值与失灵锚点（生产 vs 跳过 addLoops 的树状退化，同 52 层实测）：
        //   avg  4.95% vs 8.62%（+74%）；p95 13.22% vs 17.42%；max 15.45% vs 21.23%
        //   avg<6%：环路丢失约一半即翻红，树状退化稳红；
        //   p95<16%：个别极端层（允许 2/52 层越出）不假红，全线树状退化稳红。
        //   峰值保留为观测打印，不作断言（防个别极端层假红）。
        let artTotal = 0;
        let axisTotal = 0;
        const levelRates: number[] = [];
        gameSweep(HEAVY_SEEDS, (game) => {
            let art = 0;
            let axis = 0;
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    const cell = game.grid.getCell(x, y);
                    if (!cell || !terrainAllowsMove(cell.terrain)) continue;
                    const cls = cutVertexClass(game.grid, { x, y });
                    if (cls === 'noAxis') continue;
                    axis++;
                    axisTotal++;
                    if (cls === 'cut') { art++; artTotal++; }
                }
            }
            levelRates.push(art / Math.max(1, axis));
        });
        const avg = artTotal / axisTotal;
        const sorted = [...levelRates].sort((a, b) => a - b);
        const p95 = sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)]!;
        const maxRate = sorted[sorted.length - 1]!;
        expect(
            avg,
            `52 层平均割点率 ${(avg * 100).toFixed(1)}% ≥ 6%——地牢接近树状` +
            `（环路丢失或被机器抹平；同口径树状退化实测 8.62%）`
        ).toBeLessThan(0.06);
        expect(
            p95,
            `单层割点率 95 分位 ${(p95 * 100).toFixed(1)}% ≥ 16%——割点率分布整体右移，` +
            `尾部层已近乎树状（生产 p95 实测 13.22%，树状退化 17.42%；个别极端层不应触发本断言）`
        ).toBeLessThan(0.16);
        console.log(`[c_0] C3 末态割点=${artTotal}/${axisTotal}（平均 ${(avg * 100).toFixed(1)}%），` +
            `单层 p95=${(p95 * 100).toFixed(1)}%，峰值（观测）=${(maxRate * 100).toFixed(1)}%`);
    });

    it('D1 决定性：同种子两次生成 → 指纹/loopMap/门位/work grid 逐一一致', () => {
        for (const seed of [424242, 20260913]) {
            const fps1: string[] = [];
            gameSweep([seed], (game, _s, depth) => {
                fps1.push(`D${depth}:${terrainFingerprint(game.grid)}:${countLoopCells(game.loopMap)}`);
            });
            const fps2: string[] = [];
            gameSweep([seed], (game, _s, depth) => {
                fps2.push(`D${depth}:${terrainFingerprint(game.grid)}:${countLoopCells(game.loopMap)}`);
            });
            expect(fps2, `seed${seed} 两次全管线生成不一致（混入非种子随机源）`).toEqual(fps1);
        }
        for (const seed of [424242]) {
            const run = (): string[] => {
                const out: string[] = [];
                stageSweep([seed], (arch, _grid, _s, depth) => {
                    out.push(`D${depth}:${arch.loopDoorSites.map((p) => `${p.x},${p.y}`).join(';')}` +
                        `:${arch.loopWorkGrid!.flat().join('')}`);
                });
                return out;
            };
            expect(run(), `seed${seed} 两次地形阶段生成不一致`).toEqual(run());
        }
    });

    it('E1 门位落位：管线内门位从不落回墙；生产落位函数在真实门位拓扑上呈 60% 门分布', () => {
        // (a) 管线合法性：每个门位终态地形 ≠ GRANITE/WALL（从不重新封死）。
        //     门位落成的 FLOOR 可能被湖泊叠加层覆盖成可踩地形/深水——web 是
        //     单层地形，等价于 CE 的液体层叠在地形层上（连接性不变）。
        const rewall: string[] = [];
        stageSweep(SEEDS, (arch, grid, seed, depth) => {
            for (const s of arch.loopDoorSites) {
                const t = grid.getCell(s.x, s.y)!.terrain;
                if (t === TerrainType.GRANITE || t === TerrainType.WALL) {
                    rewall.push(`seed${seed}/D${depth}(${s.x},${s.y})=${TerrainType[t]}`);
                }
            }
        });
        expect(rewall, `门位被重新封死：\n${rewall.slice(0, 10).join('\n')}`).toEqual([]);

        // (b) 生产落位函数的 60% 分布：对真实新门位直接重跑
        //     applyLoopDoorSites（生产代码）。管线里的落位会被湖泊覆盖无法
        //     统计，故在这里用同一函数+真实门位坐标验证分布。
        let doors = 0;
        let floors = 0;
        let doorsAtDeepest = 0;
        let deepestSites = 0;
        stageSweep(HEAVY_SEEDS, (arch, grid, _seed, depth) => {
            const placed = applyLoopDoorSites(grid, arch.loopDoorSites, depth);
            for (const p of placed) {
                if (grid.getCell(p.x, p.y)!.terrain === TerrainType.DOOR) {
                    doors++;
                } else {
                    floors++;
                }
            }
            // U26a premise correction: MAX_DEPTH=26 is this sample's limit,
            // not CE deepestLevel=40. Exercise D40 on these same natural door sites.
            const terminalSites = applyLoopDoorSites(grid, arch.loopDoorSites, 40);
            deepestSites += terminalSites.length;
            doorsAtDeepest += terminalSites.filter(p => grid.getCell(p.x, p.y)!.terrain === TerrainType.DOOR).length;
        });
        expect(deepestSites).toBeGreaterThan(0);
        const rate = doors / (doors + floors);
        expect(
            rate,
            `DOOR 占比 ${(rate * 100).toFixed(1)}% 越界（期望 30%~90%，CE rand_percent(60)）——` +
            `恒开/恒关的错误实现都会越界`
        ).toBeGreaterThan(0.3);
        expect(rate).toBeLessThan(0.9);
        expect(
            doorsAtDeepest,
            '最深层 D40 出现了 DOOR——CE Architect.c:2903 的 depth<最深层 条件失效'
        ).toBe(0);
        console.log(`[c_0] E1 落位函数 DOOR=${doors} FLOOR=${floors}（${(rate * 100).toFixed(1)}%）`);
    });

    it('B3 safety map 集成：真实 loopMap 驱动 isInLoop（同谓词重算逐格一致 + 禁用变体可区分）', () => {
        let affected = 0;
        let totalCells = 0;
        let levelsAffected = 0;
        gameSweep(SEEDS, (game) => {
            game.updateSafetyMap();
            const real = game.safetyMap;
            // 同谓词重算：逐格一致（决定性对照——接线是纯函数消费，无隐藏状态）
            const rerun = buildSafetyMap({
                grid: game.grid,
                playerX: game.player.loc.x,
                playerY: game.player.loc.y,
                playerLevitating: game.player.hasStatus('levitating'),
                playerImmuneToFire: game.player.hasStatus('immune_fire'),
                monsterAt: (x, y) => game.getMonsterAt(x, y),
                isInLoop: (x, y) => game.loopMap[x]![y] === true,
            });
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    expect(real[x]![y]).toBe(rerun[x]![y]);
                }
            }
            // 禁用变体：-=10 支路真实生效则两图必然可区分
            const disabled = buildSafetyMap({
                grid: game.grid,
                playerX: game.player.loc.x,
                playerY: game.player.loc.y,
                playerLevitating: game.player.hasStatus('levitating'),
                playerImmuneToFire: game.player.hasStatus('immune_fire'),
                monsterAt: (x, y) => game.getMonsterAt(x, y),
                isInLoop: () => false,
            });
            let diff = 0;
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    if (real[x]![y] !== disabled[x]![y]) diff++;
                }
            }
            totalCells += DCOLS * DROWS;
            affected += diff;
            if (diff > 0) levelsAffected++;
        });
        expect(
            affected,
            '130 层里 safety map 与"禁用 IN_LOOP"变体完全相同——Time.c:1925-1927 的 -=10 支路没有真实生效'
        ).toBeGreaterThan(0);
        console.log(`[c_0] B3 IN_LOOP-=10 影响格=${affected}/${totalCells}` +
            `（${((100 * affected) / totalCells).toFixed(1)}%），受影响层=${levelsAffected}/130`);
    });

    it('B4 analyzeLoopMap 纯函数口径：Game.loopMap 与对末态网格直接重算一致（缓存层同口径）', () => {
        gameSweep([424242], (game, seed, depth) => {
            const recomputed = analyzeLoopMap(game.grid);
            for (let x = 0; x < DCOLS; x++) {
                for (let y = 0; y < DROWS; y++) {
                    expect(game.loopMap[x]![y]).toBe(recomputed[x]![y]);
                }
            }
            void seed; void depth;
        });
    });
});
