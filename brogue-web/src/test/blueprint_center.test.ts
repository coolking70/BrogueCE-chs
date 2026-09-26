/**
 * src/test/blueprint_center.test.ts — 蓝图宝藏落点（machine center）可通行性回归
 *
 * 缺陷背景：BlueprintEngine.findSuitableRoom 曾把 center 算成 flood-fill region 的
 * 算术质心。质心不保证属于 region：L 形、环形、哑铃形等非凸房间的质心会落在墙里。
 * 修复前实测还有两类同族问题（详见交付报告）：
 *   - door 候选可与 center 重合 → LOCKED_DOOR 门地形盖在 center 上，把宝藏封死；
 *   - feature 地形（key_flood_trap 的 WATER_DEEP 等）可落在 center 上。
 * 三者同属"算出/使用坐标但未验证其可通行性"，Game.ts 把 center 用作全游戏最有价值
 * 物品（scroll_of_enchantment / potion_of_life / ring_* / charm_* 等）的落点 → 玩家永远拿不到。
 *
 * 四个用例：
 * 1) 单元级：手工构造 L 形 region（其质心确定落在墙格上），断言返回的 center
 *    属于 region。修复前该断言失败（center=质心=墙格），反向验证见交付报告。
 * 2)+3) 全局扫描（共享同一次生成遍历）：多 seed × D1..D26 走真实生成链路
 *    （createHeadlessGame + generateDepth），用测试侧包装
 *    BlueprintEngine.prototype.buildMachines 记录每层 MachineResult，
 *    断言 a) 所有 machine 的 center / door 都属于自身 cells 且格可通行
 *    （Game.canMoveTo 语义）；b) 所有落在 center 上的宝藏物品落格可通行。
 *    含题设反例 seed=424242（其 D22 曾把 Wand of Fire 封进 LOCKED_DOOR 格）。
 * 4) 元断言（P1-36）：isCenterTreasure 点名的 id/前缀必须真实存在于数据表——
 *    防拼写错误、退池、改名让判据静默空转（历史教训见 CENTER_TREASURE_IDS 注）。
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
import { Game } from '../engine/Core/Game';
import { rng } from '../engine/Random';
import { ItemCategory, type Item } from '../engine/Items/Item';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { ItemSpawnHeatMap } from '../engine/Items/ItemSpawnHeatMap';
import fs from 'node:fs';
import { createHeadlessGame } from './harness';
import consumablesData from '../data/consumables.json';
import arcanaData from '../data/arcana.json';
import blueprintData from '../data/blueprints.json';

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

/** U04c: trace actual population products, not merely their coordinates.
 * CE Architect.c:1691–1699 clears non-wired membership; Items.c:630–632
 * permits ordinary population there, even when the coordinate was an origin.
 * Each real item identity can justify at most one ground occurrence.
 */
function consumeOrdinaryCenterItem(game: Pick<Game, 'grid'>, item: Item, products: Set<Item>): boolean {
    return game.grid.getCell(item.loc.x, item.loc.y)?.machineNumber === 0 && products.delete(item);
}
function installPopulationRecorder(products: Set<Item>): () => void {
    const proto = Game.prototype as unknown as { spawnPopulateItem(depth: number, offset: number): Item | null };
    const populate = proto.spawnPopulateItem, gold = ItemLoader.spawnGold, amulet = ItemLoader.spawnAmulet;
    // U19f: the existing D26 amulet bypass uses a separately filtered floor deck.
    // Record its actual instance once; cleared membership and passability are
    // still required at consumption, and duplicate/invented items remain red.
    const gameSource = fs.readFileSync("src/engine/Core/Game.ts", "utf8");
    expect(gameSource).toContain("const amuletPos = amuletTiles[amuletPosIdx]!");
    expect(gameSource).toContain("ItemLoader.spawnAmulet('amulet_of_yendor', amuletPos.x, amuletPos.y)");
    ItemLoader.spawnAmulet = function(id, x, y) {
        const item = amulet.call(this, id, x, y);
        if (item) products.add(item);
        return item;
    };
    const pick = ItemSpawnHeatMap.prototype.getItemSpawnLoc, cool = ItemSpawnHeatMap.prototype.coolHeatMapAt;
    let pendingItem: Item | null = null, goldLocation: Pos | null = null;
    proto.spawnPopulateItem = function(depth, offset) {
        const item = populate.call(this, depth, offset);
        pendingItem = item;
        if (item) products.add(item);
        return item;
    };
    ItemSpawnHeatMap.prototype.getItemSpawnLoc = function() {
        const loc = pick.call(this);
        goldLocation = pendingItem ? null : loc;
        return loc;
    };
    ItemSpawnHeatMap.prototype.coolHeatMapAt = function(x, y) {
        cool.call(this, x, y);
        if (pendingItem) { pendingItem = null; goldLocation = null; }
    };
    // Gold must consume an actual heat-map location once. A direct spawnGold
    // at an unnumbered center without that location is still an invented drop.
    ItemLoader.spawnGold = function(quantity, x, y) {
        const item = gold.call(this, quantity, x, y);
        if (item && goldLocation?.x === x && goldLocation.y === y) products.add(item);
        goldLocation = null;
        return item;
    };
    return () => {
        proto.spawnPopulateItem = populate; ItemLoader.spawnGold = gold; ItemLoader.spawnAmulet = amulet;
        ItemSpawnHeatMap.prototype.getItemSpawnLoc = pick; ItemSpawnHeatMap.prototype.coolHeatMapAt = cool;
    };
}

function itemId(item: unknown): string {
    const o = item as { consumableId?: string; identityId?: string; category?: number };
    return o.consumableId ?? o.identityId ?? `category#${o.category}`;
}

/** U17f: CE8 has no interior. Its arbitrary anchor may coincide with a child
 * machine's legitimate adopted-item feature (seed1 D12). Require the original
 * instance ID, child adoption instruction and successful feature at that cell;
 * an arbitrary item at the empty anchor is still rejected. */
function outsourcedAnchorItems(parent: MachineResult): MachineResult['itemSpawns'] {
    const bp = (blueprintData as BlueprintDef[]).find(b => b.id === parent.blueprintId);
    if (bp?.ceBlueprintId !== 8 || parent.cells.length || parent.itemSpawns.length) return [];
    const ids = new Set((parent.generatedItems ?? []).flatMap(i => i.instanceId ? [i.instanceId] : []));
    const descendants = (m: MachineResult): MachineResult[] => m.subMachines.flatMap(c => [c, ...descendants(c)]);
    const adopted = descendants(parent).flatMap(child => {
        const def = (blueprintData as BlueprintDef[]).find(b => b.id === child.blueprintId);
        return child.itemSpawns.filter(spawn => spawn.viaAdoption && spawn.instanceId && ids.has(spawn.instanceId)
            && spawn.pos.x === parent.center.x && spawn.pos.y === parent.center.y
            && child.featureSpawns.some(product => product.pos.x === spawn.pos.x && product.pos.y === spawn.pos.y
                && def?.features[product.featureIndex]?.flags.includes('MF_ADOPT_ITEM')));
    });
    return [...new Map(adopted.map(spawn => [spawn.instanceId, spawn])).values()];
}

/**
 * isCenterTreasure 点名的显式宝藏 id 与前缀（P1-36 元断言的对象）。
 * 历史教训：这里曾写 'scroll_of_enchanting'（拼写错误，数据表无此键）、
 * 'wand_of_fire'（已按 D2 退池）——两条判据长期恒 false、护栏空转，而
 * 任何测试都不报错。P1-36 元断言（见下方用例 d）把"列表点名的东西必须
 * 真实存在"钉死：以后数据表改名、物品退池、id 拼错，立即翻红。
 *
 * P1-33 补记：'wand_' 前缀是本守卫**当前唯一有真实样本**的 center 宝藏——
 * Game.populateLevel 旧式机器循环的宝藏分支：50% 走
 * spawnScroll('scroll_of_enchanting')（拼写错误，ItemLoader 查无此 id 返
 * null，分支恒死——Game.ts 本轮禁改，登记在 P1-33 报告"边界外发现"），
 * 另 50% 从生成池抽真魔杖放在 machine.center 上。修复前用例 c) 的样本
 * 其实是"随机通用掉落恰好落在 center 坐标"的巧合（牌堆当时还含机器格）；
 * P1-33 把机器内部退出楼梯/物品牌堆后巧合消失，center 宝藏只剩魔杖分支。
 */
export const CENTER_TREASURE_IDS: readonly string[] = ['scroll_of_enchantment', 'potion_of_life'];
export const CENTER_TREASURE_PREFIXES: readonly string[] = ['ring_', 'charm_', 'wand_'];

/** 题设点名了 5 类由 center 放置的宝藏（rings/charms 原走 trapVaults 路径——
 *  该死代码已于 V-2b-1 删除，判据保留用于元断言 d 与历史对照）。 */
function isCenterTreasure(item: unknown): boolean {
    const id = itemId(item);
    return (
        CENTER_TREASURE_IDS.includes(id) ||
        CENTER_TREASURE_PREFIXES.some(p => id.startsWith(p))
    );
}

// 默认 3 个 seed：控制全量套件并行运行时的负载（套件里有贴着 5s 超时线的重型用例）。
// 需要更大样本时用 BP_CENTER_SCAN_SEEDS 追加，如：
//   BP_CENTER_SCAN_SEEDS=$(seq -s, 100 139) npx vitest run --disableConsoleIntercept \
//     src/test/blueprint_center.test.ts
// 验收方 C-1 修正：默认种子从 3 个扩到 12 个。
// C-1（房间剖面对齐 CE）让地牢开阔约 3 倍，宝藏落在 machine center 上的概率随之
// 降低，原来 3 个种子扫不到任何样本，用例 c) 的前置断言（样本数 > 0）因此翻红——
// 这不是回归，是样本量不足。实测 40 种子稳定有样本；取 12 个在覆盖与耗时间折中。
// U17f: RUBBLE generation moves the sample; seed35 D6 supplies a real CE39 declared origin.
const DEFAULT_SCAN_SEEDS = [35, 424242, 20260913, 1, 777, 31337, 20260916, 42, 999, 12345, 55555, 31415, 27182];
const SCAN_SEEDS: number[] = [
    ...DEFAULT_SCAN_SEEDS,
    ...Array.from({ length: 32 }, (_, i) => i + 1).filter(seed => !DEFAULT_SCAN_SEEDS.includes(seed)),
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
    /** 无声明feature或合法人口来源的center物品（见用例e）。 */
    itemsAtCenter: string[];
    /** 9e：蓝图明确声明、成功落位且可通行的区域 origin 地面物品。 */
    declaredOriginItems: number;
    /** center 上见到的宝藏类型计数（证明扫描非空转） */
    treasureTally: Map<string, number>;
    treasuresAtCenter: number;
    unexplainedTreasuresAtCenter: number;
    ordinaryCenterItems: string[];
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
        itemsAtCenter: [],
        declaredOriginItems: 0,
        treasureTally: new Map(),
        treasuresAtCenter: 0,
        unexplainedTreasuresAtCenter: 0,
        ordinaryCenterItems: [],
        machineCount: 0,
        levelCount: 0,
    };
    const terrainHistogram = new Map<number, number>();
    const badLevels = new Set<string>();

    for (const seed of SCAN_SEEDS) {
        // 录制器必须先于 createHeadlessGame 安装，才能捕获 D1 的生成
        const record: LevelMachines[] = [];
        const restore = installRecorder(record);
        const populationProducts = new Set<Item>();
        const restorePopulation = installPopulationRecorder(populationProducts);
        const game = createHeadlessGame(seed);
        try {
            for (let depth = 1; depth <= 26; depth++) {
                if (depth > 1) descendOne(game, depth);
                result.levelCount++;
                const entry = record[record.length - 1];
                expect(entry?.depth).toBe(depth);

                const centers = new Map<string, string>(); // "x,y" -> blueprintId
                const originItemSpawns: MachineResult['itemSpawns'] = [];
                const emptyAnchorSpawns = new Set<MachineResult['itemSpawns'][number]>();
                for (const mr of entry?.results ?? []) {
                    result.machineCount++;
                    const cellSet = new Set(mr.cells.map(p => `${p.x},${p.y}`));
                    const cKey = `${mr.center.x},${mr.center.y}`;
                    centers.set(cKey, mr.blueprintId);
                    // V-2a 前厅豁免（本文件在 V-2a 任务书 §5 授权清单内）：
                    // category==='vestibule' 的机器 center = door = origin
                    //（BlueprintEngine BP_VESTIBULE 分支，CE
                    // Architect.c:1120-1140 的落位锚点语义——前厅 feature 恒落
                    // origin，机器没有"宝藏落点"概念，门格 LOCKED_DOOR 封不住
                    // 任何宝藏）。V-1c 时生产数据无递归、前厅机器绝迹，本
                    // 扫描从未见过该形态；V-2a 前厅回归后按 CE 语义把
                    // vestibule 机器排除出"center 可通行 ∧ ≠door"两条检查
                    // （center ∈ cells 的检查保留）。reward/key_guard 的
                    // 合同不变。
                    const isVestibule = mr.category === 'vestibule';
                    const bpDef = (blueprintData as BlueprintDef[]).find(b => b.id === mr.blueprintId);
                    // CE Architect.c:1145-1205：非 BP_ROOM / 非 BP_VESTIBULE 的
                    // area machine 以随机 FLOOR origin 扩张；后续 feature 可以把
                    // origin 覆盖成深水。center 是 web 的房间宝藏落点合同，不是
                    // CE area machine 的合同（且 B-4b 已拆除 center 自创投宝）。
                    const isArea = !bpDef?.flags.includes('BP_ROOM')
                        && !bpDef?.flags.includes('BP_VESTIBULE');
                    // V-2b-9e：CE39 等区域的 origin 就是 center。仅允许有真实
                    // 成功 feature + 地面物品指令双证据的 BUILD_AT_ORIGIN；
                    // 房间/前厅不享受此规则。33 号领养携带品的既存双输出
                    // 缺陷另登记于 9e 报告，不借本次路由改动改写 feature 产物。
                    if (isArea && mr.featureSpawns.some(spawn => {
                        const f = bpDef?.features[spawn.featureIndex];
                        return spawn.pos.x === mr.center.x && spawn.pos.y === mr.center.y
                            && f?.flags.includes('MF_BUILD_AT_ORIGIN')
                            && (f.flags.includes('MF_ADOPT_ITEM') || f.flags.includes('MF_GENERATE_ITEM'));
                    })) {
                        originItemSpawns.push(...mr.itemSpawns.filter(spawn =>
                            spawn.pos.x === mr.center.x && spawn.pos.y === mr.center.y));
                    }
                    // CE8 has no interior; its origin is an anchor, not a treasure cell.
                    // Keep the room/vestibule contract and reject every other empty machine.
                    const emptyOutsource = bpDef?.ceBlueprintId === 8;
                    if (emptyOutsource) {
                        expect(bpDef!.roomSize).toEqual([0, 0]);
                        expect(mr.cells).toEqual([]);
                        expect(mr.door).toBeNull();
                        expect(mr.itemSpawns).toEqual([]);
                        expect(mr.subMachines.length).toBeGreaterThan(0);
                        expect(bpDef!.features.every(f => f.flags.includes('MF_BUILD_ANYWHERE_ON_LEVEL')
                            && f.flags.includes('MF_OUTSOURCE_ITEM_TO_MACHINE'))).toBe(true);
                        for (const spawn of outsourcedAnchorItems(mr)) {
                            emptyAnchorSpawns.add(spawn);
                        }
                    }
                    const inside = emptyOutsource || cellSet.has(cKey);
                    const passable = (isVestibule || isArea) ? true : walkable(game, mr.center.x, mr.center.y);
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
                        if (dKey === cKey && !isVestibule && !isArea) {
                            result.centerViolations.push(
                                `seed=${seed} D${depth} ${mr.blueprintId} door 与 center 重合（LOCKED_DOOR 会封死宝藏格）`
                            );
                        }
                    }
                }

                // Preserve the original origin sample counter, and never let an
                // overlapping CE8 allowance justify the same instance twice.
                const trueOriginSpawns = new Set(originItemSpawns);
                const acceptedIds = new Set(originItemSpawns.flatMap(s => s.instanceId ? [s.instanceId] : []));
                for (const spawn of emptyAnchorSpawns) if (!acceptedIds.has(spawn.instanceId!)) {
                    originItemSpawns.push(spawn);
                    acceptedIds.add(spawn.instanceId!);
                }

                // 用例 3：所有center坐标上的物品都检查通行性；坐标重合不等于中心直投。
                for (const item of game.items) {
                    const key = `${item.loc.x},${item.loc.y}`;
                    if (!centers.has(key)) continue;
                    const id = itemId(item);
                    // 每份成功声明只能消费一次；额外直投/重复物品仍然翻红。
                    const declared = originItemSpawns.findIndex(spawn =>
                        spawn.pos.x === item.loc.x && spawn.pos.y === item.loc.y
                        && ItemCategory[spawn.category as keyof typeof ItemCategory] === item.category
                        && (spawn.category === 'KEY'
                            ? !!spawn.keyLoc?.length && JSON.stringify(spawn.keyLoc) === JSON.stringify(item.keyLoc)
                            : !spawn.id || spawn.id === itemId(item)));
                    const ordinary = declared < 0 && consumeOrdinaryCenterItem(game, item, populationProducts);
                    if (declared >= 0) {
                        const [spawn] = originItemSpawns.splice(declared, 1);
                        // An empty CE8 anchor overlap is legal, but cannot satisfy
                        // the original non-vacuity guard for true BUILD_AT_ORIGIN area items.
                        if (trueOriginSpawns.has(spawn!)) result.declaredOriginItems++;
                    } else if (ordinary) {
                        result.ordinaryCenterItems.push(`seed=${seed} D${depth} ${centers.get(key)} ${id} @ (${item.loc.x},${item.loc.y})`);
                    } else {
                        result.itemsAtCenter.push(
                            `seed=${seed} D${depth} ${centers.get(key)} ${id} @ (${item.loc.x},${item.loc.y})`
                        );
                    }
                    if (isCenterTreasure(item)) {
                        result.treasuresAtCenter++;
                        if (declared < 0 && !ordinary) result.unexplainedTreasuresAtCenter++;
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
            restore(); restorePopulation();
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

    if (proc?.env?.BP_CENTER_EVIDENCE) {
        fs.writeFileSync(proc.env.BP_CENTER_EVIDENCE, JSON.stringify({ ...result, treasureTally: [...result.treasureTally] }, null, 2) + '\n');
    }
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

    it(`b) 全局扫描（${SCAN_SEEDS.length} seeds × D1..D26）：房间 center 可通行、区域 origin 属于 interior（CE8 空域单独验证）`, () => {
        const { centerViolations } = runScan();
        for (const v of centerViolations.slice(0, 60)) console.log('[bp-center] center违例:', v);
        expect(centerViolations).toEqual([]);
    }, 900_000);

    // ── B-4b 反转（验收方 2026-09-18 补授权：本文件不在 B-4b 清单内，是验收方漏项）──
    // 原留痕：「非空转护栏——扫描必须真的覆盖到 center 宝藏」，expected > 0。
    // B-4b **删除了 machine center 的宝藏投放循环**：那是 web 自创的
    // 「每个机器房中心塞一件好东西」，CE 的蓝图 feature 表里没有对应物
    // （CE 每个 feature 实例只摆一件、且由蓝图显式声明），它和祭坛每格 20%
    // 一起构成了 P1-50 里附魔卷轴每局 48-68 张的结构性来源。
    // U04c/K31（用户要求冲突以CE为准）：center坐标不是永久机器旗标。
    // BP_NO_INTERIOR_FLAG清号后的中心以及CE8空域锚点允许普通populateItems
    // 偶然落位；按真实产物身份追踪其来源，额外/重复直投仍为零，不用单纯
    // machineNumber==0作为放行条件。所有中心物品可通行断言完整保留。
    it('c) 反转：machine center 的自创宝藏投放已拆除（B-4b），且如有 center 物品其落格必可通行', () => {
        const { unexplainedTreasuresAtCenter, treasureViolations } = runScan();
        for (const v of treasureViolations.slice(0, 60)) console.log('[bp-center] 宝藏违例:', v);
        expect(unexplainedTreasuresAtCenter, '不得出现既非声明feature、也非真实普通人口物品的center宝藏')
            .toBe(0);
        expect(treasureViolations).toEqual([]);
    }, 900_000);

    // ── V-2b-1 §1.3：把「前厅 center 豁免」的安全前提从『碰巧没人用』搬成『有测试钉住』──
    // V-2a 给 vestibule 机器豁免了「center 可通行 ∧ ≠door」检查（本文件用例 b），
    // 豁免的安全性建立在：没有任何活代码把物品投放到机器 center。V-2a 当时这条
    // 前提靠两段死代码垫着（Architect.trapVaults / Architect.cages 声明后从未
    // push，Game.populateLevel 里消费它们的两个循环每台机器投放钥匙+宝藏/
    // 钥匙+怪物——数组恒空所以从不运行）。V-2b-1 删除了这四处死代码；本条
    // 把前提显式钉住：**任何物品（不限宝藏类别）落在任何机器 center 上都翻红**。
    // 前厅机器 center==door==origin==门格（V-2a 豁免所针对的形态），物品落上去
    // 与落进 LOCKED_DOOR 格同样不可达，故不做前厅豁免——将来若把 CE :300 的
    // KEY 本地化（去掉 MF_OUTSOURCE / 解除消费端 KEY 跳过），必须先想清楚
    // center==door 的落格问题，而不是绕过本断言。
    // V-2b-9e：上段“任何机器”的历史前提过期。区域按 CE 显式 feature
    // 声明接物品；前厅/房间零 center 直投仍保持，且所有地面物品仍检查可达。
    it('e) 编号origin仅接声明feature；已清号center允许真实人口物品，额外直投仍为零', () => {
        const { itemsAtCenter, declaredOriginItems, ordinaryCenterItems } = runScan();
        expect(ordinaryCenterItems.length, '必须观测到清号center上的真实普通落物，不能空转').toBeGreaterThan(0);
        expect(declaredOriginItems, '必须观测到真实的区域 origin 地面物品，不能空转').toBeGreaterThan(0);
        for (const v of itemsAtCenter.slice(0, 60)) console.log('[bp-center] center 物品违例:', v);
        expect(itemsAtCenter, `发现 ${itemsAtCenter.length} 件物品落在机器 center 上` +
            '——没有对应的区域 BUILD_AT_ORIGIN feature/清号格人口产物，或物品重复直投。')
            .toEqual([]);
    }, 900_000);

    it('f) 普通人口豁免必须有真实对象来源、非机器格，且同一产物只能消费一次', () => {
        const grid = new Grid(DCOLS, DROWS), item = ItemLoader.spawnScroll('scroll_of_enchantment', 5, 5)!;
        grid.setTerrain(5, 5, TerrainType.FLOOR);
        const products = new Set([item]);
        // Counterexample: a resurrected direct-center treasure, even on released floor.
        const invented = ItemLoader.spawnScroll('scroll_of_enchantment', 5, 5)!;
        expect(consumeOrdinaryCenterItem({grid}, invented, products)).toBe(false);
        grid.getCell(5, 5)!.machineNumber = 1;
        expect(consumeOrdinaryCenterItem({grid}, item, products)).toBe(false);
        grid.getCell(5, 5)!.machineNumber = 0;
        expect(consumeOrdinaryCenterItem({grid}, item, products)).toBe(true);
        expect(consumeOrdinaryCenterItem({grid}, item, products)).toBe(false);
    });

    it('g) CE8 空锚点只接受原实例经子机成功领养的落物；伪造实例或 feature 不得放行', () => {
        const pos = {x: 62, y: 26};
        const spawn = {instanceId: '3:0', category: 'ARMOR', pos, viaAdoption: true};
        const child = {blueprintId: 'key_explosive_trap', itemSpawns: [spawn],
            featureSpawns: [{pos, featureIndex: 2}], subMachines: []};
        const parent = {blueprintId: 'reward_outsourced_item', center: pos, cells: [], itemSpawns: [],
            generatedItems: [{instanceId: '3:0'}], subMachines: [child]} as unknown as MachineResult;
        expect(outsourcedAnchorItems(parent)).toEqual([spawn]);
        spawn.instanceId = 'invented';
        expect(outsourcedAnchorItems(parent)).toEqual([]);
        spawn.instanceId = '3:0'; child.featureSpawns[0]!.featureIndex = 0;
        expect(outsourcedAnchorItems(parent)).toEqual([]);
        child.featureSpawns[0]!.featureIndex = 2; spawn.viaAdoption = false;
        expect(outsourcedAnchorItems(parent)).toEqual([]);
        spawn.viaAdoption = true; child.itemSpawns.push({...spawn});
        expect(outsourcedAnchorItems(parent)).toHaveLength(1);
        parent.generatedItems![0]!.instanceId = undefined;
        expect(outsourcedAnchorItems(parent)).toEqual([]);
    });

    it('d) 元断言（P1-36）：isCenterTreasure 点名的 id 必须真实存在于数据表，前缀必须仍命中真实物品', () => {
        // 数据表全量 id 集（consumables.json：potions/scrolls/food；arcana.json：
        // wands/staffs/rings/charms/keys/amulets）。注意这里查的是**数据表存在性**
        // ——正是 'scroll_of_enchanting'（拼错）与 'wand_of_fire'（退池）当年
        // 溜过去的地方；生成池口径的进一步收缩由各自的池测试把守。
        const allIds = new Set<string>();
        const addTable = (table: unknown): void => {
            for (const entry of table as Array<{ id?: string }>) {
                if (typeof entry?.id === 'string' && entry.id.length > 0) allIds.add(entry.id);
            }
        };
        const consumables = consumablesData as Record<string, unknown>;
        for (const key of Object.keys(consumables)) addTable(consumables[key]);
        const arcana = arcanaData as Record<string, unknown>;
        for (const key of Object.keys(arcana)) addTable(arcana[key]);
        expect(allIds.size, '数据表为空——id 数据导入方式失效，本断言已空转').toBeGreaterThan(0);

        // 1) 显式点名的每个 id 必须存在（startsWith 前缀判据除外——它们下面单查）
        const missing = CENTER_TREASURE_IDS.filter(id => !allIds.has(id));
        expect(
            missing,
            `isCenterTreasure 点名的 id 在数据表中不存在（拼写错误或已删项）——` +
            `判据恒 false、护栏空转（P1-36 的教训正是 'scroll_of_enchanting' 与 ` +
            `'wand_of_fire'）：\n${missing.join('\n')}`
        ).toEqual([]);

        // 2) 每个前缀判据必须仍命中至少一个真实 id（防整族改名/退池后判据静默空转）
        const deadPrefixes = CENTER_TREASURE_PREFIXES.filter(
            p => ![...allIds].some(id => id.startsWith(p))
        );
        expect(
            deadPrefixes,
            `isCenterTreasure 的前缀判据在数据表中已无任何命中（整族退池或改名？）` +
            `——判据恒 false、护栏空转：\n${deadPrefixes.join('\n')}`
        ).toEqual([]);

        // 3) 护栏非空转自检：判据集合必须真的能命中东西（显式 id 或前缀）
        const alive = CENTER_TREASURE_IDS.some(id => allIds.has(id))
            || CENTER_TREASURE_PREFIXES.some(p => [...allIds].some(id => id.startsWith(p)));
        expect(alive, 'isCenterTreasure 的全部判据都命不中任何真实 id').toBe(true);
    });
});
