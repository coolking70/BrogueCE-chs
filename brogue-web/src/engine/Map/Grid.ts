/**
 * src/engine/Map/Grid.ts
 * Grid and Cell structures reflecting Brogue's 2D map.
 *
 * C-4a-0：迁移 CE 的四层地形模型（结构迁移，行为逐位不变）。
 *
 * CE 事实来源（BrogueCE-master/src/brogue/，只读）：
 * - `Rogue.h:1293-1300` `enum dungeonLayers { NO_LAYER=-1, DUNGEON, LIQUID, GAS,
 *   SURFACE, NUMBER_TERRAIN_LAYERS }` —— 每格四层地形同时存在。
 * - `Movement.c:64-80` `highestPriorityLayer()` —— 遍历四层取 drawPriority
 *   最小者（数字越小优先级越高）；严格 `<` 使同优先级时层序在前者胜出；
 *   全空时返回层 0（DUNGEON 层，该层存 NOTHING，故对外的地形值是 NOTHING）。
 * - `Globals.c:315` `tileCatalog` 第 4 列 drawPriority。
 *
 * 本轮刻意保持"每格只有一层非 NOTHING"：setTerrain = 写归属层 + 清空其余
 * 三层，因此 `terrain` getter 与迁移前的覆盖式赋值逐位等价。
 * C-4a 再把"清空其余三层"换成"只清 CE 会清的"。
 */
import type { Pos } from '../../types';
import { DCOLS, DROWS } from '../../types';
export { DCOLS, DROWS };

export enum TerrainType {
    NOTHING = 0,
    GRANITE,
    FLOOR,
    WALL,
    DOOR,
    OPEN_DOOR,
    WATER_SHALLOW,
    WATER_DEEP,
    CHASM,
    LAVA,
    GRASS,
    FOLIAGE,
    BOG,
    STAIRS_UP,
    STAIRS_DOWN,
    CHARRED_FLOOR,
    SIGN,
    RESET_PLATE,
    TRAP,
    SECRET_DOOR,
    PRESSURE_PLATE,
    LOCKED_DOOR,
    ALTAR,
    WEB,
    BLOOD,
    MUD,
    // C-2 新增（CE Globals.c 目录对应物；只追加在尾部，既有枚举值不变——
    // terrainFingerprint 按数值哈希，中间插值会重排全部既有指纹）：
    CHASM_EDGE,      // CE Globals.c:417 深渊边缘，无旗标可走；随 CHASM 液体使用（本轮 CHASM 不生成）
    OBSIDIAN,        // CE Globals.c:427 黑曜石地面，无旗标可走；硫矿湖的镶边（createWreath）
    BRIDGE,          // CE Globals.c:428 绳桥，T_IS_FLAMMABLE 可走；buildABridge 落在 CHASM 上（本轮真实生成中为 0）
    BRIDGE_EDGE,     // CE Globals.c:430 桥端桩点，可走；buildABridge 落在两端岸格上
    INERT_BRIMSTONE, // CE Globals.c:426 惰性硫矿，T_SPONTANEOUSLY_IGNITES（液态湖体；点火链属 C-4）
    // F-1：CE Globals.c:492 PLAIN_FIRE（十种 T_IS_FIRE 地形中 web 唯一用得上的：
    // 点火链（exposeTileToFire/ignite/igniteForced）落出的火地形）。落 SURFACE
    // 层（CE 火 DF 全在 SURFACE）；drawPriority 10 压制草(60)/网(19)——CE 渲染
    // 口径：门(8)/墙(0)仍盖住火。promoteChance=500（5%/回合概率衰老 → EMBERS）
    // 由 F-2a 接通（TerrainCatalog 条目注释详述）。
    PLAIN_FIRE,
    // F-2a：CE Globals.c:469 EMBERS（余烬）与 :461 ASH（灰烬）——CE 火寿命链
    // PLAIN_FIRE →(promoteChance 500)→ EMBERS →(300)→ ASH 的中间/终点载体，
    // 两者都是 SURFACE 层纯装饰（零旗标：不点燃邻格、不可燃、可通行）。
    // 只追加在尾部（terrainFingerprint 按数值哈希，既有值不变）。
    EMBERS,
    ASH
}

export enum LightType {
    NO_LIGHT = 0,
    LIT,
    DARK
}

/**
 * CE `Rogue.h:1293-1300` 的 `enum dungeonLayers` 逐值对应。
 * 顺序照 CE：GAS 在 SURFACE 之前（直觉顺序是错的，CE 就是这样）。
 * NO_LAYER = -1 属于查询失败哨兵，不是存储层，本轮不引入。
 */
export enum DungeonLayer {
    DUNGEON = 0, // 地基层（墙、地板、门等）
    LIQUID,      // 液体层（水、岩浆、深渊、桥面等）
    GAS,         // 气体层——web 的气体走独立 Gas.ts 网格，本层恒空（C-4a 前提）
    SURFACE,     // 表面层（草、网、血等）
    COUNT
}

/**
 * drawPriority 表——CE `Globals.c:315` tileCatalog 第 4 列（数字越小优先级越高）。
 *
 * 逐条出处（CE 目录名 → web 成员）：
 *   NOTHING=CE NOTHING 100；GRANITE 0；FLOOR 95；WALL 0；DOOR 8；OPEN_DOOR 25；
 *   WATER_SHALLOW=CE SHALLOW_WATER 55；WATER_DEEP=CE DEEP_WATER 40；CHASM 40；
 *   LAVA 40；GRASS 60；FOLIAGE 45；STAIRS_UP=CE UP_STAIRS 30；
 *   STAIRS_DOWN=CE DOWN_STAIRS 30；SECRET_DOOR 0；LOCKED_DOOR 15；
 *   ALTAR=CE ALTAR_INERT 17；WEB=CE SPIDERWEB 19；BLOOD=CE RED_BLOOD 80；
 *   MUD 55；CHASM_EDGE 80；OBSIDIAN 50；BRIDGE 45；BRIDGE_EDGE 45；
 *   INERT_BRIMSTONE 40。
 *
 * web 独有地形取最接近的 CE 对应物（依据见报告）：
 *   BOG=55（CE 无 BOG 条目；最接近的是 MUD——CE 的 MUD 用的正是 G_BOG 字形，
 *         语义同为沼泽泥泞液面， prio 55）；
 *   CHARRED_FLOOR=95（CE 无对应物；web 的焦土是 DUNGEON 层对 FLOOR 的替换
 *         而非表面覆盖物，须与 FLOOR 同档才保持"就是地面"的显示/语义）；
 *   SIGN=7（CE 无 sign；最接近的"地面上的人为标记"是 SACRED_GLYPH 7）；
 *   RESET_PLATE=15（对应物 MACHINE_PRESSURE_PLATE 15）；
 *   TRAP=30（CE 可见陷阱 GAS_TRAP_POISON/FLAMETHROWER 等均 30；隐藏态 95 不适用——
 *         web 的 TRAP 恒可见）；
 *   PRESSURE_PLATE=15（对应物 MACHINE_PRESSURE_PLATE 15）；
 *   PLAIN_FIRE=10（CE Globals.c:492 原值；F-1）。
 */
export const DRAW_PRIORITY: Record<TerrainType, number> = {
    [TerrainType.NOTHING]: 100,
    [TerrainType.GRANITE]: 0,
    [TerrainType.FLOOR]: 95,
    [TerrainType.WALL]: 0,
    [TerrainType.DOOR]: 8,
    [TerrainType.OPEN_DOOR]: 25,
    [TerrainType.WATER_SHALLOW]: 55,
    [TerrainType.WATER_DEEP]: 40,
    [TerrainType.CHASM]: 40,
    [TerrainType.LAVA]: 40,
    [TerrainType.GRASS]: 60,
    [TerrainType.FOLIAGE]: 45,
    [TerrainType.BOG]: 55,
    [TerrainType.STAIRS_UP]: 30,
    [TerrainType.STAIRS_DOWN]: 30,
    [TerrainType.CHARRED_FLOOR]: 95,
    [TerrainType.SIGN]: 7,
    [TerrainType.RESET_PLATE]: 15,
    [TerrainType.TRAP]: 30,
    [TerrainType.SECRET_DOOR]: 0,
    [TerrainType.PRESSURE_PLATE]: 15,
    [TerrainType.LOCKED_DOOR]: 15,
    [TerrainType.ALTAR]: 17,
    [TerrainType.WEB]: 19,
    [TerrainType.BLOOD]: 80,
    [TerrainType.MUD]: 55,
    [TerrainType.CHASM_EDGE]: 80,
    [TerrainType.OBSIDIAN]: 50,
    [TerrainType.BRIDGE]: 45,
    [TerrainType.BRIDGE_EDGE]: 45,
    [TerrainType.INERT_BRIMSTONE]: 40,
    [TerrainType.PLAIN_FIRE]: 10,
    // F-2a：CE EMBERS 70 / ASH 80（Globals.c:469/461 原值）。两者都是纯装饰
    // 表面层：余烬/灰烬压不住火（10）、草（60）、网（19），但会被血（80）同级
    // 竞争——CE fillSpawnMap 判据（Architect.c:3228）原样生效。
    [TerrainType.EMBERS]: 70,
    [TerrainType.ASH]: 80
};

/**
 * 归属层表——每种地形写入哪一层。
 *
 * CE 写入点依据（逐条）：
 * - DUNGEON 层：Architect.c:844/848（花岗岩）、2495（FLOOR，湖底铺垫）、
 *   2511（GRANITE 补洞）、2753（finishDoors：DOOR/FLOOR/SECRET_DOOR）、
 *   2903（门）；3721（DOWN_STAIRS）。陷阱类 DF 目录全为 DUNGEON
 *   （Globals.c:625-631）；MACHINE_PRESSURE_PLATE_USED DF 为 DUNGEON
 *   （Globals.c:815 附近）。
 * - LIQUID 层：fillLake Architect.c:2561 `layers[LIQUID] = liquid`
 *   （DEEP_WATER/CHASM/LAVA/INERT_BRIMSTONE 湖体）；createWreath
 *   Architect.c:2698 `layers[LIQUID] = shallowLiquid`（浅水镶边——注意
 *   CHASM_EDGE 与 OBSIDIAN 作为 lakeType 的 shallow 产物同样进 LIQUID）；
 *   绳桥 Architect.c:2831/2863 `layers[LIQUID] = BRIDGE`；MUD 由 DF 目录
 *   两条 `{MUD, LIQUID, ...}`（Globals.c:892/905）落入 LIQUID。
 * - SURFACE 层：GRASS/DEAD_GRASS/FOLIAGE DF 目录（Globals.c:610-614）；
 *   RED_BLOOD 等 DF（Globals.c:640 附近）；SPIDERWEB DF 两条
 *   （Globals.c:681-682 附近，均 SURFACE）；ASH DF（SURFACE）；
 *   BRIDGE_EDGE Architect.c:2833-2834/2865-2866 `layers[SURFACE]`。
 * - GAS 层：本轮恒空（web 气体走独立 Gas.ts 网格，不在层内）。
 *
 * 与任务书归属表的两处分歧（以 CE 为准，详见报告）：
 *   CHASM_EDGE → LIQUID（任务书写了 SURFACE；CE DF 目录
 *   `{CHASM_EDGE, LIQUID, 100, 100, 0}` + createWreath 写 LIQUID）；
 *   OBSIDIAN → LIQUID（同上：liquidType case 3 的 shallow=OBSIDIAN，
 *   createWreath 把 shallow 写进 LIQUID）。
 * web 自造地形的归属（CE 无对应写入点，按语义归类）：
 *   BOG → LIQUID（沼泽液面，同 MUD）；CHARRED_FLOOR/SIGN/RESET_PLATE →
 *   DUNGEON（对 FLOOR 的就地替换，与 FLOOR 同层）。
 *   PLAIN_FIRE → SURFACE（CE DF_PLAIN_FIRE {PLAIN_FIRE, SURFACE, 0, 0}，
 *   Globals.c:740；F-0 §3.2：十种火 DF 无一例外落 SURFACE——F-1）。
 */
export const TERRAIN_HOME_LAYER: Record<TerrainType, DungeonLayer> = {
    [TerrainType.NOTHING]: DungeonLayer.DUNGEON,
    [TerrainType.GRANITE]: DungeonLayer.DUNGEON,
    [TerrainType.FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.WALL]: DungeonLayer.DUNGEON,
    [TerrainType.DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.OPEN_DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.WATER_SHALLOW]: DungeonLayer.LIQUID,
    [TerrainType.WATER_DEEP]: DungeonLayer.LIQUID,
    [TerrainType.CHASM]: DungeonLayer.LIQUID,
    [TerrainType.LAVA]: DungeonLayer.LIQUID,
    [TerrainType.GRASS]: DungeonLayer.SURFACE,
    [TerrainType.FOLIAGE]: DungeonLayer.SURFACE,
    [TerrainType.BOG]: DungeonLayer.LIQUID,
    [TerrainType.STAIRS_UP]: DungeonLayer.DUNGEON,
    [TerrainType.STAIRS_DOWN]: DungeonLayer.DUNGEON,
    [TerrainType.CHARRED_FLOOR]: DungeonLayer.DUNGEON,
    [TerrainType.SIGN]: DungeonLayer.DUNGEON,
    [TerrainType.RESET_PLATE]: DungeonLayer.DUNGEON,
    [TerrainType.TRAP]: DungeonLayer.DUNGEON,
    [TerrainType.SECRET_DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.PRESSURE_PLATE]: DungeonLayer.DUNGEON,
    [TerrainType.LOCKED_DOOR]: DungeonLayer.DUNGEON,
    [TerrainType.ALTAR]: DungeonLayer.DUNGEON,
    [TerrainType.WEB]: DungeonLayer.SURFACE,
    [TerrainType.BLOOD]: DungeonLayer.SURFACE,
    [TerrainType.MUD]: DungeonLayer.LIQUID,
    [TerrainType.CHASM_EDGE]: DungeonLayer.LIQUID,
    [TerrainType.OBSIDIAN]: DungeonLayer.LIQUID,
    [TerrainType.BRIDGE]: DungeonLayer.LIQUID,
    [TerrainType.BRIDGE_EDGE]: DungeonLayer.SURFACE,
    [TerrainType.INERT_BRIMSTONE]: DungeonLayer.LIQUID,
    [TerrainType.PLAIN_FIRE]: DungeonLayer.SURFACE,
    // F-2a：DF_EMBERS {EMBERS, SURFACE}（Globals.c:747）、
    // DF_ASH {ASH, SURFACE}（Globals.c:672，执行方逐字段复核）。
    [TerrainType.EMBERS]: DungeonLayer.SURFACE,
    [TerrainType.ASH]: DungeonLayer.SURFACE
};

/**
 * T_IS_FIRE 旗标载体集合（CE Globals.c 目录里带 T_IS_FIRE 的 tile 的 web 投影）。
 *
 * 用途：Cell.isBurning 派生 getter 的判据集。放在本文件（而非从 TerrainCatalog
 * 引入）是因为依赖方向只能是 TerrainCatalog → Grid（属性表按枚举键控），
 * 反向 import 会成环——数据因此在此登记一份，由 c_4a_terrain_catalog 的
 * 恒等断言与 TERRAIN_FLAGS 的旗标载体集合双向锁死（漏登记/多登记都翻红，
 * 失败信息指向本注释）。
 *
 * 现有载体（CE 行号）：PLAIN_FIRE（Globals.c:492，F-1 引入）。
 * CE 其余八种火地形（GAS_FIRE / GAS_EXPLOSION / BRIMSTONE_FIRE /
 * FLAMEDANCER_FIRE / DART_EXPLOSION / ITEM_FIRE / CREATURE_FIRE / 火源家具）
 * web 尚无——G 链 / F-2c 落地时随目录条目在此补行。
 */
export const FIRE_TERRAIN_TYPES: readonly TerrainType[] = [
    TerrainType.PLAIN_FIRE
];

/** CE Movement.c:64-80 的纯数据版：对一层快照取最高优先层。 */
export function highestPriorityLayerOf(layers: readonly TerrainType[], skipGas: boolean = false): DungeonLayer {
    let bestPriority = 10000;
    let best = DungeonLayer.DUNGEON;
    for (let tt = 0; tt < DungeonLayer.COUNT; tt++) {
        if (tt === DungeonLayer.GAS && skipGas) {
            continue;
        }
        const t = layers[tt]!;
        // 注意 `layers[tt] &&`：CE 以"非零"判层非空，NOTHING=0 恰为空层哨兵
        if (t !== TerrainType.NOTHING && DRAW_PRIORITY[t] < bestPriority) {
            bestPriority = DRAW_PRIORITY[t];
            best = tt as DungeonLayer;
        }
    }
    return best;
}

/**
 * 跨层清除的干跑计数（仅测试消费，生产代码零读取点）。
 *
 * setTerrain 每次清掉"其他层里非 NOTHING 的内容"时记一笔
 * (被清的层, 被清的地形, 新写入的地形)。本轮"每格只有一层非空"，
 * 这些事件就是 C-4a 放开清空后会出现分歧的位置与规模的实测来源。
 */
export interface CrossLayerClearStat {
    layer: DungeonLayer;
    from: TerrainType;
    to: TerrainType;
    count: number;
}

const crossLayerClearCounts = new Map<string, number>();

function recordCrossLayerClear(layer: DungeonLayer, from: TerrainType, to: TerrainType): void {
    const key = `${layer}:${from}:${to}`;
    crossLayerClearCounts.set(key, (crossLayerClearCounts.get(key) ?? 0) + 1);
}

/** 聚合视图（测试与测量报告用）；生产代码不得调用。 */
export function getCrossLayerClearStats(): CrossLayerClearStat[] {
    const out: CrossLayerClearStat[] = [];
    for (const [key, count] of crossLayerClearCounts) {
        const [layer, from, to] = key.split(':').map(Number) as [DungeonLayer, TerrainType, TerrainType];
        out.push({ layer, from, to, count });
    }
    return out.sort((a, b) =>
        a.layer - b.layer || a.from - b.from || a.to - b.to
    );
}

/** 清零计数（测试隔离用）。 */
export function resetCrossLayerClearStats(): void {
    crossLayerClearCounts.clear();
}

/** 把 t 写进它的归属层并清空其余三层（不动 char/color/启发式）。 */
function writeTerrainHome(cell: Cell, t: TerrainType): void {
    const home = TERRAIN_HOME_LAYER[t];
    for (let l = 0; l < DungeonLayer.COUNT; l++) {
        cell.layers[l] = l === home ? t : TerrainType.NOTHING;
    }
}

/**
 * Represents a single tile on the map.
 */
export class Cell {
    public x: number;
    public y: number;

    // C-4a-0：四层地形（CE Rogue.h pmap.cells 的 layers[NUMBER_TERRAIN_LAYERS]）。
    // 不变量（本轮）：至多一层非 NOTHING；terrain 的读写都经由下方访问器。
    public layers: TerrainType[] = [
        TerrainType.NOTHING,
        TerrainType.NOTHING,
        TerrainType.NOTHING,
        TerrainType.NOTHING
    ];

    public char: string = ' ';
    public color: number = 0x000000;

    /**
     * 有效地形 = 最高优先层的地形（CE Movement.c:64 highestPriorityLayer 语义：
     * drawPriority 最小者；同优先级先遇到的层胜；全空返回 NOTHING）。
     *
     * 保留可写访问器的原因：库内存在 8 处直接赋值点（Game.ts×4、LakeSystem.ts、
     * Gas.ts×4、Monster.ts——后三者在本轮禁改清单里），plain-field 语义 =
     * "t 进归属层、其余层清空、不碰 char/color/通行启发式"，setter 原样复刻，
     * 这些调用点因此一行不改而行为逐位不变。
     */
    get terrain(): TerrainType {
        return this.layers[highestPriorityLayerOf(this.layers)]!;
    }

    set terrain(t: TerrainType) {
        writeTerrainHome(this, t);
    }

    // Flags for state
    public isExplored: boolean = false;
    public isVisible: boolean = false;
    public hasMemory: boolean = false; // Does the player remember this tile

    // Light
    public light: LightType = LightType.NO_LIGHT;

    // Movement & Sight blocking
    public isPassable: boolean = false;
    public isOpaque: boolean = false;

    // Environmental states
    /**
     * F-2a：CE pmap.exposedToFire（Time.c:1308/1317-1319）——本回合内该格
     * 已被 exposeTileToFire 尝试点燃的次数；≥12 时拒绝再暴露（每格每回合
     * 12 次封顶）。每回合火段开始时清零（Time.c:1598-1603）。
     * 不设为 getter：它就是 CE 的可变格状态，由 Promotion.runFireUpdate 独占读写。
     */
    public exposedToFire: number = 0;

    /**
     * 燃烧判据：本格跨层挂着 T_IS_FIRE 地形（CE 语义：cellHasTerrainFlag
     * (T_IS_FIRE) 的四层并集，Globals.c:581-597）。F-2a 起为纯派生 getter——
     * 火地形经 CE 的 DF 生成管线（按优先级落层的填充步 + 晋升原语）落地与
     * 衰老，不再存在"另一个事实来源"，镜像脱钩一类 bug 从结构上消失。
     *
     * 载体集合见 FIRE_TERRAIN_TYPES（本文件尾部）：c_4a 的恒等断言把
     * "该集合"与"TERRAIN_FLAGS 里带 T_IS_FIRE 旗标的地形集合"双向锁死，
     * 新火地形落地时漏改会当场翻红。
     */
    get isBurning(): boolean {
        for (const t of FIRE_TERRAIN_TYPES) {
            if (this.layers.includes(t)) return true;
        }
        return false;
    }

    // Trap metadata (for TRAP and PRESSURE_PLATE terrain)
    public trapType: 'poison_gas' | 'teleport' | 'fire' | null = null;
    // Whether a SECRET_DOOR has been discovered
    public isDiscovered: boolean = false;

    // P1-42：CE SEARCHED_FROM_HERE（Rogue.h:1090）——玩家站在本格时已做过
    // 一次低强度自动搜索；同一格不重复触发（CE Time.c:2544-2549 的
    // "only once per tile"）。CE 是 pmap flags 位、随层新建，web 是 Cell
    // 字段、随 Grid 新建，生命周期一致。仅由 Game 的自动搜索读写。
    public autoSearched: boolean = false;

    // Altar linking (if > 0, picking an item from this altar destroys all others with the same ID)
    public altarGroupId: number | null = null;

    // Machine zone tracking (0 = no machine)
    public machineNumber: number = 0;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

/**
 * The 2D Dungeon Map Grid
 */
export class Grid {
    public readonly width: number;
    public readonly height: number;
    private cells: Cell[][];

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = this.initializeGrid(width, height);
    }

    private initializeGrid(w: number, h: number): Cell[][] {
        const grid: Cell[][] = [];
        for (let x = 0; x < w; x++) {
            grid[x] = [];
            for (let y = 0; y < h; y++) {
                grid[x]![y] = new Cell(x, y);
            }
        }
        return grid;
    }

    public getCell(x: number, y: number): Cell | null {
        if (!this.isValidPos(x, y)) {
            return null;
        }
        return this.cells[x]?.[y] ?? null;
    }

    public getCellPos(pos: Pos): Cell | null {
        return this.getCell(pos.x, pos.y);
    }

    public isValidPos(x: number, y: number): boolean {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    /**
     * CE Movement.c:64 `highestPriorityLayer` 的 Grid 入口。
     * 返回层索引（不是地形）；全空时返回 DUNGEON 层（CE 的 best=0 初始化），
     * 此时该层存 NOTHING——要拿地形值请读 `cell.terrain`。
     */
    public highestPriorityLayer(x: number, y: number, skipGas: boolean = false): DungeonLayer {
        const cell = this.getCell(x, y);
        if (!cell) return DungeonLayer.DUNGEON;
        return highestPriorityLayerOf(cell.layers, skipGas);
    }

    /**
     * 层感知写入口（C-4a-0 新增，本轮生产代码零调用点，仅测试行使；
     * C-4a 起由生成器/环境系统接管）。只写该层，不动其他层，
     * 也不动 char/color/通行启发式。
     */
    public setTerrainLayer(x: number, y: number, layer: DungeonLayer, terrain: TerrainType): void {
        const cell = this.getCell(x, y);
        if (cell) {
            cell.layers[layer] = terrain;
        }
    }

    public setTerrain(x: number, y: number, terrain: TerrainType, char: string = ' ', color: number = 0xFFFFFF) {
        const cell = this.getCell(x, y);
        if (cell) {
            // 干跑测量：新写入地形的归属层之外若存有非 NOTHING 内容，逐层记一笔。
            const home = TERRAIN_HOME_LAYER[terrain];
            for (let l = 0; l < DungeonLayer.COUNT; l++) {
                if (l === home) continue;
                const old = cell.layers[l]!;
                if (old !== TerrainType.NOTHING) {
                    recordCrossLayerClear(l as DungeonLayer, old, terrain);
                }
            }
            writeTerrainHome(cell, terrain);
            cell.char = char;
            cell.color = color;
            // Basic heuristics for passability / opacity.
            // （本轮行为不变：getter 恒等于写入值；对 getter 求值是为 C-4a 预留形状）
            const effective = cell.terrain;
            cell.isPassable = (
                effective !== TerrainType.WALL &&
                effective !== TerrainType.GRANITE &&
                effective !== TerrainType.CHASM &&
                effective !== TerrainType.SECRET_DOOR
            );
            cell.isOpaque = (
                effective === TerrainType.WALL ||
                effective === TerrainType.GRANITE ||
                effective === TerrainType.DOOR ||
                effective === TerrainType.SECRET_DOOR
            );
        }
    }
}
