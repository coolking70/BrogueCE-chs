/**
 * R-1（渲染纯重构轮）：「格子/实体 → 外观」的纯决策函数。
 *
 * 从 GameCanvas.vue 的 render()（原 341-563 行）与 getTerrainVisual
 * （原 126-184 行）**逐字搬运**而来——R-1（渲染纯重构轮）是结构先行、
 * 行为逐位不变；UI-1（2026-09-18）在这条缝上偿还七条渲染欠账中的
 * 六条（火焰三态、探魔符号、PARALYSIS/METHANE 气体、explosion_immunity
 * 隐藏、光照逐通道乘法；燃烧怪发光 deferral 见 monsterAppearance 注释）。
 *
 * 核心价值：把原先对全局 `game` 的隐式依赖（gasGrid / lightMap /
 * player.statusDurations / 幻觉 RNG）变成**显式参数**（ctx），
 * 让「给定格子 → 字形/颜色」可以被直接断言与测试。
 * 这些函数**不得**读任何全局单例；一切输入经 ctx 注入。
 *
 * 结构守卫：src/test/r_1_appearance.test.ts 钉死 GameCanvas.vue 内
 * 不得再出现外观决策（颜色/字形字面量、决策 switch）。
 */

import { TerrainType, type Cell } from '../Map/Grid';
import { ColorUtils } from '../Map/Color';
import { GasType, type GasCell } from '../Environment/Gas';
import type { LightChannels } from '../Lighting/LightMap';
import { MonsterState, type Monster } from '../../entities/Monster';
import type { Player } from '../../entities/Player';
import { Item, ItemCategory } from '../Items/Item';
import { ItemLoader } from '../Items/ItemLoader';

/** W-25: selection trajectory styling belongs to the appearance layer; the
 * canvas only draws the geometry supplied by the read-only targeting preview. */
export const ARCANA_TRAJECTORY_FILL = { color: 0xaaaaff, alpha: 0.18 } as const;

// ── UI-1 新增的 CE 字形/颜色常量（逐值核对 BrogueCE-master/src/platform/）──

/** CE G_FIRE 的图形平台字形（platformdependent.c:123 → U_FLIPPED_V，platform.h:6 = 0x22CF）。 */
export const G_FIRE_CHAR = '⋏';
/** CE G_ASHES 的字形（platformdependent.c:173 → '\''，两平台一致）——ASH 与 EMBERS 同字形（Globals.c:461/469）。 */
export const G_ASHES_CHAR = "'";
/** CE G_GOOD_MAGIC（platformdependent.c:131 → U_FILLED_CIRCLE_BARS，platform.h:23 = 0x29F3）。 */
export const G_GOOD_MAGIC_CHAR = '⧳';
/** CE G_BAD_MAGIC（platformdependent.c:132 → U_CIRCLE_BARS，platform.h:22 = 0x29F2）。 */
export const G_BAD_MAGIC_CHAR = '⧲';
/** CE G_AMULET（platformdependent.c:125 → U_ANKH，platform.h:9 = 0x2640）。 */
export const G_AMULET_CHAR = '♀';

/**
 * CE 颜色 → web 字节的换算：CE web 平台是 `(unsigned char)(v * 255 / 100)`
 * （web-platform.c:170-175，整型截断）。fireForeColor = {70,20,0}（Globals.c:136）
 * → 70*255/100=178=0xB2、20*255/100=51=0x33。
 */
export const FIRE_FORE_COLOR = '#b23300';
/** ashForeColor = {20,20,20}（Globals.c:157）→ #333333。 */
export const ASH_FORE_COLOR = '#333333';
/** goodMessageColor = {60,50,100}（Globals.c:278）→ #997fff。 */
export const GOOD_MAGIC_COLOR = '#997fff';
/** badMessageColor = {100,50,60}（Globals.c:279）→ #ff7f99。 */
export const BAD_MAGIC_COLOR = '#ff7f99';
/** CE white → #ffffff（探测出的护符符号前景，IO.c:1231）。 */
export const AMULET_MAGIC_COLOR = '#ffffff';
/** PARALYSIS_GAS 的 backColor = &pink = {100,60,66}（Globals.c:506 + GlobalsBase.c:100）→ #ff99a8；web 沿用既有气体惯例减半做底色。 */
export const PARALYSIS_GAS_BG = 0x7f4c54;
/** METHANE_GAS 的 backColor = &methaneColor = {45,60,15}（Globals.c:507 + :254）→ #729926；同上减半。 */
export const METHANE_GAS_BG = 0x394c13;
/** CE 气体 tile 的 displayChar 是 ' '（Globals.c:502-507）——CE 只用颜色区分气体；
 * web 既有气体分支习惯配一个可读字形，这里沿用最中性的 '~'（与 POISON 同形，
 * 区分靠色，与 CE 的「色辨气体」一致）。 */
export const GAS_OVERLAY_CHAR = '~';
export const PARALYSIS_GAS_FG = '#ff99aa';
export const METHANE_GAS_FG = '#b3d94c';

/** CE LIGHT_SMOOTHING_THRESHOLD（Rogue.h:180）——超过它的光强按平方根压回。 */
const LIGHT_SMOOTHING_THRESHOLD = 150;

/**
 * CE adjustedLightValue（IO.c:1732-1737）：x ≤ 150 原样；否则
 * fp_sqrt(x*FP/150)*150/FP = trunc(sqrt(x/150)*150)。
 */
function adjustedLightValue(x: number): number {
    if (x <= LIGHT_SMOOTHING_THRESHOLD) return x;
    return Math.trunc(Math.sqrt(x / LIGHT_SMOOTHING_THRESHOLD) * LIGHT_SMOOTHING_THRESHOLD);
}

/**
 * CE applyColorMultiplier（IO.c:1517-1530）的 web 字节版：每通道
 * base * multiplier / 100，整数截断，出界钳回字节域（CE plotCharWithColor
 * 的 0..100 钳位，IO.c:1778-1783）。
 */
function multiplyByLightChannels(hex: string | number, light: LightChannels): string {
    const base = ColorUtils.hexToRGB(hex);
    const channel = (byte: number, lv: number): number => {
        const m = adjustedLightValue(Math.max(0, lv));
        return Math.max(0, Math.min(255, Math.trunc((byte * m) / 100)));
    };
    return ColorUtils.rgbToHex({
        r: channel(base.r, light.r),
        g: channel(base.g, light.g),
        b: channel(base.b, light.b),
    });
}

/**
 * 幻觉渲染的调色板/字形表——原样搬自 GameCanvas render() 的
 * hallucinationColors / hallucinationChars（R-1 前位于 render 闭包内）。
 */
export const HALLUCINATION_COLORS: readonly string[] = ['#ff66ff', '#66ffff', '#ffff66', '#ff9966', '#99ff66'];
export const HALLUCINATION_CHARS: readonly string[] = ['*', '?', '!', '~', '&'];

/**
 * 幻觉等纯视觉随机的注入接口。生产实现是 GameCanvas.vue 的
 * cosmeticPercent / cosmeticPick（COSMETIC 流，Rogue.h:1282-1283 的
 * assureCosmeticRNG/restoreRNG 用法）；测试注入确定性假实现。
 * 这里**刻意**不直接 import 全局 rng——保持本模块可测、无全局依赖。
 */
export interface CosmeticRng {
    percent: (percent: number) => boolean;
    pick: <T>(list: readonly T[]) => T;
}

/** 地形/格子的最终视觉：字形 + 前景色（CSS 字符串）+ 背景色（0xRRGGBB 数字，null = 不画底色）。 */
export interface TerrainVisual {
    char: string;
    color: string;
    bgColor: number | null;
}

/** 实体（物品/怪物/玩家）的视觉。interactive = 是否加发光描边（原 placeEntity 的 isInteractive）。 */
export interface EntityVisual {
    char: string;
    color: string | number;
    interactive: boolean;
}

/**
 * cellAppearance 的显式输入。gas/light 是**该格**的快照
 * （渲染层负责从 environment.gasGrid / lightMap.getLight 取出传入），
 * 纯函数自身不持有任何地图/游戏引用。
 */
export interface CellAppearanceContext {
    /** 该格气体镜像条目（无气体或越界时 undefined）。 */
    gas: GasCell | undefined;
    /**
     * 该格的 CE 三通道累积光（LightMap.lightAt ≙ CE tmap[x][y].light[3]，
     * 0-100 标度、可超 100 表示过亮）。UI-1 第 7 条起渲染按 CE 的
     * applyColorMultiplier 逐通道乘法消费它，不再用旧 {color,intensity} 混合。
     */
    lightChannels: LightChannels | null;
    /**
     * 该格的地面物品（CE itemAtLoc(loc)；渲染层每帧从 game.items 建索引传入）。
     * 探测魔法符号（IO.c:1219-1236 左支）的载体。
     */
    groundItem: Item | null;
    /**
     * 怪物携带的物品（CE monst->carriedItem，IO.c:1120-1121 右支的载体）。
     * 非 null 时生产者必须已保证该怪物不可被看见（!canSeeMonster 已折入）。
     * **web Monster 当前没有 carriedItem 字段**——GameCanvas 恒传 null，
     * 本支为留形分支，等怪物载物轮接上。
     */
    carriedItem: Item | null;
    /** 玩家是否处于幻觉（game.player.statusDurations.hallucinating 的布尔化）。 */
    hallucinating: boolean;
    /** 幻觉用纯视觉随机（生产 = GameCanvas 的 cosmeticPercent/Pick）。 */
    cosmetic: CosmeticRng;
}

/**
 * entityAppearance 的显式输入。visible/memory 取自实体所在格
 * （渲染层负责 getCell 后传入布尔，纯函数不接触 Grid）。
 */
export interface EntityAppearanceContext {
    /** 实体所在格当前可见。 */
    cellVisible: boolean;
    /** 实体所在格有记忆（已探索后的残像）。 */
    cellHasMemory: boolean;
    /** 玩家是否处于心灵感应（statusDurations.telepathy 的布尔化）。 */
    telepathy: boolean;
    /** 玩家是否处于幻觉。 */
    hallucinating: boolean;
    /** 幻觉用纯视觉随机。 */
    cosmetic: CosmeticRng;
}

/**
 * 地形的基础外观（不含气体/光照/幻觉/记忆/探测符号覆盖）。
 * 逐字搬自 GameCanvas.vue 原 getTerrainVisual（126-184 行）。
 *
 * UI-1 第 1 条（2026-09-18）给火寿命链补了 CE 外观（见 case 段注释）；
 * 仍落 default 的还有 NOTHING/WALL/CHASM/LAVA/BOG/CHARRED_FLOOR 与
 * C-2/C-5/B-3 追加的地形（FORCEFIELD/CRYSTAL_WALL/SACRED_GLYPH 等）。
 */
export function terrainAppearance(terrain: TerrainType, isVisible: boolean): TerrainVisual {
    let char = ' ';
    let color = '#000000';
    let bgColor: number | null = null;

    switch (terrain) {
        case TerrainType.GRANITE:
            char = '#'; color = '#444455'; break;
        case TerrainType.FLOOR:
            char = '.'; color = '#aaaaaa'; bgColor = 0x222233; break;
        case TerrainType.DOOR:
            char = '+'; color = '#aa8844'; bgColor = 0x332211; break;
        case TerrainType.OPEN_DOOR:
            char = "'"; color = '#aa8844'; bgColor = 0x221800; break;
        case TerrainType.WATER_SHALLOW:
            char = '~'; color = '#3366cc'; bgColor = 0x112244; break;
        case TerrainType.WATER_DEEP:
            char = '~'; color = '#1133aa'; bgColor = 0x001133; break;
        case TerrainType.GRASS:
            char = '"'; color = '#33aa33'; bgColor = 0x113311; break;
        case TerrainType.FOLIAGE:
            char = '♠'; color = '#228822'; bgColor = 0x112211; break;
        case TerrainType.STAIRS_DOWN:
            char = '>'; color = '#00aaff'; bgColor = 0x222233; break;
        case TerrainType.STAIRS_UP:
            char = '<'; color = '#ffaa00'; bgColor = 0x222233; break;
        case TerrainType.SIGN:
            char = '§'; color = '#ffee88'; bgColor = 0x332b11; break;
        case TerrainType.RESET_PLATE:
            char = '⊙'; color = '#66ccff'; bgColor = 0x113344; break;
        case TerrainType.TRAP:
            char = '^'; color = '#cc4400'; bgColor = 0x220800; break;
        case TerrainType.SECRET_DOOR:
            // Render as wall so it looks hidden
            char = '#'; color = '#555566'; break;
        case TerrainType.PRESSURE_PLATE:
            char = '_'; color = '#44cc44'; bgColor = 0x112211; break;
        case TerrainType.LOCKED_DOOR:
            char = '+'; color = '#dd9933'; bgColor = 0x331100; break;
        case TerrainType.ALTAR:
            char = '_'; color = '#ffffcc'; bgColor = 0x443311; break;
        case TerrainType.WEB:
            char = '\\'; color = '#cccccc'; bgColor = 0x222222; break;
        case TerrainType.BLOOD:
            char = '%'; color = '#aa2222'; bgColor = 0x330000; break;
        case TerrainType.MUD:
            char = '~'; color = '#664422'; bgColor = 0x221100; break;
        // ── UI-1 第 1 条：火寿命链的 CE 外观（Globals.c:461/469/492/495）──
        // PLAIN_FIRE/GAS_FIRE 都是 G_FIRE + fireForeColor（GAS_EXPLOSION 是 web
        // 的爆炸火载体，视觉同 PLAIN_FIRE——CE 爆炸留下的就是 plain fire）；
        // ASH 与 EMBERS 同为 G_ASHES 字形，靠前景色区分（ashForeColor/fireForeColor）；
        // 三者 backColor 均为 0（不画底色）。drawPriority（10/70/80，数值小者优先，
        // Rogue.h:1910）在 web 的单值 cell.terrain 模型里无可观察载体，不迁移。
        case TerrainType.PLAIN_FIRE:
            char = G_FIRE_CHAR; color = FIRE_FORE_COLOR; break;
        case TerrainType.GAS_FIRE:
            char = G_FIRE_CHAR; color = FIRE_FORE_COLOR; break;
        case TerrainType.GAS_EXPLOSION:
            char = G_FIRE_CHAR; color = FIRE_FORE_COLOR; break;
        case TerrainType.EMBERS:
            char = G_ASHES_CHAR; color = FIRE_FORE_COLOR; break;
        case TerrainType.ASH:
            char = G_ASHES_CHAR; color = ASH_FORE_COLOR; break;
        default:
            char = ' '; break;
    }

    // Dim explored but not currently visible tiles
    if (!isVisible) {
        color = '#333333';
        if (bgColor !== null) bgColor = 0x111111;
    }

    return { char, color, bgColor };
}

/**
 * 一个格子最终画成什么：地形基础外观 + 探测魔法符号 + 气体/光照/幻觉/记忆覆盖。
 * 决策结构逐字对齐 CE getCellAppearance（IO.c:1096-1441）的 web 等价物；绘制
 * （bgGraphics 矩形与 Text sprite 更新）仍在 GameCanvas.vue。
 *
 * 返回 null = 该格什么都不画（未探索且不可见——对应渲染层原
 * `sprite.visible = false; continue` 的门）。
 *
 * 掷骰时序敏感：幻觉的 cosmetic 调用次数与顺序（percent(15) → pick 颜色 →
 * pick 字形）逐字保留——COSMETIC 流的消耗序列属于可观察行为
 * （p2_0_seeded_rng 钉过其形态）。
 *
 * UI-1（2026-09-18）落地：探魔符号（第 3 条）、PARALYSIS/METHANE 气体
 * （第 4 条）、光照逐通道乘法（第 7 条）；燃烧格的 '*' 覆盖层同时移除——
 * 火视觉由地形本体承载（CE 无独立燃烧覆盖层，见 terrainAppearance case 段）。
 */
export function cellAppearance(cell: Cell, ctx: CellAppearanceContext): TerrainVisual | null {
    // CE IO.c:1219-1240：探测魔法符号。它压过地形/记忆字形，且不受
    // 「未探索即不画」的门限制（detect magic 的本意就是照出未探索区的物品）。
    const detected = detectedMagicAppearance(cell, ctx);
    if (!cell.isExplored && !cell.isVisible) {
        if (!detected) return null;
        return {
            char: detected.char,
            color: detected.color,
            // CE 对这种格子不做任何乘法/平均（IO.c:1349-1359 "do nothing"）——
            // 底色取未变暗的基础值。
            bgColor: terrainAppearance(cell.terrain, true).bgColor,
        };
    }

    let { char, color, bgColor } = terrainAppearance(cell.terrain, cell.isVisible);

    // Apply Environmental Overrides (Gas) —— 燃烧覆盖层已移除（UI-1 第 1 条：
    // 火视觉 = 地形本体；Grid.isBurning 仍供气体的 !isBurning 守卫使用）。
    if (cell.isVisible) {
        const gas = ctx.gas;
        if (gas && gas.density > 0) {
            if (gas.type === GasType.POISON) {
                bgColor = 0x660066;
                if (!cell.isBurning) { char = '~'; color = '#ff55ff'; }
            } else if (gas.type === GasType.STEAM) {
                bgColor = 0xaaaaaa;
                if (!cell.isBurning) { char = '*'; color = '#ffffff'; }
            } else if (gas.type === GasType.CONFUSION) {
                bgColor = 0x006666;
                if (!cell.isBurning) { char = '?'; color = '#55ffff'; }
            } else if (gas.type === GasType.CREEPING_DEATH) {
                bgColor = 0x440000;
                if (!cell.isBurning) { char = '~'; color = '#ff4444'; }
            }
            // UI-1 第 4 条：G-2/G-3 的两种气体补上视觉分支（取值依据见常量注释）。
            else if (gas.type === GasType.PARALYSIS) {
                bgColor = PARALYSIS_GAS_BG;
                if (!cell.isBurning) { char = GAS_OVERLAY_CHAR; color = PARALYSIS_GAS_FG; }
            } else if (gas.type === GasType.METHANE) {
                bgColor = METHANE_GAS_BG;
                if (!cell.isBurning) { char = GAS_OVERLAY_CHAR; color = METHANE_GAS_FG; }
            }
        }
    }

    // CE IO.c:1219-1240：符号字形压过地形/气体字形（右支可出现在可见格上——
    // 怪物隐形但格子亮着；左支只在 !playerCanSeeOrSense 的格子上出现）。
    if (detected) {
        char = detected.char;
        color = detected.color;
    }

    // Apply dynamic lighting if the cell is currently visible
    // For memory/explored cells, we just dim them significantly.
    if (cell.isVisible) {
        const light = ctx.lightChannels;
        if (light && (light.r > 0 || light.g > 0 || light.b > 0)) {
            // UI-1 第 7 条：CE 的光照是**逐通道乘法**（IO.c:1434-1437 对前景与
            // 背景各做一次 applyColorMultiplier，乘数 = adjustedLightValue 后的
            // tmap.light），不是向光色按强度混合——光色本身就在乘数通道里，
            // 过亮（>100）的通道会把颜色抬向饱和。
            color = multiplyByLightChannels(color, light);
            if (bgColor !== null) {
                bgColor = parseInt(multiplyByLightChannels(bgColor, light).replace('#', ''), 16);
            }
        } else {
            // Visible but completely unlit = very dark
            color = '#222222';
            if (bgColor !== null) bgColor = 0x050505;
        }
        if (ctx.hallucinating && ctx.cosmetic.percent(15)) {
            color = ctx.cosmetic.pick(HALLUCINATION_COLORS);
            char = ctx.cosmetic.pick(HALLUCINATION_CHARS);
        }
    } else if (detected) {
        // CE IO.c:1349-1359：不可见格上有探测物（或探出的怪物）时
        // "do nothing"——不做记忆变暗、不乘光，符号与底色保持全亮。
    } else if (cell.hasMemory) {
        // Out of sight memory
        if (cell.terrain === TerrainType.STAIRS_UP || cell.terrain === TerrainType.STAIRS_DOWN) {
            // Stairs stay fully or mostly bright
            color = '#ffffff';
            if (bgColor !== null) bgColor = 0x222222;
        } else {
            color = '#333333';
            if (bgColor !== null) bgColor = 0x111111;
        }
    }

    return { char, color, bgColor };
}

/**
 * CE getCellAppearance 的探测魔法符号段（IO.c:1219-1240）：
 *
 *   左支：地面物品已探测出魔法（web 载体 = item.magicDetected，B-1c）且
 *         itemMagicPolarity ≠ 0，且**看不见该格**（CE !playerCanSeeOrSense，
 *         Rogue.h:1278 = ANY_KIND_OF_VISIBLE → web cell.isVisible）；
 *   右支：怪物携带的已探测魔法物品且**看不见该怪物**（IO.c:1120-1121，
 *         含 !canSeeMonster——web 无怪物载物载体，carriedItem 恒 null 留形）。
 *
 * 两支守卫的对象不同（格 vs 怪），是**析取**不合并；右支命中时 theItem 取
 * 携带物（IO.c:1123-1125），即左支让位于右支。
 *
 * 符号（图形平台映射，platformdependent.c:123-132）：护符 → G_AMULET + white；
 * polarity -1 → G_BAD_MAGIC + badMessageColor；+1 → G_GOOD_MAGIC +
 * goodMessageColor。CE 内层还有 polarity == 0 → cellChar = 0 的防御分支，
 * 但两支守卫都要求 polarity ≠ 0（0 是 falsy 过不了守卫），结构性不可达，不迁移。
 */
function detectedMagicAppearance(cell: Cell, ctx: CellAppearanceContext): { char: string; color: string } | null {
    const carried = ctx.carriedItem;
    const monsterWithDetectedItem = !!(carried
        && carried.magicDetected
        && ItemLoader.itemMagicPolarity(carried) !== 0);

    let theItem: Item | null;
    if (monsterWithDetectedItem) {
        theItem = carried; // IO.c:1123-1125：携带物优先于地面物
    } else {
        theItem = ctx.groundItem;
        // 左支守卫：物品已探测 + 有极性 + 看不见【格子】
        if (!theItem || !theItem.magicDetected || cell.isVisible) return null;
        if (ItemLoader.itemMagicPolarity(theItem) === 0) return null;
    }

    if (!theItem.magicDetected || ItemLoader.itemMagicPolarity(theItem) === 0) return null;

    if (theItem.category === ItemCategory.AMULET) {
        return { char: G_AMULET_CHAR, color: AMULET_MAGIC_COLOR };
    }
    const polarity = ItemLoader.itemMagicPolarity(theItem);
    if (polarity === -1) return { char: G_BAD_MAGIC_CHAR, color: BAD_MAGIC_COLOR };
    return { char: G_GOOD_MAGIC_CHAR, color: GOOD_MAGIC_COLOR };
}

/**
 * 物品画成什么。逐字搬自 render() 物品循环（原 478-490 行）的决策部分。
 *
 * 掷骰时序敏感：幻觉时**两次** percent(30)（原代码对 renderChar/renderColor
 * 各调一次，两骰独立）——第一次中而第二次不中时会出现"!' 字形配原色"，
 * 这个怪癖是可观察行为，逐位保留。
 */
export function itemAppearance(item: Item, ctx: EntityAppearanceContext): EntityVisual | null {
    if (ctx.cellVisible) {
        const halledChar = ctx.hallucinating && ctx.cosmetic.percent(30);
        const halledColor = ctx.hallucinating && ctx.cosmetic.percent(30);
        return {
            char: halledChar ? '!' : item.char,
            color: halledColor ? ctx.cosmetic.pick(HALLUCINATION_COLORS) : item.color,
            interactive: true,
        };
    }
    if (ctx.cellHasMemory) {
        // Render memory item faintly
        return { char: item.char, color: '#666666', interactive: false };
    }
    return null;
}

/**
 * 怪物画成什么。逐字搬自 render() 怪物循环（原 493-517 行）的决策部分。
 * hp ≤ 0 不画（原 if (m.hp > 0) 门）；可见时盟友绿 / 睡眠冷蓝；
 * 不可见但心灵感应时画 '#66ccff' 剪影。
 *
 * ✅ UI-1 第 2 条（2026-09-18 登记 deferral；C-7 激活、I-1 钉行为）：CE 对燃烧
 * 怪物的视觉是**发光不是改字形/颜色**——updateLighting() 给非 MONST_FIERY 的
 * 燃烧怪泼 BURNING_CREATURE_LIGHT（Light.c:249-251，fireBoltColor {500,150,0}，
 * 半径 300-400）。那笔光进玩法光网格（tmap.light，Time.c:894 每回合重刷，
 * 参与 VISIBLE/黑暗判定）。web 已在 Game.updateVision 的生物光循环接上
 * paintBurning（commit 6c3a34a，条件 `burningDuration > 0 && !FIERY`，含玩家
 * ——CE handledPlayer 模式）；行为面（光网格含火光、FIERY 不叠加、邻格受光）
 * 由 i_1_interaction.test.ts 钉死。
 * 本函数此后也**永远不做任何事**：禁止自创 CE 没有的"燃烧染色"（用户裁决：
 * 优先还原 CE 的逻辑结构，避免原创差异引起连锁反应）——染色禁令不随激活失效。
 * 形式守卫：ui_1_rendering.test.ts「燃烧状态不改变怪物外观」。
 */
export function monsterAppearance(monster: Monster, ctx: EntityAppearanceContext): EntityVisual | null {
    if (monster.hp <= 0) {
        return null;
    }
    if (ctx.cellVisible) {
        // Dim sleeping monsters slightly, or maybe draw them normally
        let color: string | number = monster.color;
        let char = monster.char;

        if (monster.isAlly) {
            color = '#88ff88'; // green for allies
        } else if (monster.state === MonsterState.ASLEEP) {
            color = 0x6688aa; // deep cold blue/gray if asleep
        }
        if (ctx.hallucinating && ctx.cosmetic.percent(35)) {
            color = ctx.cosmetic.pick(HALLUCINATION_COLORS);
            char = ctx.cosmetic.pick(HALLUCINATION_CHARS);
        }
        return { char, color, interactive: true };
    }
    if (ctx.telepathy) {
        return { char: monster.char, color: '#66ccff', interactive: false };
    }
    return null;
}

/**
 * 玩家画成什么。逐字搬自 render()（原 520 行）：恒可见、金色、无发光描边。
 */
export function playerAppearance(player: Player): EntityVisual {
    return { char: player.char, color: '#ffcc00', interactive: false };
}

/** entityAppearance 接受的三类实体。 */
export type AppearanceEntity = Item | Monster | Player;

function isMonsterEntity(e: AppearanceEntity): e is Monster {
    // Monster 独有 state（MonsterState）；Item/Player/Creature 均无该字段。
    return 'state' in e;
}

function isPlayerEntity(e: AppearanceEntity): e is Player {
    // Player 独有 nutrition（饥饿量表）；Monster/Item 无。
    return 'nutrition' in e;
}

/**
 * 统一入口：任意实体 → 外观（null = 不画）。
 * GameCanvas 的 render 循环按物品/怪物/玩家分流直调三个具体函数
 * （省去逐帧判别）；本函数是给 UI-1 与测试用的单一缝。
 */
export function entityAppearance(entity: AppearanceEntity, ctx: EntityAppearanceContext): EntityVisual | null {
    if (isMonsterEntity(entity)) return monsterAppearance(entity, ctx);
    if (isPlayerEntity(entity)) return playerAppearance(entity);
    return itemAppearance(entity, ctx);
}
