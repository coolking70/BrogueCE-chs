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
