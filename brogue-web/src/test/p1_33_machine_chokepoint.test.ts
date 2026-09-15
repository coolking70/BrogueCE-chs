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
import { BlueprintEngine, mapMachineInterior } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import { analyzeChokeMap } from '../engine/Map/LoopMap';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { terrainAllowsMove, DIRS8 } from '../engine/Map/Connectivity';
import { rng } from '../engine/Random';
import { createHeadlessGame, terrainFingerprint } from './harness';
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
            const c = grid.getCell(nx, ny);
            if (!c || !terrainAllowsMove(c.terrain)) continue;
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
                        for (const p of mr.cells) {
                            if (grid.getCell(p.x, p.y)?.machineNumber === 0) {
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
                        if (!cellSet.has(cKey) || (mr.door && cKey === `${mr.door.x},${mr.door.y}`)) {
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

                    // 硬指标：从上楼梯 8 向 canMoveTo 泛洪必须覆盖下楼梯。
                    const seen = new Set<number>([up.y * grid.width + up.x]);
                    const queue: Pos[] = [up];
                    while (queue.length > 0) {
                        const p = queue.pop()!;
                        for (const [dx, dy] of DIRS8) {
                            const nx = p.x + dx!, ny = p.y + dy!;
                            if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
                            const key = ny * grid.width + nx;
                            if (seen.has(key) || !canMoveTo(nx, ny)) continue;
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
        console.log(`[p1_33] 修复后 15 种子 × D1-D26 = ${levels} 层：坏层=${bad.join('、') || '无'}；` +
            `机器 ${machines} 台（平均 ${avg}/层，零机器层 ${levels - nonZero}），锁门机器 ${locked} 台。` +
            `修复前基线：1920 台（4.92/层）、坏层 5。`);

        expect(bad, `端到端存在不可达层（机器阶段仍在切断关卡）：\n${bad.join('\n')}`).toEqual([]);
        // 反"少放机器蒙混"：数值为固定种子上的确定性实测（修复前 1920/1318）。
        // 有意改动选址参数使数量变化时，应核对后更新此下限，而不是静默放行。
        expect(machines, `机器总数 ${machines} 低于防塌缩下限（选址可能在静默拒绝一切）`).toBeGreaterThanOrEqual(1200);
        expect(locked, `锁门机器 ${locked} 台低于防塌缩下限（宝库锁可能被静默丢弃）`).toBeGreaterThanOrEqual(700);
        expect(levels - nonZero, `零机器层数超出防塌缩上限`).toBeLessThanOrEqual(40);
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
        expect(analysis.chokeMap[16]![9], '大厅侧门位 (16,9) 的 chokeMap = 大厅封顶值 41').toBe(41);
        expect(analysis.chokeMap[15]![9], '大厅侧洪泛起点 (15,9) 必被洪泛集覆盖 = 41').toBe(41);
        // 封顶早停会让截断后未访问的格保持 30000：41 与 30000 决策等价
        // （都 > 任何 roomSize 上限 40，都不可作门位、不可被内部扩展进入）。
        const hallValue = analysis.chokeMap[5]![9]!;
        expect(
            hallValue === 41 || hallValue === 30000,
            `大厅格 (5,9) 的 chokeMap=${hallValue}，只能是封顶值 41 或未覆盖 30000` +
            `（出现 ≤40 的值 = 外侧被误当死角）`
        ).toBe(true);
        expect(hallValue !== 9, '大厅格绝不能拿到内侧值').toBe(true);
        expect(analysis.chokeMap[22]![9], '走廊中段格无洪泛覆盖 = 30000（内部扩展不可入）').toBe(30000);
    });

    it("c2) 封顶前提元断言：blueprints.json 的 roomSize[1] 全部 ≤ 40（CE_CHOKE_COUNT_CAP=41 的依据）", () => {
        // CE_CHOKE_COUNT_CAP=41 的决策等价性依赖"没有蓝图要找 >40 格的死角"。
        // 若引入更大密库蓝图而不上调封顶值，大门位会被静默排除——在此翻红。
        const maxRoom = Math.max(...(blueprintData as BlueprintDef[]).map(bp => bp.roomSize[1]));
        expect(maxRoom, '出现了 roomSize[1] > 40 的蓝图：必须同步上调 LoopMap.CE_CHOKE_COUNT_CAP')
            .toBeLessThanOrEqual(40);
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
