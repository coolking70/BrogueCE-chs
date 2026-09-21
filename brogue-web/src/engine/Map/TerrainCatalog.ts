/**
 * src/engine/Map/TerrainCatalog.ts — 地形属性表（C-4a）
 *
 * 数据全部从 CE 源码逐条抄录（BrogueCE-master/src/brogue/，只读）：
 * - `Rogue.h:1905-1921` `struct floorTileType`：字段序为
 *   displayChar, foreColor, backColor, drawPriority, chanceToIgnite,
 *   fireType, discoverType, promoteType, promoteChance, glowLight,
 *   flags, mechFlags。drawPriority 已由 C-4a-0 的 DRAW_PRIORITY 承载
 *   （Grid.ts），本表补齐其余属性。
 * - `Rogue.h:1923-1957` `enum terrainFlagCatalog`（T_*）；
 *   `Rogue.h:1959-1988` `enum terrainMechanicalFlagCatalog`（TM_*）。
 * - `Globals.c:315-…` `tileCatalog[]`：每条的行号写在表项注释里。
 *
 * C-4a 轮边界（任务书"明确不做"）：
 * - fireType / discoverType / promoteType / promoteChance / chanceToIgnite
 *   本轮**有数据、无读者**（留痕测试 c_4a_terrain_catalog.test.ts 钉死
 *   生产代码零读取点）；C-4b（DF 目录）/ C-4c（promoteTile）接入行为。
 * - DF 值本轮以 CE 目录名（字符串）存档；C-4b 建立数值 DF 枚举后应替换。
 * - promoteChance 按 CE 原始单位存档（Rogue.h:1915：百分之之一百分点/回合，
 *   即实际概率 = 值 × 1/10000；如 10000 = 100%/回合，负值 = CE 的倒计时式
 *   概率，语义见 Globals.c:317 注释）。
 * - chanceToIgnite 按 CE 原始单位存档（百分数 0-100）。
 */
import { TerrainType } from './Grid';
import { LightKind } from './LightCatalog';

/** CE `Rogue.h:97` `#define Fl(N) ((unsigned long) 1 << (N))`。 */
const Fl = (n: number): number => 1 << n;

// ── T_* 旗标（CE Rogue.h:1924-1945，逐条行号）──────────────────────────────
export const T_OBSTRUCTS_PASSABILITY       = Fl(0);  // :1924 无法穿过
export const T_OBSTRUCTS_VISION            = Fl(1);  // :1925 挡视线
export const T_OBSTRUCTS_ITEMS             = Fl(2);  // :1926 物品不可放
export const T_OBSTRUCTS_SURFACE_EFFECTS   = Fl(3);  // :1927 草/血等不可覆
export const T_OBSTRUCTS_GAS               = Fl(4);  // :1928 阻挡气体渗透
export const T_OBSTRUCTS_DIAGONAL_MOVEMENT = Fl(5);  // :1929 不可绕行对角
export const T_SPONTANEOUSLY_IGNITES       = Fl(6);  // :1930 怪物回避（自燃体）
export const T_AUTO_DESCENT                = Fl(7);  // :1931 坠层 + 2d6 伤害
export const T_LAVA_INSTA_DEATH            = Fl(8);  // :1932 非免疫即死
export const T_CAUSES_POISON               = Fl(9);  // :1933 10 点毒
export const T_IS_FLAMMABLE                = Fl(10); // :1934 可燃
export const T_IS_FIRE                     = Fl(11); // :1935 是火，点燃邻格
export const T_ENTANGLES                   = Fl(12); // :1936 缠绕（蛛网）
export const T_IS_DEEP_WATER               = Fl(13); // :1937 深水：卷走物品
export const T_CAUSES_DAMAGE               = Fl(14); // :1938 每回合伤害
export const T_CAUSES_NAUSEA               = Fl(15); // :1939 恶心
export const T_CAUSES_PARALYSIS            = Fl(16); // :1940 麻痹
export const T_CAUSES_CONFUSION            = Fl(17); // :1941 混乱
export const T_CAUSES_HEALING              = Fl(18); // :1942 每回合回 20%
export const T_IS_DF_TRAP                  = Fl(19); // :1943 踩上触发 fireType DF
export const T_CAUSES_EXPLOSIVE_DAMAGE     = Fl(20); // :1944 爆炸伤害
export const T_SACRED                      = Fl(21); // :1945 敌对怪物回避

// ── T_* 复合旗标（CE Rogue.h:1947-1956 逐字抄录）─────────────────────────
export const T_OBSTRUCTS_SCENT =
    T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION | T_AUTO_DESCENT |
    T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_SPONTANEOUSLY_IGNITES;            // :1947
export const T_PATHING_BLOCKER =
    T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT | T_IS_DF_TRAP |
    T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_IS_FIRE |
    T_SPONTANEOUSLY_IGNITES;                                                    // :1948
export const T_DIVIDES_LEVEL =
    T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT | T_IS_DF_TRAP |
    T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER;                                       // :1949
export const T_LAKE_PATHING_BLOCKER =
    T_AUTO_DESCENT | T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER |
    T_SPONTANEOUSLY_IGNITES;                                                    // :1950
export const T_WAYPOINT_BLOCKER =
    T_OBSTRUCTS_PASSABILITY | T_AUTO_DESCENT | T_IS_DF_TRAP |
    T_LAVA_INSTA_DEATH | T_IS_DEEP_WATER | T_SPONTANEOUSLY_IGNITES;             // :1951
export const T_MOVES_ITEMS = T_IS_DEEP_WATER | T_LAVA_INSTA_DEATH;              // :1952
export const T_CAN_BE_BRIDGED = T_AUTO_DESCENT;                                 // :1953
export const T_OBSTRUCTS_EVERYTHING =
    T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_VISION | T_OBSTRUCTS_ITEMS |
    T_OBSTRUCTS_GAS | T_OBSTRUCTS_SURFACE_EFFECTS |
    T_OBSTRUCTS_DIAGONAL_MOVEMENT;                                              // :1954
export const T_HARMFUL_TERRAIN =
    T_CAUSES_POISON | T_IS_FIRE | T_CAUSES_DAMAGE | T_CAUSES_PARALYSIS |
    T_CAUSES_CONFUSION | T_CAUSES_EXPLOSIVE_DAMAGE;                             // :1955
export const T_RESPIRATION_IMMUNITIES =
    T_CAUSES_DAMAGE | T_CAUSES_CONFUSION | T_CAUSES_PARALYSIS |
    T_CAUSES_NAUSEA;                                                            // :1956

// ── TM_* 机械旗标（CE Rogue.h:1960-1985，逐条行号）────────────────────────
export const TM_IS_SECRET                       = Fl(0);   // :1960
export const TM_PROMOTES_WITH_KEY               = Fl(1);   // :1961
export const TM_PROMOTES_WITHOUT_KEY            = Fl(2);   // :1962
export const TM_PROMOTES_ON_CREATURE            = Fl(3);   // :1963
export const TM_PROMOTES_ON_ITEM                = Fl(4);   // :1964
export const TM_PROMOTES_ON_ITEM_PICKUP         = Fl(5);   // :1965
export const TM_PROMOTES_ON_PLAYER_ENTRY        = Fl(6);   // :1966
export const TM_PROMOTES_ON_SACRIFICE_ENTRY     = Fl(7);   // :1967
export const TM_PROMOTES_ON_ELECTRICITY         = Fl(8);   // :1968
export const TM_ALLOWS_SUBMERGING               = Fl(9);   // :1969
export const TM_IS_WIRED                        = Fl(10);  // :1970
export const TM_IS_CIRCUIT_BREAKER              = Fl(11);  // :1971
export const TM_GAS_DISSIPATES                  = Fl(12);  // :1972
export const TM_GAS_DISSIPATES_QUICKLY          = Fl(13);  // :1973
export const TM_EXTINGUISHES_FIRE               = Fl(14);  // :1974
export const TM_VANISHES_UPON_PROMOTION         = Fl(15);  // :1975
export const TM_REFLECTS_BOLTS                  = Fl(16);  // :1976
export const TM_STAND_IN_TILE                   = Fl(17);  // :1977
export const TM_LIST_IN_SIDEBAR                 = Fl(18);  // :1978
export const TM_VISUALLY_DISTINCT               = Fl(19);  // :1979
export const TM_BRIGHT_MEMORY                   = Fl(20);  // :1980
export const TM_EXPLOSIVE_PROMOTE               = Fl(21);  // :1981
export const TM_CONNECTS_LEVEL                  = Fl(22);  // :1982
export const TM_INTERRUPT_EXPLORATION_WHEN_SEEN = Fl(23);  // :1983
export const TM_INVERT_WHEN_HIGHLIGHTED         = Fl(24);  // :1984
export const TM_SWAP_ENCHANTS_ACTIVATION        = Fl(25);  // :1985
export const TM_PROMOTES_ON_STEP =
    TM_PROMOTES_ON_CREATURE | TM_PROMOTES_ON_ITEM;                              // :1987

/** 每种地形的 CE 属性（Globals.c tileCatalog 列序见文件头）。 */
export interface TerrainFlagsEntry {
    /** CE `flags` 列（T_* 的并集）。 */
    readonly flags: number;
    /** CE `mechFlags` 列（TM_* 的并集）。 */
    readonly mechFlags: number;
    /** CE `chanceToIgnite` 列（百分数；邻居有火时点燃概率）。 */
    readonly chanceToIgnite: number;
    /** CE `fireType` 列（点燃时生成的 DF 名；0 = 无）。 */
    readonly fireType: string;
    /** CE `discoverType` 列（搜索成功/踩上显形时生成的 DF 名；0 = 无）。 */
    readonly discoverType: string;
    /** CE `promoteType` 列（晋升目标 DF 名；0 = 无）。 */
    readonly promoteType: string;
    /** CE `promoteChance` 列（×1/10000 每回合）。 */
    readonly promoteChance: number;
    /**
     * CE `glowLight` 列（C-7 补齐）：`lightCatalog` 下标（LightKind；0 = NO_LIGHT）。
     * 消费方 = LightMap 的 CE 式 updateLighting（Globals.c:208-240 逐层扫描）。
     */
    readonly glowLight: number;
    /** true = web 独有地形，CE 无同名条目（取值理由见表项注释）。 */
    readonly webOnly: boolean;
}

const e = (
    flags: number,
    mechFlags: number,
    chanceToIgnite: number,
    fireType: string,
    discoverType: string,
    promoteType: string,
    promoteChance: number,
    webOnly = false,
    glowLight: number = LightKind.NO_LIGHT
): TerrainFlagsEntry => ({ flags, mechFlags, chanceToIgnite, fireType, discoverType, promoteType, promoteChance, webOnly, glowLight });

/**
 * 地形属性表（CE Globals.c:315 `tileCatalog[]` 的 web 投影）。
 *
 * 每条的 CE 出处行号写在表项注释；CE 目录名 → web 成员名的映射沿用
 * Grid.ts DRAW_PRIORITY 的既有对照（同名直迁，异名对照见各条）。
 * 表完整性（全 TerrainType 键覆盖）由 c_4a_terrain_catalog.test.ts 在
 * 运行时钉死——esbuild 只剥类型，缺键要到运行时才暴露（undefined）。
 */
export const TERRAIN_FLAGS: Record<TerrainType, TerrainFlagsEntry> = {
    // CE NOTHING，Globals.c:321
    [TerrainType.NOTHING]: e(0, 0, 0, 'DF_PLAIN_FIRE', '', '', 0),

    // CE GRANITE，Globals.c:322：T_OBSTRUCTS_EVERYTHING（Rogue.h:1954 六旗标并集）
    [TerrainType.GRANITE]: e(
        T_OBSTRUCTS_EVERYTHING, TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE FLOOR，Globals.c:323
    [TerrainType.FLOOR]: e(0, 0, 0, 'DF_PLAIN_FIRE', '', '', 0),

    // CE WALL，Globals.c:327：T_OBSTRUCTS_EVERYTHING
    [TerrainType.WALL]: e(
        T_OBSTRUCTS_EVERYTHING, TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE DOOR，Globals.c:328。注意 CE 的门不挡通行（无 T_OBSTRUCTS_PASSABILITY，
    // 玩家走入时 TM_PROMOTES_ON_STEP 晋升为 OPEN_DOOR）；挡视线与气体。
    [TerrainType.DOOR]: e(
        T_OBSTRUCTS_VISION | T_OBSTRUCTS_GAS | T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_STEP | TM_VISUALLY_DISTINCT,
        50, 'DF_EMBERS', '', 'DF_OPEN_DOOR', 0
    ),

    // CE OPEN_DOOR，Globals.c:329
    [TerrainType.OPEN_DOOR]: e(
        T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT,
        50, 'DF_EMBERS', '', 'DF_CLOSED_DOOR', 10000
    ),

    // CE SHALLOW_WATER，Globals.c:414
    [TerrainType.WATER_SHALLOW]: e(
        0,
        TM_STAND_IN_TILE | TM_EXTINGUISHES_FIRE | TM_ALLOWS_SUBMERGING,
        0, 'DF_STEAM_ACCUMULATION', '', '', 0
    ),

    // CE DEEP_WATER，Globals.c:413。T_IS_DEEP_WATER 是"深水"的判据位。
    [TerrainType.WATER_DEEP]: e(
        T_IS_FLAMMABLE | T_IS_DEEP_WATER,
        TM_ALLOWS_SUBMERGING | TM_STAND_IN_TILE | TM_EXTINGUISHES_FIRE,
        100, 'DF_STEAM_ACCUMULATION', '', '', 0
    ),

    // CE CHASM，Globals.c:416：T_AUTO_DESCENT（坠层），不挡通行、不挡视线。
    [TerrainType.CHASM]: e(
        T_AUTO_DESCENT, TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE LAVA，Globals.c:420：T_LAVA_INSTA_DEATH，不挡通行。
    // C-7：glowLight = LAVA_LIGHT（Globals.c:432 原列）。
    [TerrainType.LAVA]: e(
        T_LAVA_INSTA_DEATH, TM_STAND_IN_TILE | TM_ALLOWS_SUBMERGING,
        0, 'DF_OBSIDIAN', '', '', 0,
        false, LightKind.LAVA_LIGHT
    ),

    // CE GRASS，Globals.c:447
    [TerrainType.GRASS]: e(
        T_IS_FLAMMABLE, TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION,
        15, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE FOLIAGE，Globals.c:472：挡视线但可走（无 T_OBSTRUCTS_PASSABILITY）。
    [TerrainType.FOLIAGE]: e(
        T_OBSTRUCTS_VISION | T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_STEP,
        15, 'DF_PLAIN_FIRE', '', 'DF_TRAMPLED_FOLIAGE', 0
    ),

    // webOnly：web BOG = 可燃沼泽。显示与语义近亲是 CE MUD（Globals.c:415，
    // CE 的 MUD 用的正是 G_BOG 字形），但 web 现行行为把 BOG 与 GRASS/FOLIAGE
    // 同列点火对象（Gas.ts:59/142），故 flags 记 T_IS_FLAMMABLE 而非照抄
    // MUD 的 0——CE 无"可燃沼泽"条目，此取值是对 web 现状的忠实记录。
    [TerrainType.BOG]: e(T_IS_FLAMMABLE, 0, 0, '', '', '', 0, true),

    // CE UP_STAIRS，Globals.c:334
    [TerrainType.STAIRS_UP]: e(
        T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_PROMOTES_ON_STEP | TM_STAND_IN_TILE | TM_LIST_IN_SIDEBAR |
        TM_VISUALLY_DISTINCT | TM_BRIGHT_MEMORY |
        TM_INTERRUPT_EXPLORATION_WHEN_SEEN | TM_INVERT_WHEN_HIGHLIGHTED,
        0, 'DF_PLAIN_FIRE', '', 'DF_REPEL_CREATURES', 0
    ),

    // CE DOWN_STAIRS，Globals.c:333（旗标与 UP_STAIRS 完全相同）
    [TerrainType.STAIRS_DOWN]: e(
        T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_PROMOTES_ON_STEP | TM_STAND_IN_TILE | TM_LIST_IN_SIDEBAR |
        TM_VISUALLY_DISTINCT | TM_BRIGHT_MEMORY |
        TM_INTERRUPT_EXPLORATION_WHEN_SEEN | TM_INVERT_WHEN_HIGHLIGHTED,
        0, 'DF_PLAIN_FIRE', '', 'DF_REPEL_CREATURES', 0
    ),

    // webOnly：web CHARRED_FLOOR = 燃烧后的地面（Game.ts:6381 火熄后写、
    // Gas.ts:128 复燃判定）。CE 无对应条目——CE 的表现是 FLOOR 地面上覆
    // ASH（Globals.c:461，SURFACE 层）；web 把它做成了 DUNGEON 层对 FLOOR
    // 的就地替换。零旗标（可走、可视、不助燃自身的复燃逻辑由 isBurning 承担）。
    [TerrainType.CHARRED_FLOOR]: e(0, 0, 0, '', '', '', 0, true),

    // webOnly：web SIGN = 告示牌（Game.ts:1824 D1 深度牌、2036 手稿行），
    // 踩上显示文字。CE 无 sign。显示近亲是 CE SACRED_GLYPH（Globals.c:479，
    // drawPriority 同取 7 的原因），但其 T_SACRED（敌对怪物回避）是圣徽的
    // 行为语义，web SIGN 不具备——故只借显示位、不抄 T_SACRED，取零旗标。
    [TerrainType.SIGN]: e(0, 0, 0, '', '', '', 0, true),

    // webOnly：web RESET_PLATE = 测试用重置踏板（Game.ts:2039 放置、6333
    // 踩上重置房间）。CE 无对应物；机制近亲是 MACHINE_PRESSURE_PLATE_USED
    // （Globals.c:403，踩后惰性板、零旗标）——RESET_PLATE 同为"踩板且无
    // DF 陷阱语义"，取零旗标。
    [TerrainType.RESET_PLATE]: e(0, 0, 0, '', '', '', 0, true),

    // CE GAS_TRAP_POISON（可见态），Globals.c:378。web TRAP 恒可见（隐藏态
    // 95 不适用），trapType（poison_gas/teleport/fire）由 Cell.trapType 承载；
    // CE 无 teleport 陷阱（web 自创，D2 决策不入生成池），取毒气陷阱为基准。
    [TerrainType.TRAP]: e(
        T_IS_DF_TRAP, TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, 'DF_POISON_GAS_CLOUD', '', '', 0
    ),

    // CE SECRET_DOOR，Globals.c:330：外观即花岗岩（T_OBSTRUCTS_EVERYTHING），
    // TM_IS_SECRET + discoverType=DF_SHOW_DOOR 由搜索显形。
    [TerrainType.SECRET_DOOR]: e(
        T_OBSTRUCTS_EVERYTHING | T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET,
        50, 'DF_EMBERS', 'DF_SHOW_DOOR', '', 0
    ),

    // CE MACHINE_PRESSURE_PLATE，Globals.c:402：踩上晋升为 USED 板并消失。
    // web PRESSURE_PLATE（Architect.ts:462 放置、Game.ts:6386 踩上触发半径
    // 3 内陷阱后变 FLOOR）与之语义对应（触发 + 用后消失）。
    [TerrainType.PRESSURE_PLATE]: e(
        T_IS_DF_TRAP,
        TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_STEP | TM_IS_WIRED |
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_MACHINE_PRESSURE_PLATE_USED', 0
    ),

    // CE LOCKED_DOOR，Globals.c:331：T_OBSTRUCTS_EVERYTHING（挡通行！web
    // 旧启发式把它当可走，属 P1-38 记录的分歧，本轮留痕不翻转）。
    [TerrainType.LOCKED_DOOR]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_WITH_KEY |
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT | TM_BRIGHT_MEMORY |
        TM_INTERRUPT_EXPLORATION_WHEN_SEEN | TM_INVERT_WHEN_HIGHLIGHTED,
        50, 'DF_EMBERS', '', 'DF_OPEN_IRON_DOOR_INERT', 0
    ),

    // CE ALTAR_INERT，Globals.c:362
    // C-7：glowLight = CANDLE_LIGHT（Globals.c:362 原列——CE 的烛光祭坛）。
    [TerrainType.ALTAR]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS, TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', '', 0,
        false, LightKind.CANDLE_LIGHT
    ),

    // CE SPIDERWEB，Globals.c:470：缠绕 + 可燃 + 可走。
    [TerrainType.WEB]: e(
        T_ENTANGLES | T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT,
        100, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE RED_BLOOD，Globals.c:453
    [TerrainType.BLOOD]: e(0, TM_STAND_IN_TILE, 0, 'DF_PLAIN_FIRE', '', '', 0),

    // CE MUD，Globals.c:415
    [TerrainType.MUD]: e(
        0, TM_STAND_IN_TILE | TM_ALLOWS_SUBMERGING,
        0, 'DF_PLAIN_FIRE', '', 'DF_METHANE_GAS_PUFF', 100
    ),

    // CE CHASM_EDGE，Globals.c:417：零旗标（可走；归属层为 LIQUID 是
    // C-4a-0 的勘察修正，见 TERRAIN_HOME_LAYER 注释）。
    [TerrainType.CHASM_EDGE]: e(0, 0, 0, 'DF_PLAIN_FIRE', '', '', 0),

    // CE OBSIDIAN，Globals.c:427：零旗标（岩浆冷却后的地面）。
    [TerrainType.OBSIDIAN]: e(0, 0, 0, 'DF_PLAIN_FIRE', '', '', 0),

    // CE BRIDGE，Globals.c:428：绳桥面，可走、可燃。
    [TerrainType.BRIDGE]: e(
        T_IS_FLAMMABLE, TM_VANISHES_UPON_PROMOTION,
        50, 'DF_BRIDGE_FIRE', '', '', 0
    ),

    // CE BRIDGE_EDGE，Globals.c:430：桥端桩点（SURFACE 层），可走、可燃。
    [TerrainType.BRIDGE_EDGE]: e(
        T_IS_FLAMMABLE, TM_VANISHES_UPON_PROMOTION,
        50, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE INERT_BRIMSTONE，Globals.c:426：T_SPONTANEOUSLY_IGNITES（自燃体，
    // 硫矿湖湖体），800 = 8%/回合晋升 ACTIVE_BRIMSTONE。
    [TerrainType.INERT_BRIMSTONE]: e(
        T_SPONTANEOUSLY_IGNITES, 0,
        0, 'DF_INERT_BRIMSTONE', '', 'DF_ACTIVE_BRIMSTONE', 800
    ),

    // CE PLAIN_FIRE，Globals.c:492（F-1 新增地形；F-2a 接通概率衰老）。
    // 全字段照抄 CE，无偏离：
    //   T_IS_FIRE；(STAND_IN_TILE|VANISHES_UPON_PROMOTION|VISUALLY_DISTINCT)；
    //   ign 0；fireType 0；promoteType DF_EMBERS；promoteChance 500（5%/回合
    //   概率衰老 → EMBERS，几何分布均值约 20 回合——CE 火的全部"寿命模型"，
    //   Time.c:1643-1645 掷骰 / :1244-1290 promoteTile）。
    // F-1 曾把 promoteChance 记 0（保 burnDuration 倒计时、不移 RNG 流），
    // F-2a 按任务书 §二.2 翻正为 500 并由 runPromotionUpdate 自然驱动。
    // C-7：glowLight = FIRE_LIGHT（Globals.c:492 原列，登记不迁移已翻转）。
    [TerrainType.PLAIN_FIRE]: e(
        T_IS_FIRE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_EMBERS', 500,
        false, LightKind.FIRE_LIGHT
    ),

    // CE EMBERS，Globals.c:469（F-2a 新增地形：PLAIN_FIRE 衰老的落点，
    // DF_EMBERS 的载体）。照抄 CE：零旗标（余烬不是火——不点燃邻格、不可燃，
    // Globals.c:469 flags 列为 (0)）；drawPriority 70（Grid.ts DRAW_PRIORITY）；
    // VANISHES_UPON_PROMOTION；fireType DF_PLAIN_FIRE（CE 数据如此，但零旗标
    // 下不可燃，永不走 fire 轴）；promoteType DF_ASH、promoteChance 300
    // （3%/回合烧成灰烬）。C-7：glowLight = EMBER_LIGHT（Globals.c:469 原列，
    // 登记不迁移已翻转）。
    [TerrainType.EMBERS]: e(
        0,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION,
        0, 'DF_PLAIN_FIRE', '', 'DF_ASH', 300,
        false, LightKind.EMBER_LIGHT
    ),

    // CE ASH，Globals.c:461（F-2a 新增地形：EMBERS 衰老的落点，DF_ASH 的
    // 载体）。照抄 CE：零旗标、TM_STAND_IN_TILE、promoteChance 0（灰烬不再
    // 衰老，CE 里永久留存直到被其他 DF 覆盖）。drawPriority 80。
    [TerrainType.ASH]: e(
        0,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // ── G-1：CE 气体 tile（Globals.c:502-508，"// gas layer" 注释块）────────
    // 三条全字段照抄 CE，无偏离。要点：
    //   - 消散档位是 tile 机械旗标（updateVolumetricMedia 每轮读一次）：
    //     POISON_GAS = TM_GAS_DISSIPATES（20%/轮 −1 体积），
    //     CONFUSION_GAS / STEAM = TM_GAS_DISSIPATES_QUICKLY（50%/轮）。
    //     这直接推翻 web 旧"定值消散"下 POISON≡CONFUSION 的恒等式。
    //   - POISON_GAS / CONFUSION_GAS 可燃（T_IS_FLAMMABLE，ign 100），
    //     fireType 全为 DF_GAS_FIRE（CE 数据如此；STEAM ign=0 不可燃但
    //     fireType 列仍登记 DF_GAS_FIRE——照抄原表）。
    //   - promoteChance 全 0：气体不自衰老，只靠体积消散/被点燃。
    //   - glowLight：CONFUSION_GAS = CONFUSION_GAS_LIGHT（Globals.c:503 原列，
    //     C-7 迁移）；POISON_GAS / STEAM 在 CE 即 NO_LIGHT。
    // CE Globals.c:502 POISON_GAS
    [TerrainType.POISON_GAS]: e(
        T_IS_FLAMMABLE | T_CAUSES_DAMAGE,
        TM_STAND_IN_TILE | TM_GAS_DISSIPATES,
        100, 'DF_GAS_FIRE', '', '', 0
    ),

    // CE Globals.c:503 CONFUSION_GAS
    // C-7：glowLight = CONFUSION_GAS_LIGHT（原列，登记不迁移已翻转）。
    [TerrainType.CONFUSION_GAS]: e(
        T_IS_FLAMMABLE | T_CAUSES_CONFUSION,
        TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY,
        100, 'DF_GAS_FIRE', '', '', 0,
        false, LightKind.CONFUSION_GAS_LIGHT
    ),

    // CE Globals.c:508 STEAM（不可燃——flags 无 T_IS_FLAMMABLE）
    [TerrainType.STEAM]: e(
        T_CAUSES_DAMAGE,
        TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY,
        0, 'DF_GAS_FIRE', '', '', 0
    ),

    // ── G-2：CE Globals.c:495 GAS_FIRE（燃气之火）与 :507 METHANE_GAS（沼气）──
    // GAS_FIRE：DF_GAS_FIRE 的载体，可燃气体被点燃时铺在 SURFACE 的火地形。
    // 全字段照抄 CE：
    //   T_IS_FIRE；(STAND_IN_TILE|VANISHES_UPON_PROMOTION|VISUALLY_DISTINCT)；
    //   ign 0（自身不可燃——火段的暴露循环是"火点燃邻格"，火的 flags 不是
    //   T_IS_FLAMMABLE，不会被自己再点燃）；fireType 0；promoteType 0（''）；
    //   promoteChance 8000（80%/回合自熄——与 PLAIN_FIRE 的 500 同一套概率
    //   衰老机制：VANISHES + promoteType=0 ⇒ promoteTile 只清层不落新 DF，
    //   CE Time.c:1254-1266 + :1271 `if (DFType)` 守卫）。"燃气烧完地上留火"
    //   的"留"就是它、"80%/回合自熄"也是它。C-7：glowLight = FIRE_LIGHT
    //   （Globals.c:495 原列，登记不迁移已翻转）。
    [TerrainType.GAS_FIRE]: e(
        T_IS_FIRE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT,
        0, '', '', '', 8000,
        false, LightKind.FIRE_LIGHT
    ),

    // METHANE_GAS：第六种气体 tile。全字段照抄 CE：
    //   T_IS_FLAMMABLE（ign 100）；TM_STAND_IN_TILE | TM_EXPLOSIVE_PROMOTE
    //   （爆轰链载体——exposeTileToFire 数 8 邻的 T_IS_FIRE|T_OBSTRUCTS_GAS
    //   |TM_EXPLOSIVE_PROMOTE，≥8 时 promoteTile 走 promoteType
    //   DF_EXPLOSION_FIRE（爆轰圈），否则走 fireType DF_GAS_FIRE（小火））；
    //   **无 TM_GAS_DISSIPATES(_QUICKLY)**——CE 沼气永不自散，只能被点燃、
    //   被类型竞争压制或逃出层外；promoteChance 0。web 载体：MUD 的
    //   promoteType DF_METHANE_GAS_PUFF（promoteChance 100，C-4a 起数据就在，
    //   G-2 起 tile 齐备、链条真实行走）。glowLight：CE 原列即 NO_LIGHT。
    [TerrainType.METHANE_GAS]: e(
        T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_EXPLOSIVE_PROMOTE,
        100, 'DF_GAS_FIRE', '', 'DF_EXPLOSION_FIRE', 0
    ),

    // ── G-3：CE Globals.c:506 PARALYSIS_GAS（麻痹气体）────────────────────
    // 全字段照抄 CE：T_IS_FLAMMABLE | T_CAUSES_PARALYSIS（麻痹效果判定在
    // Game.applyEnvironmentalEffects，Time.c:471-497——站进即上
    // STATUS_PARALYZED、无阈值、每回合 max(…,20) 刷新）；
    // TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY（50%/轮 −1，QUICK 档）；
    // ign 100、fireType DF_GAS_FIRE（与其他可燃气体同链：被点燃 → 燃气之火）。
    // promoteChance 0。web 载体：potion_of_paralysis 改线（Game 药水分支
    // → addGas 1000 = DF_PARALYSIS_GAS_CLOUD_POTION 的 startProbability，
    // Globals.c:778；喝 Items.c:8117-8120 / 扔 Items.c:6994-6997）。
    // glowLight：CE 原列即 NO_LIGHT。
    [TerrainType.PARALYSIS_GAS]: e(
        T_IS_FLAMMABLE | T_CAUSES_PARALYSIS,
        TM_STAND_IN_TILE | TM_GAS_DISSIPATES_QUICKLY,
        100, 'DF_GAS_FIRE', '', '', 0
    ),

    // ── F-2c：CE Globals.c:496 GAS_EXPLOSION（爆炸之火）────────────────────
    // 全字段照抄 CE，无偏离：
    //   T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE（Rogue.h:1944：瞬时
    //   max(15-20, maxHP/2)、同生物五回合免疫——结算在 Game 的
    //   resolveExplosionDamage，Time.c:343-353 applyInstantTileEffectsToCreature
    //   爆炸段）；(STAND_IN_TILE | VANISHES_UPON_PROMOTION | VISUALLY_DISTINCT)；
    //   ign 0；fireType 0；promoteType 0（''）；promoteChance 10000（=100%/回合
    //   必定晋升 + VANISHES + promoteType 0 ⇒ 瞬时地形：落地的下一个晋升趟即
    //   清层消失，Time.c:1254-1271 的通用机制）。C-7：glowLight =
    //   EXPLOSION_LIGHT（Globals.c:496 原列，登记不迁移已翻转）。
    //   载体：DF_EXPLOSION_FIRE（甲烷爆轰圈，Globals.c:742）与
    //   DF_BLOAT_EXPLOSION（bloat 自爆，Globals.c:654）。
    [TerrainType.GAS_EXPLOSION]: e(
        T_IS_FIRE | T_CAUSES_EXPLOSIVE_DAMAGE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT,
        0, '', '', '', 10000,
        false, LightKind.EXPLOSION_LIGHT
    ),

    // ── C-5：CE Globals.c:442 HOLE（洞，"// surface layer" 注释块）─────────
    // 全字段照抄 CE：T_AUTO_DESCENT（坠层判据位，与 CHASM 同族——消费点
    // Time.c:110 monsterShouldFall / Time.c:168 applyInstantTileEffects）；
    // TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION；ign 0；fireType
    // DF_PLAIN_FIRE；promoteType DF_HOLE_DRAIN（:757 {HOLE_EDGE, SURFACE,
    // 0, 0}）+ promoteChance -1000（负值 = CE 的"暴露越多合得越快"：
    // Promotion.ts 首趟对每个 4 向开敞邻居 +1000，Time.c:1627-1642）——
    // 药水/pit bloat 炸出的洞约十回合内自行合拢。glowLight：CE 原列即
    // NO_LIGHT（发光洞是挖地杖链的 HOLE_GLOW，web 无此 tile——C-7 登记）。
    // drawPriority 9 / 归属层 SURFACE 见 Grid.ts。
    [TerrainType.HOLE]: e(
        T_AUTO_DESCENT,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION,
        0, 'DF_PLAIN_FIRE', '', 'DF_HOLE_DRAIN', -1000
    ),

    // CE Globals.c:444 HOLE_EDGE（洞口的半透明地面）。零旗标（可走）；
    // TM_VANISHES_UPON_PROMOTION；promoteChance -500（同上负值机制）。
    // 载体 = DF_HOLE_POTION（:782，start 300/decr 100 的铺展波）。
    [TerrainType.HOLE_EDGE]: e(
        0,
        TM_VANISHES_UPON_PROMOTION,
        0, 'DF_PLAIN_FIRE', '', '', -500
    ),

    // ── B-3：水晶/圣徽 tile（Globals.c:477-479 与 :338）────────────────────

    // CE FORCEFIELD，Globals.c:477：SCROLL_SHATTERING 的 crystalize 打碎的墙
    // 先变它（Items.c:4916 直写 DUNGEON 层）。promoteChance -200 = 负值扩散型
    // （Promotion.ts 第一趟：每个合格 4 向开敞邻居 +200/回合 → 晋升掷骰 →
    // DF_FORCEFIELD_MELT），"绿水晶肉眼可见地消融"。DF 目录 :674
    // {FORCEFIELD, SURFACE, 100, 50} 是机器侧写入口（web 未接）。
    // glowLight = FORCEFIELD_LIGHT（:477 原列）。
    [TerrainType.FORCEFIELD]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_GAS | T_OBSTRUCTS_DIAGONAL_MOVEMENT,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_CREATURE,
        0, '', '', 'DF_FORCEFIELD_MELT', -200,
        false, LightKind.FORCEFIELD_LIGHT
    ),

    // CE FORCEFIELD_MELT，Globals.c:478：消融中的水晶。同旗标同光照；
    // promoteChance -10000——邻居开敞即高概率晋升，且 promoteType 0（''）
    // + VANISHES ⇒ promoteTile 只清层消失（CE Time.c:1254-1271 通用机制）。
    [TerrainType.FORCEFIELD_MELT]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_GAS | T_OBSTRUCTS_DIAGONAL_MOVEMENT,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_CREATURE,
        0, '', '', '', -10000,
        false, LightKind.FORCEFIELD_LIGHT
    ),

    // CE CRYSTAL_WALL，Globals.c:338："边界墙化晶"（crystalize 的边界覆写，
    // Items.c:4928-4929）与 DF_CRYSTAL_WALL（Globals.c:607，C-6 自动生成器
    // 待激活缺口的载体 tile）。带 T_OBSTRUCTS_ITEMS/SURFACE_EFFECTS/
    // DIAGONAL_MOVEMENT 但**不挡视线**（无 T_OBSTRUCTS_VISION——水晶墙后
    // 的东西看得见）；TM_REFLECTS_BOLTS 反弹法杖 bolt；fireType
    // DF_PLAIN_FIRE（可被点燃轴烧毁，CE 数据如此）。glowLight =
    // CRYSTAL_WALL_LIGHT（:338 原列）。
    [TerrainType.CRYSTAL_WALL]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
        T_OBSTRUCTS_SURFACE_EFFECTS | T_OBSTRUCTS_DIAGONAL_MOVEMENT,
        TM_STAND_IN_TILE | TM_REFLECTS_BOLTS,
        0, 'DF_PLAIN_FIRE', '', '', 0,
        false, LightKind.CRYSTAL_WALL_LIGHT
    ),

    // CE SACRED_GLYPH，Globals.c:479：SCROLL_SANCTUARY 的 DF_SACRED_GLYPHS
    // （Globals.c:676，SURFACE 层 100/100 十字波前）落在地上的圣徽。
    // T_SACRED（敌对怪物回避）的 web 唯一载体——消费点 =
    // SafetyMap.isSacred（B-3 起：谓词从恒 false 激活为真读位）。
    // drawPriority 7（web 的 SIGN 当年借的显示位就是它）；glowLight =
    // SACRED_GLYPH_LIGHT（:479 原列）。
    [TerrainType.SACRED_GLYPH]: e(
        T_SACRED, 0,
        0, '', '', '', 0,
        false, LightKind.SACRED_GLYPH_LIGHT
    ),

    // ── V-2b-2b：机器蓝图地形载体（GlobalsBrogue.c 目录序 3/4/5/19/20/23）────

    // CE CARPET，Globals.c:325：宝库铺装（3/4/5 号的 MF_EVERYWHERE 底衬）。
    // 全字段照抄：T_IS_FLAMMABLE（可燃——火会烧掉地毯，DF_EMBERS 收尾）；
    // TM_VANISHES_UPON_PROMOTION；ign 0；fireType DF_EMBERS；零晋升。
    // drawPriority 85 / 归属层 DUNGEON 见 Grid.ts（DF 目录 :709 同证）。
    [TerrainType.CARPET]: e(
        T_IS_FLAMMABLE,
        TM_VANISHES_UPON_PROMOTION,
        0, 'DF_EMBERS', '', '', 0
    ),

    // CE STATUE_INERT，Globals.c:351：惰性大理石雕像（3/4/5 号经
    // MF_BUILD_IN_WALLS 落进机器外圈墙格）。T_OBSTRUCTS_EVERYTHING 去掉
    // VISION/DIAGONAL 两位的四旗标取值照抄（雕像挡路/挡物品/挡气/挡表面
    // 效果，但不挡视线与对角绕行）；TM_STAND_IN_TILE；fireType
    // DF_PLAIN_FIRE（CE 数据如此，零可燃性下不触发）。
    [TerrainType.STATUE_INERT]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE PEDESTAL，Globals.c:369：石基座（4/5 号基座大奖的落点）。
    // 只挡表面效果（物品可以放在上面——CE 的 MF_GENERATE_ITEM feature
    // 正是落 pedestal 后把物品放同格）；glowLight = CANDLE_LIGHT（:369
    // 原列，与 ALTAR_INERT 同一烛光）。
    [TerrainType.PEDESTAL]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS, 0,
        0, '', '', '', 0,
        false, LightKind.CANDLE_LIGHT
    ),

    // CE STATUE_INERT_DOORWAY，Globals.c:550：门内碎裂雕像（20 号的堵门体，
    // 由 SCROLL_SHATTERING 的 crystalize 打碎——该链归 2b-7 接线）。旗标与
    // STATUE_INERT 相同，机械旗标多 TM_CONNECTS_LEVEL（堵门体语义：破碎后
    // 该格回到"连通层"状态）。
    [TerrainType.STATUE_INERT_DOORWAY]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE | TM_CONNECTS_LEVEL,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE WOODEN_BARRICADE，Globals.c:341：干木栅（19 号的堵门体）。可燃
    // （ign 100、fireType DF_WOODEN_BARRICADE_BURN——焚化药水/火系把它烧成
    // 灰烬开路，烧栅链归 2b-7）；挡通行/挡物品；TM_CONNECTS_LEVEL 同上。
    [TerrainType.WOODEN_BARRICADE]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_VISUALLY_DISTINCT |
        TM_CONNECTS_LEVEL,
        100, 'DF_WOODEN_BARRICADE_BURN', '', '', 0
    ),

    // CE TRAP_DOOR_HIDDEN，Globals.c:379：隐藏陷阱门（23 号的 60 连片陷阱）。
    // T_AUTO_DESCENT（踩上坠层——消费点 Game 的 monsterShouldFall/坠落结算，
    // 与 CHASM/HOLE 同族判据）；TM_IS_SECRET（隐藏位：外观 = G_FLOOR，
    // drawPriority 95 与 FLOOR 同档，搜索/魔法测绘显形前不可见）；
    // fireType DF_POISON_GAS_CLOUD、discoverType DF_SHOW_TRAPDOOR 均照抄
    // （显形链归 2b-7 接线——web 的 discover 现只处理 SECRET_DOOR，缺口已登记）。
    [TerrainType.TRAP_DOOR_HIDDEN]: e(
        T_AUTO_DESCENT,
        TM_IS_SECRET,
        0, 'DF_POISON_GAS_CLOUD', 'DF_SHOW_TRAPDOOR', '', 0
    ),

    // ── V-2b-3：wired 触发网络的九个地形载体（Globals.c 目录序无关，按蓝
    //    图依赖分组；字段全部逐列照抄 CE，无偏离）────────────────────────

    // CE MACHINE_GLYPH，Globals.c:404：机器符文（24/25 号障碍机器的触发器，
    // TM_PROMOTES_ON_PLAYER_ENTRY——玩家踏入晋升 DF_INACTIVE_GLYPH，随即走
    // wired 分支通电）。零 flags；fireType 0；glowLight CE 原列 GLYPH_LIGHT_DIM
    // ——光照目录不在本轮授权清单，登记不迁移（C-7 行同款处置）。
    [TerrainType.MACHINE_GLYPH]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_PLAYER_ENTRY |
        TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_INACTIVE_GLYPH', 0
    ),

    // CE PORTCULLIS_CLOSED，Globals.c:339：落下的铁闸（18/22 号的闸门堵门体，
    // wired 通电后晋升 DF_OPEN_PORTCULLIS → PORTCULLIS_DORMANT（闸门升起，
    // tile web 无——DF 条目已登记）。挡通行/挡物品，不挡视线（铁栏杆）。
    [TerrainType.PORTCULLIS_CLOSED]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT | TM_CONNECTS_LEVEL,
        0, 'DF_PLAIN_FIRE', '', 'DF_OPEN_PORTCULLIS', 0
    ),

    // CE WORM_TUNNEL_OUTER_WALL，Globals.c:570：蠕虫隧道外墙（18/22 号的
    // "爆炸墙"堵门体，wired 通电后晋升 DF_WALL_SHATTER → RUBBLE 波前）。
    // 全 flags = T_OBSTRUCTS_EVERYTHING（六位并集，Rogue.h:1954）。
    [TerrainType.WORM_TUNNEL_OUTER_WALL]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
        TM_CONNECTS_LEVEL,
        0, 'DF_PLAIN_FIRE', '', 'DF_WALL_SHATTER', 0
    ),

    // CE WALL_LEVER_HIDDEN，Globals.c:347：隐藏墙杆（18 号）。**本 tile 不带
    // TM_IS_WIRED——CE 原样**（显形 DF_REVEAL_LEVER → WALL_LEVER 才带线 +
    // TM_PROMOTES_ON_PLAYER_ENTRY，:348；web 无 WALL_LEVER tile，故 18 号的
    // 拉杆激活链本轮结构性不可达，登记"激活轮需重核"）。G_WALL 伪装。
    [TerrainType.WALL_LEVER_HIDDEN]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET,
        0, 'DF_PLAIN_FIRE', 'DF_REVEAL_LEVER', '', 0
    ),

    // CE GAS_TRAP_PARALYSIS，Globals.c:382：麻痹触发板（已揭示态，67 号）。
    // T_IS_DF_TRAP 但 fireType 0——踩上的气体由 wired 网络经喷口 DF 提供，
    // 板本身只通电（CE Time.c:253-267 的 T_IS_DF_TRAP 分支对 fireType=0 走
    // 目录 {0} 空条目后照样 promoteTile → wired 分支）。
    [TerrainType.GAS_TRAP_PARALYSIS]: e(
        T_IS_DF_TRAP,
        TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', '', 0
    ),

    // CE GAS_TRAP_PARALYSIS_HIDDEN，Globals.c:381：麻痹触发板（隐藏态，68 号）。
    // TM_IS_SECRET（G_FLOOR 伪装，prio 95）+ TM_IS_WIRED；discoverType
    // DF_SHOW_PARALYSIS_GAS_TRAP（搜索显形链，web 的 discover 现只处理
    // SECRET_DOOR——缺口登记同 TRAP_DOOR_HIDDEN 行）。
    [TerrainType.GAS_TRAP_PARALYSIS_HIDDEN]: e(
        T_IS_DF_TRAP,
        TM_IS_SECRET | TM_IS_WIRED,
        0, '', 'DF_SHOW_PARALYSIS_GAS_TRAP', '', 0
    ),

    // CE MACHINE_PARALYSIS_VENT_HIDDEN，Globals.c:383：麻痹喷口（隐藏态，
    // 67/68 号）。wired 通电时 promoteTile 走 promoteType DF_PARALYSIS_VENT_
    // SPEW（PARALYSIS_GAS 气云波前，tile G-3 已迁——链条真实行走）。
    [TerrainType.MACHINE_PARALYSIS_VENT_HIDDEN]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', 'DF_DISCOVER_PARALYSIS_VENT', 'DF_PARALYSIS_VENT_SPEW', 0
    ),

    // CE MACHINE_METHANE_VENT_HIDDEN，Globals.c:398：甲烷喷口（隐藏态，
    // 41 号载体——蓝图因 ALTAR_SWITCH 推迟 V-2b-4，tile 先行留形）。
    // promoteType DF_METHANE_VENT_OPEN（链尾 DF_VENT_SPEW_METHANE 的
    // METHANE_GAS 气云 tile G-2 已迁）。
    [TerrainType.MACHINE_METHANE_VENT_HIDDEN]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', 'DF_SHOW_METHANE_VENT', 'DF_METHANE_VENT_OPEN', 0
    ),

    // CE PILOT_LIGHT_DORMANT，Globals.c:342：休眠点火嘴（41 号载体，同上
    // 留形）。墙装火把（T_OBSTRUCTS_EVERYTHING）；wired 通电时晋升
    // DF_PILOT_LIGHT → PILOT_LIGHT（火把落地点燃可燃物——tile web 无，登记）。
    // glowLight CE 原列 TORCH_LIGHT，光照目录不在本轮授权清单，登记不迁移。
    [TerrainType.PILOT_LIGHT_DORMANT]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_PILOT_LIGHT', 0
    ),

    // ══ V-2b-4：祭坛族轮——CE 七条蓝图（1/2/6/7/15/26/28 号）的七个地形载体 ══
    // 逐字段照抄 CE Globals.c tileCatalog 对应行（行号写在每条注释里）。

    // CE ALTAR_CAGE_OPEN，Globals.c:364：开底铁笼祭坛（1/2/26 号）。
    // 取物后晋升 DF_ITEM_CAGE_CLOSE（笼子降下盖住祭坛）——晋升行为归专门轮，
    // 本轮只落数据。TM_PROMOTES_WITHOUT_KEY（无需钥匙，直接取物触发）。
    [TerrainType.ALTAR_CAGE_OPEN]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_WITHOUT_KEY |
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_ITEM_CAGE_CLOSE', 0,
        false, LightKind.CANDLE_LIGHT
    ),

    // CE ALTAR_CAGE_RETRACTABLE，Globals.c:368：可收铁笼（28 号）。
    // 挡通行（G_CLOSED_CAGE）——踏板被掷中后晋升 DF_CAGE_DISAPPEARS（笼子升起）。
    [TerrainType.ALTAR_CAGE_RETRACTABLE]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_CAGE_DISAPPEARS', 0,
        false, LightKind.CANDLE_LIGHT
    ),

    // CE COMMUTATION_ALTAR，Globals.c:532：置换祭坛（6 号，两个一组）。
    // TM_SWAP_ENCHANTS_ACTIVATION 是本 tile 独有的"互换附魔"激活位。
    // fireType/discoverType 在 CE 原行都是 0（本条不是火源、无显形链）。
    [TerrainType.COMMUTATION_ALTAR]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_SWAP_ENCHANTS_ACTIVATION |
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_ALTAR_COMMUTE', 0
    ),

    // CE RESURRECTION_ALTAR，Globals.c:538：复活祭坛（7 号）。
    // 晋升 DF_ALTAR_RESURRECT（DFF_RESURRECT_ALLY 的载体——召唤亡故盟友）。
    [TerrainType.RESURRECTION_ALTAR]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_ALTAR_RESURRECT', 0,
        false, LightKind.CANDLE_LIGHT
    ),

    // CE AMULET_SWITCH，Globals.c:529：护符触发板（15 号 Statuary 的护符落点）。
    // G_FLOOR 伪装（prio 95，"the ground"）——玩家看见的就是地面；
    // 护符被拾取时 TM_PROMOTES_ON_ITEM_PICKUP 触发（web 由 promoteTile 承接）。
    [TerrainType.AMULET_SWITCH]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_ITEM_PICKUP,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE STATUE_INSTACRACK，Globals.c:354：即刻开裂雕像（15 号，护符房）——
    // 与 STATUE_CRACKING（:353）同 promoteType DF_STATUE_SHATTER，但没有
    // 3500 的过渡 promoteChance：它是"一搜即碎"的形态（promoteChance 0）。
    // 旗标与 STATUE_INERT 同四旗标 + TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED。
    //
    // ★ V-2b-5 更正 ★：本条目原先把 DF_STATUE_SHATTER 记在 **discoverType**、
    // 把 promoteType 留空——**位置抄反了**。CE 行 `… 0, 0, DF_PLAIN_FIRE,0,
    // DF_STATUE_SHATTER, 0, NO_LIGHT …` 按 `floorTileType`（Rogue.h:1905-1921）
    // 的字段序 `… ign% fireType discoverType promoteType promoteChance glowLight`
    // 逐位对齐后是 fireType=DF_PLAIN_FIRE、**discoverType=0、
    // promoteType=DF_STATUE_SHATTER**。影响是实质的：web 唯一的晋升驱动
    // （Promotion.promoteTile）取 promoteType，抄成 discoverType 后整条
    // "护符被取走 → 全机通电 → 雕像震裂 → 唤醒 Warden of Yendor"在这条 tile 上
    // 断掉。discoverType 反过来写成了非零值——而 CE 该列是 0
    //（web 的搜索只处理 SECRET_DOOR，该列在 web 无生产读者，故此前未暴露）。
    [TerrainType.STATUE_INSTACRACK]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_STATUE_SHATTER', 0
    ),

    // CE TORCH_WALL，Globals.c:337：墙装火把（15 号，MF_BUILD_IN_WALLS 进墙）。
    // 与 PILOT_LIGHT_DORMANT 的区别：TORCH_WALL 是常亮装饰（无 TM_IS_WIRED、
    // 无晋升链），glowLight = TORCH_LIGHT 真实发光。
    [TerrainType.TORCH_WALL]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0,
        false, LightKind.TORCH_LIGHT
    ),

    // ══ V-2b-5：休眠唤醒轮的七个载体地形 ═══════════════════════════════════
    // 逐字段照抄 CE Globals.c tileCatalog 对应行（行号写在每条注释里）。
    // 七条的共性：都是 wired 网络的一环（带 TM_IS_WIRED），晋升时才唤醒
    // 藏在自己格里的休眠怪（promoteType 链最终落到带
    // DFF_ACTIVATE_DORMANT_MONSTER 的 DF 上）。

    // CE ALTAR_SWITCH，Globals.c:366：祭坛触发板（29/43/50/56 号）——
    // 钥匙放在祭坛上，玩家取走即 TM_PROMOTES_ON_ITEM_PICKUP 触发。
    // promoteType DF_ALTAR_INERT（惰性祭坛）本身不唤醒怪，唤醒靠同一次
    // 晋升带出的 wired 全机通电（CE Time.c:1271-1286）。
    // glowLight = CANDLE_LIGHT（"a weathered stone altar is adorned with
    // candles"）。注意 CE 该行的 fireType/discoverType 两列**都是 0**
    // （`… 17, 0, 0,0,DF_ALTAR_INERT, 0, CANDLE_LIGHT …`）——它既不点燃
    // 也不可搜索显形。
    [TerrainType.ALTAR_SWITCH]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_ITEM_PICKUP |
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_ALTAR_INERT', 0,
        false, LightKind.CANDLE_LIGHT
    ),

    // CE MACHINE_TRIGGER_FLOOR，Globals.c:361：机器触发地板（21/69/70 号）。
    // G_FLOOR 伪装（prio 95，"the ground"）+ TM_PROMOTES_ON_PLAYER_ENTRY：
    // 玩家踏入即晋升（promoteType 0 → 只提供 wired 通电由头，不落任何 DF）。
    // fireType = DF_PLAIN_FIRE（CE 原值），但它不是火源（ign 0、无 T_IS_FIRE）。
    [TerrainType.MACHINE_TRIGGER_FLOOR]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_PLAYER_ENTRY,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE STATUE_DORMANT，Globals.c:352：休眠雕像（43/69 号）——"一尊无害的
    // 大理石像"，通电后晋升 DF_CRACKING_STATUE（雕像开始出现裂纹）。
    // 与 STATUE_INERT（:351）的差别：多 VANISHES_UPON_PROMOTION | IS_WIRED
    // 且带 promoteType。discoverType 为 0（CE 原行 `… DF_PLAIN_FIRE,0,
    // DF_CRACKING_STATUE, 0 …`——注意它与 STATUE_INSTACRACK 同形，
    // 那位在 V-2b-5 已按同一字段序更正）。
    [TerrainType.STATUE_DORMANT]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_CRACKING_STATUE', 0
    ),

    // CE STATUE_DORMANT_DOORWAY，Globals.c:551：门内休眠雕像（21 号，
    // "Statue in the doorway — bursts to reveal monster"）。
    // 与 STATUE_DORMANT 逐字段一致，**只多 TM_CONNECTS_LEVEL**
    // （它是前厅机器的门位体，CE 用来标注"本格连通层"）。
    [TerrainType.STATUE_DORMANT_DOORWAY]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
        TM_CONNECTS_LEVEL,
        0, 'DF_PLAIN_FIRE', '', 'DF_CRACKING_STATUE', 0
    ),

    // CE WALL_MONSTER_DORMANT，Globals.c:357：藏怪墙（50/70 号）——
    // G_WALL 伪装，通电后晋升 DF_WALL_SHATTER（"the nearby wall explodes in
    // a shower of stone fragments!"，碎石波前逐格唤醒蠕虫）。
    // 该 promoteType 的 DF 条目 V-2b-3 已在目录（18/22 号爆炸墙共用同一条）。
    [TerrainType.WALL_MONSTER_DORMANT]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_WALL_SHATTER', 0
    ),

    // CE RAT_TRAP_WALL_DORMANT，Globals.c:559：鼠陷阱墙（29 号）——G_WALL 伪装，
    // 通电后晋升 DF_WALL_CRACK（"a scratching sound emanates from the nearby
    // walls!"，链尾 DF_RUBBLE）。与 WALL_MONSTER_DORMANT 只差 promoteType。
    [TerrainType.RAT_TRAP_WALL_DORMANT]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_WALL_CRACK', 0
    ),

    // CE TURRET_DORMANT，Globals.c:356：休眠炮塔（56 号 Gauntlet）——
    // G_WALL 伪装，通电后晋升 DF_TURRET_EMERGE（"you hear a click, and the
    // stones in the wall shift to reveal turrets!"）。与 WALL_MONSTER_DORMANT
    // 只差 promoteType。**本条是七条里唯一链上全环节 tile 都在 web 有载体的**
    // （DF_TURRET_EMERGE 的 tile = WALL），但它的链尾 DF_RUBBLE 仍缺 RUBBLE
    // 地形，故 web 的整链预检仍会缓办——见报告 §3 的缺口登记。
    [TerrainType.TURRET_DORMANT]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_TURRET_EMERGE', 0
    ),

    // ── V-2b-6：钥匙轮的五个载体（10/35/40 号蓝图）。逐字段抄自 CE
    //    Globals.c 的 tileCatalog 行（行号即注释）。

    // CE MONSTER_CAGE_OPEN，Globals.c:370：开盖铁笼——零旗标、可走进
    //（笼门已开）。DF_MONSTER_CAGE_OPENS（:927）的落点 tile。
    [TerrainType.MONSTER_CAGE_OPEN]: e(
        0,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE MONSTER_CAGE_CLOSED，Globals.c:371：锁闭铁笼——挡通行/表面效果/
    // 气体；TM_PROMOTES_WITH_KEY 是钥匙认锁的第二个消费者（10 号 Kennel：
    // cage key 经 MF_SKELETON_KEY 拿到机器号绑定，钥匙经 machineNumber
    // 匹配开笼）。promoteType DF_MONSTER_CAGE_OPENS。
    [TerrainType.MONSTER_CAGE_CLOSED]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS | T_OBSTRUCTS_GAS,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_WITH_KEY |
        TM_LIST_IN_SIDEBAR | TM_INTERRUPT_EXPLORATION_WHEN_SEEN,
        0, 'DF_PLAIN_FIRE', '', 'DF_MONSTER_CAGE_OPENS', 0
    ),

    // CE MACHINE_POISON_GAS_VENT_HIDDEN，Globals.c:395：隐藏毒气喷口（40 号
    // Poison gas）——G_FLOOR 伪装、TM_IS_SECRET|TM_IS_WIRED；discoverType
    // DF_SHOW_POISON_GAS_VENT、promoteType DF_POISON_GAS_VENT_OPEN。
    [TerrainType.MACHINE_POISON_GAS_VENT_HIDDEN]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_SECRET | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', 'DF_SHOW_POISON_GAS_VENT', 'DF_POISON_GAS_VENT_OPEN', 0
    ),

    // CE PORTCULLIS_DORMANT，Globals.c:340：休眠铁闸（40 号）——G_FLOOR
    // 伪装（"the ground"），零 flags + TM_VANISHES_UPON_PROMOTION|TM_IS_WIRED；
    // promoteType DF_ACTIVATE_PORTCULLIS（机器通电时闸门落下）。
    [TerrainType.PORTCULLIS_DORMANT]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_ACTIVATE_PORTCULLIS', 0
    ),

    // CE WALL_LEVER_HIDDEN_DORMANT，Globals.c:350：休眠墙杆（40 号）——
    // G_WALL 伪装（T_OBSTRUCTS_EVERYTHING 墙档），TM_STAND_IN_TILE|TM_IS_WIRED；
    // promoteType DF_CREATE_LEVER（机器通电时显形为可拉墙杆）。
    [TerrainType.WALL_LEVER_HIDDEN_DORMANT]: e(
        T_OBSTRUCTS_EVERYTHING,
        TM_STAND_IN_TILE | TM_IS_WIRED,
        0, 'DF_PLAIN_FIRE', '', 'DF_CREATE_LEVER', 0
    ),

    // CE BONES，Globals.c:464：骨头堆（10 号 Kennel 的 DF_BONES 载体）——
    // 零 flags 纯装饰、TM_STAND_IN_TILE，G_BONES ',' + bonesForeColor
    // {80,80,30} ×2.55 ≈ 0xcccc4d。
    [TerrainType.BONES]: e(
        0,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // ── V-2b-7：DF 特征系统轮的 19 条地形载体（13 条 CE 蓝图的地形列 +
    //    其 DF 链落点 tile）。七字段逐字抄 CE Globals.c tileCatalog，
    //    glowLight 用 LightKind 下标，行号写在每条上方。
    //    后 7 条（DEAD_GRASS/VOMIT/LUMINESCENT_FUNGUS/DEAD_FOLIAGE/RUBBLE/
    //    GRAY_FUNGUS/WORM_TUNNEL_MARKER_DORMANT）由 DF 目录新条目的 tile 列
    //    强制——DF 落点必须有 tile 载体。

    // CE COFFIN_CLOSED，Globals.c:372：11 号 Vampire lair 的棺木。可燃
    //（T_IS_FLAMMABLE，ign 20），fireType DF_COFFIN_BURNS、promoteType
    // DF_COFFIN_BURSTS（两者本轮入目录，见 DungeonFeatureCatalog）。
    [TerrainType.COFFIN_CLOSED]: e(
        T_IS_FLAMMABLE,
        TM_IS_WIRED | TM_VANISHES_UPON_PROMOTION | TM_LIST_IN_SIDEBAR,
        20, 'DF_COFFIN_BURNS', '', 'DF_COFFIN_BURSTS', 0
    ),

    // CE ALTAR_KEYHOLE，Globals.c:363：12 号 Legendary ally 的带孔祭坛。
    // TM_PROMOTES_WITH_KEY 是 web 的第三个"钥匙认锁"消费者（除锁门/铁笼外）。
    [TerrainType.ALTAR_KEYHOLE]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_PROMOTES_WITH_KEY | TM_IS_WIRED | TM_LIST_IN_SIDEBAR,
        0, '', '', '', 0, false, LightKind.CANDLE_LIGHT
    ),

    // CE ALTAR_SWITCH_RETRACTING，Globals.c:367：42 号的可收祭坛（取物即
    // 收回 DF_ALTAR_RETRACT）。
    [TerrainType.ALTAR_SWITCH_RETRACTING]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_ITEM_PICKUP |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_ALTAR_RETRACT', 0, false, LightKind.CANDLE_LIGHT
    ),

    // CE BRAZIER，Globals.c:573：53 号 Zombie crypt 的火盆——T_IS_FIRE 的
    // 堵格体（不可走、不可放物）。
    [TerrainType.BRAZIER]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_IS_FIRE,
        TM_STAND_IN_TILE | TM_LIST_IN_SIDEBAR,
        0, 'DF_PLAIN_FIRE', '', '', 0, false, LightKind.BURNING_CREATURE_LIGHT
    ),

    // CE DEMONIC_STATUE，Globals.c:547：47 号献祭房的恶魔雕像（墙族堵格体）。
    [TerrainType.DEMONIC_STATUE]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS | T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0, false, LightKind.DEMONIC_STATUE_LIGHT
    ),

    // CE FLAMETHROWER_HIDDEN，Globals.c:387：30 号 Fun with fire 的隐藏喷火口
    //（G_FLOOR 伪装 + TM_IS_SECRET，discoverType DF_SHOW_FLAMETHROWER_TRAP）。
    [TerrainType.FLAMETHROWER_HIDDEN]: e(
        T_IS_DF_TRAP,
        TM_IS_SECRET,
        0, 'DF_FLAMETHROWER', 'DF_SHOW_FLAMETHROWER_TRAP', '', 0
    ),

    // CE GAS_TRAP_POISON_HIDDEN，Globals.c:377：30 号的可疑毒气板
    //（与 V-2b-3 的 GAS_TRAP_PARALYSIS_HIDDEN 同构，只是气体种类不同）。
    [TerrainType.GAS_TRAP_POISON_HIDDEN]: e(
        T_IS_DF_TRAP,
        TM_IS_SECRET,
        0, 'DF_POISON_GAS_CLOUD', 'DF_SHOW_POISON_GAS_TRAP', '', 0
    ),

    // CE MANACLE_L / MANACLE_T，Globals.c:486 / :484：9 号 two allies chained
    // up 的墙链镣铐。CE 两行 flags/mechFlags 全 0（纯装饰），drawPriority 20。
    [TerrainType.MANACLE_L]: e(
        0, 0, 0, '', '', '', 0
    ),
    [TerrainType.MANACLE_T]: e(
        0, 0, 0, '', '', '', 0
    ),

    // CE PORTAL，Globals.c:355：12 号的石门（TM_IS_WIRED，
    // promoteType DF_PORTAL_ACTIVATE）。
    [TerrainType.PORTAL]: e(
        T_OBSTRUCTS_ITEMS,
        TM_STAND_IN_TILE | TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, 'DF_PLAIN_FIRE', '', 'DF_PORTAL_ACTIVATE', 0
    ),

    // CE SACRIFICE_ALTAR_DORMANT / SACRIFICE_CAGE_DORMANT，Globals.c:543 / :546：
    // 47 号献祭链的两条休眠体。**激活机制缺失**：CE 用
    // TM_PROMOTES_ON_SACRIFICE_ENTRY（Rogue.h:1967）连 MB_MARKED_FOR_SACRIFICE，
    // web 无该机制（V-2b-5 已登记，本轮仍不实现，见报告 §3）。数据照抄留形。
    [TerrainType.SACRIFICE_ALTAR_DORMANT]: e(
        T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_SACRIFICE_ALTAR', 0, false, LightKind.CANDLE_LIGHT
    ),
    [TerrainType.SACRIFICE_CAGE_DORMANT]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_SURFACE_EFFECTS,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED |
            TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        0, '', '', 'DF_SACRIFICE_CAGE_ACTIVE', 0, false, LightKind.CANDLE_LIGHT
    ),

    // CE DEAD_GRASS，Globals.c:448：枯草（DF_SMALL_DEAD_GRASS 的 tile；
    // 42 号 feature 5 的 EVERYWHERE 载体）。
    [TerrainType.DEAD_GRASS]: e(
        T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION,
        40, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE VOMIT，Globals.c:457：呕吐物（9 号 feature 1 的 terrain 列 +
    // DF_VOMIT 的 tile）。flags 0 纯装饰。
    [TerrainType.VOMIT]: e(
        0,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE LUMINESCENT_FUNGUS，Globals.c:450：发光菌（DF_LUMINESCENT_FUNGUS 的
    // tile；12/33/57 号 DF 列的落点）。照明 FUNGUS_LIGHT。
    [TerrainType.LUMINESCENT_FUNGUS]: e(
        T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION,
        10, 'DF_PLAIN_FIRE', '', '', 0, false, LightKind.FUNGUS_LIGHT
    ),

    // CE DEAD_FOLIAGE，Globals.c:473：枯叶（DF_DEAD_FOLIAGE 的 tile。
    // promoteType DF_SMALL_DEAD_GRASS——踩上退化为枯草）。
    [TerrainType.DEAD_FOLIAGE]: e(
        T_OBSTRUCTS_VISION | T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_STEP,
        80, 'DF_PLAIN_FIRE', '', 'DF_SMALL_DEAD_GRASS', 0
    ),

    // CE RUBBLE，Globals.c:465：碎石堆（DF_TUNNELIZE 的 tile；55 号蠕虫隧道
    // 挖掘的落点）。flags 0。
    [TerrainType.RUBBLE]: e(
        0,
        TM_STAND_IN_TILE,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE GRAY_FUNGUS，Globals.c:449：灰菌（DF_SWAMP 的 tile）。
    [TerrainType.GRAY_FUNGUS]: e(
        T_IS_FLAMMABLE,
        TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION,
        10, 'DF_PLAIN_FIRE', '', '', 0
    ),

    // CE WORM_TUNNEL_MARKER_DORMANT，Globals.c:568：休眠蠕虫隧道标记
    //（DF_WORM_TUNNEL_MARKER_DORMANT 的 tile）。CE displayChar = 0（不可见）、
    // fore/back = 0、flags = (0)、mechFlags = VANISHES|IS_WIRED、
    // promoteType DF_WORM_TUNNEL_MARKER_ACTIVE。
    [TerrainType.WORM_TUNNEL_MARKER_DORMANT]: e(
        0,
        TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED,
        0, '', '', 'DF_WORM_TUNNEL_MARKER_ACTIVE', 0
    ),

    [TerrainType.BLOODFLOWER_STALK]: e(
        T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_IS_FLAMMABLE,
        TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
        100, 'DF_PLAIN_FIRE', '', 'DF_BLOODFLOWER_PODS_GROW', 0
    ),
    [TerrainType.HAVEN_BEDROLL]: e(
        T_IS_FLAMMABLE, TM_VANISHES_UPON_PROMOTION,
        0, 'DF_PLAIN_FIRE', '', '', 0
    ),
    // V-2b-9a carriers, CE Globals.c:324/326/344/358/390/421/554/563/565/576-578.
    [TerrainType.FLOOR_FLOODABLE]: e(0, 0, 0, 'DF_PLAIN_FIRE', '', '', 0),
    [TerrainType.CHASM_WITH_HIDDEN_BRIDGE]: e(T_AUTO_DESCENT, TM_STAND_IN_TILE, 0, 'DF_PLAIN_FIRE', '', '', 0),
    [TerrainType.LAVA_RETRACTABLE]: e(T_LAVA_INSTA_DEATH, TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_ALLOWS_SUBMERGING, 0, 'DF_OBSIDIAN', '', 'DF_RETRACTING_LAVA', 0, false, LightKind.LAVA_LIGHT),
    [TerrainType.MUD_FLOOR]: e(T_IS_FLAMMABLE, TM_VANISHES_UPON_PROMOTION, 0, 'DF_STENCH_SMOLDER', '', '', 0),
    [TerrainType.MUD_WALL]: e(T_OBSTRUCTS_EVERYTHING, TM_STAND_IN_TILE, 0, 'DF_PLAIN_FIRE', '', '', 0),
    [TerrainType.MUD_DOORWAY]: e(T_OBSTRUCTS_VISION | T_OBSTRUCTS_GAS | T_IS_FLAMMABLE, TM_STAND_IN_TILE | TM_VISUALLY_DISTINCT, 50, 'DF_EMBERS', '', '', 0),
    [TerrainType.MARBLE_FLOOR]: e(0, 0, 0, 'DF_EMBERS', '', '', 0),
    [TerrainType.FLOOD_TRAP]: e(T_IS_DF_TRAP, TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT, 0, 'DF_FLOOD', '', '', 0),
    [TerrainType.ELECTRIC_CRYSTAL_OFF]: e(T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS | T_OBSTRUCTS_SURFACE_EFFECTS, TM_STAND_IN_TILE | TM_PROMOTES_ON_ELECTRICITY | TM_IS_CIRCUIT_BREAKER | TM_IS_WIRED | TM_LIST_IN_SIDEBAR, 0, 'DF_PLAIN_FIRE', '', 'DF_ELECTRIC_CRYSTAL_ON', 0),
    [TerrainType.TURRET_LEVER]: e(T_OBSTRUCTS_EVERYTHING, TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_PROMOTES_ON_PLAYER_ENTRY | TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT | TM_INVERT_WHEN_HIGHLIGHTED, 0, 'DF_PLAIN_FIRE', '', 'DF_TURRET_LEVER', 0),
    [TerrainType.HAUNTED_TORCH_DORMANT]: e(T_OBSTRUCTS_EVERYTHING, TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED, 0, 'DF_PLAIN_FIRE', '', 'DF_HAUNTED_TORCH_TRANSITION', 0, false, LightKind.TORCH_LIGHT),
    [TerrainType.DARK_FLOOR_DORMANT]: e(0, TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED, 0, 'DF_PLAIN_FIRE', '', 'DF_DARKENING_FLOOR', 0),
};

// ── 派生判据（名字照 CE，语义 = 旗标位测试；CE Movement/Dijkstra 等处
//    以 cellHasTerrainFlag(p, T_xxx) 的形态使用这些名字）───────────────────

/** CE `cellHasTerrainFlag(…, T_OBSTRUCTS_PASSABILITY)`（Rogue.h:1924）。 */
export function blocksPassability(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_OBSTRUCTS_PASSABILITY) !== 0;
}

/** CE `cellHasTerrainFlag(…, T_PATHING_BLOCKER)`（Rogue.h:1948 七旗标并集）。 */
export function isPathingBlocker(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_PATHING_BLOCKER) !== 0;
}

/** CE `cellHasTerrainFlag(…, T_OBSTRUCTS_VISION)`（Rogue.h:1925）。 */
export function blocksVision(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_OBSTRUCTS_VISION) !== 0;
}

/** CE `cellHasTerrainFlag(…, T_OBSTRUCTS_ITEMS)`（Rogue.h:1926）。 */
export function obstructsItems(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_OBSTRUCTS_ITEMS) !== 0;
}

/** CE `cellHasTerrainFlag(…, T_OBSTRUCTS_DIAGONAL_MOVEMENT)`（Rogue.h:1929）。 */
export function obstructsDiagonalMovement(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_OBSTRUCTS_DIAGONAL_MOVEMENT) !== 0;
}

/** CE `cellHasTerrainFlag(…, T_IS_DEEP_WATER)`（Rogue.h:1937）。 */
export function isDeepWater(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_IS_DEEP_WATER) !== 0;
}

/**
 * CE `cellHasTerrainFlag(…, T_AUTO_DESCENT)`（Rogue.h:1931）的单地形形态（C-5）。
 * 跨层的问法对 cell.layers 逐层调用——CHASM 在 LIQUID、HOLE 在 SURFACE，
 * 火盖在渊上时有效地形按全层 OR 判定（F-1 同款口径）。
 * 消费点：Game 的坠落结算（Time.c:110 monsterShouldFall）与跳渊确认
 * （Movement.c:1303-1322）；T_AUTO_DESCENT = T_CAN_BE_BRIDGED（:1953）。
 */
export function isAutoDescent(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_AUTO_DESCENT) !== 0;
}

/** CE `cellHasTerrainFlag(…, T_IS_FLAMMABLE)`（Rogue.h:1934）。 */
export function isFlammable(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_IS_FLAMMABLE) !== 0;
}

/**
 * CE `cellHasTerrainFlag(…, T_IS_FIRE)`（Rogue.h:1935）的单地形形态（F-1）。
 * 注意语义差：CE 的 cellHasTerrainFlag 是四层并集；本函数只回答"这个地形
 * 是不是火"。跨层的问法请对 cell.layers 逐层调用（见 Gas/Game 的用法）——
 * 火在 web 只写 SURFACE 层，但读者不应依赖这一条。
 */
export function isFireTerrain(t: TerrainType): boolean {
    return (TERRAIN_FLAGS[t].flags & T_IS_FIRE) !== 0;
}
