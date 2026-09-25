/**
 * src/engine/Map/Promotion.ts — CE promoteTile + 每回合两趟晋升驱动（C-4c）
 *
 * CE 蓝本（BrogueCE-master/src/brogue/Time.c，只读；行号本轮逐条打开复核）：
 *   - promoteTile            Time.c:1244-1287
 *   - updateEnvironment      Time.c:1590-1705，其中：
 *       两趟晋升              :1619-1663（一趟记位、二趟落地；:1647 被注释掉的
 *                              `// promoteTile(i, j, layer, false);` 是作者从
 *                              一趟改两趟留下的痕迹）
 *       记账趟                :1665-1684（清 CAUGHT_FIRE_THIS_TURN、
 *                              PRESSURE_PLATE_DEPRESSED、TM_PROMOTES_WITHOUT_KEY）
 *       火势更新              :1686-1701（exposeTileToFire 循环——**未移植**，
 *                              web 火焰由 Gas.ts 的 isBurning 系统承担，见文末
 *                              "与 CE 的有意差异"）
 *
 * ★★★ 本文件不是"逐位不变"迁移：它接上后游戏行为真的会变 ★★★
 * （门开/自动关门、踩楼梯晋升、硫矿掷骰……）——这是 C-4c 的目的。
 *
 * 复核出的 CE 实现要点（本轮逐条核对过源码）：
 *   1. promoteTile 的顺序：取当前层 tile → 选 DF（useFireDF ? fireType :
 *      promoteType）→ TM_VANISHES_UPON_PROMOTION 清层（DUNGEON 层清成 FLOOR、
 *      其余层清成 NOTHING——"even the dungeon layer implicitly has floor
 *      underneath it"，:1258-1261；清 T_PATHING_BLOCKER 时置
 *      rogue.staleLoopMap，:1255-1257；GAS 层连 volume 一起清，:1262-1264）→
 *      spawnDungeonFeature(x, y, DF, true, false)（:1268——**五个形参**，
 *      第 4 参 refreshCell = true、第 5 参 abortIfBlocking = false）→
 *      接线机器分支（:1271-1286）。
 *      **先清层再 spawn 正是 DOOR(drawPriority 8) 能晋升 OPEN_DOOR(25) 的原因**：
 *      清层后 fillSpawnMap 看到的旧地形是 FLOOR(95) ≥ 25，优先级判据放行。
 *      ★ 验收方复核：任务书是对的，本注释原先的反驳有误 ★
 *      CE 签名五参（Rogue.h:2933）：(x, y, feat, refreshCell, abortIfBlocking)。
 *      :1268 的 `true` 是 refreshCell，`false` 才是 abortIfBlocking。
 *      执行方按四参读，把两个布尔的位置搞反了。已改正为 false。
 *      但执行方另一半是对的：挡住 DOOR→OPEN_DOOR 的机理是 **vanish 清层**
 *      （清成 FLOOR(95) ≥ OPEN_DOOR(25) 才让 fillSpawnMap 放行），
 *      **不是** abortIfBlocking——验收方任务书里那条因果写错了。
 *      今天两种传法确实无可观测差别（当前晋升链的产物都不是 T_PATHING_BLOCKER），
 *      但传 true 是潜伏偏离：C-5 的深渊、C-4d 的火焰/岩浆 DF 落地后，
 *      它会静默拒绝 CE 会执行的晋升。
 *   2. 两趟晋升（:1622-1663）：
 *      第一趟对每格每层——
 *        tile.promoteChance < 0（扩散型）：promoteChance 从 0 起，对 4 向邻居
 *          逐个检查"在图内 && 邻格不挡通行(T_OBSTRUCTS_PASSABILITY) && 邻格
 *          同层地形 ≠ 本格同层地形 && 本格本回合未起火"（:1629-1640，注意
 *          起火检查在邻居循环**内部**，CE 原文如此），每个合格邻居
 *          promoteChance += -tile.promoteChance；
 *        否则（普通型）：promoteChance = tile.promoteChance（:1642）。
 *        promoteChance 非零且本格未起火时掷 rand_range(0, 10000)（:1644-1645），
 *          中签则把该层记进 promotions[i][j] 位图——**不立即落地**。
 *        ★ RNG 只在 promoteChance 非零时消耗：promoteChance=0 的层不掷骰。
 *      第二趟按 x→y→layer 序对位图逐个 promoteTile——CE 不复查"该层是否仍
 *        可晋升"（:1658 的检查被作者注释掉了），本实现同样不复查。
 *   3. 记账趟（:1665-1684）：清全图 CAUGHT_FIRE_THIS_TURN（:1668；web 用
 *      turn 级 Set 承载，见下）；清无主 PRESSURE_PLATE_DEPRESSED（:1669-1673；
 *      web 无该格旗标，登记不实现）；TM_PROMOTES_WITHOUT_KEY 且格上无钥匙
 *      （keyOnTileAt，Items.c:4062）时逐层晋升（:1674-1682）。注意：清除发生在
 *      WITHOUT_KEY 循环**之前**，所以 WITHOUT_KEY 晋升若引发起火，其
 *      CAUGHT_FIRE_THIS_TURN 会存活到下一回合才清。
 *   4. CE promoteTile 本体不掷骰：晋升链全部 19 条 DF 的 startProbability=0
 *      （spawnMapDF 的 while 不执行，零消耗）。掷骰只发生在驱动的第一趟。
 *   5. TM_IS_WIRED / activateMachine / circuitBreakersPreventActivation
 *      （:1271-1286、:1230-1242）——**V-2b-3 已实现**（C-4d 接线网络，
 *      留痕反转：原"命中只置 wiredBranchHit 留痕"的占位升格为真实通电）。
 *      CE 三要点照抄：先置 IS_POWERED 再递归（防无限闸）、机器不必连续
 *      （按 machineNumber 全图扫，:1276-1277 注释）、激活结束把**全图**
 *      IS_POWERED 清掉（:1280-1285，不止本机器）。CE activateMachine 的
 *      两次洗牌（:1177-1180）无条件照掷——RNG 流对齐。怪物激活段
 *      （:1201-1227，MONST_GETS_TURN_ON_ACTIVATION 的怪获得回合）web 无
 *      machineHome 载体（怪物不记属机），登记 V-2b-5/6。
 *
 * 与 CE 的有意差异（登记表，均由 web 现状决定）：
 *   ┌────────────────────────────────┬────────────────────────────────────┐
 *   │ CE 行为                        │ web 处置                           │
 *   ├────────────────────────────────┼────────────────────────────────────┤
 *   │ pmap CAUGHT_FIRE_THIS_TURN 格旗标│ turn 级 Set<index>；Game 侧把上一  │
 *   │ 跨回合存活（:1668 清）         │ 回合的存留集回喂本驱动（CE 语义：  │
 *   │                                │ 记账趟先清、后继晋升可再置）       │
 *   │ refreshDungeonCell 渲染刷新    │ 结果对象 renderDirty，Game 置      │
 *   │                                │ needsRender                        │
 *   │ rogue.staleLoopMap             │ 结果对象 staleLoopMap（LoopMap.ts  │
 *   │                                │ 禁改，只登记）                     │
 *   │ DF 消息/视野门控               │ spawn 结果 message 由 Game 消费    │
 *   │ updateEnvironment 的火势循环   │ 不移植——web 火焰 = Gas.ts          │
 *   │   （:1686-1701）               │ isBurning 系统；接 CE 火地形需     │
 *   │                                │ PLAIN_FIRE 等 tile，属后续轮次     │
 *   │ monstersFall / 体积气体        │ 不在本驱动（C-5 / Gas.ts 既有）    │
 *   │ DFF_EVACUATE_CREATURES_FIRST   │ 共享 DF 事务先疏散实体 │
 *   │ monstersFall 之外的即时地形后果│ spawn 结果登记（C-4b 差异表）      │
 *   └────────────────────────────────┴────────────────────────────────────┘
 *
 * ★ web 特有：缺 tile DF 的"整链预检 + 整次缓办" ★
 * CE 目录 219 条 tile 全存在；web 的 19 条闭包里 11 条 tile=null（C-4b 登记）。
 * catalogFeature 对 null tile 会抛错，且抛点可能在 subsequentDF 链的**中段**
 * （如 DF_INERT_BRIMSTONE → DF_BRIMSTONE_FIRE）——若在 vanish 之后才炸，会
 * 留下"CE 不可能出现的半晋升态"（例如门没了但门没开）。因此 promoteTile 在
 * 任何 mutation 之前先走一遍 subsequentDF 链：链上任何一环 tile 缺失 →
 * **整次晋升缓办**（地形不动），在结果里响亮登记缺的目录名。这不改变 CE
 * 行为有定义的部分，只是把"CE 不存在的输入"从崩溃/半态改成显式缓办。
 * 合成 DF 条目的隐含约定（非 GAS 扩散条目必须 probDec>0，否则 spawnMapDF
 * 死循环）由 c_4c_promotion.test.ts 的目录级断言钉死。
 */
import type { Pos } from '../../types';
import { rng } from '../Random';
import { DungeonLayer, DRAW_PRIORITY, Grid, TerrainType } from './Grid';
import {
    TERRAIN_FLAGS,
    T_CAUSES_EXPLOSIVE_DAMAGE,
    T_IS_FLAMMABLE,
    T_IS_FIRE,
    T_IS_DF_TRAP,
    T_OBSTRUCTS_GAS,
    T_OBSTRUCTS_PASSABILITY,
    T_ENTANGLES,
    T_OBSTRUCTS_VISION,
    T_OBSTRUCTS_DIAGONAL_MOVEMENT,
    T_PATHING_BLOCKER,
    TM_EXPLOSIVE_PROMOTE,
    TM_EXTINGUISHES_FIRE,
    TM_IS_CIRCUIT_BREAKER,
    TM_IS_SECRET,
    TM_IS_WIRED,
    TM_PROMOTES_ON_PLAYER_ENTRY,
    TM_PROMOTES_ON_ITEM,
    TM_PROMOTES_ON_ITEM_PICKUP,
    TM_PROMOTES_ON_STEP,
    TM_PROMOTES_WITHOUT_KEY,
    TM_VANISHES_UPON_PROMOTION,
} from './TerrainCatalog';
import {
    catalogFeature,
    spawnDungeonFeature,
    refreshDungeonCellTerrain,
    cellTerrainFlags,
    cellTerrainMechFlags,
    type SpawnFeatureResult,
} from './DungeonFeature';
import { DUNGEON_FEATURE_CATALOG, DF, type DungeonFeatureEntry } from './DungeonFeatureCatalog';

/** CE nbDirs 前 4 项（GlobalsBase.c:38）——驱动邻居累加用，顺序与 CE 一致。 */
const DIRS4: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
];

// ── DF 目录名字符串 → 枚举（TerrainCatalog 存 CE 目录名，C-4a 决策）────────

const DF_NAME_TO_ID: ReadonlyMap<string, DF> = (() => {
    const m = new Map<string, DF>();
    for (const k of Object.keys(DF)) {
        if (!Number.isNaN(Number(k))) continue; // 数字键是枚举的反向映射，跳过
        m.set(k, (DF as unknown as Record<string, DF>)[k]!);
    }
    return m;
})();

/** TerrainCatalog 的 fireType/promoteType 字符串解析；'' = CE 0 = 无。 */
export function resolveDFName(name: string): DF | null {
    if (name === '') return null;
    const df = DF_NAME_TO_ID.get(name);
    if (df === undefined) {
        throw new Error(
            `TerrainCatalog 引用了 C-4b 目录没有的 DF 名 "${name}"——目录闭包缺口，请先补 DUNGEON_FEATURE_CATALOG`
        );
    }
    return df;
}

// ── 缺 tile 预检（含 subsequentDF 整链）────────────────────────────────────

export type DeferredReason = 'catalog-entry-missing' | 'tile-missing-in-web';

export interface DeferredPromotion {
    x: number;
    y: number;
    layer: DungeonLayer;
    /** 请求晋升到的 DF（useFireDF 选出的那一个）。 */
    df: DF;
    /** 链上第一个无法落地的环节（= df 本身，或链中段某环）。 */
    missingDf: DF;
    missingDfName: string;
    /** 该环节的 CE tileType 目录名（entry 缺失时为 '?'）。 */
    missingCeTile: string;
    reason: DeferredReason;
}

/** 走 df 的 subsequentDF 链，返回第一个 catalog 缺条目/tile 缺名的环节；链完整
 *  返回 null。带环守卫（当前目录无环，防御未来条目）。 */
function firstMissingTileInChain(df: DF): {
    missingDf: DF; missingDfName: string; missingCeTile: string; reason: DeferredReason;
} | null {
    const seen = new Set<DF>();
    let cur: DF | null = df;
    while (cur !== null && !seen.has(cur)) {
        seen.add(cur);
        const entry: DungeonFeatureEntry | undefined = DUNGEON_FEATURE_CATALOG[cur];
        if (!entry) {
            return { missingDf: cur, missingDfName: String(DF[cur]), missingCeTile: '?', reason: 'catalog-entry-missing' };
        }
        if (entry.tile === null && cur !== DF.DF_ALTAR_RESURRECT) {
            return { missingDf: cur, missingDfName: String(DF[cur]), missingCeTile: entry.ceTile, reason: 'tile-missing-in-web' };
        }
        cur = entry.subsequentDF;
    }
    return null;
}

/** CE Movement.c:2437-2457: preflight the DF, remove the hidden layer,
 * then use the same DF transaction as promotion. Missing later-family carriers
 * remain intact; discovery must not erase an undisplayable/unsolvable tile. */
export function discoverTerrain(grid: Grid, x: number, y: number): boolean {
    const cell = grid.getCell(x, y);
    if (!cell) return false;
    let discovered = false;
    for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
        const tile = TERRAIN_FLAGS[cell.layers[layer]!]!;
        if (!(tile.mechFlags & TM_IS_SECRET)) continue;
        const df = resolveDFName(tile.discoverType);
        if (df === null || firstMissingTileInChain(df)) continue;
        grid.setTerrainLayer(x, y, layer, layer === DungeonLayer.DUNGEON ? TerrainType.FLOOR : TerrainType.NOTHING);
        spawnDungeonFeature(grid, x, y, catalogFeature(df), false);
        discovered = true;
    }
    if (discovered) refreshDungeonCellTerrain(grid, x, y);
    return discovered;
}

// ── 接线机器（CE Time.c:1173-1287 的 activateMachine / circuitBreakers 段，
//    V-2b-3 实现——C-4c 时代为留痕占位）────────────────────────────────────

/** activateMachine 的结果（测量与 Game 侧播报用）。 */
export interface WiredActivationResult {
    /** 激活的机器号。 */
    machineNumber: number;
    /** 本次置 IS_POWERED 的格（CE :1186-1197 命中序 = 洗牌后的扫描序）。 */
    poweredCells: Pos[];
    /** 每个 powered 格逐层 promoteTile 的明细（CE :1192-1196）。 */
    promotions: PromoteTileResult[];
}

/**
 * CE circuitBreakersPreventActivation（Time.c:1230-1242）的直译：全图扫描
 * （x 外层 y 内层），本机器号任一格带 TM_IS_CIRCUIT_BREAKER 即阻断激活。
 * CE 字面无 IS_IN_MACHINE 要求——只按 machineNumber 匹配（0 号机器的格
 * machineNumber 恒 0，扫描同样成立，照抄）。
 */
export function circuitBreakersPreventActivation(grid: Grid, machineNumber: number): boolean {
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) {
            const cell = grid.getCell(x, y);
            if (!cell || cell.machineNumber !== machineNumber) continue;
            if (cellTerrainMechFlags(grid, x, y) & TM_IS_CIRCUIT_BREAKER) {
                return true;
            }
        }
    }
    return false;
}

/**
 * CE activateMachine（Time.c:1173-1228）的直译：给机器里所有带 TM_IS_WIRED
 * 的未通电格通电，并对每个 wired 层 promoteTile。
 *
 * RNG（与 CE 逐位对齐）：:1177-1180 的 fillSequentialList 零消耗 + 两次
 * shuffleList（列先、行后）各掷 (宽-1) + (高-1) 次 rand_range——**无条件先
 * 掷**，哪怕机器没有 wired 格或机器号为 0（CE 字面：洗牌在扫描之前）。
 *
 * web 的 IS_IN_MACHINE 等价物 = machineNumber !== 0（BlueprintEngine 既定
 * 口径）：CE 的扫描条件是 IS_IN_MACHINE ∧ machineNumber 相等 ∧ 未通电 ∧
 * 格上任一层带 TM_IS_WIRED；machineNumber<=0 时 CE 的 IS_IN_MACHINE 恒假
 * ——以显式守卫表达同一语义（洗牌照掷，扫描空转）。
 *
 * ★ 相互递归与终止 ★：本函数对每个 powered 格调 promoteTile，其 wired 分支
 * 因 IS_POWERED 已置位（CE :1277 先置位再递归）而不再反向调用本函数——
 * 这道闸是唯一的终止保证，不得在扫描里提前清位。
 *
 * ★ CE :1201-1227 的怪物激活段（machineHome == machineNumber 且
 * MONST_GETS_TURN_ON_ACTIVATION 的怪获得回合）web 无载体：怪物不记属机
 * （spawnBlueprintItem/monsterSpawns 均无 machineHome 字段），登记 V-2b-5/6
 * 接线；本实现不模拟其效果、也不消耗其无 RNG 的份额（该段零掷骰）。
 */
export function activateMachine(grid: Grid, machineNumber: number): WiredActivationResult {
    const result: WiredActivationResult = {
        machineNumber,
        poweredCells: [],
        promotions: [],
    };

    // CE :1177-1180：fillSequentialList(sCols/sRows) + shuffleList 各一次
    // ——列先、行后；顺序即 RNG 消耗顺序，不得对调。
    const sCols: number[] = [];
    for (let v = 0; v < grid.width; v++) sCols.push(v);
    rng.shuffleList(sCols);
    const sRows: number[] = [];
    for (let v = 0; v < grid.height; v++) sRows.push(v);
    rng.shuffleList(sRows);

    if (machineNumber <= 0) return result; // web IS_IN_MACHINE 守卫（见头注）

    // CE :1182-1199：洗过的列序 × 行序双层扫描（i 走列、j 走行）。
    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            const x = sCols[i]!;
            const y = sRows[j]!;
            const cell = grid.getCell(x, y);
            if (!cell) continue;
            if (cell.machineNumber !== machineNumber || cell.isPowered) continue;
            // CE :1189 cellHasTMFlag 的跨层问法：任一层带 TM_IS_WIRED。
            if ((cellTerrainMechFlags(grid, x, y) & TM_IS_WIRED) === 0) continue;

            cell.isPowered = true; // CE :1191：先置位再晋升（相互递归的闸）
            result.poweredCells.push({ x, y });
            for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
                if (TERRAIN_FLAGS[cell.layers[layer]!]!.mechFlags & TM_IS_WIRED) {
                    result.promotions.push(
                        promoteTile(grid, x, y, layer as DungeonLayer, false)
                    );
                }
            }
        }
    }
    return result;
}

/** 清除全图 IS_POWERED（CE :1281-1285 的字面全图循环）。 */
function clearAllPowered(grid: Grid): void {
    for (let x = 0; x < grid.width; x++) {
        for (let y = 0; y < grid.height; y++) {
            const cell = grid.getCell(x, y);
            if (cell) cell.isPowered = false;
        }
    }
}

// ── promoteTile（CE Time.c:1244-1287）──────────────────────────────────────

export interface PromoteTileResult {
    /** 晋升发生的格（V-2b-3 补：wired 激活的嵌套晋升明细需要坐标寻址）。 */
    x: number;
    y: number;
    /** 晋升发生前该层的地形（测量按源地形分类用）。 */
    sourceTerrain: TerrainType;
    layer: DungeonLayer;
    /** TM_VANISHES_UPON_PROMOTION 清层是否执行。 */
    vanished: boolean;
    /** 选中的 DF（'' → null；缓办时也给出请求值）。 */
    df: DF | null;
    /** spawnDungeonFeature 结果（无 DF 或缓办时 null）。 */
    spawn: SpawnFeatureResult | null;
    /** 非 null = 整次晋升缓办（链上有缺 tile 环节），地形未动。 */
    deferred: DeferredPromotion | null;
    /** TM_IS_WIRED 分支被命中（V-2b-3 留痕反转：语义从"命中留痕"升格为
     *  "本格发起了 wired 通电"——CE 全四条件成立才会是 true，嵌套晋升里
     *  已带电的格不进分支故为 false）。明细在 wired 字段。 */
    wiredBranchHit: boolean;
    /**
     * 非 null = 本格发起了机器激活（CE :1277-1278 置位 + activateMachine）。
     * 含激活期内所有被通电格的逐层晋升明细（含其缓办登记，Game 侧可据此
     * 播报/测量）；CE 怪物激活段（:1201-1227）web 无 machineHome 载体，
     * 不在结果内（登记 V-2b-5/6）。
     */
    wired: WiredActivationResult | null;
    /** 是否发生了任何地形变化（vanish 或 spawn 落格）。 */
    mutated: boolean;
    /** rogue.staleLoopMap 登记（清掉 T_PATHING_BLOCKER 时）。 */
    staleLoopMap: boolean;
}

/**
 * CE promoteTile：把 (x,y) 的 layer 层晋升到它的 promoteType（useFireDF 时
 * fireType）。CE :1268 字面：abortIfBlocking=true、refreshMap=false。
 * 不掷骰（CE 本体无 RNG；扩散 DF 的骰在 spawnMapDF，本链条目 start 全为 0）。
 */
export function promoteTile(
    grid: Grid,
    x: number,
    y: number,
    layer: DungeonLayer,
    useFireDF: boolean
): PromoteTileResult {
    const cell = grid.getCell(x, y);
    if (!cell) {
        throw new Error(`promoteTile: (${x},${y}) 不在图内`);
    }
    const sourceTerrain = cell.layers[layer]!;
    const tile = TERRAIN_FLAGS[sourceTerrain]!;

    const result: PromoteTileResult = {
        x,
        y,
        sourceTerrain,
        layer,
        vanished: false,
        df: null,
        spawn: null,
        deferred: null,
        wiredBranchHit: false,
        wired: null,
        mutated: false,
        staleLoopMap: false,
    };

    // CE :1252：DFType = useFireDF ? fireType : promoteType
    const dfName = useFireDF ? tile.fireType : tile.promoteType;
    let df: DF | null = resolveDFName(dfName);
    result.df = df;

    // web 特有：整链缺 tile 预检（见文件头）——在任何 mutation 之前。
    if (df !== null) {
        const missing = firstMissingTileInChain(df);
        if (missing) {
            result.deferred = {
                x, y, layer,
                df,
                missingDf: missing.missingDf,
                missingDfName: missing.missingDfName,
                missingCeTile: missing.missingCeTile,
                reason: missing.reason,
            };
            df = null;
        }
    }

    // CE :1254-1266：TM_VANISHES_UPON_PROMOTION 清层（缓办时不动地形）。
    if (!result.deferred && (tile.mechFlags & TM_VANISHES_UPON_PROMOTION)) {
        if (tile.flags & T_PATHING_BLOCKER) {
            result.staleLoopMap = true; // CE :1255-1257 rogue.staleLoopMap = true
        }
        grid.setTerrainLayer(
            x, y, layer,
            layer === DungeonLayer.DUNGEON ? TerrainType.FLOOR : TerrainType.NOTHING
        );
        // CE :1262-1264 GAS 层连 volume 清零。G-1 起 Cell.volume 存在。
        // G-2 复核：本分支**仍未被真实行使**——G-1 预测"GAS_FIRE 落地时
        // 生效"不成立：GAS_FIRE 是 SURFACE 层火地形（Globals.c:741），
        // 它的 VANISHES 走上方通用的清层路径（清 SURFACE，不动 volume）。
        // CE 现目录的 GAS 层 tile 均无 VANISHES 旗标，本分支是对 CE 数据
        // 的忠实留形（未来若有带 VANISHES 的气体 tile 才会走到）。
        if (layer === DungeonLayer.GAS) {
            const vanishCell = grid.getCell(x, y);
            if (vanishCell) vanishCell.volume = 0;
        }
        result.vanished = true;
        result.mutated = true;
    }

    // CE Time.c:1268 `spawnDungeonFeature(x, y, &dungeonFeatureCatalog[DFType], true, false)`。
    //
    // ★ 验收方改正（执行方数错了参数位）★
    // CE 签名是 `(x, y, feat, refreshCell, abortIfBlocking)`（Rogue.h:2933 /
    // Architect.c:3359，**五个形参**）。所以那行的 `true` 是 refreshCell，
    // `false` 才是 abortIfBlocking。执行方把它读成四参、得出
    // "abortIfBlocking 字面是 true"，并据此在这里传了 true。
    // web 的 spawnDungeonFeature 以 options.refreshSideEffects 承载刷新，
    // 第 5 参就是 abortIfBlocking —— 应传 **false**。
    //
    // 今天无可观测差别（当前晋升链里没有 T_PATHING_BLOCKER 的产物），
    // 但传 true 是潜伏偏离：C-5 的深渊、C-4d 的火焰/岩浆 DF 落地后，
    // 它会静默拒绝 CE 会执行的晋升。
    if (df !== null) {
        // U16: the resurrection effect is game-side. Its distinct inert CE
        // appearance maps to web's existing ALTAR after a successful raise.
        const feat = df === DF.DF_ALTAR_RESURRECT
            ? { ...catalogFeature(DF.DF_ALTAR_INERT), flags: DUNGEON_FEATURE_CATALOG[df]!.flags,
                description: DUNGEON_FEATURE_CATALOG[df]!.description }
            : catalogFeature(df);
        result.spawn = spawnDungeonFeature(grid, x, y, feat, false);
        // 无地形 DF（CE tile=0，如 DF_REPEL_CREATURES）footprint 只登记原点、
        // 不写地形——不计入 mutated（渲染与测量口径）。
        if (
            feat.tile !== TerrainType.NOTHING
            && (result.spawn.builtCells.length > 0 || result.spawn.gasVolumeAdded > 0)
        ) {
            result.mutated = true;
        }
    }

    // CE :1271-1286：接线机器分支——V-2b-3 实现（C-4c 时代的留痕占位反转）。
    // 全四条件照抄：!useFireDF ∧ 格带 TM_IS_WIRED ∧ 未通电 ∧ 断路器不阻断。
    // 三要点（缺一即错，CE 原文锚点）：
    //   1. 先置 IS_POWERED 再递归（:1277）——与 activateMachine 相互递归的
    //      唯一终止闸；本格已带电时分支不进（嵌套晋升不会二次触发）。
    //   2. 机器不必连续（:1276-1277 注释 "Note that machines need not be
    //      contiguous"）——activateMachine 按 machineNumber 全图扫，不是按
    //      连通区域扩散。
    //   3. 激活结束把**全图** IS_POWERED 清掉（:1280-1285 "Power fades from
    //      the map immediately after we finish"）——不止本机器的格。
    if (!useFireDF && (tile.mechFlags & TM_IS_WIRED)) {
        if (!cell.isPowered && !circuitBreakersPreventActivation(grid, cell.machineNumber)) {
            result.wiredBranchHit = true;
            cell.isPowered = true; // CE :1277
            result.wired = activateMachine(grid, cell.machineNumber); // CE :1278 "It lives!!!"
            clearAllPowered(grid); // CE :1281-1285：电随即从全图散去
        }
    }

    refreshDungeonCellTerrain(grid, x, y);
    return result;
}

// ── 旗标触发的逐层晋升（CE Items.c:819-829 / Time.c:278-299 等共通形态）───

/**
 * 对 (x,y) 的每一层：若该层地形带 mechFlag 则 promoteTile(layer, useFireDF=false)。
 * CE 的 TM_PROMOTES_ON_STEP（= ON_CREATURE|ON_ITEM）、ON_ITEM_PICKUP、
 * ON_ITEM、ON_PLAYER_ENTRY、WITHOUT_KEY 触发点全是这个循环形状
 * （Time.c:279-288/291-299/1676-1681、Items.c:822-828/1280-1286/5067-5073）。
 */
export function promoteLayersWithMechFlag(
    grid: Grid,
    x: number,
    y: number,
    mechFlag: number
): PromoteTileResult[] {
    const out: PromoteTileResult[] = [];
    const cell = grid.getCell(x, y);
    if (!cell) return out;
    for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
        if (TERRAIN_FLAGS[cell.layers[layer]!]!.mechFlags & mechFlag) {
            out.push(promoteTile(grid, x, y, layer, false));
        }
    }
    return out;
}

/** CE Movement.c:1152-1160: select one entry layer, promote only if it blocks. */
export function promoteOnPlayerBump(grid: Grid, x: number, y: number, before?: () => void): boolean {
    const cell = grid.getCell(x, y);
    const layer = cell?.layers.findIndex(t => (TERRAIN_FLAGS[t].mechFlags & TM_PROMOTES_ON_PLAYER_ENTRY) !== 0) ?? -1;
    if (!cell || layer < 0 || !(TERRAIN_FLAGS[cell.layers[layer]!]!.flags & T_OBSTRUCTS_PASSABILITY)) return false;
    before?.();
    promoteTile(grid, x, y, layer, false);
    return true;
}

/** TM_PROMOTES_ON_STEP（CE Rogue.h:1987 = ON_CREATURE | ON_ITEM）。 */
export function promoteOnStep(grid: Grid, x: number, y: number): PromoteTileResult[] {
    return promoteLayersWithMechFlag(grid, x, y, TM_PROMOTES_ON_STEP);
}

/** CE Items.c:819-829 removeItemAt。 */
export function promoteOnItemPickup(grid: Grid, x: number, y: number): PromoteTileResult[] {
    return promoteLayersWithMechFlag(grid, x, y, TM_PROMOTES_ON_ITEM_PICKUP);
}

/** CE Items.c:1278-1286（物品落到地面时）。 */
export function promoteOnItemPlaced(grid: Grid, x: number, y: number): PromoteTileResult[] {
    return promoteLayersWithMechFlag(grid, x, y, TM_PROMOTES_ON_ITEM);
}

// ── 每回合驱动（CE updateEnvironment :1619-1684 的晋升 + 记账段）──────────

export interface PromotionDriverOptions {
    /** CE keyOnTileAt（Items.c:4062）：格上是否有钥匙类物品。Game 侧供给。 */
    keyOnTileAt: (x: number, y: number) => boolean;
    /** 本回合此前进化已起火的格（CE pmap CAUGHT_FIRE_THIS_TURN 的跨调用
     *  存活部分——上一回合记账趟之后新起火的、以及本回合外部 spawn 引起的）。
     *  CE 语义：第一趟把它当"本回合已起火"豁免晋升。 */
    caughtFireCells?: Pos[];
}

export interface PromotionUpdateResult {
    /** 第二趟逐个 promoteTile 的明细（含缓办）。 */
    promotions: PromoteTileResult[];
    /** WITHOUT_KEY 记账趟触发的晋升明细（CE :1674-1682）。 */
    withoutKeyPromotions: PromoteTileResult[];
    /** 全部缓办记录（promotions ∪ withoutKeyPromotions 的 deferred 子集）。 */
    deferred: DeferredPromotion[];
    /** 第一趟掷骰次数（= promoteChance 非零且未起火的层次数；RNG 流审计用）。 */
    rngDraws: number;
    /** 记账趟清掉的起火格数（CE :1668）。 */
    caughtFireCleared: number;
    /** 记账趟结束后仍存活的起火格（CE 语义：留到下一回合的
     *  CAUGHT_FIRE_THIS_TURN；Game 侧回喂下一次调用）。 */
    caughtFireRemaining: Pos[];
    /** 本回合是否发生过任何地形变化（渲染刷新用）。 */
    renderDirty: boolean;
    /** 任一晋升清掉了 T_PATHING_BLOCKER（rogue.staleLoopMap 登记）。 */
    staleLoopMap: boolean;
}

/**
 * CE updateEnvironment 的晋升段（两趟，:1619-1663）+ 记账趟（:1665-1684）。
 * 火势循环（:1686-1701）不在此——web 火焰由 Gas.ts 承担（文件头差异表）。
 *
 * RNG 消耗（与 CE 逐位对齐）：第一趟 x 外层 y 内层、layer 0..3，仅对
 * "promoteChance 非零且该格未起火"的层掷一次 rng.randRange(0, 10000)。
 */
export function runPromotionUpdate(
    grid: Grid,
    opts: PromotionDriverOptions
): PromotionUpdateResult {
    const W = grid.width;
    const idx = (px: number, py: number): number => py * W + px;
    // CE promotions[DCOLS][DROWS] 的层位图：bit(l) = 该层要晋升。
    const promotions = new Uint8Array(W * grid.height);
    const caughtFire = new Set<number>(
        (opts.caughtFireCells ?? []).map((p) => idx(p.x, p.y))
    );
    let rngDraws = 0;

    const result: PromotionUpdateResult = {
        promotions: [],
        withoutKeyPromotions: [],
        deferred: [],
        rngDraws: 0,
        caughtFireCleared: 0,
        caughtFireRemaining: [],
        renderDirty: false,
        staleLoopMap: false,
    };

    // ── 第一趟：只记位，不改地形（CE :1622-1651）───────────────────────────
    for (let i = 0; i < W; i++) {
        for (let j = 0; j < grid.height; j++) {
            const cell = grid.getCell(i, j)!;
            for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
                const tile = TERRAIN_FLAGS[cell.layers[layer]!]!;
                let promoteChance: number;
                if (tile.promoteChance < 0) {
                    // 扩散型：按合格 4 向邻居数负向累加（CE :1627-1640）。
                    promoteChance = 0;
                    for (let dir = 0; dir < 4; dir++) {
                        const nx = i + DIRS4[dir]![0]!;
                        const ny = j + DIRS4[dir]![1]!;
                        if (
                            grid.isValidPos(nx, ny)
                            && !(cellTerrainFlags(grid, nx, ny) & T_OBSTRUCTS_PASSABILITY)
                            && grid.getCell(nx, ny)!.layers[layer] !== cell.layers[layer]
                            && !caughtFire.has(idx(i, j))
                        ) {
                            promoteChance += -1 * tile.promoteChance;
                        }
                    }
                } else {
                    promoteChance = tile.promoteChance; // CE :1642
                }
                if (promoteChance && !caughtFire.has(idx(i, j))) {
                    // CE :1644-1645：掷了才算、没中也消耗——rngDraws 记的是
                    // 实际 rand_range 调用数（RNG 流审计口径）。
                    rngDraws++;
                    if (rng.randRange(0, 10000) < promoteChance) {
                        promotions[idx(i, j)]! |= 1 << layer;
                    }
                }
            }
        }
    }
    result.rngDraws = rngDraws;

    // ── 第二趟：落地（CE :1652-1663；不复查可晋升性，CE :1658 注释如此）───
    for (let i = 0; i < W; i++) {
        for (let j = 0; j < grid.height; j++) {
            for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
                if (promotions[idx(i, j)]! & (1 << layer)) {
                    const r = promoteTile(grid, i, j, layer, false);
                    result.promotions.push(r);
                    if (r.mutated) result.renderDirty = true;
                    if (r.staleLoopMap) result.staleLoopMap = true;
                    if (r.spawn) {
                        // CE：fillSpawnMap 落火地形时置 CAUGHT_FIRE_THIS_TURN
                        // （Architect.c:3235-3238）——记入本回合起火集。
                        for (const p of r.spawn.caughtFireCells) {
                            caughtFire.add(idx(p.x, p.y));
                        }
                    }
                }
            }
        }
    }

    // ── 记账趟（CE :1665-1684）─────────────────────────────────────────────
    for (let i = 0; i < W; i++) {
        for (let j = 0; j < grid.height; j++) {
            const k = idx(i, j);
            if (caughtFire.has(k)) {
                caughtFire.delete(k); // CE :1668
                result.caughtFireCleared++;
            }
            // CE :1669-1673 PRESSURE_PLATE_DEPRESSED：web 无该格旗标，登记不实现。
            const cell = grid.getCell(i, j)!;
            if (
                (cellTerrainMechFlags(grid, i, j) & TM_PROMOTES_WITHOUT_KEY)
                && !opts.keyOnTileAt(i, j) // CE :1675 keyOnTileAt
            ) {
                for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
                    if (TERRAIN_FLAGS[cell.layers[layer]!]!.mechFlags & TM_PROMOTES_WITHOUT_KEY) {
                        const r = promoteTile(grid, i, j, layer, false);
                        result.withoutKeyPromotions.push(r);
                        if (r.mutated) result.renderDirty = true;
                        if (r.spawn) {
                            for (const p of r.spawn.caughtFireCells) {
                                caughtFire.add(idx(p.x, p.y));
                            }
                        }
                    }
                }
            }
        }
    }

    // 存活的起火格 = CE 跨回合的 CAUGHT_FIRE_THIS_TURN（下一回合记账趟清）。
    for (const k of caughtFire) {
        result.caughtFireRemaining.push({ x: k % W, y: Math.floor(k / W) });
    }
    result.deferred = [
        ...result.promotions,
        ...result.withoutKeyPromotions,
    ]
        .map((r) => r.deferred)
        .filter((d): d is DeferredPromotion => d !== null);

    return result;
}

// ── CE updateEnvironment 的火段（Time.c:1688-1700）与 exposeTileToFire
//    （Time.c:1306-1377）——F-2a 移植。CE 里这两段与 promoteTile 同在
//    Time.c，web 对应地与 promoteTile 同在本文件。────────────────────────────

/** CE nbDirs 前 4 项——火段对每个火格暴露的 4 个正交邻（Time.c:1692-1699）。 */
const FIRE_DIRS4: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
];

/** CE 全 8 向（GlobalsBase.c:38 nbDirs）——TM_EXPLOSIVE_PROMOTE 邻居计数用。
 *  G-2 修复：原抄写把 {1,-1} 重复了一次、漏了 {1,1}（"dirs8 漏 [1,1]"
 *  的历史事故形态再现）——在爆轰分支不可达时无观测后果，G-2 让
 *  TM_EXPLOSIVE_PROMOTE 载体（METHANE_GAS）落地、分支被激活前修正。
 *  错误形态的观测后果：甲烷格若 (1,-1) 方向可燃而 (1,1) 方向不燃，
 *  计数会把 (1,-1) 数两次、(1,1) 不数——7 邻火 + 1 空角的格会被误爆轰。 */
const ALL_DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1],
];

export interface ExposeTileResult {
    /** CE 返回值：是否点燃（含 alwaysIgnite 直燃与掷骰命中）。 */
    ignited: boolean;
    /** 本次点燃经 promoteTile → spawnDungeonFeature 新落到火地形的格
     *  （CE pmap CAUGHT_FIRE_THIS_TURN 的登记集，交调用方喂回下一趟晋升）。 */
    caughtFireCells: Pos[];
    /** F-2c：本次点燃新落下的、带 T_CAUSES_EXPLOSIVE_DAMAGE 的地形格
     *  （CE fillSpawnMap refresh 分支 Architect.c:3255-3260 当场对格上生物
     *  跑 applyInstantTileEffectsToCreature——web 的调用方据此在落格瞬间
     *  结算爆炸伤害；甲烷爆轰经 DF_EXPLOSION_FIRE 走到这里）。 */
    explosiveSpawnCells: Pos[];
}

/**
 * CE exposeTileToFire（Time.c:1306-1377）逐段移植：
 *   1. 非 T_IS_FLAMMABLE（四层并集）或本回合已暴露 ≥12 次 → 直接 false
 *      （Time.c:1308-1311；每格每回合 12 次点火尝试封顶）。
 *   2. exposedToFire++（:1317）。
 *   3. 选"最佳灭火层"：TM_EXTINGUISHING_FIRE 层中 drawPriority 最小者
 *      （:1319-1330，bestExtinguishingPriority 初值 1000）。
 *   4. ignitionChance = 各可燃层中（GAS 层，或 drawPriority ≤ 灭火层优先级）
 *      最大的 chanceToIgnite（:1332-1345）。
 *   5. alwaysIgnite || rand_percent(ignitionChance) → 点燃：所有可燃层依次
 *      promoteTile(useFireDF = !explosivePromotion)（:1358-1372）。甲烷爆轰
 *      分支（TM_EXPLOSIVE_PROMOTE + 8 邻计数 ≥8，:1347-1356）照抄——
 *      G-2 起 METHANE_GAS 载体落地、分支真实可达；F-2c 起 promoteType
 *      DF_EXPLOSION_FIRE 的 tile（GAS_EXPLOSION）已迁，爆轰圈真实落地
 *      （爆炸格的落格瞬间结算见 ExposeTileResult.explosiveSpawnCells）；
 *      GAS 层可燃物
 *      "只清 volume 不清层"的 CE 怪癖（:1361-1368）G-1 起已接（见下方实现内注释）。
 */
export function exposeTileToFire(
    grid: Grid,
    x: number,
    y: number,
    alwaysIgnite: boolean
): ExposeTileResult {
    const cell = grid.getCell(x, y);
    const result: ExposeTileResult = { ignited: false, caughtFireCells: [], explosiveSpawnCells: [] };
    if (!cell) return result;

    const flags = cellTerrainFlags(grid, x, y);
    if (!(flags & T_IS_FLAMMABLE) || cell.exposedToFire >= 12) {
        return result; // CE :1308-1311
    }
    cell.exposedToFire++; // CE :1317

    // 最佳灭火层优先级（CE :1319-1330）。
    let bestExtinguishingPriority = 1000;
    for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
        const tile = TERRAIN_FLAGS[cell.layers[layer]!]!;
        if ((tile.mechFlags & TM_EXTINGUISHES_FIRE)
            && DRAW_PRIORITY[cell.layers[layer]!] < bestExtinguishingPriority) {
            bestExtinguishingPriority = DRAW_PRIORITY[cell.layers[layer]!];
        }
    }

    // 最易燃合格层的点火概率（CE :1332-1345）。
    let ignitionChance = 0;
    for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
        const terrain = cell.layers[layer]!;
        const tile = TERRAIN_FLAGS[terrain]!;
        if ((tile.flags & T_IS_FLAMMABLE)
            && (layer === DungeonLayer.GAS || DRAW_PRIORITY[terrain] <= bestExtinguishingPriority)
            && tile.chanceToIgnite > ignitionChance) {
            ignitionChance = tile.chanceToIgnite;
        }
    }

    if (alwaysIgnite || (ignitionChance && rng.randPercent(ignitionChance))) { // CE :1347
        result.ignited = true;

        // 爆轰邻居计数（CE :1348-1356）：G-2 起 METHANE_GAS 携带
        // TM_EXPLOSIVE_PROMOTE，分支真实可达——爆轰（≥8）时 promoteTile 走
        // promoteType DF_EXPLOSION_FIRE（F-2c 起载体 tile GAS_EXPLOSION 已迁，
        // 爆轰圈真实落地），普通点燃走 fireType DF_GAS_FIRE（燃气之火）。
        let explosivePromotion = false;
        if (cellTerrainMechFlags(grid, x, y) & TM_EXPLOSIVE_PROMOTE) {
            let explosiveNeighborCount = 0;
            for (const [dx, dy] of ALL_DIRS8) {
                const nx = x + dx, ny = y + dy;
                if (!grid.isValidPos(nx, ny)) continue;
                const nFlags = cellTerrainFlags(grid, nx, ny);
                const nMech = cellTerrainMechFlags(grid, nx, ny);
                if ((nFlags & (T_IS_FIRE | T_OBSTRUCTS_GAS)) || (nMech & TM_EXPLOSIVE_PROMOTE)) {
                    explosiveNeighborCount++;
                }
            }
            if (explosiveNeighborCount >= 8) explosivePromotion = true;
        }

        // 可燃层依次被消耗（CE :1358-1372）：promoteTile 的 useFireDF =
        // !explosivePromotion——普通点燃走 fireType，爆轰走 promoteType。
        // CE :1361-1368 的怪癖（注释自认"flammable gas burns its volume
        // away"）：GAS 层可燃物（POISON/CONFUSION_GAS 等）先清 volume
        // 再 promoteTile，且不清层（层由下一次 updateVolumetricMedia 在
        // volume<1 时收走）。G-1 起 volume 存在，本分支由此接上；
        // promoteTile 对 DF_GAS_FIRE 的缺 tile 缓办只挡 GAS_FIRE 落地
        // （G-2），不影响这一步的体积消耗。
        for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
            if (TERRAIN_FLAGS[cell.layers[layer]!]!.flags & T_IS_FLAMMABLE) {
                if (layer === DungeonLayer.GAS) {
                    cell.volume = 0; // CE :1362：Flammable gas burns its volume away.
                }
                const r = promoteTile(grid, x, y, layer, !explosivePromotion);
                if (r.spawn) {
                    for (const p of r.spawn.caughtFireCells) {
                        result.caughtFireCells.push(p);
                    }
                    // F-2c：落下的爆炸地形登记给调用方（落格瞬间结算，
                    // CE fillSpawnMap refresh 分支 Architect.c:3255-3260）。
                    for (const p of r.spawn.builtCells) {
                        if (cellTerrainFlags(grid, p.x, p.y) & T_CAUSES_EXPLOSIVE_DAMAGE) {
                            result.explosiveSpawnCells.push(p);
                        }
                    }
                }
            }
        }
    }
    return result;
}

export interface FireUpdateOptions {
    /** 本回合已登记的起火格（CE pmap CAUGHT_FIRE_THIS_TURN 在火段时点的
     *  存活集：上一回合火段的遗留 + 本回合记账趟后 WITHOUT_KEY 晋升新点的火）。
     *  火段不重复暴露它们（Time.c:1690）。 */
    caughtFireCells?: Pos[];
}

export interface FireUpdateResult {
    /** 火段新点起的火格（CE :3235 经 spawnDungeonFeature 登记的
     *  CAUGHT_FIRE_THIS_TURN 增量）；调用方并入下一回合的 skip 集。 */
    caughtFireCells: Pos[];
    /** F-2c：火段内新落下的爆炸地形格（含 TM_EXPLOSIVE_PROMOTE 甲烷的
     *  爆轰产物 DF_EXPLOSION_FIRE → GAS_EXPLOSION）。CE fillSpawnMap 的
     *  refresh 分支在落格瞬间对格上生物跑 applyInstantTileEffectsToCreature
     *  （Architect.c:3255-3260），调用方（Game）据此即时结算爆炸伤害。 */
    explosiveSpawnCells: Pos[];
}

/**
 * CE updateEnvironment 的火段（Time.c:1688-1700）：每个 T_IS_FIRE 且本回合
 * 未登记起火的格，先暴露自身、再依次暴露 4 个正交邻（nbDirs 前 4 项）。
 * CE 在 updateEnvironment 开头清全图 exposedToFire（:1598-1603）——web 的
 * exposedToFire 只被火段读写，清零放在本函数开头即同一时点。
 * 扫描次序照 CE：i 外层 j 内层、自身先于邻居、邻居按 nbDirs 序——RNG 消耗
 * 顺序与 CE 一致。
 */
export function runFireUpdate(
    grid: Grid,
    opts: FireUpdateOptions
): FireUpdateResult {
    const result: FireUpdateResult = { caughtFireCells: [], explosiveSpawnCells: [] };

    // CE :1598-1603：本回合暴露计数清零。
    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            const cell = grid.getCell(i, j);
            if (cell) cell.exposedToFire = 0;
        }
    }

    const W = grid.width;
    const idx = (px: number, py: number): number => py * W + px;
    // 火段的活 skip 集：入参遗留 + 本段内新登记的（CE 旗标是活的，
    // :1690 的判定在同一段扫描里即时可见——新点的火当回合不再被暴露）。
    const caught = new Set<number>((opts.caughtFireCells ?? []).map((p) => idx(p.x, p.y)));

    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            if (!caught.has(idx(i, j)) && (cellTerrainFlags(grid, i, j) & T_IS_FIRE)) {
                const self = exposeTileToFire(grid, i, j, false); // CE :1691
                for (const p of self.caughtFireCells) caught.add(idx(p.x, p.y));
                result.explosiveSpawnCells.push(...self.explosiveSpawnCells);
                for (const [dx, dy] of FIRE_DIRS4) { // CE :1692-1699
                    const nx = i + dx, ny = j + dy;
                    if (grid.isValidPos(nx, ny)) {
                        const r = exposeTileToFire(grid, nx, ny, false);
                        for (const p of r.caughtFireCells) caught.add(idx(p.x, p.y));
                        result.explosiveSpawnCells.push(...r.explosiveSpawnCells);
                    }
                }
            }
        }
    }
    for (const k of caught) {
        // 只回吐"火段新登记的"（入参遗留由调用方自持，见 Game.objectiveTimeBlock）。
        if (!(opts.caughtFireCells ?? []).some((p) => idx(p.x, p.y) === k)) {
            result.caughtFireCells.push({ x: k % W, y: Math.floor(k / W) });
        }
    }
    return result;
}

/** W-11, CE Time.c:259-272: a grounded creature depresses a DF trap.
 * The caller owns levitation/submersion and per-cell depression bookkeeping.
 * Emit each layer's fire DF before its ordinary promotion (including wiring).
 * Kept in the terrain module alongside all other catalog field interpretation.
 */
export function triggerCreatureTrapLayers(grid: Grid, x: number, y: number): PromoteTileResult[] {
    const cell = grid.getCell(x, y);
    if (!cell) return [];
    const results: PromoteTileResult[] = [];
    for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
        const entry = TERRAIN_FLAGS[cell.layers[layer]!]!;
        if (!(entry.flags & T_IS_DF_TRAP)) continue;
        const df = resolveDFName(entry.fireType);
        if (df !== null) spawnDungeonFeature(grid, x, y, catalogFeature(df), false);
        results.push(promoteTile(grid, x, y, layer, false));
    }
    return results;
}

/** Consume a legacy pressure plate/trap without erasing its emitted gas/fire. */
export function consumeTrapTile(grid: Grid, x: number, y: number, residue = TerrainType.FLOOR): void {
    grid.setTerrainLayer(x, y, DungeonLayer.DUNGEON, residue);
}

/** CE Items.c:5479-5489, FP_FACTOR=65536. Keep the integer lookup/rounding:
 * the table starts at E=2; E<2/non-finite values are invalid staff data and use
 * that minimum instead of indexing before the table. CE caps the index at 40.
 * This is diffusion probability decrement, not radius, area or lifetime. */
export function obstructionDecrement(enchantment: number): number {
    const powers = [41943, 33554, 26843, 21474, 17179, 13743, 10995, 8796,
        7036, 5629, 4503, 3602, 2882, 2305, 1844, 1475, 1180, 944, 755, 604,
        483, 386, 309, 247, 198, 158, 126, 101, 81, 64, 51, 41, 33, 26, 21,
        17, 13, 10, 8, 6, 5];
    const e = Number.isFinite(enchantment) ? Math.max(2, Math.min(40, Math.trunc(enchantment))) : 2;
    return Math.max(1, Math.floor(75 * powers[e - 2]! / 65536));
}

/** CE detonateBolt supplies a dynamic decrement; all contact, recursive
 * promotion and refresh now belong to the shared DF transaction. */
export function spawnObstruction(
    grid: Grid, x: number, y: number, enchantment: number,
    occupied: (pos: Pos) => boolean,
): SpawnFeatureResult {
    const feat = catalogFeature(DF.DF_FORCEFIELD);
    feat.probabilityDecrement = obstructionDecrement(enchantment);
    return spawnDungeonFeature(grid, x, y, feat, false, { effects: { occupied } });
}


/** CE Items.c:4362-4415 tunnelize. Terrain mutation belongs here, not in Game.
 * Each obstructing layer is removed independently. The return value counts the
 * primary cell once; recursive diagonal repairs do not spend extra bolt E.
 * Hooks keep creature ownership in Game and preserve CE release -> terrain ->
 * DF (including dormant activation) -> embedded turret death ordering. */
export function tunnelize(grid: Grid, x: number, y: number, hooks: {
    beforeOpen?(pos: Pos): void;
    afterOpen?(pos: Pos): void;
} = {}): boolean {
    const cell = grid.getCell(x, y);
    if (!cell || grid.isImpregnable(x, y)) return false;
    hooks.beforeOpen?.({ x, y });
    let changed = false;
    const blocks = T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION;
    if (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1) {
        grid.setTerrainLayer(x, y, DungeonLayer.DUNGEON, TerrainType.CRYSTAL_WALL);
        changed = true; // CE counts boundary crystalization, even on crystal.
    } else {
        for (let layer = 0; layer < DungeonLayer.COUNT; layer++) {
            if (TERRAIN_FLAGS[cell.layers[layer]!].flags & blocks) {
                grid.setTerrainLayer(x, y, layer, layer === DungeonLayer.DUNGEON
                    ? TerrainType.FLOOR : TerrainType.NOTHING);
                changed = true;
            }
        }
    }
    if (!changed) return false;
    spawnDungeonFeature(grid, x, y, catalogFeature(DF.DF_TUNNELIZE), false);
    // Existing FOV/legacy path consumers use these derived booleans. Evaluate
    // all retained layers, including transparent impassable crystal at edges.
    const flags = cellTerrainFlags(grid, x, y);
    cell.isPassable = !(flags & T_OBSTRUCTS_PASSABILITY);
    cell.isOpaque = !!(flags & T_OBSTRUCTS_VISION);
    hooks.afterOpen?.({ x, y });
    if (!(flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT)) {
        // CE nbDirs order; only diagonal neighbors can form a kink.
        for (const [dx, dy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
            const nx = x + dx, ny = y + dy;
            if (!grid.isValidPos(nx, ny)
                || (cellTerrainFlags(grid, x, y) & T_OBSTRUCTS_PASSABILITY)
                || (cellTerrainFlags(grid, nx, ny) & T_OBSTRUCTS_PASSABILITY)) continue;
            const horizontal = cellTerrainFlags(grid, nx, y), vertical = cellTerrainFlags(grid, x, ny);
            if (!(horizontal & T_OBSTRUCTS_PASSABILITY) || !(vertical & T_OBSTRUCTS_PASSABILITY)
                || !((horizontal | vertical) & T_OBSTRUCTS_DIAGONAL_MOVEMENT)) continue;
            if (grid.isImpregnable(x, ny) || (!grid.isImpregnable(nx, y) && rng.randPercent(50))) {
                tunnelize(grid, nx, y, hooks);
            } else {
                tunnelize(grid, x, ny, hooks);
            }
        }
    }
    return true;
}

/** CE Movement.c:1417 / Monsters.c:3781: the final STUCK attempt releases only SURFACE. */
export function breakEntanglingTerrain(grid: Grid, x: number, y: number): void {
    const cell = grid.getCell(x, y);
    if (cell && (TERRAIN_FLAGS[cell.layers[DungeonLayer.SURFACE]!].flags & T_ENTANGLES)) {
        grid.setTerrainLayer(x, y, DungeonLayer.SURFACE, TerrainType.NOTHING);
    }
}
