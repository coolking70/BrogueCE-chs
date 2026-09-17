/**
 * src/engine/Map/LightCatalog.ts — CE 光照目录 + 矿灯半径公式（C-7）
 *
 * 数据全部从 CE 源码逐条抄录（BrogueCE-master/src/brogue/，只读）：
 * - `Rogue.h:1794-1799` `struct lightSource`：字段序
 *   lightColor / lightRadius(randomRange) / radialFadeToPercent / passThroughCreatures
 *   （注释原文："generally no, but miner light does"）。
 * - `Rogue.h:677-742` `enum lightType`：60 条（NO_LIGHT=0 … DEMONIC_STATUE_LIGHT=59）。
 * - `Globals.c:955-1016` `lightCatalog[NUMBER_LIGHT_KINDS]`（":953 radius is in
 *   units of 0.01"）。每条的 CE 行号写在表项注释。
 * - 颜色常量：`Globals.c:72-236`（另 `GlobalsBase.c:100` 的 pink）。
 *
 * 单位与口径（读数前必看）：
 * - **radius 单位是"0.01 格"**：300 = 3 格。矿灯条目存 {0,0,1} 占位是 CE 原样
 *   （Globals.c:958），运行时由 updateMinersLightRadius 动态写入
 *   rogue.minersLight（Rogue.h:2486-2487，fixpt 半径）。
 * - color 是 CE `struct color`（Rogue.h:1342-1358）的 7 个数值通道：
 *   red/green/blue（基础）+ redRand/greenRand/blueRand/rand（随机抖动幅度）。
 *   colorDances 是渲染端闪烁旗标，不参与光照数值，不迁移。
 * - CE 每次泼光都从 substantive 主流抽抖动（Light.c:65 断言 RNG_SUBSTANTIVE
 *   在案；:70-72 randComponent/rand_range）——即 CE 的光照数值本身就是主流
 *   消费者。**web 引擎侧确定性消费基础三分量、不抽随机数**：光照每回合重刷，
 *   若复刻该消耗，生成期与交互期的 RNG 流都会移动（generation_baseline 翻红）。
 *   留痕：渲染轮要闪烁时用 cosmetic RNG 自接 rand 通道（web 侧设计选择，
 *   CE 无此分域对应），引擎阈值判定继续用基础分量。
 * - 半径里 DCOLS*100 的 DCOLS 按 **CE 的 64** 求值（= 6400），不用 web 的 79
 *   （types/index.ts 的 DCOLS 是 web 终端布局常量，地图几何与 CE 不同；
 *   目录数据与公式参数一律抄 CE 原值——D1）。
 */

/** CE 终端布局下的地图宽度（Rogue.h:168；CE DCOLS=64，供目录/公式引用）。 */
export const CE_DCOLS = 64;

/** CE 16.16 定点因子（Rogue.h:99-101）。 */
export const FP_FACTOR = 65536;

/** 光照可见阈值（Rogue.h:184：三通道光强和超过 50 才置 VISIBLE）。 */
export const VISIBILITY_THRESHOLD = 50;

/** CE `struct color` 的 7 个数值通道（Rogue.h:1342-1358；colorDances 不迁移）。 */
export interface CeLightColor {
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly redRand: number;
    readonly greenRand: number;
    readonly blueRand: number;
    readonly rand: number;
}

/** CE `typedef struct randomRange`（Rogue.h:1336-1340）。 */
export interface CeRandomRange {
    readonly lowerBound: number;
    readonly upperBound: number;
    readonly clumpFactor: number;
}

/** CE `struct lightSource`（Rogue.h:1794-1799）。 */
export interface LightSourceDef {
    readonly color: CeLightColor;
    /** 单位 0.01 格。 */
    readonly radius: CeRandomRange;
    /** 光边缘衰减到的百分比（0=不衰减，100=线性熄灭）。 */
    readonly radialFadeToPercent: number;
    /** 光是否穿过生物（矿灯为 true，多数地形光为 false）。 */
    readonly passThroughCreatures: boolean;
}

const C = (
    red: number, green: number, blue: number,
    redRand = 0, greenRand = 0, blueRand = 0, rand = 0
): CeLightColor => ({ red, green, blue, redRand, greenRand, blueRand, rand });

const L = (
    color: CeLightColor,
    lowerBound: number, upperBound: number,
    radialFadeToPercent: number, passThroughCreatures: boolean
): LightSourceDef => ({
    color,
    radius: { lowerBound, upperBound, clumpFactor: 1 },
    radialFadeToPercent,
    passThroughCreatures
});

// ── 目录引用的颜色常量（Globals.c:72-236 / GlobalsBase.c:100，逐值抄录）────
const cPink                  = C(100, 60, 66);                     // GlobalsBase.c:100
const cFireBolt              = C(500, 150, 0, 45, 30, 0);          // :72
const cYendorLight           = C(50, -100, 30);                    // :73
const cFlamedancerCorona     = C(500, 150, 100, 45, 30, 0);        // :74
const cWispLight             = C(75, 100, 250, 33, 10, 0);         // :200
const cPixie                 = C(60, 60, 60, 40, 40, 40);          // :182
const cLichLight             = C(-50, 80, 30, 0, 0, 20);           // :208
const cSentinelLight         = C(20, 20, 120, 10, 10, 60);         // :218
const cUnicornLight          = C(-50, -50, -50, 250, 250, 250);    // :199
const cIfritLight            = C(0, 10, 150, 100, 0, 100);         // :198
const cSpectralBladeLight    = C(40, 0, 230);                      // :202
const cSummonedImageLight    = C(200, 0, 75);                      // :201
const cLightning             = C(100, 150, 500, 50, 50, 0, 50);    // :144
const cExplosiveAura         = C(2000, 0, -1000, 200, 200, 0);     // :205
const cTelepathy             = C(30, 30, 130);                     // :219
const cSacrificeTarget       = C(100, -100, -300, 0, 100, 100);    // :206
const cScrollProtection      = C(375, 750, 0);                     // :227
const cScrollEnchantment     = C(250, 225, 300, 0, 0, 450);        // :228
const cPotionStrength        = C(1000, 0, 400, 600, 0, 0);         // :229
const cEmpowermentFlash      = C(500, 1000, 600, 0, 500, 0);       // :230
const cGenericFlash          = C(800, 800, 800);                   // :231
const cFireFlash             = C(750, 225, 0, 100, 50, 0);         // :233
const cSummoningFlash        = C(0, 0, 0, 600, 0, 1200);           // :232
const cExplosionFlare        = C(10000, 6000, 1000);               // :234
const cQuietusFlash          = C(0, -1000, -200);                  // :235
const cSlayingFlash          = C(-1000, -200, 0);                  // :236
const cTorchLight            = C(75, 38, 15, 0, 15, 7);            // :195
const cLavaLight             = C(47, 13, 0, 10, 7, 0);             // :146
const cSunLight              = C(100, 100, 75);                    // :211
const cDarknessPatch         = C(-10, -10, -10);                   // :215
const cFungusLight           = C(2, 11, 11, 4, 3, 3);              // :145
const cFungusForestLight     = C(30, 40, 60, 0, 0, 0, 40);         // :212
const cAlgaeBlueLight        = C(20, 15, 50);                      // :223
const cAlgaeGreenLight       = C(15, 50, 20);                      // :224
const cEctoplasm             = C(45, 20, 55, 25, 0, 25, 5);        // :159
const cExplosion             = C(10, 8, 2, 0, 2, 2);               // :204
const cDartFlash             = C(500, 500, 500, 0, 2, 2);          // :207
const cPortalActivateLight   = C(300, 400, 500);                   // :221
const cConfusionLight        = C(10, 10, 10, 10, 10, 10);          // :220
const cDarknessCloud         = C(-20, -20, -20);                   // :216
const cForceFieldLight       = C(10, 10, 10, 0, 50, 50);           // :209
const cCrystalWallLight      = C(10, 10, 10, 0, 0, 50);            // :210
const cHauntedTorch          = C(75, 20, 40, 30, 10, 0);           // :196
const cGlyphLight            = C(150, 0, 0, 150, 0, 0);            // :116
const cSacredGlyph           = C(5, 20, 5, 0, 50, 0);              // :117
const cDescentLight          = C(20, 20, 70);                      // :222

/** CE `enum lightType`（Rogue.h:677-742）。下标即 TerrainCatalog glowLight 列值。 */
export enum LightKind {
    NO_LIGHT = 0,
    MINERS_LIGHT,                  // 1
    BURNING_CREATURE_LIGHT,        // 2
    WISP_LIGHT,                    // 3
    SALAMANDER_LIGHT,              // 4
    IMP_LIGHT,                     // 5
    PIXIE_LIGHT,                   // 6
    LICH_LIGHT,                    // 7
    FLAMEDANCER_LIGHT,             // 8
    SENTINEL_LIGHT,                // 9
    UNICORN_LIGHT,                 // 10
    IFRIT_LIGHT,                   // 11
    PHOENIX_LIGHT,                 // 12
    PHOENIX_EGG_LIGHT,             // 13
    YENDOR_LIGHT,                  // 14
    SPECTRAL_BLADE_LIGHT,          // 15
    SPECTRAL_IMAGE_LIGHT,          // 16
    SPARK_TURRET_LIGHT,            // 17
    EXPLOSIVE_BLOAT_LIGHT,         // 18
    BOLT_LIGHT_SOURCE,             // 19
    TELEPATHY_LIGHT,               // 20
    SACRIFICE_MARK_LIGHT,          // 21
    SCROLL_PROTECTION_LIGHT,       // 22
    SCROLL_ENCHANTMENT_LIGHT,      // 23
    POTION_STRENGTH_LIGHT,         // 24
    EMPOWERMENT_LIGHT,             // 25
    GENERIC_FLASH_LIGHT,           // 26
    FALLEN_TORCH_FLASH_LIGHT,      // 27
    SUMMONING_FLASH_LIGHT,         // 28
    EXPLOSION_FLARE_LIGHT,         // 29
    QUIETUS_FLARE_LIGHT,           // 30
    SLAYING_FLARE_LIGHT,           // 31
    CHARGE_FLASH_LIGHT,            // 32
    TORCH_LIGHT,                   // 33
    LAVA_LIGHT,                    // 34
    SUN_LIGHT,                     // 35
    DARKNESS_PATCH_LIGHT,          // 36
    FUNGUS_LIGHT,                  // 37
    FUNGUS_FOREST_LIGHT,           // 38
    LUMINESCENT_ALGAE_BLUE_LIGHT,  // 39
    LUMINESCENT_ALGAE_GREEN_LIGHT, // 40
    ECTOPLASM_LIGHT,               // 41
    UNICORN_POOP_LIGHT,            // 42
    EMBER_LIGHT,                   // 43
    FIRE_LIGHT,                    // 44
    BRIMSTONE_FIRE_LIGHT,          // 45
    EXPLOSION_LIGHT,               // 46
    INCENDIARY_DART_LIGHT,         // 47
    PORTAL_ACTIVATE_LIGHT,         // 48
    CONFUSION_GAS_LIGHT,           // 49
    DARKNESS_CLOUD_LIGHT,          // 50
    FORCEFIELD_LIGHT,              // 51
    CRYSTAL_WALL_LIGHT,            // 52
    CANDLE_LIGHT,                  // 53
    HAUNTED_TORCH_LIGHT,           // 54
    GLYPH_LIGHT_DIM,               // 55
    GLYPH_LIGHT_BRIGHT,            // 56
    SACRED_GLYPH_LIGHT,            // 57
    DESCENT_LIGHT,                 // 58
    DEMONIC_STATUE_LIGHT,          // 59
}

/**
 * CE `lightCatalog[NUMBER_LIGHT_KINDS]`（Globals.c:955-1016）的 web 投影。
 * 条目数与顺序由 c_7 测试钉死（60 条、枚举名逐一对位）。
 */
export const LIGHT_CATALOG: readonly LightSourceDef[] = [
    // ── 生物与矿灯 ──
    { color: C(0, 0, 0), radius: { lowerBound: 0, upperBound: 0, clumpFactor: 0 }, radialFadeToPercent: 0, passThroughCreatures: false }, // :957 NO_LIGHT（{0} 原样，clump 也是 0）
    L(C(0, 0, 0), 0, 0, 35, true),                            // :958 miners light（颜色/半径动态：Rogue.h:2486 + Time.c:2093）
    L(cFireBolt, 300, 400, 0, false),                         // :959 burning creature light
    L(cWispLight, 400, 800, 0, false),                        // :960 will-o'-the-wisp light
    L(cFireBolt, 300, 400, 0, false),                         // :961 salamander glow
    L(cPink, 600, 600, 0, true),                              // :962 imp light
    L(cPixie, 400, 600, 50, false),                           // :963 pixie light
    L(cLichLight, 1500, 1500, 0, false),                      // :964 lich light
    L(cFlamedancerCorona, 1000, 2000, 0, false),              // :965 flamedancer light
    L(cSentinelLight, 300, 500, 0, false),                    // :966 sentinel light
    L(cUnicornLight, 300, 400, 0, false),                     // :967 unicorn light
    L(cIfritLight, 300, 600, 0, false),                       // :968 ifrit light
    L(cFireBolt, 400, 600, 0, false),                         // :969 phoenix light
    L(cFireBolt, 150, 300, 0, false),                         // :970 phoenix egg light
    L(cYendorLight, 1500, 1500, 0, false),                    // :971 Yendorian light
    L(cSpectralBladeLight, 350, 350, 0, false),               // :972 spectral blades
    L(cSummonedImageLight, 350, 350, 0, false),               // :973 weapon images
    L(cLightning, 250, 250, 35, false),                       // :974 lightning turret light
    L(cExplosiveAura, 150, 200, 0, true),                     // :975 explosive bloat light
    L(cLightning, 300, 300, 0, false),                        // :976 bolt glow
    L(cTelepathy, 200, 200, 0, true),                         // :977 telepathy light
    L(cSacrificeTarget, 250, 250, 0, true),                   // :978 sacrifice doom light
    // ── flares（闪光动画，渲染轮职权）──
    L(cScrollProtection, 600, 600, 0, true),                  // :981 scroll of protection flare
    L(cScrollEnchantment, 600, 600, 0, true),                 // :982 scroll of enchantment flare
    L(cPotionStrength, 600, 600, 0, true),                    // :983 potion of strength flare
    L(cEmpowermentFlash, 600, 600, 0, true),                  // :984 empowerment flare
    L(cGenericFlash, 300, 300, 0, true),                      // :985 generic flash flare
    L(cFireFlash, 800, 800, 0, false),                        // :986 fallen torch flare
    L(cSummoningFlash, 600, 600, 0, true),                    // :987 summoning flare
    L(cExplosionFlare, 5000, 5000, 0, true),                  // :988 explosion (explosive bloat or incineration potion)
    L(cQuietusFlash, 300, 300, 0, true),                      // :989 quietus activation flare
    L(cSlayingFlash, 300, 300, 0, true),                      // :990 slaying activation flare
    L(cLightning, 800, 800, 0, false),                        // :991 electric crystal activates
    // ── 发光地形 ──
    L(cTorchLight, 1000, 1000, 50, false),                    // :994 torch
    L(cLavaLight, 300, 300, 50, false),                       // :995 lava
    L(cSunLight, 200, 200, 25, true),                         // :996 sunlight
    L(cDarknessPatch, 400, 400, 0, true),                     // :997 darkness patch
    L(cFungusLight, 300, 300, 50, false),                     // :998 luminescent fungus
    L(cFungusForestLight, 500, 500, 0, false),                // :999 luminescent forest
    L(cAlgaeBlueLight, 300, 300, 0, false),                   // :1000 luminescent algae blue
    L(cAlgaeGreenLight, 300, 300, 0, false),                  // :1001 luminescent algae green
    L(cEctoplasm, 200, 200, 50, false),                       // :1002 ectoplasm
    L(cUnicornLight, 200, 200, 0, false),                     // :1003 unicorn poop light
    L(cLavaLight, 200, 200, 50, false),                       // :1004 embers
    L(cLavaLight, 500, 1000, 0, false),                       // :1005 fire
    L(cLavaLight, 200, 300, 0, false),                        // :1006 brimstone fire
    L(cExplosion, CE_DCOLS * 100, CE_DCOLS * 100, 100, false),// :1007 explosions
    L(cDartFlash, 15 * 100, 15 * 100, 0, false),              // :1008 incendiary darts
    L(cPortalActivateLight, CE_DCOLS * 100, CE_DCOLS * 100, 0, false), // :1009 portal activation
    L(cConfusionLight, 300, 300, 100, false),                 // :1010 confusion gas
    L(cDarknessCloud, 500, 500, 0, true),                     // :1011 darkness cloud
    L(cForceFieldLight, 200, 200, 50, false),                 // :1012 forcefield
    L(cCrystalWallLight, 300, 500, 50, false),                // :1013 crystal wall
    L(cTorchLight, 200, 400, 0, false),                       // :1014 candle light
    L(cHauntedTorch, 400, 600, 0, false),                     // :1015 haunted torch
    L(cGlyphLight, 100, 100, 0, false),                       // :1016 glyph dim light
    L(cGlyphLight, 300, 300, 0, false),                       // :1017 glyph bright light
    L(cSacredGlyph, 300, 300, 0, false),                      // :1018 sacred glyph light
    L(cDescentLight, 600, 600, 0, false),                     // :1019 magical pit light
    L(cSacrificeTarget, 800, 1200, 0, true),                  // :1020 demonic statue light
];

// ── 矿灯颜色（动态）：Rogue.h 全局 minersLightColor 由 updateColors 按 深度
//    插值（RogueMain.c:538-544 + Globals.c:293-301 边界表 + IO.c:1529-1540）。

const MINERS_LIGHT_START = C(180, 180, 180);  // Globals.c:120 minersLightStartColor
const MINERS_LIGHT_END   = C(90, 90, 120);    // Globals.c:121 minersLightEndColor

/** CE AMULET_LEVEL（GlobalsBrogue.c:43，Brogue 变体 gameConst->amuletLevel = 26）。 */
export const CE_AMULET_LEVEL = 26;

/**
 * CE updateColors 的矿灯颜色插值（RogueMain.c:538-544）：
 * percent = min(100, max(0, depth*100/amuletLevel))；
 * 每通道 = (start*(100-percent) + end*percent)/100，C 整除（向零截断）——
 * 复刻 IO.c:1529-1537 applyColorAverage 的舍入。
 */
export function minersLightColorAtDepth(depth: number, amuletLevel: number = CE_AMULET_LEVEL): CeLightColor {
    const percent = Math.min(100, Math.max(0, (depth * 100) / amuletLevel | 0));
    const mix = (a: number, b: number): number => (a * (100 - percent) + b * percent) / 100 | 0;
    return {
        red: mix(MINERS_LIGHT_START.red, MINERS_LIGHT_END.red),
        green: mix(MINERS_LIGHT_START.green, MINERS_LIGHT_END.green),
        blue: mix(MINERS_LIGHT_START.blue, MINERS_LIGHT_END.blue),
        redRand: mix(MINERS_LIGHT_START.redRand, MINERS_LIGHT_END.redRand),
        greenRand: mix(MINERS_LIGHT_START.greenRand, MINERS_LIGHT_END.greenRand),
        blueRand: mix(MINERS_LIGHT_START.blueRand, MINERS_LIGHT_END.blueRand),
        rand: mix(MINERS_LIGHT_START.rand, MINERS_LIGHT_END.rand),
    };
}

// ── 矿灯半径：深度衰减（RogueMain.c:666-670）+ 动态修正（Light.c:120-154）──

/**
 * CE 每次进新层重置的基础矿灯半径（RogueMain.c:666-670，fixpt）：
 *
 *   minersLightRadius = (DCOLS-1) * FP_FACTOR;
 *   for (i = 0; i < depth * depthAccelerator; i++)
 *       minersLightRadius = minersLightRadius * 85 / 100;   // 逐次整除，非 pow
 *   minersLightRadius += FP_FACTOR * 225 / 100;             // +2.25 格
 *
 * 注意逐次 85% 用 C 整除（floor），与浮点 0.85^depth 有累积差——按 CE 原样循环。
 * Brogue 变体 depthAccelerator = 1（GlobalsBrogue.c:1019）。
 */
export function minersLightBaseRadiusFixpt(depth: number, depthAccelerator: number = 1): number {
    let radius = (CE_DCOLS - 1) * FP_FACTOR;
    for (let i = 0; i < depth * depthAccelerator; i++) {
        radius = (radius * 85) / 100 | 0;
    }
    radius += (FP_FACTOR * 225) / 100;
    return radius;
}

/** updateMinersLightRadius 的输出（Rogue.h:2486 rogue.minersLight 的动态两列）。 */
export interface MinersLightState {
    /** 写入 lightRadius.lowerBound/upperBound（单位 0.01 格）。 */
    readonly radiusHundredths: number;
    /** 写入 radialFadeToPercent。 */
    readonly radialFadeToPercent: number;
}

/**
 * CE updateMinersLightRadius（Light.c:120-154）的逐行复刻。
 *
 * 载体现状（C-7 登记）：
 * - lightMultiplier：CE 由 updateRingBonuses 按光明戒指附魔累加
 *   （Items.c:8685-8730，基础值 1）；web 无光明戒指载体（D2 池无
 *   ring_of_light），本轮恒传 1，公式结构完整保留——戒指落地时接
 *   effectiveRingEnchant 即可。
 * - STATUS_DARKNESS：CE 由黑暗药水设置（Items.c:8085-8093）；web 无黑暗
 *   药水载体，本轮恒传 0，立方衰减分支保留。
 * - rogue.inWater：CE 玩家站水中时矿灯减半（Light.c:148-150）；web 无
 *   inWater 载体，本轮恒传 false，分支保留。
 *
 * @param baseRadiusFixpt minersLightBaseRadiusFixpt(depth) 的 fixpt 值
 */
export function updateMinersLightRadius(
    baseRadiusFixpt: number,
    params: {
        lightMultiplier?: number;
        darknessStatus?: number;
        darknessMax?: number;
        inWater?: number;
    } = {}
): MinersLightState {
    const lightMultiplier = params.lightMultiplier ?? 1;
    const darknessStatus = params.darknessStatus ?? 0;
    const darknessMax = params.darknessMax ?? 0;
    const inWater = params.inWater ?? 0;

    // Light.c:123
    let lightRadius = 100 * baseRadiusFixpt;

    // Light.c:125-132（fixpt：负倍率除法收缩，正倍率乘法放大 + 下限）
    if (lightMultiplier < 0) {
        lightRadius = Math.trunc(lightRadius / (-1 * lightMultiplier + 1));
    } else {
        lightRadius *= lightMultiplier;
        lightRadius = Math.max(lightRadius, (lightMultiplier * 2 + 2) * FP_FACTOR);
    }

    // Light.c:134-144：黑暗状态的立方衰减（fraction 下限 1/20）
    let fraction: number;
    if (darknessStatus > 0) {
        const baseFraction = FP_FACTOR - Math.trunc((darknessStatus * FP_FACTOR) / darknessMax);
        fraction = Math.trunc(Math.trunc((baseFraction * baseFraction) / FP_FACTOR) * baseFraction / FP_FACTOR);
        if (fraction < FP_FACTOR / 20) {
            fraction = FP_FACTOR / 20;
        }
        lightRadius = Math.trunc((lightRadius * fraction) / FP_FACTOR);
    } else {
        fraction = FP_FACTOR;
    }

    // Light.c:146-148：绝对下限 2*FP——注意量纲：lightRadius 此处以
    // FP 为"百分之一格"计（:123 已 ×100），2*FP 即 2 个百分之一格的
    // 退化保护，正常深度永不触底（depth40 满黑暗 = 11）。
    if (lightRadius < 2 * FP_FACTOR) {
        lightRadius = 2 * FP_FACTOR;
    }

    // Light.c:150-152：水中减半（同量纲的 3*FP 退化下限）
    if (inWater && lightRadius > 3 * FP_FACTOR) {
        lightRadius = Math.max(Math.trunc(lightRadius / 2), 3 * FP_FACTOR);
    }

    // Light.c:154：径向衰减 = 35 + clamp(LM*5, 0, 65) * fraction
    const radialFadeToPercent =
        35 + Math.trunc((Math.max(0, Math.min(65, lightMultiplier * 5)) * fraction) / FP_FACTOR);

    // Light.c:155：半径写入（clamp ±30000，单位 0.01 格）
    const radiusHundredths = Math.max(-30000, Math.min(30000, Math.trunc(lightRadius / FP_FACTOR)));

    return { radiusHundredths, radialFadeToPercent };
}
