/**
 * src/engine/Environment/Gas.ts
 * Manages gas spread and effects (fire, poison, steam)
 *
 * F-2a：火焰机制对齐 CE（本文件不再持有火的事实来源）。
 *
 * F-1 形态：isBurning/burnDuration 状态机双写 SURFACE 层 PLAIN_FIRE，
 * 火的寿命是 burnDuration 硬倒计时、蔓延是 8 邻 × 40%、烧尽一律 CHARRED_FLOOR。
 * F-2a 起（任务书 §二.1/2/3）改为 CE 模型，本文件只保留三个入口：
 *   - ignite(x,y)        = CE exposeTileToFire(x,y,true)（Items.c:5217/5445
 *                          "burninate"——弹道/火杖/怪物火系的直燃旁路：
 *                          跳过掷骰、但尊重可燃性与 12 次暴露封顶）；
 *   - igniteForced(x,y)  = CE 的火 DF 生成家族（药水/爆炸类：DF 直接把火
 *                          地形铺上任何地表，DF_PLAIN_FIRE 单点零 RNG），
 *                          经 spawnDungeonFeature 走 fillSpawnMap——
 *                          T_OBSTRUCTS_SURFACE_EFFECTS 守卫（火落不进
 *                          楼梯/祭坛，Architect.c:3230）与 drawPriority
 *                          判据由该路径免费获得（F-1 §七.2 预测成真）；
 *   - updateFires()      = CE updateEnvironment 的火段（Time.c:1688-1700，
 *                          移植在 Promotion.runFireUpdate）+ web 既有
 *                          "火贴水冒蒸汽"（web 自创，本轮原样保留，
 *                          §5.3-9 的 CE 蒸汽来源归 G 链）。
 * 火的寿命 = PLAIN_FIRE promoteChance 500 的概率衰老（runPromotionUpdate
 * 每回合驱动；几何分布均值约 20 回合），烧完产物 = EMBERS → ASH
 * （CE Globals.c:492/469/461）。isBurning 是"跨层挂着 T_IS_FIRE 地形"的
 * 纯派生读数（Grid.Cell getter），web 自创的 burnDuration/burnTerrain
 * 已随倒计时模型退役。
 *
 * 与 CE 的有意差异（登记表）：
 *   - 深水/浅水"被点燃"（CE chanceToIgnite=100 → DF_STEAM_ACCUMULATION，
 *     §5.3-9）本轮不接：promoteTile 对缺 tile 的 GAS 层 DF 整链缓办，
 *     水格暴露后原地不动——蒸汽侧归 G 链。
 *   - BOG（webOnly）目录记录 T_IS_FLAMMABLE 但无 fireType：直燃时
 *     promoteTile 无 DF 可落，BOG 不再可点燃（web 旧白名单行为退役）。
 *   - 火烧到生物仍是 Game.applyEnvironmentalEffects 的固定 2 点（§三：
 *     CE 两段燃烧状态机归 F-2b）。
 */

import { Grid, DCOLS, DROWS, DungeonLayer, TerrainType } from '../Map/Grid';
import { rng } from '../Random';
import { DF } from '../Map/DungeonFeatureCatalog';
import { catalogFeature, spawnDungeonFeature } from '../Map/DungeonFeature';
import { exposeTileToFire, runFireUpdate } from '../Map/Promotion';
import type { Pos } from '../../types';

export enum GasType {
    NONE = 0,
    FIRE = 1,
    POISON = 2,
    CONFUSION = 3,
    STEAM = 4,
    CREEPING_DEATH = 5
}

export interface GasCell {
    type: GasType;
    density: number; // 0-100
}

export class EnvironmentManager {
    public gasGrid: GasCell[][] = [];
    private grid: Grid;
    /** F-2a：点火入口（ignite/igniteForced）攒下的 CAUGHT_FIRE_THIS_TURN
     *  增量，由下一次 updateFires 一并交给 Game（喂回晋升驱动的 skip 集）。
     *  CE 里这些格的旗标在 pmap 上即时生效；web 的旗标等价物归 Game 所有，
     *  入口与客观块不同步，用队列衔接。 */
    private fireCaughtQueue: Pos[] = [];

    constructor(grid: Grid) {
        this.grid = grid;
        // Initialize empty gas grid
        for (let x = 0; x < DCOLS; x++) {
            this.gasGrid[x] = [];
            for (let y = 0; y < DROWS; y++) {
                this.gasGrid[x]![y] = { type: GasType.NONE, density: 0 };
            }
        }
    }

    public addGas(x: number, y: number, type: GasType, amount: number) {
        if (!this.grid.isValidPos(x, y)) return;

        const cell = this.gasGrid[x]![y]!;
        if (cell.type === GasType.NONE || cell.type === type) {
            cell.type = type;
            cell.density = Math.min(100, cell.density + amount);
        } else {
            // Very simplified gas mixing (override if strong enough)
            if (amount > cell.density) {
                cell.type = type;
                cell.density = amount;
            }
        }
    }

    /**
     * 直燃旁路（CE Items.c:5217/5445 `exposeTileToFire(x, y, true)`，
     * "burninate"）：火杖/火系弹道/怪物火弹的落点。跳过 chanceToIgnite
     * 掷骰，但格子必须可燃（T_IS_FLAMMABLE 四层并集）且本回合暴露未满
     * 12 次——CE 没有把火放上石头地板的 exposeTileToFire；那是 DF 生成
     * 家族（igniteForced）的事。掷骰路径只在火段内部（runFireUpdate）。
     */
    public ignite(x: number, y: number): void {
        const r = exposeTileToFire(this.grid, x, y, true);
        this.fireCaughtQueue.push(...r.caughtFireCells);
    }

    /**
     * 强制点火（CE 的火 DF 生成家族）：把 DF_PLAIN_FIRE（Globals.c:740，
     * {PLAIN_FIRE, SURFACE, 0, 0}——单点、零 RNG）经 spawnDungeonFeature
     * 铺到 (x,y)。bloat 自爆、火系药水、火陷阱等"外力点火"走这里。
     *
     * 与 F-1 及更早形态的差别：不再无差别直写层——fillSpawnMap 的
     * T_OBSTRUCTS_SURFACE_EFFECTS 守卫使火落不进楼梯/祭坛（CE Architect.c:3230，
     * F-1 §七.2 预测的"免费守卫"），drawPriority 判据照常生效。
     * abortIfBlocking=false（CE promoteTile/DF 家族同参：火不因堵路被否决）。
     *
     * F-1 形态的 duration 参数随 burnDuration 倒计时模型一起退役
     * （火寿命 = promoteChance 概率衰老，无 per-cell 时长）。
     * 返回本次新登记的起火格（CAUGHT_FIRE_THIS_TURN 等价物），调用方可
     * 自行处置；通常无需返回值——队列已由 updateFires 统一交给 Game。
     */
    public igniteForced(x: number, y: number): Pos[] {
        if (!this.grid.isValidPos(x, y)) return [];
        const feat = catalogFeature(DF.DF_PLAIN_FIRE);
        const spawn = spawnDungeonFeature(this.grid, x, y, feat, false);
        this.fireCaughtQueue.push(...spawn.caughtFireCells);
        return spawn.caughtFireCells;
    }

    /**
     * 排干 ignite/igniteForced 攒下的起火登记（CAUGHT_FIRE_THIS_TURN 等价物）。
     * 调用时点 = 客观块晋升驱动**之前**（Game.objectiveTimeBlock）：CE 的旗标
     * 在点燃瞬间生效（Architect.c:3235），下一 updateEnvironment 的晋升段
     * （Time.c:1625）据此跳过这些格的衰老掷骰——web 的旗标等价物归 Game 所有，
     * 必须在晋升前并入，否则玩家动作期间点的火会在下一客观块被立即衰老。
     */
    public takeNewlyCaughtFire(): Pos[] {
        if (this.fireCaughtQueue.length === 0) return [];
        const out = this.fireCaughtQueue;
        this.fireCaughtQueue = [];
        return out;
    }

    /**
     * 客观块火段（Game.objectiveTimeBlock 每百 tick 调一次）：
     *   1. 复燃分支（web 自创，原样保留）：焦土 0.05%/回合再生草——本轮起
     *      火烧尽的产物是 EMBERS/ASH（CE 口径），CHARRED_FLOOR 的剩余生产者
     *      只剩火陷阱的自转化（Game.triggerTrap），本分支substrate变稀是
     *      §二.3 的既授权后果；
     *   2. CE 火段（Time.c:1688-1700，Promotion.runFireUpdate：12 次暴露
     *      封顶、4 邻 chanceToIgnite 掷骰、可燃物经 promoteTile 消耗）；
     *   3. 蒸汽分支（web 自创，原样保留 8 邻口径）：燃烧格贴水 30% 冒
     *      50 密度蒸汽——CE 的蒸汽来自水体自身被点燃（§5.3-9），归 G 链。
     *
     * `caughtFireCells`：调用方持有的当前起火格集（Game.pendingCaughtFireCells，
     * CE CAUGHT_FIRE_THIS_TURN 在火段时点的存活半边），火段对它们不重复暴露。
     * 返回本次新登记的起火格（火段内新点的火；ignite/igniteForced 的队列
     * 由 takeNewlyCaughtFire 在晋升驱动前排干，不在此处）。
     */
    public updateFires(caughtFireCells?: Pos[]): Pos[] {
        const regrowths: { x: number, y: number, terrain: TerrainType }[] = [];

        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell) continue;

                // 1. Regrowth mechanic: Charred floors rarely grow grass
                if (cell.terrain === TerrainType.CHARRED_FLOOR && !cell.isBurning) {
                    if (rng.randPercent(1) && rng.randPercent(5)) { // Very rare: 0.05% chance per turn
                        regrowths.push({ x, y, terrain: rng.randPercent(20) ? TerrainType.FOLIAGE : TerrainType.GRASS });
                    }
                }
            }
        }

        // 2. CE 火段（12 封顶 / 4 邻 / chanceToIgnite / promoteTile 消耗可燃层）。
        const fired = runFireUpdate(this.grid, { caughtFireCells });

        // 3. Steam: fire adjacent to water（web 自创，8 邻口径原样保留）。
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell?.isBurning) continue;
                const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                for (const [dx, dy] of dirs) {
                    const ncell = this.grid.getCell(x + dx!, y + dy!);
                    if (!ncell) continue;
                    // 水面判定查 LIQUID 层——火盖在水上（SURFACE）时有效地形
                    // 是火（F-1 起的口径，原样保留）。
                    if (ncell.layers[DungeonLayer.LIQUID] === TerrainType.WATER_SHALLOW || ncell.layers[DungeonLayer.LIQUID] === TerrainType.WATER_DEEP) {
                        if (rng.randPercent(30)) {
                            this.addGas(x + dx!, y + dy!, GasType.STEAM, 50);
                        }
                    }
                }
            }
        }

        for (const pos of regrowths) {
            const cell = this.grid.getCell(pos.x, pos.y);
            if (cell) {
                cell.terrain = pos.terrain;
                if (pos.terrain === TerrainType.FOLIAGE) {
                    cell.char = '♠';
                    cell.color = 0x228822;
                } else {
                    cell.char = '"';
                    cell.color = 0x33aa33;
                }
            }
        }

        return fired.caughtFireCells;
    }

    public updateGases() {
        const newGrid: GasCell[][] = [];
        for (let x = 0; x < DCOLS; x++) {
            newGrid[x] = [];
            for (let y = 0; y < DROWS; y++) {
                newGrid[x]![y] = { type: this.gasGrid[x]![y]!.type, density: this.gasGrid[x]![y]!.density };
            }
        }

        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = this.gasGrid[x]![y]!;
                if (cell.density <= 0) continue;

                // Natural dissipation
                let dissipationRate = 2;
                if (cell.type === GasType.STEAM) dissipationRate = 5;
                if (cell.type === GasType.CREEPING_DEATH) dissipationRate = 1;

                newGrid[x]![y]!.density -= dissipationRate;
                if (newGrid[x]![y]!.density <= 0 && this.gasGrid[x]![y]!.type === newGrid[x]![y]!.type) {
                    newGrid[x]![y]!.type = GasType.NONE;
                    newGrid[x]![y]!.density = 0;
                }

                if (cell.density > 10) {
                    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx!;
                        const ny = y + dy!;
                        if (!this.grid.isValidPos(nx, ny)) continue;

                        const terrainCell = this.grid.getCell(nx, ny);
                        if (!terrainCell || terrainCell.isOpaque) continue; // Don't spread into walls/doors

                        // Creeping death does not spread onto grass/foliage/bog
                        if (cell.type === GasType.CREEPING_DEATH) {
                            if (terrainCell.terrain === TerrainType.GRASS || terrainCell.terrain === TerrainType.FOLIAGE || terrainCell.terrain === TerrainType.BOG) {
                                continue;
                            }
                        }

                        const neighbor = newGrid[nx]![ny]!;
                        // Simple diffusion pressure
                        const spreadAmount = Math.floor(cell.density * 0.15); // 15% spreads to each neighbor

                        // Creeping Death spreads aggressively
                        const actualSpread = cell.type === GasType.CREEPING_DEATH ? Math.floor(cell.density * 0.25) : spreadAmount;

                        if (neighbor.type === GasType.NONE || neighbor.type === cell.type) {
                            neighbor.type = cell.type;
                            neighbor.density = Math.min(100, neighbor.density + actualSpread);
                            newGrid[x]![y]!.density -= actualSpread; // Conservation of volume
                        } else if (neighbor.type !== cell.type) {
                            // Heavy gas replaces lighter gas
                            if (cell.density > neighbor.density + 20) {
                                neighbor.type = cell.type;
                                neighbor.density = actualSpread;
                                newGrid[x]![y]!.density -= actualSpread;
                            }
                        }
                    }
                }
            }
        }

        // Clean up and clamp
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (newGrid[x]![y]!.density <= 0) {
                    newGrid[x]![y]!.type = GasType.NONE;
                    newGrid[x]![y]!.density = 0;
                } else if (newGrid[x]![y]!.density > 100) {
                    newGrid[x]![y]!.density = 100;
                }
            }
        }

        this.gasGrid = newGrid;
    }
}
