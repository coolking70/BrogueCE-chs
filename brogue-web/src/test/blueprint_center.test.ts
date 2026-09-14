/**
 * src/test/blueprint_center.test.ts — 蓝图宝藏落点（machine center）可通行性回归
 *
 * 缺陷背景：BlueprintEngine.findSuitableRoom 曾把 center 算成 flood-fill region 的
 * 算术质心。质心不保证属于 region：L 形、环形、哑铃形等非凸房间的质心会落在墙里。
 * 修复前实测还有两类同族问题（详见交付报告）：
 *   - door 候选可与 center 重合 → LOCKED_DOOR 门地形盖在 center 上，把宝藏封死；
 *   - feature 地形（key_flood_trap 的 WATER_DEEP 等）可落在 center 上。
 * 三者同属"算出/使用坐标但未验证其可通行性"，Game.ts 把 center 用作全游戏最有价值
 * 物品（scroll_of_enchanting / wand_of_fire 等）的落点 → 玩家永远拿不到。
 *
 * 三个用例：
 * 1) 单元级：手工构造 L 形 region（其质心确定落在墙格上），断言返回的 center
 *    属于 region。修复前该断言失败（center=质心=墙格），反向验证见交付报告。
 * 2)+3) 全局扫描（共享同一次生成遍历）：多 seed × D1..D26 走真实生成链路
 *    （createHeadlessGame + generateDepth），用测试侧包装
 *    BlueprintEngine.prototype.buildMachines 记录每层 MachineResult，
 *    断言 a) 所有 machine 的 center / door 都属于自身 cells 且格可通行
 *    （Game.canMoveTo 语义）；b) 所有落在 center 上的宝藏物品落格可通行。
 *    含题设反例 seed=424242（其 D22 曾把 Wand of Fire 封进 LOCKED_DOOR 格）。
 *
 * 可通行判据与 Game.canMoveTo(Game.ts:4377) 完全同源：WALL / GRANITE / SECRET_DOOR /
 * LOCKED_DOOR / WATER_DEEP 不可通行，其余可通行。
 *
 * seed 列表可用环境变量 BP_CENTER_SCAN_SEEDS 追加（逗号分隔），用于大样本统计扫描；
 * 默认列表保持全量套件并行运行时的负载可控（套件里有贴着 5s 超时线的重型用例）。
 */
import { describe, it, expect } from 'vitest';
import { Grid, TerrainType, DCOLS, DROWS } from '../engine/Map/Grid';
import { BlueprintEngine } from '../engine/Generator/BlueprintEngine';
import type { BlueprintDef, MachineResult } from '../engine/Generator/BlueprintEngine';
import type { Pos } from '../types';
import type { Game } from '../engine/Core/Game';
import { rng } from '../engine/Random';
import { createHeadlessGame } from './harness';

// ---------- 公共小件 ----------

/** 最小 process 面（tsconfig.app 有意排除 @types/node，做法同 smoke.test.ts）。 */
interface MinimalProcess {
    env?: Record<string, string | undefined>;
}
const proc = (globalThis as { process?: MinimalProcess }).process;

type GameWithPrivates = Omit<Game, 'generateDepth' | 'canMoveTo'> & {
    generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void;
    canMoveTo(x: number, y: number): boolean;
};

/** 下潜一层并触发全新生成（walk down stairs 的生成路径）。 */
function descendOne(game: Game, targetDepth: number): void {
    game.depth = targetDepth;
    (game as unknown as GameWithPrivates).generateDepth(false, false);
}

/** 与 Game.canMoveTo 同源的可通行判据（经实例上的私有方法，零漂移）。 */
function walkable(game: Game, x: number, y: number): boolean {
    return (game as unknown as GameWithPrivates).canMoveTo(x, y);
}

/** MachineResult 逐层记录器：包装原型方法，走完真实生成链路后可回放检查。 */
interface LevelMachines {
    depth: number;
    results: MachineResult[];
}
function installRecorder(record: LevelMachines[]): () => void {
    // BlueprintEngine.depth 是 private，类型面拿不到；这里经 unknown 取宽松视图，
    // 只在运行期读取 this.depth（与 smoke/harness 访问私有成员的做法同源）。
    const proto = BlueprintEngine.prototype as unknown as Record<string, unknown>;
    const original = proto.buildMachines as (this: unknown) => MachineResult[];
    proto.buildMachines = function (this: unknown) {
        const results = original.call(this);
        record.push({ depth: (this as { depth: number }).depth, results });
        return results;
    };
    return () => {
        proto.buildMachines = original;
    };
}

function itemId(item: unknown): string {
    const o = item as { consumableId?: string; identityId?: string; category?: number };
    return o.consumableId ?? o.identityId ?? `category#${o.category}`;
}

/** 题设点名了 5 类由 center 放置的宝藏（rings/charms 走 trapVaults 路径）。 */
function isCenterTreasure(item: unknown): boolean {
    const id = itemId(item);
    return (
        id === 'scroll_of_enchanting' ||
        id === 'wand_of_fire' ||
        id === 'potion_of_life' ||
        id.startsWith('ring_') ||
        id.startsWith('charm_')
    );
}

// 默认 3 个 seed：控制全量套件并行运行时的负载（套件里有贴着 5s 超时线的重型用例）。
// 需要更大样本时用 BP_CENTER_SCAN_SEEDS 追加，如：
//   BP_CENTER_SCAN_SEEDS=$(seq -s, 100 139) npx vitest run --disableConsoleIntercept \
//     src/test/blueprint_center.test.ts
const DEFAULT_SCAN_SEEDS = [424242, 20260913, 1];
const SCAN_SEEDS: number[] = [
    ...DEFAULT_SCAN_SEEDS,
    ...(proc?.env?.BP_CENTER_SCAN_SEEDS ?? '')
        .split(',')
        .map(s => parseInt(s.trim(), 10))
        .filter(n => Number.isFinite(n) && n > 0),
];

// ---------- 共享扫描（一次生成遍历，供用例 2/3 各自断言） ----------

interface ScanResult {
    /** center 不属于自身 cells 或落格不可通行（含 door 重合/越界）的违例清单 */
    centerViolations: string[];
    /** 落在 center 上的不可通行宝藏清单 */
    treasureViolations: string[];
    /** center 上见到的宝藏类型计数（证明扫描非空转） */
    treasureTally: Map<string, number>;
    treasuresAtCenter: number;
    machineCount: number;
    levelCount: number;
}

const terrainNames: Record<number, string> = {
    [TerrainType.GRANITE]: 'GRANITE',
    [TerrainType.WALL]: 'WALL',
    [TerrainType.OPEN_DOOR]: 'OPEN_DOOR',
    [TerrainType.WATER_DEEP]: 'WATER_DEEP',
    [TerrainType.GRASS]: 'GRASS',
    [TerrainType.TRAP]: 'TRAP',
    [TerrainType.SECRET_DOOR]: 'SECRET_DOOR',
    [TerrainType.PRESSURE_PLATE]: 'PRESSURE_PLATE',
    [TerrainType.LOCKED_DOOR]: 'LOCKED_DOOR',
    [TerrainType.WEB]: 'WEB',
};

let scanCache: ScanResult | null = null;

function runScan(): ScanResult {
    if (scanCache) return scanCache;

    const result: ScanResult = {
        centerViolations: [],
        treasureViolations: [],
        treasureTally: new Map(),
        treasuresAtCenter: 0,
        machineCount: 0,
        levelCount: 0,
    };
    const terrainHistogram = new Map<number, number>();
    const badLevels = new Set<string>();

    for (const seed of SCAN_SEEDS) {
        // 录制器必须先于 createHeadlessGame 安装，才能捕获 D1 的生成
        const record: LevelMachines[] = [];
        const restore = installRecorder(record);
        const game = createHeadlessGame(seed);
        try {
            for (let depth = 1; depth <= 26; depth++) {
                if (depth > 1) descendOne(game, depth);
                result.levelCount++;
                const entry = record[record.length - 1];
                expect(entry?.depth).toBe(depth);

                const centers = new Map<string, string>(); // "x,y" -> blueprintId
                for (const mr of entry?.results ?? []) {
                    result.machineCount++;
                    const cellSet = new Set(mr.cells.map(p => `${p.x},${p.y}`));
                    const cKey = `${mr.center.x},${mr.center.y}`;
                    centers.set(cKey, mr.blueprintId);
                    const inside = cellSet.has(cKey);
                    const passable = walkable(game, mr.center.x, mr.center.y);
                    if (!inside || !passable) {
                        badLevels.add(`seed=${seed} D${depth}`);
                        const terrain = game.grid.getCell(mr.center.x, mr.center.y)?.terrain;
                        if (!passable) {
                            terrainHistogram.set(
                                terrain ?? -1,
                                (terrainHistogram.get(terrain ?? -1) ?? 0) + 1
                            );
                        }
                        result.centerViolations.push(
                            `seed=${seed} D${depth} ${mr.blueprintId} center=(${mr.center.x},${mr.center.y}) ` +
                            `cells内=${inside} 可通行=${passable} terrain=${terrain}`
                        );
                    }
                    if (mr.door) {
                        const dKey = `${mr.door.x},${mr.door.y}`;
                        if (!cellSet.has(dKey)) {
                            result.centerViolations.push(
                                `seed=${seed} D${depth} ${mr.blueprintId} door=(${mr.door.x},${mr.door.y}) 不属于自身 cells`
                            );
                        }
                        if (dKey === cKey) {
                            result.centerViolations.push(
                                `seed=${seed} D${depth} ${mr.blueprintId} door 与 center 重合（LOCKED_DOOR 会封死宝藏格）`
                            );
                        }
                    }
                }

                // 用例 3：所有落在 center 上的物品（= 由 center 放置的宝藏）落格可通行
                for (const item of game.items) {
                    const key = `${item.loc.x},${item.loc.y}`;
                    if (!centers.has(key)) continue;
                    const id = itemId(item);
                    if (isCenterTreasure(item)) {
                        result.treasuresAtCenter++;
                        result.treasureTally.set(id, (result.treasureTally.get(id) ?? 0) + 1);
                    }
                    if (!walkable(game, item.loc.x, item.loc.y)) {
                        badLevels.add(`seed=${seed} D${depth}`);
                        result.treasureViolations.push(
                            `seed=${seed} D${depth} ${centers.get(key)} 宝藏 ${id} @ ` +
                            `(${item.loc.x},${item.loc.y}) 落格不可通行 ` +
                            `terrain=${game.grid.getCell(item.loc.x, item.loc.y)?.terrain}`
                        );
                    }
                }
            }
        } finally {
            restore();
        }
        // 该 seed 全程（D1..D26）消耗的 substantive 随机数总数：
        // createHeadlessGame 已重置种子，此值只由 seed 与生成逻辑决定，
        // 用于回归监测"生成逻辑是否悄悄改变了 RNG 消耗"。
        console.log(`[bp-center] seed=${seed} D1..D26 substantive RNG 抽取总数: ${rng.randomNumbersGenerated}`);
    }

    const histogramText = [...terrainHistogram.entries()]
        .sort((x, y) => y[1] - x[1])
        .map(([t, n]) => `${terrainNames[t] ?? `terrain#${t}`}×${n}`)
        .join(', ');
    console.log(
        `[bp-center] 扫描 ${SCAN_SEEDS.length} seeds × 26 层 = ${result.levelCount} 层，` +
        `共 ${result.machineCount} 台 machine，center 违例 ${result.centerViolations.length} 条` +
        `（涉及 ${badLevels.size} 层）；不可通行 terrain 分布：${histogramText || '（无）'}`
    );
    const tally = [...result.treasureTally.entries()].map(([id, n]) => `${id}×${n}`).join(', ');
    console.log(
        `[bp-center] center 上共见到 ${result.treasuresAtCenter} 件宝藏：${tally || '（无）'}；` +
        `宝藏违例 ${result.treasureViolations.length} 条`
    );

    scanCache = result;
    return result;
}

// ---------- 用例 ----------

describe('蓝图宝藏落点（machine center）可通行性', () => {
    it('a) L 形 region：返回的 center 必须属于 region（质心落墙的反例）', () => {
        // 全 GRANITE 底板，中间刻一个 L 形房间（15 格）：
        //   横臂 x∈[10,14], y∈[10,11]（10 格）
        //   竖臂 x=10,      y∈[12,16]（5 格）
        // 其算术质心 = (11,12)，该格不在 L 内 —— 是真正的墙格。
        const grid = new Grid(DCOLS, DROWS);
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
            }
        }
        const ox = 10, oy = 10;
        const cells: Pos[] = [];
        for (let x = ox; x <= ox + 4; x++) {
            for (let y = oy; y <= oy + 1; y++) cells.push({ x, y });
        }
        for (let y = oy + 2; y <= oy + 6; y++) cells.push({ x: ox, y });
        for (const p of cells) grid.setTerrain(p.x, p.y, TerrainType.FLOOR, '.', 0x888888);

        // fixture 自检：质心 (11,12) 确实不在 L 内（保证用例对回归有杀伤力）
        const cellSet = new Set(cells.map(p => `${p.x},${p.y}`));
        const naiveCentroid: Pos = { x: 11, y: 12 };
        expect(cellSet.has(`${naiveCentroid.x},${naiveCentroid.y}`)).toBe(false);

        const engine = new BlueprintEngine(grid, 5);
        type FindRoom = (bp: BlueprintDef) => { cells: Pos[]; center: Pos; door: Pos | null } | null;
        const bp = { roomSize: [12, 30] } as unknown as BlueprintDef;
        const room = (engine as unknown as { findSuitableRoom: FindRoom }).findSuitableRoom(bp);

        expect(room).not.toBeNull();
        expect(room!.cells.length).toBe(cells.length);
        // 核心断言（修复前失败：center = 质心 = (11,12) 墙格）
        expect(cellSet.has(`${room!.center.x},${room!.center.y}`)).toBe(true);
        // door 同类约束：属于 region，且不与 center 重合（重合会被 LOCKED_DOOR 封死宝藏格）
        if (room!.door) {
            expect(cellSet.has(`${room!.door.x},${room!.door.y}`)).toBe(true);
            expect(`${room!.door.x},${room!.door.y}`).not.toBe(`${room!.center.x},${room!.center.y}`);
        }
    });

    it(`b) 全局扫描（${SCAN_SEEDS.length} seeds × D1..D26）：所有 machine 的 center 都是自身 cells 内的可通行格`, () => {
        const { centerViolations } = runScan();
        for (const v of centerViolations.slice(0, 60)) console.log('[bp-center] center违例:', v);
        expect(centerViolations).toEqual([]);
    }, 180_000);

    it('c) 所有落在 machine center 上的宝藏物品，其落格必须可通行', () => {
        const { treasuresAtCenter, treasureViolations } = runScan();
        for (const v of treasureViolations.slice(0, 60)) console.log('[bp-center] 宝藏违例:', v);
        // 非空转护栏：扫描必须真的覆盖到 center 宝藏，否则断言无意义
        expect(treasuresAtCenter).toBeGreaterThan(0);
        expect(treasureViolations).toEqual([]);
    }, 180_000);
});
