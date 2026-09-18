/**
 * R-1（渲染纯重构轮）：「格子/实体 → 外观」的纯决策函数。
 *
 * 从 GameCanvas.vue 的 render()（原 341-563 行）与 getTerrainVisual
 * （原 126-184 行）**逐字搬运**而来——本轮（R-1）是结构先行、行为逐位不变：
 * 不新增、不修改任何视觉效果。颜色值、字形、优先级、可见/记忆态的处理
 * 全部保持原样，包括那些看起来像缺陷的分支（幻觉物品的双重掷骰、
 * 无渲染分支的 PARALYSIS/METHANE 气体等）——它们是下一轮 UI-1 的落点。
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
import type { LightCell } from '../Lighting/LightMap';
import { MonsterState, type Monster } from '../../entities/Monster';
import type { Player } from '../../entities/Player';
import type { Item } from '../Items/Item';

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
    /** 该格累积光照（无光时 null）。 */
    light: LightCell | null;
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
 * 地形的基础外观（不含气体/光照/幻觉/记忆覆盖）。
 * 逐字搬自 GameCanvas.vue 原 getTerrainVisual（126-184 行）。
 *
 * ⚠️ 登记给 UI-1 的欠账（本轮不修）：NOTHING/WALL/CHASM/LAVA/BOG/
 * CHARRED_FLOOR 以及 C-2/F/G/C-5/B-3 追加的全部地形都落在 default
 * 分支——即 EMBERS/ASH/PLAIN_FIRE（火寿命链）、FORCEFIELD/CRYSTAL_WALL/
 * SACRED_GLYPH（B-3 载体）等目前**没有专属字形/颜色**。
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
 * 一个格子最终画成什么：地形基础外观 + 燃烧/气体/光照/幻觉/记忆覆盖。
 * 逐字搬自 render() 瓦片段（原 349-441 行）的**决策部分**；绘制
 * （bgGraphics 矩形与 Text sprite 更新）仍在 GameCanvas.vue。
 *
 * 返回 null = 该格什么都不画（未探索且不可见——对应渲染层原
 * `sprite.visible = false; continue` 的门）。
 *
 * 掷骰时序敏感：幻觉的 cosmetic 调用次数与顺序（percent(15) → pick 颜色 →
 * pick 字形）逐字保留——COSMETIC 流的消耗序列属于可观察行为
 * （p2_0_seeded_rng 钉过其形态）。
 *
 * ⚠️ 登记给 UI-1 的欠账（本轮不修）：气体渲染只认 POISON/STEAM/CONFUSION/
 * CREEPING_DEATH 四种，G-2/G-3 的 METHANE/PARALYSIS 没有视觉分支。
 */
export function cellAppearance(cell: Cell, ctx: CellAppearanceContext): TerrainVisual | null {
    if (!cell.isExplored && !cell.isVisible) {
        return null;
    }

    let { char, color, bgColor } = terrainAppearance(cell.terrain, cell.isVisible);

    // Apply Environmental Overrides (Gas & Fire)
    if (cell.isVisible) {
        if (cell.isBurning) {
            char = '*';
            color = '#ffaa00';
            bgColor = 0xcc2200;
        }

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
        }
    }

    // Apply dynamic lighting if the cell is currently visible
    // For memory/explored cells, we just dim them significantly.
    if (cell.isVisible) {
        const light = ctx.light;
        if (light && light.intensity > 0) {
            // Blend the text color with the light color
            const baseColorRgb = ColorUtils.hexToRGB(color);

            // We use an Additive/Mix blend depending on light intensity.
            // Brogue uses a complex multiply/add system. Here we'll do a simple proportion mix
            // towards the light color based on intensity, but capped so we don't wash out.
            const finalColorRgb = ColorUtils.mix(baseColorRgb, light.color, light.intensity * 0.8);
            color = ColorUtils.rgbToHex(finalColorRgb);

            if (bgColor !== null) {
                const baseBgRgb = ColorUtils.hexToRGB(bgColor);
                const finalBgRgb = ColorUtils.mix(baseBgRgb, light.color, light.intensity * 0.5);
                bgColor = parseInt(ColorUtils.rgbToHex(finalBgRgb).replace('#', ''), 16);
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
 * ⚠️ 登记给 UI-1 的欠账（本轮不修）：燃烧的怪物没有专属视觉
 * （CE 有 burning 状态显示）；心灵感应剪影没有"地面符号"辅助。
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
