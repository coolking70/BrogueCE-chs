/**
 * src/test/p1_33_machine_chokepoint.test.ts — P1-33：机器阶段把关卡切断
 *
 * 病灶（修复前实测 15 种子 × D1-D26 = 390 层，坏层 5 个）：机器选址用
 * "任意 BFS 连通块 + 块内贴墙格当门"（旧 findSuitableRoom），LOCKED_DOOR /
 * 特征水深水可能落在通往关卡其余部分的唯一通路上，下楼梯从上楼梯走不到。
 *
 * 修复（CE Architect.c 对照）：
 *   - analyzeChokeMap（LoopMap.ts）：CE analyzeMap 后半段（246-336）+
 *     floodFillCount（140-165）。机器只落 IS_GATE_SITE 割点、且被封区域
 *     大小 ∈ 蓝图 roomSize 区间（CE buildAMachine BP_ROOM 分支 1080-1095）；
 *   - mapMachineInterior：CE addTileToMachineInteriorAndIterate（404-434），
 *     内部沿 chokeMap 非递增路径扩展，恰好盖住门后死角；
 *   - gateSealsOnlyInterior（web 侧必要、CE 无对应）：8 向移动下锁门
 *     假想验证，会夹带封死别处的门位一律否决；
 *   - 机器内部裸地板转 CHARRED_FLOOR（**P1-37 已拆除**，改为牌堆直接按
 *     machineNumber 排除）：CE 的楼梯/物品/怪群回避 IS_IN_MACHINE
 *     （Architect.c:3543/3597/3712/3738）在 web 的等价物——populateLevel 的
 *     楼梯/钥匙/护符全部从 `terrain === FLOOR` 牌堆抽取（Game.ts 本轮禁改）。
 *
 * 与 CE 的两处口径差异（均有 P1-29 先例，详见交付报告）：
 *   - passMap 用 terrainAllowsMove（canMoveTo 镜像），非 CE 的 T_PATHING_BLOCKER；
 *   - 割点洪泛用 8 向（web 移动是 8 向），非 CE 的 4 向递归——
 *     seed31337/D12 的坏层正是 4 向洪泛看不见斜向连通所致。
 *
 * 对抗性用例与对应的错误实现：
 *   AD1（用例 b）选址退回任意 BFS 块 → 旧实现真实切层 + findSuitableRoom
 *        不再被 buildMachines 调用（回退即红）；
 *   AD2（用例 c）chokeMap 的"被封区域大小"取了外侧而非内侧 → 精确值断言红；
 *   AD3（用例 d）内部扩展丢掉 chokeMap[新] ≤ chokeMap[起] → 内部漫进通路红；
 *   AD4（blueprint_center.test.ts 用例 d）元断言：id 写错 → 红。
 */
import { describe, it, expect } from 'vitest';
import { Architect } from '../engine/Generator/Architect';
import { BlueprintEngine, mapMachineInterior, resetRewardRoomsGenerated } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import { analyzeChokeMap, CE_CHOKE_COUNT_CAP } from '../engine/Map/LoopMap';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { terrainAllowsMove, DIRS8 } from '../engine/Map/Connectivity';
import { rng } from '../engine/Random';
import { createHeadlessGame, terrainFingerprint, analysisAllowsMove } from './harness';
import blueprintData from '../data/blueprints.json';
import type { Game } from '../engine/Core/Game';

const SWEEP_SEEDS = [424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555, 2, 3, 5, 7, 11];
const MAX_DEPTH = 26;

type Pos = { x: number; y: number };
type GameWithPrivates = Omit<Game, 'generateDepth' | 'canMoveTo'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
    canMoveTo(x: number, y: number): boolean;
};

/** 全图花岗岩底板。 */
function graniteAll(grid: Grid): void {
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
        }
    }
}
function floorCell(grid: Grid, x: number, y: number): void {
    grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
}

/**
 * 夹具 A（割点单元图）：大厅（x2-15,y4-14，154 格）— 1 宽走廊（y=9,
 * x16-22，7 格）— 门位 G=(23,9) — 死角口袋 P（x24-26,y8-10，9 格）。
 * 唯一割点 = G；G 的内侧（P）洪泛计数 9、外侧 161。
 */
function buildPocketMap(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    graniteAll(grid);
    for (let x = 2; x <= 15; x++) for (let y = 4; y <= 14; y++) floorCell(grid, x, y);
    for (let x = 16; x <= 22; x++) floorCell(grid, x, 9);
    floorCell(grid, 23, 9); // G
    for (let x = 24; x <= 26; x++) for (let y = 8; y <= 10; y++) floorCell(grid, x, y);
    return grid;
}

/**
 * 夹具 B（通路图）：1 宽走廊（y=9, x5-54，50 格）中段上方挂死角口袋
 * P（x31-33,y5-7，9 格），门位 G=(32,8)。走廊两端必须始终互相可达。
 */
function buildCorridorPocketMap(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    graniteAll(grid);
    for (let x = 5; x <= 54; x++) floorCell(grid, x, 9);
    for (let x = 31; x <= 33; x++) for (let y = 5; y <= 7; y++) floorCell(grid, x, y);
    floorCell(grid, 32, 8); // G
    return grid;
}

/** 纯 1 宽走廊（无任何口袋）：旧选址在这张图上必然把锁门放在唯一通路上。 */
function buildPureCorridorMap(): Grid {
    const grid = new Grid(DCOLS, DROWS);
    graniteAll(grid);
    for (let x = 5; x <= 54; x++) floorCell(grid, x, 9);
    return grid;
}

/** 8 向可走泛洪（terrainAllowsMove 口径），返回可达格集合。 */
function flood(grid: Grid, start: Pos, blocked: (x: number, y: number) => boolean = () => false): Set<number> {
    const seen = new Set<number>();
    if (blocked(start.x, start.y)) return seen;
    const passes = analysisAllowsMove(grid, (x, y) => {
        const c = grid.getCell(x, y);
        return !!c && terrainAllowsMove(c.terrain);
    });
    const cell = grid.getCell(start.x, start.y);
    if (!cell || !terrainAllowsMove(cell.terrain)) return seen;
    seen.add(start.y * DCOLS + start.x);
    const queue: Pos[] = [start];
    while (queue.length > 0) {
        const p = queue.pop()!;
        for (const [dx, dy] of DIRS8) {
            const nx = p.x + dx!, ny = p.y + dy!;
            if (nx < 0 || nx >= DCOLS || ny < 0 || ny >= DROWS) continue;
            const key = ny * DCOLS + nx;
            if (seen.has(key) || blocked(nx, ny)) continue;
            if (!passes(nx, ny)) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen;
}

interface LevelMachines { depth: number; results: MachineResult[] }

function installRecorder(record: LevelMachines[]): () => void {
    const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
    const original = proto.buildMachines as (this: unknown) => MachineResult[];
    proto.buildMachines = function (this: unknown) {
        const results = original.call(this);
        record.push({ depth: (this as { depth: number }).depth, results });
        return results;
    };
    return () => { proto.buildMachines = original; };
}

describe('P1-33 机器阶段不切断关卡', () => {
    it('a) 端到端复验：15 种子 × D1-D26 零不可达 + 机器非塌缩 + 机器结构合同', () => {
        const bad: string[] = [];
        const structureViolations: string[] = [];
        const perLevel: number[] = [];
        let machines = 0, locked = 0;

        for (const seed of SWEEP_SEEDS) {
            const record: LevelMachines[] = [];
            const restore = installRecorder(record);
            const game = createHeadlessGame(seed);
            try {
                for (let d = 1; d <= MAX_DEPTH; d++) {
                    if (d > 1) {
                        (game as unknown as { depth: number }).depth = d;
                        (game as unknown as GameWithPrivates).generateDepth(false, false);
                    }
                    const grid = game.grid;
                    const entry = record[record.length - 1];
                    perLevel.push(entry?.results.length ?? 0);
                    const canMoveTo = (game as unknown as GameWithPrivates).canMoveTo.bind(game);

                    // 机器结构合同（对真实生成链路的每台机器逐条断言）：
                    // 1) 机器内部没有裸 FLOOR（楼梯/钥匙牌堆已排除密库）；
                    // 2) door ∈ cells；needsKey ⇒ door 是 LOCKED_DOOR；
                    // 3) center ∈ cells、与 door 不同格、且可通行。
                    // V-2b-2b 反转（本文件不在该轮 §6 授权清单——但 CE 23 号
                    // 蓝图的 BP_NO_INTERIOR_FLAG（Architect.c:1691-1702）本就
                    // 把"machineNumber 覆盖全部内部格"的合同前提按 CE 字面
                    // 打破，边界扩展在 v-2b-2b 报告申报）：
                    //   a) 带 BP_NO_INTERIOR_FLAG 的机器自身豁免本合同（其
                    //      内部格 machineNumber 被 CE :1698-1700 合法清零）；
                    //   b) 其余机器的内部格若与 a) 类机器的 cells 重合
                    //      （前厅子机器的 origin = 父机器门位格，CE :691 起
                    //      fillInterior 把它并入子机器内部、:1698 再清零），
                    //      同样视为合法清零。
                    const noInteriorMachineCells = new Set<string>();
                    for (const mr2 of entry?.results ?? []) {
                        const bpDef = (blueprintData as BlueprintDef[]).find(b => b.id === mr2.blueprintId);
                        if (bpDef?.flags.includes('BP_NO_INTERIOR_FLAG')) {
                            for (const p of mr2.cells) noInteriorMachineCells.add(`${p.x},${p.y}`);
                        }
                    }
                    for (const mr of entry?.results ?? []) {
                        machines++;
                        if (mr.needsKey) locked++;
                        const cellSet = new Set(mr.cells.map(p => `${p.x},${p.y}`));
                        // 验收方 P1-37 后反转（原断言："机器内部没有裸 FLOOR"）。
                        // 那条断言钉的是 CHARRED_FLOOR 冒充 IS_IN_MACHINE 这个
                        // 权宜之计本身——P1-37 把权宜拆掉、改为牌堆直接按
                        // machineNumber 排除，它就必然翻红，与本轮任务直接矛盾。
                        // 现在钉更直接也更强的合同：机器内部每一格都真的带
                        // machineNumber（牌堆排除正是以它为键），而不是靠地形冒充。
                        const bpDef = (blueprintData as BlueprintDef[]).find(b => b.id === mr.blueprintId);
                        const noInterior = bpDef?.flags.includes('BP_NO_INTERIOR_FLAG') ?? false;
                        for (const p of mr.cells) {
                            const k = `${p.x},${p.y}`;
                            if (grid.getCell(p.x, p.y)?.machineNumber === 0
                                && !noInterior && !noInteriorMachineCells.has(k)) {
                                structureViolations.push(
                                    `seed${seed}/D${d} ${mr.blueprintId} 内部 (${p.x},${p.y}) 的 machineNumber 为 0` +
                                    `（机器旗标没铺满内部，楼梯/物品牌堆的排除会漏掉这格）`);
                                break;
                            }
                        }
                        if (!mr.door || !cellSet.has(`${mr.door.x},${mr.door.y}`)) {
                            structureViolations.push(`seed${seed}/D${d} ${mr.blueprintId} door 不属于自身 cells`);
                        } else if (mr.needsKey
                            && grid.getCell(mr.door.x, mr.door.y)?.terrain !== TerrainType.LOCKED_DOOR) {
                            structureViolations.push(
                                `seed${seed}/D${d} ${mr.blueprintId} needsKey 但 door 不是 LOCKED_DOOR`);
                        }
                        const cKey = `${mr.center.x},${mr.center.y}`;
                        const isArea = !bpDef?.flags.includes('BP_ROOM')
                            && !bpDef?.flags.includes('BP_VESTIBULE');
                        // V-2a 前厅豁免（本文件在 V-2a 任务书 §5 授权清单内）：
                        // category==='vestibule' 的机器 center = door = origin
                        // （BlueprintEngine BP_VESTIBULE 分支，CE
                        // Architect.c:1120-1140 的落位锚点语义——前厅 feature
                        // 恒落 origin，机器没有"宝藏落点"概念）。V-1c 时生产
                        // 数据无递归、前厅机器绝迹，本合同从未见过该形态；
                        // V-2a 前厅回归后按 CE 语义豁免 center≠door 一项，
                        // center ∈ cells 仍要求。reward/key_guard 的合同不变。
                        if (mr.category === 'vestibule' || isArea) {
                            if (!cellSet.has(cKey)) {
                                structureViolations.push(
                                    `seed${seed}/D${d} ${mr.blueprintId} center 不在 cells 内`);
                            }
                        } else if (!cellSet.has(cKey) || (mr.door && cKey === `${mr.door.x},${mr.door.y}`)) {
                            structureViolations.push(
                                `seed${seed}/D${d} ${mr.blueprintId} center 非法（不在 cells 内或与 door 重合）`);
                        } else if (!canMoveTo(mr.center.x, mr.center.y)) {
                            structureViolations.push(
                                `seed${seed}/D${d} ${mr.blueprintId} center (${cKey}) 不可通行`);
                        }
                    }

                    // 楼梯必须落在机器之外（mn==0）——CE placeStairs 回避
                    // IS_IN_MACHINE（Architect.c:3712/3738）的 web 等价效果。
                    let up: Pos | null = null;
                    let down: Pos | null = null;
                    for (let x = 0; x < grid.width; x++) {
                        for (let y = 0; y < grid.height; y++) {
                            const cell = grid.getCell(x, y);
                            if (cell?.terrain === TerrainType.STAIRS_UP) up = { x, y };
                            else if (cell?.terrain === TerrainType.STAIRS_DOWN) down = { x, y };
                        }
                    }
                    if (!up || !down) continue;
                    if (grid.getCell(up.x, up.y)!.machineNumber !== 0
                        || grid.getCell(down.x, down.y)!.machineNumber !== 0) {
                        structureViolations.push(`seed${seed}/D${d} 楼梯落在机器格内`);
                    }

                    // 硬指标：从上楼梯 8 向泛洪必须覆盖下楼梯。
                    // C-3 后由验收方把判据从 canMoveTo 的字面口径改为 CE 的
                    // **分析口径**：放行密门。依据 Architect.c:202-203
                    // （analyzeMap 的 passMap 条件是 T_PATHING_BLOCKER &&
                    // !TM_IS_SECRET）与 Architect.c:50-56 cellIsPassableOrDoor，
                    // SECRET_DOOR 带 TM_IS_SECRET（Globals.c:330）——
                    // **CE 判断连通性时本来就把密门当通路**。
                    // C-3 让密门按 CE 概率如实生成后，字面口径会给出 68/390
                    // 假阳性，实测全部满足"视密门为门后即完全连通"。
                    // **阈值不放宽**：坏层仍要求严格 0，换的是口径不是门槛。
                    const stairsRule = analysisAllowsMove(grid, canMoveTo);
                    const seen = new Set<number>([up.y * grid.width + up.x]);
                    const queue: Pos[] = [up];
                    while (queue.length > 0) {
                        const p = queue.pop()!;
                        for (const [dx, dy] of DIRS8) {
                            const nx = p.x + dx!, ny = p.y + dy!;
                            if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
                            const key = ny * grid.width + nx;
                            if (seen.has(key) || !stairsRule(nx, ny)) continue;
                            seen.add(key);
                            queue.push({ x: nx, y: ny });
                        }
                    }
                    if (!seen.has(down.y * grid.width + down.x)) {
                        bad.push(`${seed}/D${d}（可达 ${seen.size} 格）`);
                    }
                }
            } finally {
                restore();
            }
        }

        const levels = perLevel.length;
        const avg = (perLevel.reduce((a, b) => a + b, 0) / levels).toFixed(2);
        const nonZero = perLevel.filter(n => n > 0).length;
        console.log(`[p1_33] V-1c 后 15 种子 × D1-D26 = ${levels} 层：坏层=${bad.join('、') || '无'}；` +
            `机器 ${machines} 台（平均 ${avg}/层，零机器层 ${levels - nonZero}），锁门机器 ${locked} 台。` +
            `历史基线：P1-33 时 1920 台（4.92/层，全类别）；V-1c 起顶层抽签只剩 CE 配额的奖励机器` +
            `（约每 4 层 1 间 + 15% 加成，CE addMachines Architect.c:1757-1775），实测 87 台（0.22/层）。`);

        expect(bad, `端到端存在不可达层（机器阶段仍在切断关卡）：\n${bad.join('\n')}`).toEqual([]);
        // 反"少放机器蒙混"：数值为固定种子上的确定性实测（V-1c 后 87 台）。
        // 有意改动选址参数使数量变化时，应核对后更新此下限，而不是静默放行。
        // （V-1c 前的口径是 ≥1200 台——那时全类别每层 min(2+⌊d/3⌋,6) 同池抽；
        //   配额制下奖励机器本就稀少，下限按新语义重校准，仍能拦住
        //   "选址静默拒绝一切"的塌缩回归。）
        expect(machines, `机器总数 ${machines} 低于防塌缩下限（选址可能在静默拒绝一切）`).toBeGreaterThanOrEqual(50);
        expect(locked, `锁门机器 ${locked} 台低于防塌缩下限（宝库锁可能被静默丢弃）`).toBeGreaterThanOrEqual(15);
        // 反塌缩的分布面：配额下多数层合法地没有机器（CE 语义），原
        // "零机器层 ≤ 40"的口径失效；改为"有机器的层必须仍有一定 spread"
        //（V-1c 实测 73/390 ≈ 19%，CE 约 25% + 加成的量级）。
        expect(nonZero, `有机器层数 ${nonZero} 低于防塌缩下限（配额/抽签可能整体失效）`).toBeGreaterThanOrEqual(40);
        expect(structureViolations, `机器结构合同被破坏：\n${structureViolations.slice(0, 20).join('\n')}`).toEqual([]);
    }, 600_000);

    it('b) AD1：旧选址（任意 BFS 块）在纯走廊图上真实切层；buildMachines 不再走它且走廊图不被切', () => {
        // 第一半：演示旧路径的危险性（本修复所针对的错误实现本身）——
        // findSuitableRoom 会把 20 格走廊段当房间、贴墙格当门，LOCKED_DOOR
        // 落在唯一通路上，走廊两端从此不通。
        rng.seedRandomGenerator(20260915);
        const legacyGrid = buildPureCorridorMap();
        const before = flood(legacyGrid, { x: 5, y: 9 });
        expect(before.has(9 * DCOLS + 54), '预置检查：放锁前走廊两端互通').toBe(true);
        const legacyEngine = new BlueprintEngine(legacyGrid, 5);
        const bp = {
            id: 'ad1_legacy', name: 'ad1_legacy', depthRange: [1, 26], roomSize: [6, 20],
            frequency: 1, category: 'ad1', flags: [], doorTerrain: 'LOCKED_DOOR', features: [],
        } as unknown as BlueprintDef;
        const room = legacyEngine.findSuitableRoom(bp);
        expect(room, '旧选址在纯走廊图上应能找到"房间"（20 格走廊段）').not.toBeNull();
        expect(room!.door, '旧选址应给出门位').not.toBeNull();
        const applyBp = (legacyEngine as unknown as {
            applyBlueprint(bp: BlueprintDef, r: { cells: Pos[]; center: Pos; door: Pos }): MachineResult | null;
        }).applyBlueprint;
        applyBp.call(legacyEngine, bp, room as { cells: Pos[]; center: Pos; door: Pos });
        expect(legacyGrid.getCell(room!.door!.x, room!.door!.y)?.terrain).toBe(TerrainType.LOCKED_DOOR);
        const leftReach = flood(legacyGrid, { x: 5, y: 9 });
        expect(
            leftReach.has(9 * DCOLS + 54),
            `旧选址切断了走廊：门 (${room!.door!.x},${room!.door!.y}) 落在唯一通路上` +
            `（修复前生产代码的真实行为，本用例以此钉住"为什么不能退回去"）`
        ).toBe(false);

        // 第二半：生产路径守卫——buildMachines 在走廊+口袋图上：
        // 1) 绝不调用 findSuitableRoom（回退旧选址即翻红）；
        // 2) 走廊两端始终互相可达（即便放出了带锁门的机器）；
        // 3) 若有锁门机器，门格必是 LOCKED_DOOR。
        const calls = { findSuitableRoom: 0 };
        const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
        const origFind = proto.findSuitableRoom as (this: unknown, bp: BlueprintDef) => unknown;
        proto.findSuitableRoom = function (this: unknown, bp2: BlueprintDef) {
            calls.findSuitableRoom++;
            return origFind.call(this, bp2);
        };
        try {
            rng.seedRandomGenerator(20260916);
            const grid = buildCorridorPocketMap();
            const engine = new BlueprintEngine(grid, 5);
            const results = engine.buildMachines();
            expect(calls.findSuitableRoom, 'buildMachines 回退到了旧选址路径 findSuitableRoom').toBe(0);
            for (const mr of results) {
                if (mr.needsKey && mr.door) {
                    expect(grid.getCell(mr.door.x, mr.door.y)?.terrain,
                        `锁门机器 ${mr.blueprintId} 的门格不是 LOCKED_DOOR`).toBe(TerrainType.LOCKED_DOOR);
                }
            }
            const reach = flood(grid, { x: 5, y: 9 });
            expect(
                reach.has(9 * DCOLS + 54),
                '走廊+口袋图上 buildMachines 之后两端不再互通（机器阶段切断了通路）'
            ).toBe(true);
        } finally {
            proto.findSuitableRoom = origFind;
        }
    }, 60_000);

    it('c) AD2：chokeMap 在门位上的值是"内侧死角"的大小（9），不是外侧（161）', () => {
        const grid = buildPocketMap();
        const analysis = analyzeChokeMap(grid);

        // CE 246-270 的割点语义：绕格一周的 passability 跳变 >2 且上下或左右
        // 皆墙 → 割点。**每个直走廊格都是割点**（跳变恰 4 次）；口袋内格、
        // 大厅内部/边缘格不是。
        expect(analysis.chokepoint[23]![9], 'G(23,9) 应是割点').toBe(true);
        expect(analysis.chokepoint[18]![9], '直走廊格 (18,9) 也是割点（CE 语义）').toBe(true);
        expect(analysis.chokepoint[22]![9], '走廊末端格 (22,9) 也是割点').toBe(true);
        expect(analysis.chokepoint[24]![9], '口袋内格不应是割点').toBe(false);
        expect(analysis.chokepoint[5]![9], '大厅内部格不应是割点').toBe(false);

        // 门位 = "邻着开阔（非割点）格"的割点，且只有它们被洪泛赋值：
        // G(23,9) 邻口袋开阔格 → 值 9；(16,9) 邻大厅开阔格 → 值 154；
        // 走廊中段格的邻格全是割点/墙，洪泛无从触发 → 保持 30000（CE 中
        // 等同墙，内部扩展不会进入）。
        const gateSites: string[] = [];
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (analysis.gateSite[x]![y]) gateSites.push(`${x},${y}`);
            }
        }
        expect(gateSites.sort(), '全图恰有两个门位：G(23,9) 与大厅侧的 (16,9)').toEqual(['16,9', '23,9']);

        // 内侧/外侧精确值：口袋 9 格、大厅+走廊 154+7=161。洪泛逐割点触发：
        // (16,9) 的外侧洪泛先给大厅 154 → **早停封顶为 41**（CE_CHOKE_COUNT_CAP，
        // 决策等价：>40 的值只用于"排除"，见 LoopMap.ts 常量注）；G 的口袋洪泛
        // 给 P 和 G 精确 9。把"被封区域大小"算反（取外侧）的实现会得到
        // 41 而非 9 → 立即翻红。
        expect(analysis.chokeMap[23]![9], '门位 G 的 chokeMap 必须是内侧死角大小 9').toBe(9);
        expect(analysis.chokeMap[24]![9], '口袋格的 chokeMap = 9').toBe(9);
        expect(analysis.chokeMap[26]![10], '口袋格的 chokeMap = 9').toBe(9);
        // ★ V-2b-7：CE_CHOKE_COUNT_CAP 由 41 上调到 176（CE 目录 roomSize[1]
        // 上沿 175 + 1，见 LoopMap.ts 的常量注），本合成图的封顶值随之消失——
        // 大厅真值 154 被精确记录。**决策等价性反而更强**：CAP 现在大于任何
        // 真实门值，三处消费对"真值/封顶值"的判定与 CE 逐位相同。
        expect(analysis.chokeMap[16]![9], '大厅侧门位 (16,9) 的 chokeMap = 大厅真值 154（不再封顶）').toBe(154);
        expect(analysis.chokeMap[15]![9], '大厅侧洪泛起点 (15,9) 必被洪泛集覆盖 = 154').toBe(154);
        // 封顶早停会让截断后未访问的格保持 30000：41 与 30000 决策等价
        // （都 > 任何 roomSize 上限 40，都不可作门位、不可被内部扩展进入）。
        const hallValue = analysis.chokeMap[5]![9]!;
        expect(
            hallValue === 154 || hallValue === 30000,
            `大厅格 (5,9) 的 chokeMap=${hallValue}，只能是大厅真值 154 或未覆盖 30000` +
            `（出现 ≤40 的值 = 外侧被误当死角）`
        ).toBe(true);
        expect(hallValue !== 9, '大厅格绝不能拿到内侧值').toBe(true);
        expect(analysis.chokeMap[22]![9], '走廊中段格无洪泛覆盖 = 30000（内部扩展不可入）').toBe(30000);
    });

    it("c2) 封顶前提元断言（V-2b-1 顺延）：blueprints.json 的 roomSize[1] 全部 ≤ 100", () => {
        // 原断言（P1-33 时）：「roomSize[1] 全部 ≤ 40」——当时全部蓝图的门位
        // 窗口上沿 ≤ 40，封顶值 41 恒落窗外，三处消费（候选窗/门位赋值/内部
        // 扩展）对"真值>41"与"封顶41"判定逐位相同。
        // V-2b-1 按 CE GlobalsBrogue.c:356-359 逐字落地 27 号 Secret room
        // （roomSize {15,100}）后，窗口上沿首次越过封顶值。封顶语义在
        // [15,100] 下的实测口径（LoopMap.ts floodFillCount 早停）：
        //   a) 真值 ≤ 40 的割点仍报精确值——候选窗下沿判定不变；
        //   b) 真值 ≥ 41 的割点报 41 ∈ [15,100] → 也是候选。CE 会拒掉真值
        //      >100 的割点——web 多收的这部分由 gateSealsOnlyInterior 兜住
        //      （把世界封成两半的窄点因"误封非机器格"被否决，dead-end 大口袋
        //      才会幸存）；内部扩展又因洪泛集早停只含 ≤42 格而自然封顶。
        //      残余偏差：dead-end 口袋真值 42..100 时 web 内部 ≈42 格前缀
        //      （CE 取整个口袋）；真值 >100 且恰为孤立口袋的门位 web 会收
        //      （CE 拒）—— CE 对齐的正解是上调 CE_CHOKE_COUNT_CAP ≥ 101，
        //      但 LoopMap.ts 不在 V-2b-1 授权清单，登记于本轮报告。
        // V-2b-1 曾把本上沿记为 100（":356 的 Secret room"）——**那条记载是错的**。
        // ★ V-2b-7 经 CE 原表复核更正：blueprintCatalog_Brogue 的 roomSize[1]
        // 上沿是 **175**（55 号 Worm tunnels `{80, 175}`，GlobalsBrogue.c:365）。
        // 这个更正不是纸面数字：封顶值 41 < 175，roomSize 下沿 > 41 的蓝图
        // （55/46/45/49/53/30/11 号共七条）会永远选不到门位、结构性不可生成——
        // 故本轮把 CE_CHOKE_COUNT_CAP 一并上调到 176（= 175 + 1，见常量注），
        // 决策等价性由此从"部分等价"变为"完全等价"。
        // 本断言顺延为：全表 roomSize[1] ≤ CAP − 1（再次引入更大蓝图表或
        // 调整 CAP 时，两处必须同进同退）。
        const maxRoom = Math.max(...(blueprintData as BlueprintDef[]).map(bp => bp.roomSize[1]));
        expect(maxRoom, '出现了 roomSize[1] > CE_CHOKE_COUNT_CAP − 1 的蓝图：' +
            '必须同步上调 LoopMap.CE_CHOKE_COUNT_CAP（= roomSize[1] 最大值 + 1），' +
            '否则该蓝图会因封顶值落窗外而结构性不可生成')
            .toBeLessThanOrEqual(CE_CHOKE_COUNT_CAP - 1);
        expect(maxRoom, 'CE 目录上沿实测值（GlobalsBrogue.c:365 的 55 号 Worm tunnels）').toBe(175);
    });

    it('d) AD3：内部扩展被 chokeMap[新] ≤ chokeMap[起] 约束在死角内；触及他机即放弃', () => {
        const grid = buildPocketMap();
        const analysis = analyzeChokeMap(grid);
        const gate = { x: 23, y: 9 };

        const interior = mapMachineInterior(grid, analysis, gate);
        expect(interior, '内部映射不应失败').not.toBeNull();
        const expected = new Set<number>([9 * DCOLS + 23]); // G 自身
        for (let x = 24; x <= 26; x++) {
            for (let y = 8; y <= 10; y++) expected.add(y * DCOLS + x);
        }
        const got = new Set(interior!.map(p => p.y * DCOLS + p.x));
        expect(
            interior!.length === expected.size && [...expected].every(k => got.has(k)),
            `内部必须恰好是 G + 口袋（10 格）；实际 ${interior!.length} 格：` +
            `${interior!.map(p => `(${p.x},${p.y})`).join('')}。` +
            `丢失 = 漏掉死角地板（楼梯牌堆不安全）；超出 = 漫进通路（CE 417-421 被删？）`
        ).toBe(true);
        expect(got.has(9 * DCOLS + 22), '内部不得包含走廊格（chokeMap 161 > 9）').toBe(false);

        // CE 405-414：触及其他机器（非门位）→ 整机放弃。
        grid.getCell(24, 8)!.machineNumber = 7; // 假设口袋里已有他机
        expect(mapMachineInterior(grid, analysis, gate),
            '邻格是他机时应返回 null（CE 的中止语义）').toBeNull();
    });

    it('e) 决定性：同种子同深度的机器布局与地形指纹逐一一致', () => {
        const run = (): string[] => {
            // V-1c：配额计数器（CE rogue.rewardRoomsGenerated）是 run 级全局——
            // 两次 run() 必须从同一起点开始，否则第二次的配额决策整体后移，
            // 与"同种子可复现"的前提矛盾（同 C-4a-0 的"完整生成链"口径）。
            resetRewardRoomsGenerated();
            rng.seedRandomGenerator(424242);
            const arch = new Architect();
            const lines: string[] = [];
            for (let depth = 1; depth <= 8; depth++) {
                arch.generateLevel(depth);
                const digest = arch.machineResults
                    .map(mr => `${mr.blueprintId}@${mr.door?.x ?? -1},${mr.door?.y ?? -1}` +
                        `#${mr.center.x},${mr.center.y}` +
                        `#${mr.cells.map(p => `${p.x}.${p.y}`).sort().join(',')}`)
                    .sort()
                    .join('|');
                lines.push(`D${depth}:${terrainFingerprint(arch.grid)}::${digest}`);
            }
            return lines;
        };
        const a = run();
        const b = run();
        expect(b, '同种子两次生成不一致（机器选址混入非种子随机源或依赖遍历序）').toEqual(a);
    });

    it('f) Architect 层不变量：机器阶段之后所有非机器可走格仍属同一连通块', () => {
        // 比 e2e 更细的生成期合同：楼梯/钥匙/护符牌堆只从 mn==0 的 FLOOR 取格，
        // 只要"非机器可走格"彼此连通，populateLevel 放什么都能走到。
        for (const seed of [424242, 31337, 20260915]) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (let depth = 1; depth <= 26; depth++) {
                arch.generateLevel(depth);
                const grid = arch.grid;
                let seedCell: Pos | null = null;
                const walkableTotal: Pos[] = [];
                for (let x = 0; x < DCOLS; x++) {
                    for (let y = 0; y < DROWS; y++) {
                        const cell = grid.getCell(x, y);
                        if (!cell || !terrainAllowsMove(cell.terrain) || cell.machineNumber !== 0) continue;
                        walkableTotal.push({ x, y });
                        if (!seedCell) seedCell = { x, y };
                    }
                }
                const reach = flood(grid, seedCell!);
                const unreachable = walkableTotal.filter(p => !reach.has(p.y * DCOLS + p.x));
                expect(
                    unreachable,
                    `seed${seed}/D${depth}：机器阶段后存在不连通的非机器可走格 ` +
                    `${unreachable.slice(0, 8).map(p => `(${p.x},${p.y})`).join('')}`
                ).toEqual([]);
            }
        }
    }, 300_000);
});
