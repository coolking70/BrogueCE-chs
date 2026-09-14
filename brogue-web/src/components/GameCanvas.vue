<script lang="ts">
import { rng, RNGType } from '../engine/Random';
import type { MapScaleMode } from '../engine/Settings';
import { DCOLS, DROWS } from '../types';

/** 地图单元格像素边长（与 setup 内共用，模块级以便 computeMapOffset 使用）。 */
export const TILE_SIZE = 16;

/**
 * 幻觉渲染专用的纯视觉随机：必须走 COSMETIC 流，不得污染玩法（SUBSTANTIVE）流。
 * 渲染次数取决于帧率/窗口大小/玩家是否在看，若留在玩法流会让玩法随渲染而变。
 *
 * 成对用法对齐 CE 的 assureCosmeticRNG / restoreRNG（Rogue.h:1282-1283）：
 * 切到 COSMETIC -> 取数 -> 用完必须切回（try/finally 保证异常路径也恢复）。
 * 导出是为了让确定性测试直接断言"渲染不污染玩法流"（p2_0_seeded_rng.test.ts）。
 */
export function cosmeticPercent(percent: number): boolean {
    rng.setRNG(RNGType.RNG_COSMETIC);
    try {
        return rng.randPercent(percent);
    } finally {
        rng.setRNG(RNGType.RNG_SUBSTANTIVE);
    }
}

export function cosmeticPick<T>(list: readonly T[]): T {
    rng.setRNG(RNGType.RNG_COSMETIC);
    try {
        return list[rng.randRange(0, list.length - 1)]!;
    } finally {
        rng.setRNG(RNGType.RNG_SUBSTANTIVE);
    }
}

/**
 * 地图在画布容器内的居中偏移（P2-4 居中修复）。
 *
 * 只能传**画布容器**的实际尺寸（flex 布局扣除 Sidebar 后的剩余区域），
 * 不能传窗口尺寸（innerWidth/innerHeight）——那会把 340px 侧栏算进居中，
 * 地图整体右移约 170px，右侧被侧栏压住、鼠标命中区随之错位。
 * 导出供测试锁定该口径（p2_4_animation_cadence.test.ts）。
 */
/**
 * 地图在视口中的布局：缩放 + 居中偏移（P2-6 起支持两种缩放模式）。
 *
 * 地图是固定的 DCOLS×DROWS 格、每格 TILE_SIZE 像素（79×16 = 1264px 宽）。
 * 当视口放不下时**必须等比缩小**，否则超出部分会被画布边界硬切——
 * 视觉上表现为"右侧被侧栏挡住一块"，这正是本项目长期未能修复的那个 bug：
 * 旧实现 `Math.max(0, (viewport - map) / 2)` 把负偏移钳成 0，
 * 地图便从 x=0 一路画到 1264 并溢出容器。
 *
 * 实测（侧栏 340px）：窗口 1280 → 切 21 列；1440 → 切 11 列；
 * 1604 才是完整显示的临界点。
 *
 * uniform（默认，= P2-5 现状）：scale 只缩不放（上限 1），避免小地图在大屏上
 * 被放大得糊掉；多余空间留黑边，方格保持正方形。
 *
 * stretch（CE 口径，platform/tiles.c:782-803）：x 方向按 outputWidth/格数、
 * y 方向按 outputHeight/格数**各自铺满**，两方向独立缩放、不保持宽高比，
 * 允许放大、无黑边。CE 用 `(x+1)*W/C - x*W/C` 的整除写法把余数摊到各格、
 * 使相邻格边界严丝合缝；web 用连续缩放 `viewportWidth/mapW` 达成同一效果
 * （右缘恰好 = 容器宽，无 1px 缝隙）。
 *
 * `scale` 是兼容字段，仅 uniform 模式有意义（= scaleX = scaleY）；
 * stretch 模式下两方向缩放不同，请一律使用 scaleX/scaleY。
 */
export function computeMapLayout(
    viewportWidth: number,
    viewportHeight: number,
    mode: MapScaleMode = 'uniform',
): { scale: number; scaleX: number; scaleY: number; offsetX: number; offsetY: number } {
    const mapW = DCOLS * TILE_SIZE;
    const mapH = DROWS * TILE_SIZE;
    if (viewportWidth <= 0 || viewportHeight <= 0) {
        return { scale: 1, scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 };
    }
    if (mode === 'stretch') {
        return {
            scale: 1,
            scaleX: viewportWidth / mapW,
            scaleY: viewportHeight / mapH,
            offsetX: 0,
            offsetY: 0,
        };
    }
    const scale = Math.min(1, viewportWidth / mapW, viewportHeight / mapH);
    return {
        scale,
        scaleX: scale,
        scaleY: scale,
        offsetX: Math.max(0, (viewportWidth - mapW * scale) / 2),
        offsetY: Math.max(0, (viewportHeight - mapH * scale) / 2),
    };
}

/** 兼容旧签名：只取偏移。缩放请用 computeMapLayout。 */
export function computeMapOffset(viewportWidth: number, viewportHeight: number): { offsetX: number; offsetY: number } {
    const { offsetX, offsetY } = computeMapLayout(viewportWidth, viewportHeight);
    return { offsetX, offsetY };
}
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import * as PIXI from 'pixi.js';
import { Application, Text, TextStyle, Graphics, Container } from 'pixi.js';
import { TerrainType } from '../engine/Map/Grid';
import { GasType } from '../engine/Environment/Gas';
import { ColorUtils } from '../engine/Map/Color';
// DCOLS/DROWS 已在上方 <script lang="ts"> 模块块导入（computeMapOffset 用），
// 同一模块内重复声明绑定会报错，这里只取 setup 独有的 Direction。
import { Direction } from '../types';
import { activeGame } from '../engine/Core/Game';
import { inputManager } from '../engine/Input';
import { MonsterState } from '../entities/Monster';
import { displaySettings } from '../engine/Settings';

const canvasContainer = ref<HTMLDivElement | null>(null);
let pixiApp: Application | null = null;
// P2-4：居中/命中区随容器尺寸变化重算（挂载时建立，卸载时断开）
let resizeObserver: ResizeObserver | null = null;
// P2-6：地图缩放模式切换的 watch 停止器（onMounted 内创建，onUnmounted 内停止）
let stopScaleModeWatch: (() => void) | null = null;

// --- Terrain definitions ---
function getTerrainVisual(terrain: TerrainType, isVisible: boolean): { char: string; color: string; bgColor: number | null } {
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

onMounted(async () => {
  if (canvasContainer.value) {
    pixiApp = new Application();

    await pixiApp.init({
      resizeTo: canvasContainer.value,
      backgroundColor: 0x111111,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
    });

    canvasContainer.value.appendChild(pixiApp.canvas);

    const baseStyleOptions = {
      fontFamily: 'Courier New',
      fontSize: TILE_SIZE,
      fill: '#ffffff',
    } as const;

    // P2-4 居中修复：地图居中与鼠标命中区一律基于**画布容器**的实际尺寸。
    // 旧实现用窗口视口尺寸（innerWidth/innerHeight）——把 340px 侧栏算进居中，
    // 地图整体右移约 170px 被侧栏遮挡。offset 在 resize 时由 ResizeObserver
    // 重算（observe 建立于图层创建之后），四个图层与 hitArea 同步更新。
    let offsetX = 0;
    let offsetY = 0;

    // ---------- Pre-allocated tile layer ----------
    // One Graphics for bg rectangles (batch-drawn every frame)
    const bgGraphics = new Graphics();
    bgGraphics.position.set(offsetX, offsetY);

    // One Text sprite per cell, reused every frame
    const tileLayer = new Container();
    tileLayer.position.set(offsetX, offsetY);

    // Pre-allocated cells: tileSprites[x][y]
    const tileSprites: Text[][] = [];
    for (let x = 0; x < DCOLS; x++) {
        tileSprites[x] = [];
        for (let y = 0; y < DROWS; y++) {
            const t = new Text({ text: ' ', style: new TextStyle(baseStyleOptions) });
            t.x = x * TILE_SIZE;
            t.y = y * TILE_SIZE;
            t.visible = false;
            tileLayer.addChild(t);
            tileSprites[x]![y] = t;
        }
    }

    // ---------- Entity layer ----------
    // Fixed number of entity Text sprites (player + max ~30 entities)
    const MAX_ENTITY_SPRITES = 64;
    const entityLayer = new Container();
    entityLayer.position.set(offsetX, offsetY);

    const entitySprites: Text[] = [];
    for (let i = 0; i < MAX_ENTITY_SPRITES; i++) {
        const t = new Text({ text: ' ', style: new TextStyle(baseStyleOptions) });
        t.visible = false;
        entityLayer.addChild(t);
        entitySprites.push(t);
    }

    // ---------- Bolt sprite (for projectile animation) ----------
    const boltSprite = new Text({
        text: '*',
        style: new TextStyle({
            fontFamily: 'Courier New',
            fontSize: 14,
            fontWeight: 'bold',
            fill: '#ffff00',
            dropShadow: { color: '#ffff00', blur: 12, distance: 0, angle: 0, alpha: 0.9 }
        })
    });
    boltSprite.visible = false;
    entityLayer.addChild(boltSprite);

    // Floating text layer (max 8 floaters)
    const MAX_FLOAT_SPRITES = 8;
    const floatLayer = new Container();
    floatLayer.position.set(offsetX, offsetY);

    const floatSprites: Text[] = [];
    for (let i = 0; i < MAX_FLOAT_SPRITES; i++) {
        const ft = new Text({
            text: ' ',
            style: new TextStyle({
                fontFamily: 'Courier New',
                fontSize: 14,
                fontWeight: 'bold',
                fill: '#ffffff',
                stroke: { color: '#000000', width: 2 }
            })
        });
        ft.visible = false;
        floatLayer.addChild(ft);
        floatSprites.push(ft);
    }

    // Add layers in order
    pixiApp.stage.addChild(bgGraphics);
    pixiApp.stage.addChild(tileLayer);
    pixiApp.stage.addChild(entityLayer);
    pixiApp.stage.addChild(floatLayer);

    // 居中偏移与命中区的一次性落地：以容器实际尺寸重算并同步到
    // 四个图层与 stage.hitArea。挂载时调用一次；此后由 ResizeObserver 驱动。
    const applyLayout = () => {
        const el = canvasContainer.value;
        if (!el || !pixiApp) return;
        // 用容器 clientWidth/Height 而非 pixiApp.screen：resizeTo 的渲染器
        // 尺寸要等 Pixi 下一个渲染帧才跟上（queueResize），clientWidth 是
        // 布局完成后的即时真值，且能覆盖非 window 尺寸变化（如侧栏增减）。
        const { scaleX, scaleY, offsetX: ox, offsetY: oy } = computeMapLayout(
            el.clientWidth,
            el.clientHeight,
            displaySettings.mapScaleMode,
        );
        offsetX = ox;
        offsetY = oy;
        // 四个图层同步缩放 + 居中。toLocal 走完整的仿射逆矩阵，x/y 缩放不同
        // （stretch 模式）也会被正确换算，因此指针→格子的映射
        // （pointermove / pointerup）无需另外处理。
        for (const layer of [bgGraphics, tileLayer, entityLayer, floatLayer]) {
            layer.position.set(offsetX, offsetY);
            layer.scale.set(scaleX, scaleY);
        }
        // 命中区 = 画布容器区域（stage 坐标即 CSS 像素，autoDensity）。
        // 旧实现用 window 尺寸，侧栏右侧的点击会被映射到错误的格子。
        pixiApp.stage.hitArea = new PIXI.Rectangle(0, 0, el.clientWidth, el.clientHeight);
    };

    applyLayout();
    // 窗口 resize（容器随之变宽变高）与任何布局变化都会触发 ResizeObserver；
    // 比起 window resize 事件，它还覆盖"窗口不变但布局变"的场景
    // （如侧栏在固定/按比例间切换导致容器宽度变化）。
    resizeObserver = new ResizeObserver(() => applyLayout());
    resizeObserver.observe(canvasContainer.value);

    // P2-6：地图缩放模式切换不改变容器尺寸（ResizeObserver 不会触发），
    // 需显式走同一条 applyLayout 重算路径，设置变更即时生效、无需刷新页面。
    stopScaleModeWatch = watch(() => displaySettings.mapScaleMode, () => applyLayout());

    const game = activeGame;
    // P2-4 动画节奏（决策 E1-修订，CE Time.c:2704 口径）：UI 挂载后启用分步
    // 推进——常规动作（≤100 tick）零插帧、下一渲染帧即完成；慢回合（>100
    // tick）在 100-tick 客观块处暂停 25ms 各一次；自动寻路/探索在引擎侧直接
    // 同步推进（isAutoTraveling），不再每步吃动画。推进进行中输入锁生效。
    // headless（无渲染）环境不挂载本组件，animationEnabled 保持 false，同步推进。
    game.animationEnabled = true;
    inputManager.setCallback((action, data) => {
        game.handlePlayerAction(action, data);
        game.update();
    });

    const render = () => {
        // ---- Background rectangles (batch draw) ----
        bgGraphics.clear();
        const hallucinating = !!game.player.statusDurations.hallucinating;
        const hallucinationColors = ['#ff66ff', '#66ffff', '#ffff66', '#ff9966', '#99ff66'];
        const hallucinationChars = ['*', '?', '!', '~', '&'];

        // ---- Tiles ----
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = game.grid.getCell(x, y);
                const sprite = tileSprites[x]![y]!;

                if (!cell || (!cell.isExplored && !cell.isVisible)) {
                    sprite.visible = false;
                    continue;
                }

                let { char, color, bgColor } = getTerrainVisual(cell.terrain, cell.isVisible);

                // Apply Environmental Overrides (Gas & Fire)
                if (cell.isVisible) {
                    if (cell.isBurning) {
                        char = '*';
                        color = '#ffaa00';
                        bgColor = 0xcc2200;
                    }

                    const gas = game.environment.gasGrid[x]?.[y];
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
                    const light = game.lightMap.getLight(x, y);
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
                    if (hallucinating && cosmeticPercent(15)) {
                        color = cosmeticPick(hallucinationColors);
                        char = cosmeticPick(hallucinationChars);
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

                // Update background rect
                if (bgColor !== null) {
                    bgGraphics.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    bgGraphics.fill({ color: bgColor });
                }

                // Update tile text (avoid unnecessary style object allocation)
                sprite.visible = char !== ' ';
                if (char !== ' ') {
                    if (sprite.text !== char)     sprite.text = char;
                    // @ts-ignore: fill is a standard style property
                    if ((sprite.style as TextStyle).fill !== color) (sprite.style as TextStyle).fill = color;
                }
            }
        }

        // ---- Entities ----
        let entityIdx = 0;

        // Helper to place an entity sprite
        const placeEntity = (
            text: string,
            color: string | number,
            ex: number,
            ey: number,
            isInteractive: boolean = false
        ) => {
            if (entityIdx >= MAX_ENTITY_SPRITES) return;
            const s = entitySprites[entityIdx]!;
            s.text = text;
            (s.style as TextStyle).fill = color as never;
            s.x = ex * TILE_SIZE;
            s.y = ey * TILE_SIZE;

            if (isInteractive) {
                (s.style as TextStyle).dropShadow = {
                    color: color as never,
                    blur: 8,
                    distance: 0,
                    angle: 0,
                    alpha: 0.8,
                };
            } else {
                (s.style as TextStyle).dropShadow = false;
            }

            s.visible = true;
            entityIdx++;
        };

        // Items
        for (const item of game.items) {
            const cell = game.grid.getCell(item.loc.x, item.loc.y);
            if (cell?.isVisible) {
                const renderChar = hallucinating && cosmeticPercent(30) ? '!' : item.char;
                const renderColor = hallucinating && cosmeticPercent(30)
                    ? cosmeticPick(hallucinationColors)
                    : item.color;
                placeEntity(renderChar, renderColor, item.loc.x, item.loc.y, true);
            } else if (cell?.hasMemory) {
                // Render memory item faintly
                placeEntity(item.char, '#666666', item.loc.x, item.loc.y, false);
            }
        }

        // Monsters
        for (const m of game.monsters) {
            if (m.hp > 0) {
                const cell = game.grid.getCell(m.loc.x, m.loc.y);
                const telepathyRevealed = !!game.player.statusDurations.telepathy;
                if (cell?.isVisible) {
                    // Dim sleeping monsters slightly, or maybe draw them normally
                    let renderColor: string | number = m.color;
                    let renderChar = m.char;

                    if (m.isAlly) {
                        renderColor = '#88ff88'; // green for allies
                    } else if (m.state === MonsterState.ASLEEP) {
                        renderColor = 0x6688aa; // deep cold blue/gray if asleep
                    }
                    if (hallucinating && cosmeticPercent(35)) {
                        renderColor = cosmeticPick(hallucinationColors);
                        renderChar = cosmeticPick(hallucinationChars);
                    }
                    
                    placeEntity(renderChar, renderColor, m.loc.x, m.loc.y, true);
                } else if (telepathyRevealed) {
                    placeEntity(m.char, '#66ccff', m.loc.x, m.loc.y, false);
                }
            }
        }

        // Player (always visible)
        placeEntity(game.player.char, '#ffcc00', game.player.loc.x, game.player.loc.y, false);

        // Hide unused entity sprites
        for (let i = entityIdx; i < MAX_ENTITY_SPRITES; i++) {
            entitySprites[i]!.visible = false;
        }

        // ---- Bolt projectile ----
        const boltFrame = game.getCurrentBoltFrame();
        if (boltFrame) {
            boltSprite.text = boltFrame.char;
            const hexColor = '#' + boltFrame.color.toString(16).padStart(6, '0');
            (boltSprite.style as TextStyle).fill = hexColor as never;
            (boltSprite.style as TextStyle).dropShadow = {
                color: hexColor as never,
                blur: 14,
                distance: 0,
                angle: 0,
                alpha: 0.95
            };
            boltSprite.x = boltFrame.x * TILE_SIZE;
            boltSprite.y = boltFrame.y * TILE_SIZE;
            boltSprite.visible = true;
        } else {
            boltSprite.visible = false;
        }

        // ---- Floating texts ----
        let floatIdx = 0;
        for (const ft of game.floatingTexts) {
            if (floatIdx >= MAX_FLOAT_SPRITES) break;
            const s = floatSprites[floatIdx]!;
            s.text = ft.text;
            (s.style as TextStyle).fill = ft.color;
            s.x = (ft.x + 0.5) * TILE_SIZE - s.width / 2;
            s.y = ft.y * TILE_SIZE;
            s.alpha = Math.max(0, ft.life / 30);
            s.visible = true;
            floatIdx++;
        }
        for (let i = floatIdx; i < MAX_FLOAT_SPRITES; i++) {
            floatSprites[i]!.visible = false;
        }
    };

    game.onRenderRequested = render;

    // Deterministic hooks for automation checks.
    (window as Window & { advanceTime?: (ms: number) => void }).advanceTime = (ms: number) => {
        const steps = Math.max(1, Math.round(ms / 100));
        for (let i = 0; i < steps; i++) {
            game.tickReplay();
            if (!game.isTimePaused() && game.autoPath.length > 0) {
                game.stepAutoPath();
            }
            game.update();
        }
    };

    (window as Window & { render_game_to_text?: () => string }).render_game_to_text = () => {
        const telepathyRevealed = !!game.player.statusDurations.telepathy;
        const visibleMonsters = game.monsters
            .filter((m) => {
                const cell = game.grid.getCell(m.loc.x, m.loc.y);
                return m.hp > 0 && (!!cell?.isVisible || telepathyRevealed);
            })
            .map((m) => ({ name: m.name, x: m.loc.x, y: m.loc.y, hp: m.hp }));
        const visibleItems = game.items
            .filter((i) => game.grid.getCell(i.loc.x, i.loc.y)?.isVisible)
            .map((i) => ({ name: i.displayName, x: i.loc.x, y: i.loc.y }));

        return JSON.stringify({
            mode: game.isInventoryOpen ? 'inventory' : (game.isThrowing ? 'throw_target' : 'explore'),
            coordinateSystem: { origin: 'top-left', xAxis: 'right', yAxis: 'down' },
            player: {
                x: game.player.loc.x,
                y: game.player.loc.y,
                hp: game.player.hp,
                nutrition: game.player.nutrition,
                statuses: { ...game.player.statusDurations }
            },
            replay: {
                status: game.replayStatus,
                cursor: game.replayCursor,
                total: game.replayEvents.length
            },
            recordedInputEvents: game.recordedInputEvents.length,
            autoPathLength: game.autoPath.length,
            monsters: visibleMonsters,
            items: visibleItems
        });
    };

    (window as Window & { export_game_recording?: () => string }).export_game_recording = () =>
        JSON.stringify(game.exportRecording());

    (window as Window & { import_game_recording?: (json: string) => void }).import_game_recording = (json: string) => {
        game.loadReplay(JSON.parse(json));
    };

    (window as Window & { run_game_turn?: () => void }).run_game_turn = () => {
        game.update();
    };

    (window as Window & { tick_replay?: () => void }).tick_replay = () => {
        game.tickReplay();
    };

    (window as Window & { force_replay_step?: () => void }).force_replay_step = () => {
        game.replayStep(true);
    };

    pixiApp.canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // Mouse interactions
    pixiApp.stage.eventMode = 'static';
    // hitArea 初值已在 applyLayout 中按容器尺寸设置（含 ResizeObserver 跟随）

    pixiApp.stage.on('pointermove', (e) => {
        const localPt = tileLayer.toLocal(e.global);
        const mapX = Math.floor(localPt.x / TILE_SIZE);
        const mapY = Math.floor(localPt.y / TILE_SIZE);
        if (mapX >= 0 && mapX < DCOLS && mapY >= 0 && mapY < DROWS) {
           game.updateHover(mapX, mapY);
        }
    });

    pixiApp.stage.on('pointerup', (e) => {
        const localPt = tileLayer.toLocal(e.global);
        const mapX = Math.floor(localPt.x / TILE_SIZE);
        const mapY = Math.floor(localPt.y / TILE_SIZE);

        if (mapX >= 0 && mapX < DCOLS && mapY >= 0 && mapY < DROWS) {
           if (e.button === 2) {
               game.handleInspectAt(mapX, mapY);
               return;
           }

           const dx = mapX - game.player.loc.x;
           const dy = mapY - game.player.loc.y;

           if (dx === 0 && dy === 0) {
               inputManager.triggerAction('move');
           } else if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
               let dir = Direction.NO_DIRECTION;
               if (dx === 0 && dy === -1)       dir = Direction.UP;
               else if (dx === 0 && dy === 1)   dir = Direction.DOWN;
               else if (dx === -1 && dy === 0)  dir = Direction.LEFT;
               else if (dx === 1 && dy === 0)   dir = Direction.RIGHT;
               else if (dx === -1 && dy === -1) dir = Direction.UPLEFT;
               else if (dx === 1 && dy === -1)  dir = Direction.UPRIGHT;
               else if (dx === -1 && dy === 1)  dir = Direction.DOWNLEFT;
               else if (dx === 1 && dy === 1)   dir = Direction.DOWNRIGHT;

               if (dir !== Direction.NO_DIRECTION) {
                   inputManager.triggerAction('move', dir);
               }
           } else {
               game.handleMouseTravel(mapX, mapY);
               game.update();
           }
        }
    });

    let pathingTimer = 0;
    // Floating text animation ticker
    pixiApp.ticker.add((ticker) => {
        game.tickReplay();

        // P2-4：驱动分步推进（常规回合一步跑完；慢回合停在暂停点时按
        // pendingPauseMs 节流；推进进行中输入锁生效）
        game.tickAdvancement(ticker.deltaMS);

        if (game.isTimePaused()) {
            return;
        }

        if (game.floatingTexts.length > 0) {
            game.floatingTexts.forEach(ft => ft.update());
            game.floatingTexts = game.floatingTexts.filter(ft => ft.life > 0);
            render();
        }

        // Bolt animation tick
        if (game.tickBoltAnimation()) {
            render();
        }

        if (game.autoPath.length > 0) {
            pathingTimer++;
            if (pathingTimer > 4) { // 60/4 = 15 moves per second
                game.stepAutoPath();
                pathingTimer = 0;
                game.update();
            }
        } else {
            pathingTimer = 0;
        }
    });

    game.update(); // Compute initial FOV and trigger first render
  }
});

onUnmounted(() => {
  // P2-2：组件卸载后没有 ticker 驱动动画了，关闭分步推进并丢弃在途推进，
  // 避免遗留一个只能等 5s 超时才解锁的输入锁
  activeGame.animationEnabled = false;
  activeGame.discardInFlightAdvancement();

  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }

  stopScaleModeWatch?.();
  stopScaleModeWatch = null;

  delete (window as Window & { advanceTime?: (ms: number) => void }).advanceTime;
  delete (window as Window & { render_game_to_text?: () => string }).render_game_to_text;
  delete (window as Window & { export_game_recording?: () => string }).export_game_recording;
  
  if (activeGame.onRenderRequested) {
      activeGame.onRenderRequested = null;
  }
  
  if (pixiApp) {
    pixiApp.destroy(true, { children: true, texture: true });
    pixiApp = null;
  }
});
</script>

<template>
  <div class="game-container" ref="canvasContainer"></div>
</template>

<style scoped>
.game-container {
  width: 100%;
  height: 100vh;
  overflow: hidden;
  background-color: #000;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
