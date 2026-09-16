/**
 * src/engine/Map/LakeSystem.ts — C-2：湖泊四类液体 + 浅水镶边 + 边界打通 + 建桥
 *
 * CE 对照（BrogueCE-master/src/brogue/Architect.c，只读事实来源）：
 * - liquidType            2518-2550  四类液体（深度门槛 + 最深层特例）
 * - fillLake              2554-2570  单湖灌注（scanWidth=4 向外合并附近湖）
 * - createWreath          2692-2707  给深液体镶一圈浅液体（欧氏圆盘）
 * - fillLakes             2709-2730  逐连通组件抽液体 → 灌注 → 镶边
 * - cleanUpLakeBoundaries 1856-1912  打通相邻**同类**湖之间的 1 格边界
 * - buildABridge          2786-2876  架桥；pathingDistance 判据 Dijkstra.c:252
 *
 * gameConst 实际数值（经典 Brogue，variants/GlobalsBrogue.c:1019-1022 与
 * GlobalsBrogue.c:43-44；P1-7 教训：C 常量必须展开成数值再比对）：
 *   depthAccelerator = 1, minimumLavaLevel = 4,
 *   minimumBrimstoneLevel = 17, deepestLevel = DEEPEST_LEVEL = 40。
 *
 * 本轮三个风险点的裁决（详见 ai_docs/c_2_lakes_report.md；1 已由 C-5 反转）：
 * 1. CHASM 生成（C-5 解禁）：CE 深渊 = T_AUTO_DESCENT（坠到下一层）。C-2 时
 *    web 无坠落子系统而显式剔除候选（留痕测试钉住"深渊族恒 0"）；C-5 补上
 *    坠落（Game.playerFalls/monstersFall，消费 Time.c:110/168 的
 *    monsterShouldFall 语义）后候选域恢复 CE 原样，桥梁随之出现。
 * 2. LAVA 生成：即死通道已在 P1-28 落地（Game.applyEnvironmentalEffects，
 *    豁免 = 悬浮 / 火焰免疫 / MONST_INVULNERABLE，对齐 CE Time.c:183-190）；
 *    canMoveTo 不排除岩浆（P1-25）→ 岩浆湖不可能制造"不可达"，只会造成
 *    "走过去就死"——这与 CE 一致（CE 的 T_LAVA_INSTA_DEATH 也只挡 AI 寻路，
 *    玩家可以直接走进岩浆）。闸门在验证时把整湖当阻断物，干地（含楼梯
 *    落点）必有完全不穿湖的连通路径；坏层=0 由 e2e 测试复验。
 * 3. INERT_BRIMSTONE 生成 + 登记缺失：CE 的惰性硫矿踩上去**无即时后果**
 *    （T_SPONTANEOUSLY_IGNITES 只进 T_LAKE_PATHING_BLOCKER / T_PATHING_
 *    BLOCKER——影响 AI 寻路偏好与可燃性，不挡玩家直接移动；Globals.c:426
 *    的 TM 列为 0）。web 缺失的是"点火 → ACTIVE_BRIMSTONE → 爆炸 → 黑曜石"
 *    的 DF 链（C-4 promoteTile 范围）；生成惰性态本身忠于 CE。
 *
 * 与 CE 的结构性差异（web 单层地形模型，报告均有登记）：
 * - web 一格一个 terrain，无 CE 的 DUNGEON/LIQUID/SURFACE 三层。液体直接
 *   落 terrain；createWreath 只盖 FLOOR/DOOR。CE 会把浅水画在**墙格**的
 *   LIQUID 层上（纯渲染、玩法旗标仍来自 DUNGEON 层的墙）；web 若照搬会把
 *   墙变成可走地形，直接破坏 P1-29 的连通性合同，故必须跳过。
 * - cleanUpLakeBoundaries 增加"不可降低可走性"守卫：CE 四种液体全都是
 *   pathing blocker，清理永不改变可走拓扑；web 的岩浆/硫矿可走（P1-25），
 *   [深水][岩浆][深水] 若照 CE 复刻会把中间岩浆改成深水——**删掉**一个
 *   可走格，可能打破 P1-29 闸门保证过的干地连通。守卫：主体格可走而
 *   目标格不可走时跳过该次转换。
 * - 桥只架在 CHASM 上（CE T_CAN_BE_BRIDGED = T_AUTO_DESCENT，**深水不可
 *   架桥**）；C-2～C-4 期间 CHASM 不生成 → 真实生成中 BRIDGE/BRIDGE_EDGE
 *   恒 0，buildABridge 每层仍按 CE 照常消耗 RNG（比值 2 抽 + 两张洗牌）并
 *   空转返回 false。C-5 解禁后桥梁自动开始出现。
 */
import { Grid, TerrainType, DCOLS, DROWS } from './Grid';
import { terrainAllowsMove } from './Connectivity';
import { rng } from '../Random';

/** 经典 Brogue 的 gameConst 数值（variants/GlobalsBrogue.c:1019-1022、43-44）。 */
export const CE_DEPTH_ACCELERATOR = 1;
export const CE_MINIMUM_LAVA_LEVEL = 4;
export const CE_MINIMUM_BRIMSTONE_LEVEL = 17;
export const CE_DEEPEST_LEVEL = 40;

/** CE fillLakes Architect.c:2722 `fillLake(i, j, deepLiquid, 4, ...)`。 */
const FILL_LAKE_SCAN_WIDTH = 4;

/** CE cleanUpLakeBoundaries Architect.c:1862 `failsafe = 100`。 */
const CLEANUP_FAILSAFE = 100;

// ---------------------------------------------------------------------------
// CE 地形旗标的位映射（Rogue.h:1924-1954）。数值本身无意义，只参与
// 相等 / 取补比较，与 cleanUpLakeBoundaries、buildABridge 的判据一一对应。
// ---------------------------------------------------------------------------

const F_OBSTRUCTS_PASSABILITY = 1 << 0; // Rogue.h:1924（墙/花岗岩/暗门/铁门）
const F_AUTO_DESCENT = 1 << 1;          // 深渊（= T_CAN_BE_BRIDGED，Rogue.h:1953）
const F_LAVA_INSTA_DEATH = 1 << 2;      // 岩浆
const F_IS_DEEP_WATER = 1 << 3;         // 深水
const F_SPONTANEOUSLY_IGNITES = 1 << 4; // 硫矿
const F_IS_DF_TRAP = 1 << 5;            // DF 机关门（web 的 TRAP 近似，架桥时不存在）

/** Rogue.h:1950 T_LAKE_PATHING_BLOCKER = AUTO_DESCENT | LAVA | DEEP_WATER | SPONTANEOUSLY_IGNITES。 */
const T_LAKE_PATHING_BLOCKER =
    F_AUTO_DESCENT | F_LAVA_INSTA_DEATH | F_IS_DEEP_WATER | F_SPONTANEOUSLY_IGNITES;
/** Rogue.h:1948 T_PATHING_BLOCKER（bridgeRatio 的 pathingDistance 阻挡集）。 */
const T_PATHING_BLOCKER =
    F_OBSTRUCTS_PASSABILITY | F_AUTO_DESCENT | F_IS_DF_TRAP | F_LAVA_INSTA_DEATH |
    F_IS_DEEP_WATER | F_SPONTANEOUSLY_IGNITES;
/** Rogue.h:1953 T_CAN_BE_BRIDGED = T_AUTO_DESCENT —— CE 的桥**只架在深渊上**。 */
const T_CAN_BE_BRIDGED = F_AUTO_DESCENT;

/**
 * web 地形 → CE 旗标映射（各terrain 的旗标见 CE Globals.c 目录行号注释）。
 * DOOR 不含 T_OBSTRUCTS_PASSABILITY（Globals.c:328，CE 的门可通行），
 * 因此清理永远不会把门当边界溶解——与 CE 一致。
 */
function ceTerrainFlags(terrain: TerrainType): number {
    switch (terrain) {
        case TerrainType.WALL:
        case TerrainType.GRANITE:
        case TerrainType.SECRET_DOOR:
        case TerrainType.LOCKED_DOOR:
            return F_OBSTRUCTS_PASSABILITY;
        case TerrainType.WATER_DEEP:
            return F_IS_DEEP_WATER;             // Globals.c:413（另有 T_IS_FLAMMABLE，本轮判据用不到）
        case TerrainType.LAVA:
            return F_LAVA_INSTA_DEATH;          // Globals.c:420
        case TerrainType.CHASM:
            return F_AUTO_DESCENT;              // Globals.c:416
        case TerrainType.INERT_BRIMSTONE:
            return F_SPONTANEOUSLY_IGNITES;     // Globals.c:426
        case TerrainType.TRAP:
            return F_IS_DF_TRAP;                // web TRAP 对 CE DF 机关门的近似（架桥阶段尚不存在，无实际影响）
        default:
            return 0;                           // FLOOR/SHALLOW/OBSIDIAN/CHASM_EDGE/BRIDGE* 等全部无旗标
    }
}

/** CE TM_IS_SECRET 的 web 对应物：暗门在发现前对清理/架桥不可见。 */
function isSecretTerrain(terrain: TerrainType): boolean {
    return terrain === TerrainType.SECRET_DOOR;
}

// ---------------------------------------------------------------------------
// liquidType（CE Architect.c:2518-2550）
// ---------------------------------------------------------------------------

export interface LakeLiquid {
    deep: TerrainType;
    shallow: TerrainType;
    shallowWidth: number;
}

/**
 * CE liquidType（Architect.c:2518-2550）：
 *   randMin = depth < 4 ? 1 : 0; randMax = depth < 17 ? 2 : 3;
 *   rand = rand_range(randMin, randMax); if (depth == 40) rand = 1;
 *   0=岩浆(无镶边) / 1=深水(浅水×2) / 2=深渊(渊缘×1) / 3=硫矿(黑曜石×2)。
 *
 * C-5 解禁（风险裁决 1 反转）：抽取恢复 CE 原文 `rand_range(randMin, randMax)`——
 * C-2 时代"从候选数组剔除 2"的收窄随坠落子系统落地退役（T_AUTO_DESCENT 的
 * 消费点：Game 坠落结算 + 跳渊确认，本轮已接上；桥梁随之自动开始生成）。
 * 抽取次数与 C-2 实现相同（仍是一次 rand_range），仅取值域恢复。
 */
export function liquidType(depth: number): LakeLiquid {
    const randMin = depth < CE_MINIMUM_LAVA_LEVEL ? 1 : 0;
    const randMax = depth < CE_MINIMUM_BRIMSTONE_LEVEL ? 2 : 3;

    let rand = rng.randRange(randMin, randMax);
    // CE 2526-2528：最深层恒深水（抽骰照常消耗，随后覆盖——RNG 语义与 CE 一致）。
    if (depth === CE_DEEPEST_LEVEL) {
        rand = 1;
    }

    switch (rand) {
        case 0:
            return { deep: TerrainType.LAVA, shallow: TerrainType.NOTHING, shallowWidth: 0 };
        case 1:
            return { deep: TerrainType.WATER_DEEP, shallow: TerrainType.WATER_SHALLOW, shallowWidth: 2 };
        case 2:
            // CE 2537-2539：深渊 + 渊缘×1（C-5 解禁后真实可达）。
            return { deep: TerrainType.CHASM, shallow: TerrainType.CHASM_EDGE, shallowWidth: 1 };
        default:
            return { deep: TerrainType.INERT_BRIMSTONE, shallow: TerrainType.OBSIDIAN, shallowWidth: 2 };
    }
}

// ---------------------------------------------------------------------------
// fillLake / createWreath / fillLakes（CE Architect.c:2554-2570 / 2692-2730）
// ---------------------------------------------------------------------------

function cellKey(grid: Grid, x: number, y: number): number {
    return y * grid.width + x;
}

/** 各液体落格时的显示参数（渲染用；CE 目录的 web 近似配色）。 */
const LIQUID_DISPLAY: Partial<Record<TerrainType, { char: string, color: number }>> = {
    [TerrainType.WATER_DEEP]: { char: '~', color: 0x1133aa },
    [TerrainType.WATER_SHALLOW]: { char: '~', color: 0x3366cc },
    [TerrainType.LAVA]: { char: '~', color: 0xff4400 },
    [TerrainType.INERT_BRIMSTONE]: { char: '"', color: 0xccaa33 },
    [TerrainType.OBSIDIAN]: { char: '.', color: 0x554455 },
    [TerrainType.CHASM_EDGE]: { char: '.', color: 0x777788 },
    [TerrainType.BRIDGE]: { char: '=', color: 0xaa8844 },
    [TerrainType.BRIDGE_EDGE]: { char: '=', color: 0x997733 },
};

function stampTerrain(grid: Grid, x: number, y: number, terrain: TerrainType): void {
    const disp = LIQUID_DISPLAY[terrain] ?? { char: '?', color: 0xffffff };
    grid.setTerrain(x, y, terrain, disp.char, disp.color);
}

/**
 * CE fillLake（Architect.c:2554-2570）：从 (x,y) 起，凡 scanWidth（=4）
 * 切比雪夫窗内的未灌注湖格都灌入 liquid 并记入 wreathMap，递归外扩——
 * 效果是把 4 格以内的邻近湖合并成同一种液体。CE 是递归实现，这里用显式
 * 栈复刻同一传递闭包（大湖数百格，避免深递归；结果集与顺序无关）。
 */
function fillLake(
    grid: Grid,
    lakeMap: Set<number>,
    startX: number,
    startY: number,
    liquid: TerrainType,
    scanWidth: number,
    wreath: Set<number>
): void {
    const stack: Array<{ x: number, y: number }> = [{ x: startX, y: startY }];
    while (stack.length > 0) {
        const { x, y } = stack.pop()!;
        for (let i = x - scanWidth; i <= x + scanWidth; i++) {
            for (let j = y - scanWidth; j <= y + scanWidth; j++) {
                if (i < 0 || j < 0 || i >= grid.width || j >= grid.height) continue;
                const key = cellKey(grid, i, j);
                if (!lakeMap.has(key)) continue;
                lakeMap.delete(key);
                stampTerrain(grid, i, j, liquid);
                wreath.add(key);
                stack.push({ x: i, y: j });
            }
        }
    }
}

/**
 * CE createWreath（Architect.c:2692-2707）：对 wreathMap 的每个格子，在
 * 半径 wreathWidth 的欧氏圆盘内给 LIQUID==NOTHING 的格子上浅液体；门格
 * （DUNGEON==DOOR）被浅水覆盖时门消失（CE 2703-2705）。
 * web 单层模型：可受液体的是 FLOOR 与 DOOR；墙/花岗岩/楼梯/既有液体一律
 * 跳过（CE 在墙格的 LIQUID 层画浅水是纯渲染，web 照搬会把墙变成可走）。
 */
function createWreath(grid: Grid, shallowLiquid: TerrainType, wreathWidth: number, wreath: Set<number>): void {
    if (wreathWidth <= 0 || shallowLiquid === TerrainType.NOTHING) return;
    for (const key of wreath) {
        const i = key % grid.width;
        const j = Math.floor(key / grid.width);
        for (let k = i - wreathWidth; k <= i + wreathWidth; k++) {
            for (let l = j - wreathWidth; l <= j + wreathWidth; l++) {
                if (k < 0 || l < 0 || k >= grid.width || l >= grid.height) continue;
                if ((i - k) * (i - k) + (j - l) * (j - l) > wreathWidth * wreathWidth) continue;
                const cell = grid.getCell(k, l);
                if (!cell) continue;
                // CE 2702 `pmap[k][l].layers[LIQUID] == NOTHING` 的单层对应物。
                if (cell.terrain === TerrainType.FLOOR || cell.terrain === TerrainType.DOOR) {
                    stampTerrain(grid, k, l, shallowLiquid);
                }
            }
        }
    }
}

/**
 * CE fillLakes（Architect.c:2709-2730）：按 raster 序找每个未灌注的湖格
 * （= 一个连通组件的起点），liquidType 抽一次液体，fillLake(±4) 灌注并
 * 合并附近的湖，createWreath 镶边。lakeMap 由此清空。
 */
export function fillLakes(grid: Grid, lakeMap: Set<number>, depth: number): void {
    for (let i = 0; i < grid.width; i++) {
        for (let j = 0; j < grid.height; j++) {
            if (lakeMap.has(cellKey(grid, i, j))) {
                const { deep, shallow, shallowWidth } = liquidType(depth);
                const wreath = new Set<number>();
                fillLake(grid, lakeMap, i, j, deep, FILL_LAKE_SCAN_WIDTH, wreath);
                createWreath(grid, shallow, shallowWidth, wreath);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// cleanUpLakeBoundaries（CE Architect.c:1856-1912）
// ---------------------------------------------------------------------------

/**
 * CE cleanUpLakeBoundaries（Architect.c:1856-1912）："Knock down the
 * boundaries between similar lakes where possible"。对每个带
 * T_LAKE_PATHING_BLOCKER | T_OBSTRUCTS_PASSABILITY 旗标的格 C（排除
 * TM_IS_SECRET 与 IMPREGNABLE），若 (i-1,j) 与 (i+1,j)（或 (i,j-1) 与
 * (i,j+1)）的 T_LAKE_PATHING_BLOCKER 旗标**在去掉 C 自身旗标后相等且非空**
 *（= 同类湖），则把 C 整格复制成 (i+1,j)（或 (i,j+1)）。交替方向扫 +
 * 100 次 failsafe，直到无改动。
 */
export function cleanUpLakeBoundaries(grid: Grid): void {
    let reverse = true;
    let failsafe = CLEANUP_FAILSAFE;
    let madeChange: boolean;
    do {
        madeChange = false;
        reverse = !reverse;
        failsafe--;

        for (let i = reverse ? grid.width - 2 : 1; reverse ? i > 0 : i < grid.width - 1; reverse ? i-- : i++) {
            for (let j = reverse ? grid.height - 2 : 1; reverse ? j > 0 : j < grid.height - 1; reverse ? j-- : j++) {
                const subject = grid.getCell(i, j);
                if (!subject) continue;
                const subjectAll = ceTerrainFlags(subject.terrain);
                // CE 1868：subject 必须带湖/墙旗标；1870-1871 排除暗门与 IMPREGNABLE
                //（web 的 IMPREGNABLE 对应物 = 机器格；架桥/清理阶段机器尚未放置，恒空）。
                if ((subjectAll & (T_LAKE_PATHING_BLOCKER | F_OBSTRUCTS_PASSABILITY)) === 0) continue;
                if (isSecretTerrain(subject.terrain) || subject.machineNumber !== 0) continue;

                const subjectFlags = subjectAll & (T_LAKE_PATHING_BLOCKER | F_OBSTRUCTS_PASSABILITY);

                // CE 1876-1887：左右（或上下）两侧旗标去掉 subject 自身旗标后相等且非空。
                let target: { x: number, y: number } | null = null;
                const left = grid.getCell(i - 1, j);
                const right = grid.getCell(i + 1, j);
                if (left && right) {
                    const aLeft = ceTerrainFlags(left.terrain) & T_LAKE_PATHING_BLOCKER & ~subjectFlags;
                    const aRight = ceTerrainFlags(right.terrain) & T_LAKE_PATHING_BLOCKER & ~subjectFlags;
                    if (aLeft !== 0 && aLeft === aRight
                        && !isSecretTerrain(left.terrain) && !isSecretTerrain(right.terrain)) {
                        target = { x: i + 1, y: j }; // CE 1879-1880：内容取自右格
                    }
                }
                if (!target) {
                    const up = grid.getCell(i, j - 1);
                    const down = grid.getCell(i, j + 1);
                    if (up && down) {
                        const aUp = ceTerrainFlags(up.terrain) & T_LAKE_PATHING_BLOCKER & ~subjectFlags;
                        const aDown = ceTerrainFlags(down.terrain) & T_LAKE_PATHING_BLOCKER & ~subjectFlags;
                        if (aUp !== 0 && aUp === aDown
                            && !isSecretTerrain(up.terrain) && !isSecretTerrain(down.terrain)) {
                            target = { x: i, y: j + 1 }; // CE 1889-1890：内容取自下格
                        }
                    }
                }
                if (!target) continue;

                const targetCell = grid.getCell(target.x, target.y);
                if (!targetCell) continue;
                // web 守卫（CE 无此分支）：CE 四种液体全为 pathing blocker，清理永不
                // 改变可走拓扑；web 的岩浆/硫矿可走而深水不可走，主体→目标的转换
                // 若会删掉可走格则跳过（保护 P1-29 闸门的干地连通合同）。见文件头。
                if (terrainAllowsMove(subject.terrain) && !terrainAllowsMove(targetCell.terrain)) continue;

                // CE 1894-1897：整格复制（web 单层 = terrain + 显示参数）。
                subject.terrain = targetCell.terrain;
                subject.char = targetCell.char;
                subject.color = targetCell.color;
                subject.isPassable = targetCell.isPassable;
                madeChange = true;
            }
        }
    } while (madeChange && failsafe > 0);
}

// ---------------------------------------------------------------------------
// buildABridge（CE Architect.c:2786-2876）
// ---------------------------------------------------------------------------

/**
 * CE pathingDistance（Dijkstra.c:252 → calculateDistances:198-231）的 web
 * 对应物：8 向、代价 1 的均匀代价搜索（= BFS），阻挡集 = T_PATHING_BLOCKER。
 * canUseSecretDoors=true：已发现的暗门可通行（web: SECRET_DOOR + isDiscovered）。
 * 不可达返回 CE 距离图的清空值 30000（Dijkstra.c:247 `pdsClear(&map, 30000)`
 * ——C-5 逐字重核翻正：C-2 版误返回 -1 并注释为 PDS_FORBIDDEN，但那是
 * calculateDistances 的**代价**标记（Rogue.h:2782），不是距离值；比值判据
 * `100 * pd / (k-i) > ratio` 里 30000 = "绕不过去必须架桥"（CE 桥的主场景），
 * -1 则恒假、桥永不生成）。目标格本身是阻挡地形时提前返回（CE 语义：
 * calculateDistances 无条件置目标距离 0，此形态在 buildABridge 的调用里
 * 不可达——落点已由 isLand 过滤；保留 web 防御分支并单独注记）。
 */
function pathingDistance(grid: Grid, x1: number, y1: number, x2: number, y2: number): number {
    const PDS_UNREACHABLE = 30000; // CE Dijkstra.c:247 pdsClear(&map, 30000)
    const blocked = (x: number, y: number): boolean => {
        const cell = grid.getCell(x, y);
        if (!cell) return true;
        if (isSecretTerrain(cell.terrain) && cell.isDiscovered) return false; // CE Dijkstra.c:213-217
        return (ceTerrainFlags(cell.terrain) & T_PATHING_BLOCKER) !== 0;
    };
    if (blocked(x2, y2)) return -1; // 防御分支：buildABridge 调用面不可达（见上注）
    const dist = new Map<number, number>([[cellKey(grid, x2, y2), 0]]);
    const queue: Array<{ x: number, y: number }> = [{ x: x2, y: y2 }];
    const DIRS8: ReadonlyArray<readonly [number, number]> = [
        [0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1],
    ];
    while (queue.length > 0) {
        const p = queue.shift()!;
        const d = dist.get(cellKey(grid, p.x, p.y))!;
        if (p.x === x1 && p.y === y1) return d;
        for (const [dx, dy] of DIRS8) {
            const nx = p.x + dx;
            const ny = p.y + dy;
            if (nx < 0 || ny < 0 || nx >= grid.width || ny >= grid.height) continue;
            const key = cellKey(grid, nx, ny);
            if (dist.has(key) || blocked(nx, ny)) continue;
            dist.set(key, d + 1);
            queue.push({ x: nx, y: ny });
        }
    }
    return PDS_UNREACHABLE;
}

/**
 * CE buildABridge（Architect.c:2786-2876）：尝试架一座桥；成功返回 true
 *（调用方 `while (buildABridge())` 反复架到无处可架）。
 * 判据（水平方向，垂直对称）：
 *   起点 (i,j)：非深渊/非 pathing blocker（岸）、非机器格；
 *   候选 k=i+1…：深渊、非暗门、非墙、两侧 (k,j±1) 都必须是深渊或墙；
 *   沿途至少有一处两侧都不是墙（foundExposure，"不能全程贴墙"）；
 *   落点 (k,j)：岸（非 pathing blocker / 非深渊）、非机器格、k-i>3；
 *   100 * pathingDistance(i,j,k,j) / (k-i) > bridgeRatio —— 绕行必须比
 *   直接跨足够远才值得架桥（比值随深度上升，整数算术照抄 CE）。
 *   成功：k 之间全盖 BRIDGE，两端岸格盖 BRIDGE_EDGE。
 * 本轮 CHASM 不生成（风险裁决 1）→ 真实生成中恒返回 false；RNG 消耗
 * （比值 2 抽 + 列/行两张洗牌）与 CE 一致，每层照常发生。
 */
export function buildABridge(grid: Grid, depth: number): boolean {
    // CE 2790-2791：C 整数算术（先乘后除，逐级截断）。
    const innerX = 100 + Math.floor((100 * depth * CE_DEPTH_ACCELERATOR) / 9);
    const innerY = 400 + Math.floor((100 * depth * CE_DEPTH_ACCELERATOR) / 18);
    const bridgeRatioX = 100 + Math.floor(innerX * rng.randRange(10, 20) / 10);
    const bridgeRatioY = 100 + Math.floor(innerY * rng.randRange(10, 20) / 10);

    // CE 2793-2796：列/行顺序随机（fillSequentialList + shuffleList）。
    const nCols: number[] = [];
    for (let v = 0; v < DCOLS; v++) nCols.push(v);
    rng.shuffleList(nCols);
    const nRows: number[] = [];
    for (let v = 0; v < DROWS; v++) nRows.push(v);
    rng.shuffleList(nRows);

    const isBridgableOrWall = (x: number, y: number): boolean => {
        const cell = grid.getCell(x, y);
        return !!cell && (ceTerrainFlags(cell.terrain) & (T_CAN_BE_BRIDGED | F_OBSTRUCTS_PASSABILITY)) !== 0;
    };
    const isLand = (x: number, y: number): boolean => {
        const cell = grid.getCell(x, y);
        return !!cell && (ceTerrainFlags(cell.terrain) & (T_PATHING_BLOCKER | T_CAN_BE_BRIDGED)) === 0;
    };
    const inMachine = (x: number, y: number): boolean => (grid.getCell(x, y)?.machineNumber ?? 0) !== 0;
    const isSecretAt = (x: number, y: number): boolean => {
        const cell = grid.getCell(x, y);
        return !!cell && isSecretTerrain(cell.terrain);
    };
    const isWallAt = (x: number, y: number): boolean => {
        const cell = grid.getCell(x, y);
        return !!cell && (ceTerrainFlags(cell.terrain) & F_OBSTRUCTS_PASSABILITY) !== 0;
    };
    const isChasmAt = (x: number, y: number): boolean => {
        const cell = grid.getCell(x, y);
        return !!cell && (ceTerrainFlags(cell.terrain) & T_CAN_BE_BRIDGED) !== 0;
    };

    for (let i2 = 1; i2 < DCOLS - 1; i2++) {
        const i = nCols[i2]!;
        for (let j2 = 1; j2 < DROWS - 1; j2++) {
            const j = nRows[j2]!;
            if (!isLand(i, j) || inMachine(i, j)) continue;

            // ---- 水平桥（CE 2803-2836）----
            let foundExposure = false;
            let k = i + 1;
            for (;
                k < DCOLS
                && !inMachine(k, j)
                && isChasmAt(k, j)
                && !isSecretAt(k, j)
                && !isWallAt(k, j)
                && isBridgableOrWall(k, j - 1)
                && isBridgableOrWall(k, j + 1);
                k++) {
                if (!isWallAt(k, j - 1) && !isWallAt(k, j + 1)) {
                    foundExposure = true; // CE 2822-2826：至少一处两侧开敞
                }
            }
            if (k < DCOLS
                && (k - i > 3)
                && foundExposure
                && isLand(k, j)
                && !inMachine(k, j)
                && Math.floor((100 * pathingDistance(grid, i, j, k, j)) / (k - i)) > bridgeRatioX) {
                for (let l = i + 1; l < k; l++) stampTerrain(grid, l, j, TerrainType.BRIDGE);
                stampTerrain(grid, i, j, TerrainType.BRIDGE_EDGE);
                stampTerrain(grid, k, j, TerrainType.BRIDGE_EDGE);
                return true;
            }

            // ---- 垂直桥（CE 2838-2871）----
            foundExposure = false;
            k = j + 1;
            for (;
                k < DROWS
                && !inMachine(i, k)
                && isChasmAt(i, k)
                && !isSecretAt(i, k)
                && !isWallAt(i, k)
                && isBridgableOrWall(i - 1, k)
                && isBridgableOrWall(i + 1, k);
                k++) {
                if (!isWallAt(i - 1, k) && !isWallAt(i + 1, k)) {
                    foundExposure = true;
                }
            }
            if (k < DROWS
                && (k - j > 3)
                && foundExposure
                && isLand(i, k)
                && !inMachine(i, k)
                && Math.floor((100 * pathingDistance(grid, i, j, i, k)) / (k - j)) > bridgeRatioY) {
                for (let l = j + 1; l < k; l++) stampTerrain(grid, i, l, TerrainType.BRIDGE);
                stampTerrain(grid, i, j, TerrainType.BRIDGE_EDGE);
                stampTerrain(grid, i, k, TerrainType.BRIDGE_EDGE);
                return true;
            }
        }
    }
    return false;
}
