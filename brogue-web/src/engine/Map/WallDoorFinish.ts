/**
 * src/engine/Map/WallDoorFinish.ts — C-3：墙面与门的收尾
 *
 * CE 对照（BrogueCE-master/src/brogue/Architect.c，只读事实来源）：
 * - removeDiagonalOpenings  1913-1949  消除对角穿缝（do-while 扫到收敛）
 * - finishDoors             2733-2756  孤儿门移除 + 密门升级
 * - finishWalls             2480-2518  裸花岗岩补墙 / 未裸露墙退花岗岩
 * 调用点 digDungeon（2877-2980）：第 5 步 finishWalls(false)、第 8 步
 * removeDiagonalOpenings（designLakes/fillLakes 之后、addMachines 之前）、
 * 第 13 步 finishDoors、第 14 步 finishWalls(true)（含对角暴露）。
 * web 挂载位置见 Architect.generateTerrain / generateLevel 头注。
 *
 * web 地形 → CE 旗标近似（单层地形模型；映射先例 LakeSystem.ceTerrainFlags
 * 与 LoopMap.blocksPathing，行号均为 CE Globals.c 目录 + Rogue.h:1924-1954）：
 *   T_OBSTRUCTS_PASSABILITY → GRANITE / WALL / SECRET_DOOR / LOCKED_DOOR
 *     （CE WALL/GRANITE/SECRET_DOOR = T_OBSTRUCTS_EVERYTHING，Globals.c:322/
 *      327/330；LOCKED_DOOR 对 CE 机器闸门的近似同 LakeSystem。WATER_DEEP
 *      **不在内**：CE 深水可踏入（T_IS_DEEP_WATER 只进 T_PATHING_BLOCKER），
 *      把它算进来会让 removeDiagonalOpenings 削湖角、finishDoors 把临水门
 *      全当孤儿——两者都是 CE 不会发生的行为。）
 *   T_OBSTRUCTS_VISION → GRANITE / WALL / DOOR / SECRET_DOOR
 *     （= Grid.setTerrain 的 isOpaque 集；CE DOOR 挡视线不挡通行
 *      Globals.c:328。结果与 CE 逐地形等价：exposure 判据是
 *      `!vision || !pass`，两集合之外的地形两个旗标都不全，恒为"暴露"。）
 *   T_OBSTRUCTS_DIAGONAL_MOVEMENT → GRANITE / WALL / SECRET_DOOR
 *     （web 移动是 8 向且无对角穿墙限制，没有独立旗标；取 CE 两个旗标的
 *      交集地形——生成期存在的"墙类"恰好就是这三个。LOCKED_DOOR 对应的
 *      CE PORTCULLIS 无对角旗（Globals.c:339），不收。）
 *   T_PATHING_BLOCKER → 上者 ∪ WATER_DEEP / LAVA / CHASM / INERT_BRIMSTONE /
 *     TRAP（Rogue.h:1948；分别在 Globals.c:413/420/416/426 与 DF 机关门）。
 *
 * 密门口径（风险点 1 的裁决，见 ai_docs/c_3_walls_and_doors_report.md）：
 * web 有密门发现机制（Game.ts 移动邻接 30% 揭示并转成 DOOR），且 CE 自己的
 * 连通/环分析判据是 `T_PATHING_BLOCKER && !TM_IS_SECRET`（Architect.c:199-210
 * checkLoopiness；web 对应物 LoopMap.blocksPathing）——密门在分析口径下视作
 * 通路。因此按 CE 概率如实生成密门，不因 canMoveTo 的字面排除而少生成。
 */
import { Grid, TerrainType, DCOLS, DROWS } from './Grid';
import { rng } from '../Random';

// ---------------------------------------------------------------------------
// CE 旗标近似谓词（全枚举判定，供测试逐地形钉死）
// ---------------------------------------------------------------------------

/** CE T_OBSTRUCTS_PASSABILITY（Rogue.h:1926）的 web 地形集。 */
export function obstructsPassability(t: TerrainType): boolean {
    return t === TerrainType.GRANITE
        || t === TerrainType.WALL
        || t === TerrainType.SECRET_DOOR
        || t === TerrainType.LOCKED_DOOR;
}

/** CE T_OBSTRUCTS_VISION（Rogue.h:1927）的 web 地形集（= Grid isOpaque 集）。 */
export function obstructsVision(t: TerrainType): boolean {
    return t === TerrainType.GRANITE
        || t === TerrainType.WALL
        || t === TerrainType.DOOR
        || t === TerrainType.SECRET_DOOR;
}

/** CE T_OBSTRUCTS_DIAGONAL_MOVEMENT（Rogue.h:1929）的 web 近似集。 */
export function obstructsDiagonalMovement(t: TerrainType): boolean {
    return t === TerrainType.GRANITE
        || t === TerrainType.WALL
        || t === TerrainType.SECRET_DOOR;
}

/** CE T_PATHING_BLOCKER（Rogue.h:1948）的 web 地形集。 */
export function isPathingBlocker(t: TerrainType): boolean {
    return obstructsPassability(t)
        || t === TerrainType.WATER_DEEP
        || t === TerrainType.LAVA
        || t === TerrainType.CHASM
        || t === TerrainType.INERT_BRIMSTONE
        || t === TerrainType.TRAP;
}

// ---------------------------------------------------------------------------
// secretDoorChance（CE finishDoors 首行，Architect.c:2735）
// ---------------------------------------------------------------------------

/** variants/GlobalsBrogue.c:43 `#define AMULET_LEVEL 26`（gameConst->amuletLevel）。 */
export const CE_AMULET_LEVEL = 26;
/** CE Architect.c:2735 的 clamp 上界字面量。 */
const SECRET_DOOR_CHANCE_MAX = 67;

/**
 * clamp((depth-1)*67/(amuletLevel-1), 0, 67)，C 整数除法。
 * D1=0、D2=2、D5=10、D10=24、D14=34、D20=50、D26=67（封顶）。
 */
export function secretDoorChance(depth: number): number {
    const raw = Math.floor(((depth - 1) * SECRET_DOOR_CHANCE_MAX) / (CE_AMULET_LEVEL - 1));
    return Math.min(SECRET_DOOR_CHANCE_MAX, Math.max(0, raw));
}

// ---------------------------------------------------------------------------
// removeDiagonalOpenings（CE Architect.c:1913-1950）
// ---------------------------------------------------------------------------

export interface DiagonalFinishStats {
    /** do-while 的扫描趟数（收敛检查含在内）。 */
    passes: number;
    /** 被推开的阻挡格数（每格一次全层复制）。 */
    removed: number;
}

/** CE nbDirs（GlobalsBase.c:38）：前 4 正向 + 后 4 对角。 */
const NB_DIRS: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/**
 * CE removeDiagonalOpenings（1913-1950）：2×2 内两个"阻挡通行且阻挡对角
 * 移动"的格呈对角、另两对角可通行时，rand_percent(50) 挑一侧把阻挡格推开
 * （用同行可通行格的**全部层**覆盖）。外层 do-while 反复扫到没有改动为止
 * （CE 原文如此；生成期 machineNumber 恒 0，机器侧格不会被选中——CE 1938
 * 同款守卫保留）。CE 1938 的 HAS_MONSTER 守卫无 web 对应物：生成阶段
 * （populateLevel 之前）场上没有怪物，web Cell 亦无怪物位——模型差异，
 * 登记于报告。
 */
export function removeDiagonalOpenings(grid: Grid): DiagonalFinishStats {
    const stats: DiagonalFinishStats = { passes: 0, removed: 0 };
    let cornerRemoved = false;
    do {
        cornerRemoved = false;
        stats.passes++;
        for (let i = 0; i < DCOLS - 1; i++) {
            for (let j = 0; j < DROWS - 1; j++) {
                for (let k = 0; k <= 1; k++) {
                    const passA = grid.getCell(i + k, j)!;
                    const blockB = grid.getCell(i + (1 - k), j)!;
                    const blockC = grid.getCell(i + k, j + 1)!;
                    const passD = grid.getCell(i + (1 - k), j + 1)!;
                    // CE 1922-1927 的判据原序：A 可通行，B/C 阻挡通行+对角，D 可通行。
                    if (obstructsPassability(passA.terrain)
                        || !obstructsPassability(blockB.terrain) || !obstructsDiagonalMovement(blockB.terrain)
                        || !obstructsPassability(blockC.terrain) || !obstructsDiagonalMovement(blockC.terrain)
                        || obstructsPassability(passD.terrain)) {
                        continue;
                    }
                    // CE 1929-1936：rand_percent(50) 决定推开哪一侧。
                    let tx: number, ty: number, sx: number;
                    if (rng.randPercent(50)) {
                        tx = i + (1 - k); ty = j; // 上侧阻挡格 B
                        sx = i + k;               // 同行可通行格 A
                    } else {
                        tx = i + k; ty = j + 1;   // 下侧阻挡格 C
                        sx = i + (1 - k);         // 同行可通行格 D
                    }
                    const target = grid.getCell(tx, ty)!;
                    if (target.machineNumber !== 0) continue; // CE 1938
                    const source = grid.getCell(sx, ty)!;
                    grid.setTerrain(tx, ty, source.terrain, source.char, source.color);
                    stats.removed++;
                    cornerRemoved = true;
                }
            }
        }
    } while (cornerRemoved);
    return stats;
}

// ---------------------------------------------------------------------------
// finishDoors（CE Architect.c:2733-2758）
// ---------------------------------------------------------------------------

export interface DoorFinishStats {
    /** 参与判定的非机器 DOOR 格数。 */
    eligibleDoors: number;
    /** 孤儿判据一（十字皆通）移成 FLOOR 的门数。 */
    orphanFlooredCross: number;
    /** 孤儿判据二（四正邻 ≥3 阻挡）移成 FLOOR 的门数。 */
    orphanFlooredSealed: number;
    /** 升级成 SECRET_DOOR 的门数。 */
    secretDoors: number;
    /** 本层密门概率（观测用）。 */
    secretChance: number;
}

/**
 * CE finishDoors（2733-2758）：对每个非机器 DOOR 格——
 * 1) 左右有可通行且上下有可通行 → 孤儿门，FLOOR（2740-2744）；
 * 2) 四正方向 T_PATHING_BLOCKER 邻格 ≥3 → 封死孤儿，FLOOR（2745-2751）；
 * 3) 否则 rand_percent(secretDoorChance) → SECRET_DOOR（2752-2754）。
 * 单趟 raster 原位扫描（CE 无收敛环）；机器门由 machineNumber 豁免
 * （web：BlueprintEngine.applyBlueprint 落位时写入 Cell.machineNumber）。
 */
export function finishDoors(grid: Grid, depth: number): DoorFinishStats {
    const chance = secretDoorChance(depth);
    const stats: DoorFinishStats = {
        eligibleDoors: 0, orphanFlooredCross: 0, orphanFlooredSealed: 0,
        secretDoors: 0, secretChance: chance,
    };
    for (let i = 1; i < DCOLS - 1; i++) {
        for (let j = 1; j < DROWS - 1; j++) {
            const cell = grid.getCell(i, j)!;
            if (cell.terrain !== TerrainType.DOOR || cell.machineNumber !== 0) continue;
            stats.eligibleDoors++;
            const passableL = !obstructsPassability(grid.getCell(i - 1, j)!.terrain);
            const passableR = !obstructsPassability(grid.getCell(i + 1, j)!.terrain);
            const passableU = !obstructsPassability(grid.getCell(i, j - 1)!.terrain);
            const passableD = !obstructsPassability(grid.getCell(i, j + 1)!.terrain);
            if ((passableR || passableL) && (passableD || passableU)) {
                grid.setTerrain(i, j, TerrainType.FLOOR, '.', 0x888888);
                stats.orphanFlooredCross++;
                continue;
            }
            let blockers = 0;
            for (const [dx, dy] of NB_DIRS.slice(0, 4)) {
                if (isPathingBlocker(grid.getCell(i + dx!, j + dy!)!.terrain)) blockers++;
            }
            if (blockers >= 3) {
                grid.setTerrain(i, j, TerrainType.FLOOR, '.', 0x888888);
                stats.orphanFlooredSealed++;
                continue;
            }
            if (rng.randPercent(chance)) {
                grid.setTerrain(i, j, TerrainType.SECRET_DOOR, '#', 0x555555);
                stats.secretDoors++;
            }
        }
    }
    return stats;
}

// ---------------------------------------------------------------------------
// finishWalls（CE Architect.c:2480-2517）
// ---------------------------------------------------------------------------

export interface WallFinishStats {
    /** 本次调用的实参（CE digDungeon 第 5 步 false / 第 14 步 true）。 */
    includingDiagonals: boolean;
    /** 裸露花岗岩补成 WALL 的格数。 */
    graniteWalled: number;
    /** 未裸露 WALL 退回 GRANITE 的格数。 */
    wallsReverted: number;
}

/**
 * 邻格"暴露"判据（CE 2491-2496/2505-2510）：
 * `!T_OBSTRUCTS_VISION || !T_OBSTRUCTS_PASSABILITY`——即视线或通行至少
 * 一项不阻挡（地板/门/水/草都暴露；墙/花岗岩/密门不暴露）。
 */
export function finishWalls(grid: Grid, includingDiagonals: boolean): WallFinishStats {
    const stats: WallFinishStats = { includingDiagonals, graniteWalled: 0, wallsReverted: 0 };
    const dirCount = includingDiagonals ? 8 : 4;
    const exposes = (x: number, y: number): boolean => {
        const c = grid.getCell(x, y); // 图外 = 不暴露（CE coordinatesAreInMap 守卫）
        if (!c) return false;
        return !obstructsVision(c.terrain) || !obstructsPassability(c.terrain);
    };
    for (let i = 0; i < DCOLS; i++) {
        for (let j = 0; j < DROWS; j++) {
            const cell = grid.getCell(i, j)!;
            if (cell.terrain === TerrainType.GRANITE) {
                for (let d = 0; d < dirCount; d++) {
                    if (exposes(i + NB_DIRS[d]![0]!, j + NB_DIRS[d]![1]!)) {
                        grid.setTerrain(i, j, TerrainType.WALL, '#', 0x555566);
                        stats.graniteWalled++;
                        break; // CE 2497-2499：命中即转 WALL 并停止扫邻居
                    }
                }
            } else if (cell.terrain === TerrainType.WALL) {
                let exposed = false;
                for (let d = 0; d < dirCount && !exposed; d++) {
                    if (exposes(i + NB_DIRS[d]![0]!, j + NB_DIRS[d]![1]!)) exposed = true;
                }
                if (!exposed) {
                    grid.setTerrain(i, j, TerrainType.GRANITE, ' ', 0x333333);
                    stats.wallsReverted++;
                }
            }
        }
    }
    return stats;
}
