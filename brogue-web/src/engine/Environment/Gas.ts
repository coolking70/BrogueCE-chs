/**
 * src/engine/Environment/Gas.ts
 * Gas subsystem: CE 的体积气体模型（G-1 起本文件是 updateVolumetricMedia 的宿主）
 *
 * G-1 形态（任务书 §二：F-0 §5.3 第 6/7/8 条 + 量纲 + P1-45）：
 * 气体的"是什么"住在 Grid.Cell.layers[GAS]（TerrainType.POISON_GAS /
 * CONFUSION_GAS / STEAM，CE Globals.c:502/503/508），"有多少"住在
 * Cell.volume（CE pmap.volume，Rogue.h:1307，unsigned short 0-65535）。
 * gasGrid 是这两者的只读镜像，仅供渲染（GameCanvas 在禁改文件）与
 * 存档/效果查询消费；镜像与事实来源的同步点只有三个：addGas（单格）、
 * updateGases（全量，每轮末尾）、syncGasMirror（全量，外部写入 GAS 层后
 * 由调用方触发，如 spawnDungeonFeature 的 GAS 分支）。
 *
 * updateGases() = CE updateVolumetricMedia（Time.c:1383-1479）逐行移植：
 *   - 8 邻（nbDirs，GlobalsBase.c:38）体积均分：sum/(1+8邻)；
 *   - 随机舍入：rand_range(0, numSpaces-1) < sum%numSpaces 时 +1
 *     （Time.c:1408-1410）——守恒在期望意义上成立；
 *   - chasm/trapdoor（T_AUTO_DESCENT）numSpaces++：气体逃出层外
 *     （Time.c:1404-1406）；
 *   - 类型竞争：本格类型 ≠ 邻域最大体积者的类型且新体积 >3 时整体换型；
 *     换型前若已有别的气，新体积压到 3（Time.c:1427-1431，"otherwise
 *     interactions between gases are crazy"）；
 *   - 消散二档：TM_GAS_DISSIPATES_QUICKLY 50%/轮 −1、TM_GAS_DISSIPATES
 *     20%/轮 −1（读 tile 的机械旗标，Time.c:1437-1444）——档位住在
 *     TerrainCatalog 的气体条目里；METHANE/DARKNESS 无旗标即永不自散；
 *   - T_OBSTRUCTS_GAS 格里被困的气瞬时散给能存的邻居（:1446-1474）；
 *   - CE 的 uint16 回绕语义用 Uint16Array 承载（newGasVolume），与 CE
 *     逐位一致。
 * 调用节奏在 Game.objectiveTimeBlock：先全场探测 GAS 层非空（CE
 * Time.c:1600-1613），非空才连调两次（Time.c:1606 注释 "// update gases
 * twice"）。探测守卫同时保住无气体回合的 RNG 流——本函数每格每轮各消耗
 * 一次 rand_range（随机舍入），空跑会白烧 2×DCOLS×DROWS 次抽取。
 *
 * 与 CE 的有意差异（登记表）：
 *   - randRange(0,0) 在 web 不消耗抽取（CE rand_range(0,0) 消耗）：只影响
 *     流位置记账，web 流本就独立，行为无差；
 *   - volume 写入口钳制 65535（CE uint16 回绕）：触顶需单格 ≥4 支 dewar
 *     叠加，实际不可达，登记；
 *   - addGas 是 CE 没有的概念，其语义按 CE GAS 层 DF 特例
 *     （Architect.c:3384-3386 `volume += startProb; layers[GAS] = tile`）
 *     折算——体积加法、类型无条件换型，不再是 web 旧的"amount > density
 *     才顶替"（那套混液规则随 0-100 量纲一起退役）；
 *   - GasType.CREEPING_DEATH（web 自创，CE 无此气体）保留枚举值供渲染/
 *     效果代码引用（D2：保留代码），但无 TerrainType 载体、不参与层存储，
 *     addGas 对其返回 false（留痕见 g_1 测试）；GameType.FIRE 死枚举随
 *     P1-45 幽灵气写者一起删除。
 * 火侧入口（ignite / igniteForced / updateFires / takeNewlyCaughtFire）的
 * 蔓延/寿命/燃烧状态机语义不变（G-2 反向哨兵）；G-2 的唯一火侧改动是
 * 退役 updateFires 里 web 自创的"30% 冒 325"一次性蒸汽分支——CE 蒸汽源
 * （水体被火段点燃 → DF_STEAM_ACCUMULATION 每回合 +15）经 DF 管线自动
 * 接管，见 updateFires 注释。
 */

import { Grid, DCOLS, DROWS, DungeonLayer, TerrainType, TERRAIN_HOME_LAYER } from '../Map/Grid';
import { rng } from '../Random';
import {
    TERRAIN_FLAGS,
    T_AUTO_DESCENT,
    T_OBSTRUCTS_GAS,
    TM_GAS_DISSIPATES,
    TM_GAS_DISSIPATES_QUICKLY,
} from '../Map/TerrainCatalog';
import { cellTerrainFlags, catalogFeature, spawnDungeonFeature } from '../Map/DungeonFeature';
import { DF } from '../Map/DungeonFeatureCatalog';
import { exposeTileToFire, runFireUpdate } from '../Map/Promotion';
import type { Pos } from '../../types';

/**
 * 气体类型。G-1 起数值 = 对应 GAS 层 TerrainType 的枚举值（同一存储，
 * 同一比较口径），渲染层（GameCanvas）的 `gas.type === GasType.X` 比较因此
 * 无需改动。web 旧枚举值（POISON=2 等）随 0-100 量纲一起退役——
 * 旧存档里的旧值会被 loadSnapshot 的 addGas 校验拒绝（登记报告）。
 */
export enum GasType {
    NONE = TerrainType.NOTHING,
    POISON = TerrainType.POISON_GAS,
    CONFUSION = TerrainType.CONFUSION_GAS,
    STEAM = TerrainType.STEAM,
    /**
     * G-2：CE Globals.c:507 METHANE_GAS（沼气）迁入 GAS 层后的枚举成员。
     * 与 POISON 等同构：数值 = GAS 层 TerrainType 值。永不自散（CE 无消散
     * 旗标）、可燃（ign 100）、TM_EXPLOSIVE_PROMOTE 爆轰载体；web 载体 =
     * MUD 的 promoteType DF_METHANE_GAS_PUFF（1%/回合）。
     */
    METHANE = TerrainType.METHANE_GAS,
    /**
     * G-3：CE Globals.c:506 PARALYSIS_GAS（麻痹气体）迁入 GAS 层后的枚举
     * 成员。与前五种同构：数值 = GAS 层 TerrainType 值。QUICK 档消散、
     * 可燃（ign 100 → DF_GAS_FIRE）、效果 = T_CAUSES_PARALYSIS
     * （Time.c:471-497：站进即 STATUS_PARALYZED、无阈值、每回合 max(…,20)
     * 刷新——Game.applyEnvironmentalEffects 判定）。web 载体 =
     * potion_of_paralysis 改线（CE Items.c:6994/8118，云体积 1000 =
     * DF_PARALYSIS_GAS_CLOUD_POTION 的 startProbability）。
     */
    PARALYSIS = TerrainType.PARALYSIS_GAS,
    /**
     * D2 留痕：web 自创气体，CE 无对应 tile（F-0 §2.1/§5.2-5），故无层载体。
     * 数值故意取在 TerrainType 值域之外（当前最大 38）：万一被误写入层，
     * TERRAIN_FLAGS 查表得到 undefined 会响亮崩溃而不是静默污染。
     * 生成池已排空（Game 侧 D2 过滤），正常游戏不可达。
     */
    CREEPING_DEATH = 250
}

/** 该类型是否有 GAS 层载体（即是否为注册过的气体地形）。 */
export function isGasTerrain(t: number): boolean {
    return TERRAIN_HOME_LAYER[t as TerrainType] === DungeonLayer.GAS;
}

/**
 * gasGrid 镜像条目。`density` 字段名保留（渲染/存档接口在禁改/既有文件），
 * G-1 起语义 = CE volume（0-65535，不再是 0-100）。type = layers[GAS] 的
 * 原值（GasType 常量与其数值相等，比较两可）。type=NONE 而 density>0 是
 * 合法状态（CE 随机舍入的"不可见残气"，无旗标不消散、可被后续云团收编）。
 */
export interface GasCell {
    type: GasType;
    density: number; // = CE volume（G-1 起不再是 0-100）
}

export class EnvironmentManager {
    /**
     * 渲染/存档镜像（只读消费）。事实来源是 grid 各格的 layers[GAS]+volume；
     * 同步点：addGas（单格）、updateGases（每轮末全量）、syncGasMirror（外部
     * 直写 GAS 层后调用方触发）、clearGasAt。
     */
    public gasGrid: GasCell[][] = [];
    private grid: Grid;
    /** F-2a：点火入口（ignite/igniteForced）攒下的 CAUGHT_FIRE_THIS_TURN
     *  增量，由下一次 updateFires 一并交给 Game（喂回晋升驱动的 skip 集）。
     *  CE 里这些格的旗标在 pmap 上即时生效；web 的旗标等价物归 Game 所有，
     *  入口与客观块不同步，用队列衔接。 */
    private fireCaughtQueue: Pos[] = [];
    /** F-2c：火段（updateFires → runFireUpdate）新落下的爆炸地形格
     *  （甲烷爆轰 DF_EXPLOSION_FIRE → GAS_EXPLOSION）。CE 的 fillSpawnMap
     *  refresh 分支（Architect.c:3255-3260）在落格瞬间对格上生物跑
     *  applyInstantTileEffectsToCreature；web 由 Game 在火段后排干本队列
     *  即时结算。 */
    private explosiveSpawnQueue: Pos[] = [];

    public getState() {
        return {
            fireCaughtQueue: this.fireCaughtQueue.map(p => ({ ...p })),
            explosiveSpawnQueue: this.explosiveSpawnQueue.map(p => ({ ...p })),
        };
    }

    public setState(state: ReturnType<EnvironmentManager['getState']>): void {
        this.fireCaughtQueue = state.fireCaughtQueue.map(p => ({ ...p }));
        this.explosiveSpawnQueue = state.explosiveSpawnQueue.map(p => ({ ...p }));
        this.syncGasMirror();
    }

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

    /**
     * 往 (x,y) 注入 amount 体积的 type 气体。CE 没有 addGas 概念；语义按
     * CE GAS 层 DF 特例（Architect.c:3384-3386）折算：
     *   volume += amount（钳 65535），layers[GAS] = type（无条件换型）。
     * 对无层载体的类型（CREEPING_DEATH / NONE / 任意非气体地形）拒绝写入
     * 并返回 false——P1-45 幽灵气（Game.ts 旧 creeping_death 药水写
     * type=1=FIRE 的占位气）的结构性防复发；旧存档里的遗留气体（旧枚举值）
     * 在 loadSnapshot 处被同一校验丢弃（登记报告）。
     */
    public addGas(x: number, y: number, type: GasType, amount: number): boolean {
        if (!this.grid.isValidPos(x, y)) return false;
        if (!isGasTerrain(type)) return false;

        const cell = this.grid.getCell(x, y)!;
        cell.volume = Math.min(65535, cell.volume + amount);
        // GasType 的气体成员与 GAS 层 TerrainType 同值同义（枚举双身份），
        // TS 视两枚举为不相交类型，经 number 中转定位。
        cell.layers[DungeonLayer.GAS] = type as unknown as TerrainType;
        this.syncMirrorAt(x, y);
        return true;
    }

    /** 清除一格的气体（体积 + GAS 层）。房间基线还原用（Game.ts）。 */
    public clearGasAt(x: number, y: number): void {
        const cell = this.grid.getCell(x, y);
        if (!cell) return;
        cell.volume = 0;
        cell.layers[DungeonLayer.GAS] = TerrainType.NOTHING;
        this.syncMirrorAt(x, y);
    }

    /** CE Time.c:1600-1613 的探测：场上是否还有气体（GAS 层非空）。 */
    public hasVolumetricGas(): boolean {
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                if (this.grid.getCell(x, y)!.layers[DungeonLayer.GAS] !== TerrainType.NOTHING) {
                    return true;
                }
            }
        }
        return false;
    }

    /** 全量重建镜像（外部路径直写 GAS 层后的对账口）。 */
    public syncGasMirror(): void {
        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                this.syncMirrorAt(x, y);
            }
        }
    }

    private syncMirrorAt(x: number, y: number): void {
        const cell = this.grid.getCell(x, y);
        const entry = this.gasGrid[x]?.[y];
        if (!cell || !entry) return;
        entry.type = cell.layers[DungeonLayer.GAS] as unknown as GasType;
        entry.density = cell.volume;
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
     * F-2c：排干火段攒下的爆炸地形落格（见 explosiveSpawnQueue）。
     * 调用时点 = 客观块火段之后（Game.objectiveTimeBlock）：CE 里爆炸 tile
     * 落到生物脚下当场结算 applyInstantTileEffectsToCreature
     * （Architect.c:3255-3260），爆炸伤害是瞬时的、不经燃烧状态。
     */
    public takeExplosiveSpawnCells(): Pos[] {
        if (this.explosiveSpawnQueue.length === 0) return [];
        const out = this.explosiveSpawnQueue;
        this.explosiveSpawnQueue = [];
        return out;
    }

    /**
     * 客观块火段（Game.objectiveTimeBlock 每百 tick 调一次）：
     *   1. 复燃分支（web 自创，原样保留）：焦土 0.05%/回合再生草——本轮起
     *      火烧尽的产物是 EMBERS/ASH（CE 口径），CHARRED_FLOOR 的剩余生产者
     *      只剩火陷阱的自转化（Game.triggerTrap），本分支substrate变稀是
     *      §二.3 的既授权后果；
     *   2. CE 火段（Time.c:1688-1700，Promotion.runFireUpdate：12 次暴露
     *      封顶、4 邻 chanceToIgnite 掷骰、可燃物经 promoteTile 消耗）。
     *
     * G-2 退役登记：web 自创的"火贴水 30% 冒 325 蒸汽"一次性分支已删——
     * CE 的蒸汽源是水体自身（WATER_DEEP chanceToIgnite=100、fireType
     * DF_STEAM_ACCUMULATION）被火段点燃 → 每回合 +15 体积的持续蒸汽，
     * 全部经 runFireUpdate → exposeTileToFire → promoteTile → DF 管线自动
     * 发生，不需要本文件任何额外代码。新旧蒸汽曲线对比见 G-2 报告
     * （旧：250→0 的一次性烟团；新：+15/回合持续注入直到火熄）。
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
        // 深水（T_IS_FLAMMABLE, ign 100, fireType DF_STEAM_ACCUMULATION）被
        // 火段点燃即产出持续蒸汽——CE 蒸汽源，G-2 起真实生效。
        const fired = runFireUpdate(this.grid, { caughtFireCells });
        // F-2c：火段的爆炸落格（甲烷爆轰）进队列，Game 在火段后排干结算。
        this.explosiveSpawnQueue.push(...fired.explosiveSpawnCells);

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

    // CE nbDirs 全 8 向（GlobalsBase.c:38）——顺序逐项一致（前 4 正交、
    // 后 4 对角）。求和/计数与顺序无关，但照抄以保持逐行可对读。
    private static readonly NB_DIRS8: ReadonlyArray<readonly [number, number]> = [
        [0, -1], [0, 1], [-1, 0], [1, 0],
        [-1, -1], [-1, 1], [1, -1], [1, 1],
    ];

    /**
     * CE updateVolumetricMedia（Time.c:1383-1479）逐行移植。一次调用 =
     * 一轮 8 邻体积均分；每玩家回合跑两轮的节奏由 Game.objectiveTimeBlock
     * 掌握（CE updateEnvironment 的探测 + "// update gases twice"）。
     * RNG 消耗（与 CE 同序）：每个不挡气的格每轮一次随机舍入
     * rand_range(0, numSpaces-1)；有体积且带消散旗标的格再加一次
     * rand_percent(50/20)。扫描次序 i 外层 j 内层。
     */
    public updateGases(): void {
        const grid = this.grid;
        const W = grid.width;
        const H = grid.height;
        const idx = (px: number, py: number): number => py * W + px;

        // CE `unsigned short newGasVolume[DCOLS][DROWS]`：Uint16Array 复刻
        // CE 的 uint16 回绕语义（Time.c:1387）。
        const newGasVolume = new Uint16Array(W * H);

        const obstructsGas = (x: number, y: number): boolean =>
            (cellTerrainFlags(grid, x, y) & T_OBSTRUCTS_GAS) !== 0;

        for (let i = 0; i < W; i++) {
            for (let j = 0; j < H; j++) {
                const cell = grid.getCell(i, j)!;
                if (!obstructsGas(i, j)) {
                    // CE :1401-1424：邻域闭集（自身 + 8 个不挡气的在图邻居）
                    // 的体积和与"最大体积者的类型"（平局归自己）。
                    let sum = cell.volume;
                    let numSpaces = 1;
                    let highestNeighborVolume = cell.volume;
                    let gasType = cell.layers[DungeonLayer.GAS]!;
                    for (const [dx, dy] of EnvironmentManager.NB_DIRS8) {
                        const newX = i + dx;
                        const newY = j + dy;
                        if (!grid.isValidPos(newX, newY)) continue;
                        if (obstructsGas(newX, newY)) continue;
                        const n = grid.getCell(newX, newY)!;
                        sum += n.volume;
                        numSpaces++;
                        if (n.volume > highestNeighborVolume) {
                            highestNeighborVolume = n.volume;
                            gasType = n.layers[DungeonLayer.GAS]!;
                        }
                    }
                    // CE :1404-1406：chasm/trapdoor 格 numSpaces++——
                    // 气体从此逃出层外（分母变大、总量减少）。
                    if ((cellTerrainFlags(grid, i, j) & T_AUTO_DESCENT) !== 0) {
                        numSpaces++;
                    }
                    // CE :1408-1410：均分 + 随机舍入。
                    let nv = Math.floor(sum / Math.max(1, numSpaces));
                    if (rng.randRange(0, numSpaces - 1) < (sum % numSpaces)) {
                        nv++; // stochastic rounding
                    }
                    // CE :1427-1431：类型竞争。邻域最大者的类型 ≠ 本格类型且
                    // 新体积 >3 → 整体换型；换型前已有别的气的，新体积压到 3
                    // （"otherwise interactions between gases are crazy"）。
                    // 本格类型 == 最大者类型，或新体积 ≤3：保持原状。
                    if (cell.layers[DungeonLayer.GAS] !== gasType && nv > 3) {
                        if (cell.layers[DungeonLayer.GAS] !== TerrainType.NOTHING) {
                            nv = Math.min(3, nv);
                        }
                        cell.layers[DungeonLayer.GAS] = gasType;
                    } else if (cell.layers[DungeonLayer.GAS] !== TerrainType.NOTHING && nv < 1) {
                        // CE :1432-1436：体积归零即收层（不可见残气 volume
                        // 可暂存于 NOTHING 层，CE 同——见文件头 GasCell 注）。
                        cell.layers[DungeonLayer.GAS] = TerrainType.NOTHING;
                    }
                    // CE :1437-1444：消散二档（读"当前"GAS 层 tile 的旗标——
                    // 换型/收层之后的值，CE 同序）。旧体积为 0 不掷。
                    if (cell.volume > 0) {
                        const mech = TERRAIN_FLAGS[cell.layers[DungeonLayer.GAS]!].mechFlags;
                        if (mech & TM_GAS_DISSIPATES_QUICKLY) {
                            if (rng.randPercent(50)) nv -= 1;
                        } else if (mech & TM_GAS_DISSIPATES) {
                            if (rng.randPercent(20)) nv -= 1;
                        }
                    }
                    newGasVolume[idx(i, j)] = nv;
                } else if (cell.volume > 0) {
                    // CE :1446-1474：挡气格里被困的气，瞬时散给能存的邻居
                    // （整除均分；够 1 体积才换型），自身清零。
                    let numSpaces = 0;
                    for (const [dx, dy] of EnvironmentManager.NB_DIRS8) {
                        const newX = i + dx;
                        const newY = j + dy;
                        if (grid.isValidPos(newX, newY) && !obstructsGas(newX, newY)) {
                            numSpaces++;
                        }
                    }
                    if (numSpaces > 0) {
                        for (const [dx, dy] of EnvironmentManager.NB_DIRS8) {
                            const newX = i + dx;
                            const newY = j + dy;
                            if (!grid.isValidPos(newX, newY)) continue;
                            if (obstructsGas(newX, newY)) continue;
                            newGasVolume[idx(newX, newY)] = newGasVolume[idx(newX, newY)]! + Math.floor(cell.volume / numSpaces);
                            if (Math.floor(cell.volume / numSpaces) > 0) {
                                grid.getCell(newX, newY)!.layers[DungeonLayer.GAS] =
                                    cell.layers[DungeonLayer.GAS]!;
                            }
                        }
                    }
                    newGasVolume[idx(i, j)] = 0;
                    cell.layers[DungeonLayer.GAS] = TerrainType.NOTHING;
                }
            }
        }

        // CE :1472-1478：终局写回。
        for (let i = 0; i < W; i++) {
            for (let j = 0; j < H; j++) {
                grid.getCell(i, j)!.volume = newGasVolume[idx(i, j)]!;
            }
        }

        this.syncGasMirror();
    }
}
