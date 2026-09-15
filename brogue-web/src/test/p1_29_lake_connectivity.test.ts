/**
 * src/test/p1_29_lake_connectivity.test.ts — P1-29：湖泊连通性验证
 *
 * 修复的 bug：web 铺深水湖泊时不做连通性验证（CE 每提议一个湖就
 * flood-fill 验证"放下之后干地是否仍连通"，不通过换位重试、20 次仍不行
 * 则放弃该湖；Architect.c:2588-2688），导致 ~8.5% 的关卡下楼梯从上楼梯
 * 走不到（验收方 5 种子 × D1-D26 实测 11/125 层；本轮 10 种子实测
 * 修复前 21/260 层，经"水体豁免泛洪"归因全部为水切）。
 *
 * 修复方式：方案 (a)——保留 web 现有 overlay 结构，对不可踏入的叠加层
 * （canMoveTo 口径下仅深水）加 CE 语义的放置闸门：
 *   - 每次选址先算"真正会被盖上去的格子集"（blob ∩ FLOOR），假想放置后
 *     验证干地仍属同一个连通块，通过才落地；
 *   - 最多 20 次尝试（CE Architect.c:2659 `for (k=0; k<20; k++)`），
 *     全部失败就跳过该湖（不硬塞）。
 * 判据与工具在 src/engine/Map/Connectivity.ts；湖泊阶段完成态的连通性
 * 合同由 Architect.generateTerrain 承载。
 *
 * ★ P1-33 前的已知边界（机器阶段在湖泊闸门之后动地形，可能切断连通）
 *   已由 P1-33（chokeMap 门位选址）根治：端到端断言现为**空集**。
 *   若翻红即是新回归（机器阶段或湖泊阶段），按生成期回归排查。
 */
import { describe, it, expect } from 'vitest';
import { Architect } from '../engine/Generator/Architect';
import { lakeDisruptsPassability, terrainAllowsMove, DIRS8 } from '../engine/Map/Connectivity';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { createEmptyRoomGrid, drawRectangleOnGrid, type RoomGrid } from '../engine/Generator/RoomBuilder';
import { rng } from '../engine/Random';
import { createHeadlessGame, terrainFingerprint, analysisAllowsMove } from './harness';
import type { Game } from '../engine/Core/Game';

const LAKE_OVERLAY = { type: TerrainType.WATER_DEEP, char: '~', color: 0x1133aa };

/** P1-26 的 5 种子 + 本轮新增 5 种子（扩样复验用）。 */
const SWEEP_SEEDS = [424242, 777, 20260913, 31337, 20260916, 1, 42, 999, 20260915, 55555];
const MAX_DEPTH = 26;

/**
 * 端到端实测（2026-09-15，10 种子 × D1-D26 = 260 层）：坏层均为机器阶段
 * （BlueprintEngine）所致，与湖泊无关（本文件的**湖泊阶段**断言对全部
 * 15 种子全绿，排除湖泊致）：
 * - seed424242/D19：从上楼梯可达 783 格；
 * - seed20260916/D16：可达 728 格；
 * - seed999/D18：可达 477 格。
 * 机制同 seed777/D15 的历史解剖：机器锁门/特征水深水恰好卡在走廊割点上
 * ——**P1-33（chokeMap 门位选址 + 锁门验证 + 密库地板退出楼梯牌堆）已把
 * 该缺陷根治，本集合为空集**。15 种子 × D1-D26 复验（p1_33_machine_chokepoint
 * 测试）坏层=0。若本断言再翻红，即是生成期新回归，不是留痕。
 */
const KNOWN_MACHINE_STAGE_BAD_LEVELS: string[] = []; // P1-33 后为空集；断言比较的是排序后数组

type Pos = { x: number; y: number };

function collectDry(grid: Grid): { cells: Pos[]; first: Pos | null } {
    const cells: Pos[] = [];
    let first: Pos | null = null;
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) {
            const cell = grid.getCell(x, y);
            if (cell && terrainAllowsMove(cell.terrain)) {
                cells.push({ x, y });
                if (!first) first = { x, y };
            }
        }
    }
    return { cells, first };
}

/** 8 向泛洪（游戏移动口径），起点出发可达的干地格集合。 */
function floodDry(grid: Grid, start: Pos): Set<number> {
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
            const cell = grid.getCell(nx, ny);
            if (!cell || !terrainAllowsMove(cell.terrain)) continue;
            seen.add(key);
            queue.push({ x: nx, y: ny });
        }
    }
    return seen;
}

function countTerrain(grid: Grid, terrain: TerrainType): number {
    let n = 0;
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) {
            if (grid.getCell(x, y)?.terrain === terrain) n++;
        }
    }
    return n;
}

describe('P1-29 湖泊连通性', () => {
    it('核心不变量：15 种子 × D1-D26 湖泊阶段完成态全连通（湖泊闸门合同）', () => {
        // 直接驱动 Architect.generateTerrain（房间+湖泊+陷阱之前的阶段，
        // 即闸门的合同范围）。机器阶段在 generateLevel 里位于其后，
        // 不属于本断言。
        const seeds = [...SWEEP_SEEDS, 2, 3, 5, 7, 11];
        const statsBefore = { ...Architect.lakeGateStats };
        let deepTotal = 0;
        let shallowTotal = 0;
        const broken: string[] = [];

        for (const seed of seeds) {
            rng.seedRandomGenerator(seed);
            const arch = new Architect();
            for (let depth = 1; depth <= MAX_DEPTH; depth++) {
                const grid = arch.generateTerrain(depth);
                deepTotal += countTerrain(grid, TerrainType.WATER_DEEP);
                shallowTotal += countTerrain(grid, TerrainType.WATER_SHALLOW);
                const { cells, first } = collectDry(grid);
                if (!first) {
                    broken.push(`seed${seed}/D${depth}: 无干地`);
                    continue;
                }
                const reached = floodDry(grid, first);
                if (reached.size !== cells.length) {
                    broken.push(`seed${seed}/D${depth}: 干地 ${cells.length} 中仅 ${reached.size} 格连通`);
                }
            }
        }

        const stats = Architect.lakeGateStats;
        console.log(`[p1_29] 湖泊阶段扫描：${seeds.length * MAX_DEPTH} 层，` +
            `闸门 placed=${stats.placed - statsBefore.placed} skipped=${stats.skipped - statsBefore.skipped}，` +
            `深水格=${deepTotal} 浅水格=${shallowTotal}`);

        expect(
            broken,
            `湖泊阶段完成态存在不连通层（闸门合同被破坏）：\n${broken.join('\n')}`
        ).toEqual([]);
    });

    it('端到端 10 种子 × D1-D26：坏层集合恰为已知机器阶段缺陷集（湖泊致坏层=0）', () => {
        const bad: string[] = [];
        const details: string[] = [];
        let deepTotal = 0;
        let shallowTotal = 0;

        for (const seed of SWEEP_SEEDS) {
            const game = createHeadlessGame(seed);
            for (let d = 1; d <= MAX_DEPTH; d++) {
                if (d > 1) {
                    (game as unknown as { depth: number }).depth = d;
                    (game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void }).generateDepth(false, false);
                }
                const grid = game.grid;
                deepTotal += countTerrain(grid, TerrainType.WATER_DEEP);
                shallowTotal += countTerrain(grid, TerrainType.WATER_SHALLOW);
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
                // 与 p1_26 同款判据：Game.canMoveTo 本体（只读转型），8 向。
                const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
                // C-3 后：洪泛按 CE 的分析口径放行密门（harness.analysisAllowsMove）。
                const e2eRule = analysisAllowsMove(grid, canMoveTo);
                const seen = new Set<number>([up.y * grid.width + up.x]);
                const queue: Pos[] = [up];
                while (queue.length > 0) {
                    const p = queue.pop()!;
                    for (const [dx, dy] of DIRS8) {
                        const nx = p.x + dx;
                        const ny = p.y + dy;
                        if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
                        const key = ny * grid.width + nx;
                        if (seen.has(key) || !e2eRule(nx, ny)) continue;
                        seen.add(key);
                        queue.push({ x: nx, y: ny });
                    }
                }
                if (!seen.has(down.y * grid.width + down.x)) {
                    const key = `${seed}/D${d}`;
                    bad.push(key);
                    details.push(`${key}: 从上楼梯可达 ${seen.size} 格`);
                }
            }
        }

        console.log(`[p1_29] 端到端扫描：260 层，坏层=${bad.join('、') || '无'}，` +
            `深水格=${deepTotal} 浅水格=${shallowTotal}`);

        // 验收方修正：原断言左侧 `bad` 是测量顺序、右侧恒 `.sort()`，
        // 只有当测量顺序恰好等于字典序时才通过——原集合 ['777/D15','999/D12']
        // 是靠巧合过的。两侧同时排序才是稳定判据。
        expect(
            [...bad].sort(),
            `端到端坏层集合与已知机器阶段缺陷集不符。\n` +
            `已知集：${KNOWN_MACHINE_STAGE_BAD_LEVELS.join('、')}（成因与证据链见 ` +
            `ai_docs/p1_29_lake_connectivity_report.md §与预设不符之处）。\n` +
            `若你刚修复了机器阶段的锁门/特征水缺陷，或合并了会移动 RNG 流的轮次，` +
            `请复跑实测并更新 KNOWN_MACHINE_STAGE_BAD_LEVELS（理想为空集）。\n` +
            `实测坏层: ${details.join('；') || '无'}`
        ).toEqual([...KNOWN_MACHINE_STAGE_BAD_LEVELS].sort());
    });

    it('决定性：同种子两次生成，地形指纹与深水格数逐一一致', () => {
        for (const seed of [424242, 20260913, 999]) {
            const pass = (): string[] => {
                rng.seedRandomGenerator(seed);
                const arch = new Architect();
                const fps: string[] = [];
                for (let depth = 1; depth <= MAX_DEPTH; depth++) {
                    const grid = arch.generateTerrain(depth);
                    fps.push(`D${depth}:深水${countTerrain(grid, TerrainType.WATER_DEEP)}:${terrainFingerprint(grid)}`);
                }
                return fps;
            };
            const a = pass();
            const b = pass();
            expect(b, `seed${seed} 两次生成不一致（生成混入非种子随机源）`).toEqual(a);
        }
    });

    it('对抗 AD2：每次放置都破坏连通时，20 次尝试耗尽必须放弃该湖（不硬塞）', () => {
        // 两间互不连通的斗室：任何非空候选放置都会让另一间"干地"不可达，
        // 因此 20 次尝试必然全部被闸门拒绝 → 必须返回 false 且不改地形。
        const arch = new Architect();
        const grid = arch.grid;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
            }
        }
        stampFloor(grid, 10, 10, 3, 3);
        stampFloor(grid, 40, 10, 3, 3);

        const blobMap = createEmptyRoomGrid();
        drawRectangleOnGrid(blobMap, 39, 13, 3, 3, 1);
        const blob = { minX: 39, minY: 13, width: 3, height: 3 };

        const placed = (arch as unknown as {
            placeGatedLakeBlob(m: RoomGrid, b: typeof blob, o: typeof LAKE_OVERLAY): boolean;
        }).placeGatedLakeBlob(blobMap, blob, LAKE_OVERLAY);

        expect(placed, '闸门在 20 次尝试全拒绝后仍返回 true = 硬塞').toBe(false);
        expect(countTerrain(grid, TerrainType.WATER_DEEP), '放弃该湖后不得有深水落地').toBe(0);
        // 两个斗室的地板原封不动
        expect(countTerrain(grid, TerrainType.FLOOR)).toBe(18);
    });

    it('对抗 AD2 正控：开阔地上同一助手应正常放下湖（证明助手没有被钉死为拒绝）', () => {
        const arch = new Architect();
        const grid = arch.grid;
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
            }
        }
        stampFloor(grid, 25, 5, 30, 20); // 大开阔间

        const blobMap = createEmptyRoomGrid();
        drawRectangleOnGrid(blobMap, 39, 13, 3, 3, 1);
        const blob = { minX: 39, minY: 13, width: 3, height: 3 };

        const placed = (arch as unknown as {
            placeGatedLakeBlob(m: RoomGrid, b: typeof blob, o: typeof LAKE_OVERLAY): boolean;
        }).placeGatedLakeBlob(blobMap, blob, LAKE_OVERLAY);

        expect(placed, '开阔地放置应成功').toBe(true);
        const deep = countTerrain(grid, TerrainType.WATER_DEEP);
        expect(deep, '开阔地放置应落地 1-9 格深水（blob ∩ FLOOR）').toBeGreaterThan(0);
        expect(deep).toBeLessThanOrEqual(9);
    });

    it('对抗 AD3：判据是 canMoveTo 口径——预存深水桥不算干地', () => {
        // 布局：A -P- B -Q- C 三间（P/Q 为地板走廊），另有深水桥 W 连通 A、C。
        // 候选湖盖住 P：
        //   canMoveTo 口径 → W 不可通行 → B、C 与 A 失去联系 → 必须拒绝（true）；
        //   若误用 isPassable（深水 isPassable=true）→ W 被当干地 → 全图连通 → 接受（false）。
        // 这是验收方与 phase_c 提案都踩过的坑，钉死于此。
        const build = (bridge: TerrainType): Grid => {
            const g = new Grid(20, 15);
            for (let x = 0; x < 20; x++) {
                for (let y = 0; y < 15; y++) {
                    g.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
                }
            }
            stampFloor(g, 2, 6, 3, 3);   // A
            stampFloor(g, 5, 7, 3, 1);   // P（候选湖将覆盖）
            stampFloor(g, 8, 6, 3, 3);   // B
            stampFloor(g, 11, 7, 3, 1);  // Q
            stampFloor(g, 14, 6, 3, 3);  // C
            // 深水（或对照组的地板）桥：A 上方 → 横穿 → C 上方
            stampTerrain(g, 3, 2, 13, 1, bridge);
            stampTerrain(g, 3, 3, 1, 3, bridge);
            stampTerrain(g, 15, 3, 1, 3, bridge);
            return g;
        };

        const candidate = new Set([7 * 20 + 5, 7 * 20 + 6, 7 * 20 + 7]);
        const wouldBeLaked = (x: number, y: number): boolean => candidate.has(y * 20 + x);

        const withWaterBridge = build(TerrainType.WATER_DEEP);
        expect(
            lakeDisruptsPassability(withWaterBridge, wouldBeLaked),
            '深水桥不能算干地：盖住 P 会切断 B、C，必须拒绝'
        ).toBe(true);

        const withFloorBridge = build(TerrainType.FLOOR);
        expect(
            lakeDisruptsPassability(withFloorBridge, wouldBeLaked),
            '地板桥是真实替代路径：盖住 P 不切断任何干地，必须接受'
        ).toBe(false);
    });

    it('判据口径钉死：terrainAllowsMove 与 Game.canMoveTo 对全部 TerrainType 逐一一致', () => {
        const game: Game = createHeadlessGame(424242);
        const canMoveTo = (game as unknown as { canMoveTo(x: number, y: number): boolean }).canMoveTo.bind(game);
        const mismatches: string[] = [];
        for (const t of Object.values(TerrainType).filter((v): v is TerrainType => typeof v === 'number')) {
            game.grid.setTerrain(5, 5, t, '?', 0x000000);
            const viaGame = canMoveTo(5, 5);
            const viaMirror = terrainAllowsMove(t);
            if (viaGame !== viaMirror) mismatches.push(`${TerrainType[t]}: canMoveTo=${viaGame} terrainAllowsMove=${viaMirror}`);
        }
        expect(
            mismatches,
            `terrainAllowsMove 与 Game.canMoveTo 口径漂移（Game.canMoveTo 的排除清单` +
            `变更时必须同步 src/engine/Map/Connectivity.ts）：\n${mismatches.join('\n')}`
        ).toEqual([]);
    });
});

/** 在 Grid 上直接铺 FLOOR（测试布景用）。 */
function stampFloor(grid: Grid, x0: number, y0: number, w: number, h: number): void {
    stampTerrain(grid, x0, y0, w, h, TerrainType.FLOOR);
}

function stampTerrain(grid: Grid, x0: number, y0: number, w: number, h: number, terrain: TerrainType): void {
    for (let x = x0; x < x0 + w; x++) {
        for (let y = y0; y < y0 + h; y++) {
            if (grid.isValidPos(x, y)) {
                grid.setTerrain(x, y, terrain, '.', 0x888888);
            }
        }
    }
}
