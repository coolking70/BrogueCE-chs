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
import { terrainRandomValues, tickTerrainColors } from '../engine/UI/DancingColors';
import { onMounted, onUnmounted, ref, watch } from 'vue';
import * as PIXI from 'pixi.js';
import { Application, Text, TextStyle, Graphics, Container } from 'pixi.js';
// R-1 渲染纯重构：格子/实体「画什么字符、什么颜色」的决策已抽到
// Appearance.ts 纯函数（ctx 显式注入），本组件只保留 Pixi 绘制。
// 结构守卫（r_1_appearance.test.ts）钉死本文件不得再出现外观决策。
import { ARCANA_TRAJECTORY_FILL, cellAppearance, itemAppearance, rememberedItemAppearance, monsterAppearance, playerAppearance, type CosmeticRng } from '../engine/UI/Appearance';
import { canSeeMonster, canDirectlySeeMonster, canDisplayMonster, monsterInGas } from '../engine/UI/MonsterVisibility';
// DCOLS/DROWS 已在上方 <script lang="ts"> 模块块导入（computeMapOffset 用），
// 同一模块内重复声明绑定会报错，这里只取 setup 独有的 Direction。
import { Direction } from '../types';
import { activeGame } from '../engine/Core/Game';
import { logger } from '../engine/Systems/Logger';
import { inputManager } from '../engine/Input';
import i18next from 'i18next';
import { displaySettings } from '../engine/Settings';
// FE-1：小屏跟随相机（纯显示状态，不进存档/录像）
import { computeMapCamera, cameraState, zoomBy } from '../ui/mapCamera';
// FE-1：触屏手势与目标选择（改状态的输出只经 ui/commands 的录制边界）
import { GestureTracker, type GestureEvent } from '../ui/touchGestures';
import { normalizeMapGlyph } from '../ui/mapGlyph';
import { targetingState, clearAim, targetingTapCommand, type TapCommand, THROW_AIM_FILL, THROW_AIM_STROKE } from '../ui/targeting';
import { dispatch as dispatchCommand, travelTo } from '../ui/commands';

const canvasContainer = ref<HTMLDivElement | null>(null);
let pixiApp: Application | null = null;
const arcanaPrompt = ref('');
// P2-4：居中/命中区随容器尺寸变化重算（挂载时建立，卸载时断开）
let resizeObserver: ResizeObserver | null = null;
// P2-6：地图缩放模式切换的 watch 停止器（onMounted 内创建，onUnmounted 内停止）
let stopScaleModeWatch: (() => void) | null = null;
let stopCameraWatch: (() => void) | null = null;
// FE-1：触屏手势监听的卸载函数
let removeTouchListeners: (() => void) | null = null;

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
    // FE-1：相机跟随的上次焦点与当前文字纹理分辨率
    let lastFocusX = -1;
    let lastFocusY = -1;
    let textResolution = window.devicePixelRatio || 1;
    let layoutScaleX = 1;
    let layoutScaleY = 1;

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
    const arcanaCursor = new Graphics();
    entityLayer.addChild(arcanaCursor);

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
        const base = computeMapLayout(
            el.clientWidth,
            el.clientHeight,
            displaySettings.mapScaleMode,
        );
        // FE-1：桌面口径（上面的 computeMapLayout）每格 ≥ 12px 时原样使用；
        // 小屏下才叠加跟随相机（以玩家为中心 + 用户平移/缩放，夹在地图边界内）。
        const focus = activeGame.player?.loc ?? { x: 0, y: 0 };
        const cam = computeMapCamera(
            el.clientWidth, el.clientHeight, base, DCOLS, DROWS, TILE_SIZE,
            focus, cameraState.zoom, { x: cameraState.panX, y: cameraState.panY },
        );
        cameraState.follow = cam.follow;
        if (cameraState.panX !== cam.panX) cameraState.panX = cam.panX;
        if (cameraState.panY !== cam.panY) cameraState.panY = cam.panY;
        lastFocusX = focus.x;
        lastFocusY = focus.y;
        const { scaleX, scaleY } = cam;
        layoutScaleX = scaleX;
        layoutScaleY = scaleY;
        offsetX = cam.offsetX;
        offsetY = cam.offsetY;
        // 放大（scale > 1）时按比例提高文字纹理分辨率，避免字形被拉糊。
        const wantedResolution = Math.min(4, (window.devicePixelRatio || 1) * Math.max(1, scaleX, scaleY));
        if (wantedResolution !== textResolution) {
            textResolution = wantedResolution;
            for (const column of tileSprites) for (const t of column) t.resolution = wantedResolution;
            for (const t of entitySprites) t.resolution = wantedResolution;
        }
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
    // FE-1：缩放级 / 平移量变化同样走 applyLayout（纯显示，不影响玩法）。
    stopCameraWatch = watch(() => [cameraState.zoom, cameraState.panX, cameraState.panY], () => applyLayout());

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
    inputManager.setUnboundKeyCallback(() => {
        if (!game.isAutoTraveling()) return;
        game.handlePlayerAction('interrupt_auto');
        game.update();
    });

    const render = () => {
        // FE-1：玩家移动后相机回到跟随（清掉临时平移）并重算视口
        if (game.player.loc.x !== lastFocusX || game.player.loc.y !== lastFocusY) {
            cameraState.panX = 0;
            cameraState.panY = 0;
            applyLayout();
        }
        // ---- Background rectangles (batch draw) ----
        bgGraphics.clear();
        arcanaCursor.clear();
        const selection = game.pendingArcana;
        arcanaPrompt.value = selection ? i18next.t('arcana.target_prompt', {
            interpolation: { escapeValue: false }, // Vue renders text; keep charge slash readable.
            name: selection.item.displayName,
            defaultValue: '{{name}} — hjklyubn / arrows: aim · Tab: next · Enter / click: cast · Esc: cancel'
        }) : '';
        if (selection) {
            const preview = game.getArcanaPreview();
            if (preview?.maxDistance !== null && preview?.maxDistance !== undefined) {
                arcanaPrompt.value += i18next.t('arcana.blink_range', { distance: preview.maxDistance });
            }
            for (const p of preview?.path ?? []) {
                arcanaCursor.rect(p.x * TILE_SIZE, p.y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                    .fill(ARCANA_TRAJECTORY_FILL);
            }
            arcanaCursor.rect(selection.cursor.x * TILE_SIZE, selection.cursor.y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                .stroke({ width: 2, color: 0xdddddd });
        }
        // FE-1：触屏投掷的 UI 瞄准格（纯绘制；投掷模式结束即清除）
        const aim = targetingState.aim;
        if (aim && !game.isThrowing) clearAim();
        else if (aim && !selection) {
            arcanaCursor.rect(aim.x * TILE_SIZE, aim.y * TILE_SIZE, TILE_SIZE, TILE_SIZE).fill(THROW_AIM_FILL);
            arcanaCursor.rect(aim.x * TILE_SIZE, aim.y * TILE_SIZE, TILE_SIZE, TILE_SIZE)
                .stroke({ width: 2, color: THROW_AIM_STROKE });
        }
        const hallucinating = !!game.player.statusDurations.hallucinating;
        const telepathyRevealed = !!game.player.statusDurations.telepathy;
        // 幻觉等纯视觉随机走 COSMETIC 流（见模块块 cosmeticPercent/cosmeticPick），
        // 以 ctx 注入外观纯函数——本组件不再做任何"画什么"的决策。
        const cosmetic: CosmeticRng = { percent: cosmeticPercent, pick: cosmeticPick };

        // ---- Tiles ----
        // UI-1 第 3 条接线：地面物品索引（探测魔法符号需要知道格子上有什么）。
        // 每帧建一次 O(items)，避免 3713 格 × 线性扫描。
        const itemAtCell = new Map<string, (typeof game.items)[number]>();
        const gasBackgrounds = new Map<string, number>();
        for (const item of game.items) {
            itemAtCell.set(`${item.loc.x},${item.loc.y}`, item);
        }

        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = game.grid.getCell(x, y);
                const sprite = tileSprites[x]![y]!;

                // 该格画什么（字形/颜色/气体/光照/记忆/幻觉/探测符号）全部由
                // 纯函数决定；null = 未探索且不可见，什么都不画。
                // lightChannels = CE tmap.light 三通道（LightMap.lightAt），
                // UI-1 第 7 条起渲染按 CE 乘法消费；groundItem/carriedItem =
                // 探测魔法符号的 ctx 取值（web Monster 无载物载体，恒 null 留形）。
                const visual = cell
                    ? cellAppearance(cell, {
                        gas: game.environment.gasGrid[x]?.[y],
                        lightChannels: game.lightMap.lightAt(x, y),
                        dancingLightChannels: game.lightMap.renderLightAt(x, y),
                        terrainRandomValues: terrainRandomValues(cell, game.grid),
                        flareChannels: game.flareLightAt(x, y),
                        flashChannels: game.terrainFlashAt(x, y),
                        depth: game.depth,
                        groundItem: itemAtCell.get(`${x},${y}`) ?? null,
                        carriedItem: null,
                        hallucinating,
                        cosmetic,
                    })
                    : null;

                if (!visual) {
                    sprite.visible = false;
                    continue;
                }

                const { char, color, bgColor } = visual;
                if (bgColor !== null) {
                    gasBackgrounds.set(`${x},${y}`, bgColor);
                }

                // Update background rect
                if (bgColor !== null) {
                    bgGraphics.rect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);
                    bgGraphics.fill({ color: bgColor });
                }

                // Update tile text (avoid unnecessary style object allocation)
                sprite.visible = char !== ' ';
                if (char !== ' ') {
                    const text = normalizeMapGlyph(char);
                    if (sprite.text !== text) sprite.text = text;
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
            s.text = normalizeMapGlyph(text);
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
        for (let x = 0; x < DCOLS; x++) for (let y = 0; y < DROWS; y++) {
            const cell = game.grid.getCell(x, y);
            if (cell) {
                const visual = rememberedItemAppearance(cell);
                if (visual) placeEntity(visual.char, visual.color, x, y, visual.interactive);
            }
        }
        for (const item of game.items) {
            const cell = game.grid.getCell(item.loc.x, item.loc.y);
            const visual = itemAppearance(item, {
                cellVisible: !!cell?.isVisible,
                cellHasMemory: !!cell?.hasMemory,
                telepathy: telepathyRevealed,
                hallucinating,
                cosmetic,
            });
            if (visual && cell?.isVisible) {
                placeEntity(visual.char, visual.color, item.loc.x, item.loc.y, visual.interactive);
            }
        }

        // Monsters
        for (const m of game.monsters) {
            const cell = game.grid.getCell(m.loc.x, m.loc.y);
            const direct = canDirectlySeeMonster(game.player, game.grid, m);
            const known = canSeeMonster(game.player, game.grid, m);
            const visual = monsterAppearance(m, {
                cellVisible: !!cell?.isVisible,
                cellHasMemory: !!cell?.hasMemory,
                telepathy: telepathyRevealed || m.hasStatus('entranced'),
                hallucinating,
                cosmetic,
                monsterVisibility: direct ? 'direct' : known ? 'known' : canDisplayMonster(game.player, game.grid, m) ? 'marker' : 'hidden',
                gasBackground: monsterInGas(game.grid, m)
                    ? gasBackgrounds.get(`${m.loc.x},${m.loc.y}`) : undefined,
            });
            if (visual) {
                placeEntity(visual.char, visual.color, m.loc.x, m.loc.y, visual.interactive);
            }
        }

        // Player (always visible)
        const playerVisual = playerAppearance(game.player);
        placeEntity(playerVisual.char, playerVisual.color, game.player.loc.x, game.player.loc.y, playerVisual.interactive);

        // Hide unused entity sprites
        for (let i = entityIdx; i < MAX_ENTITY_SPRITES; i++) {
            entitySprites[i]!.visible = false;
        }

        // ---- Bolt projectile ----
        const boltFrame = game.getCurrentBoltFrame();
        if (boltFrame) {
            boltSprite.text = normalizeMapGlyph(boltFrame.char);
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
            if (!displaySettings.showDamageNumbers && /^-\d+$/.test(ft.text)) continue;
            if (floatIdx >= MAX_FLOAT_SPRITES) break;
            const s = floatSprites[floatIdx]!;
            s.text = normalizeMapGlyph(ft.text);
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
            if (!game.replayRecording && !game.isTimePaused() && game.isAutoTraveling()) {
                game.stepAutoPath();
            }
            game.update();
        }
    };

    (window as Window & { render_game_to_text?: () => string }).render_game_to_text = () => {
        const visibleMonsters = game.monsters
            .filter((m) => canSeeMonster(game.player, game.grid, m))
            .map((m) => ({ name: m.name, x: m.loc.x, y: m.loc.y, hp: m.hp,
                maxHp: m.maxHp, weaknessAmount: m.weaknessAmount, maxStatus: { ...m.maxStatus }, accuracy: m.accuracy, defense: m.defense, damage: m.damageString,
                newPowerCount: m.newPowerCount, totalPowerCount: m.totalPowerCount,
                targetCorpseLoc: m.targetCorpseLoc && { ...m.targetCorpseLoc }, targetCorpseName: m.targetCorpseName,
                corpseAbsorptionCounter: m.corpseAbsorptionCounter, isAbsorbing: m.isAbsorbing,
                absorptionFlags: m.absorptionFlags, absorbBehavior: m.absorbBehavior, absorptionBolt: m.absorptionBolt,
                wasNegated: m.wasNegated, negated: m.displaysNegation, mutation: m.mutation?.id ?? null,
                behaviorFlags: [...m.behaviorFlags], abilityFlags: [...m.abilityFlags], bolts: [...m.bolts],
                typeId: m.typeId, isAlly: m.isAlly, boundToPlayer: m.boundToPlayer,
                dominated: m.dominated, isCaged: m.isCaged, leaderId: m.leader?.id ?? null,
                discordant: m.getStatusDuration('discordant'), entranced: m.getStatusDuration('entranced'),
                doesNotTrackLeader: m.doesNotTrackLeader, ticksUntilTurn: m.ticksUntilTurn,
                poisonAmount: m.poisonAmount, poisoned: m.getStatusDuration('poisoned'),
                shield: m.getStatusDuration('shielded'), maxShield: m.maxShield }));
        const revealedLocations = game.monsters
            .filter((m) => !canSeeMonster(game.player, game.grid, m) && canDisplayMonster(game.player, game.grid, m))
            .map((m) => ({ x: m.loc.x, y: m.loc.y, marker: 'x' }));
        const visibleItems = game.items
            .filter((i) => game.grid.getCell(i.loc.x, i.loc.y)?.isVisible)
            .map((i) => ({ name: i.displayName, x: i.loc.x, y: i.loc.y }));

        return JSON.stringify({
            seed: game.currentSeed,
            acknowledgment: logger.pendingAcknowledgment?.text ?? null,
            mode: game.pendingEnchantment ? 'enchantment_target' : game.pendingArcana ? 'arcana_target' : game.isInventoryOpen ? 'inventory' : (game.isThrowing ? 'throw_target' : 'explore'),
            enchantmentTargets: game.pendingEnchantment
                ? game.player.inventory.items.filter(item => game.canEnchantTarget(item)).map(item => ({ id: item.id, name: item.displayName })) : [],
            arcanaPreview: game.getArcanaPreview(),
            arcanaTarget: game.pendingArcana ? { name: game.pendingArcana.item.displayName, ...game.pendingArcana.cursor } : null,
            coordinateSystem: { origin: 'top-left', xAxis: 'right', yAxis: 'down' },
            player: {
                weaknessAmount: game.player.weaknessAmount, effectiveStrength: game.player.effectiveStrength, maxStatus: { ...game.player.maxStatus },
                x: game.player.loc.x,
                y: game.player.loc.y,
                hp: game.player.hp,
                nutrition: game.player.nutrition,
                poisonAmount: game.player.poisonAmount,
                maxShield: game.player.maxShield,
                statuses: { ...game.player.statusDurations }
            },
            replay: {
                status: game.replayStatus,
                cursor: game.replayCursor,
                total: game.replayEvents.length
            },
            recordedInputEvents: game.recordedInputEvents.length,
            // FE-1：自动化验收用的只读补充——已知（见过/记得）的楼梯位置与背包清单
            depth: game.depth,
            knownStairs: (() => {
                const s = game.levelSeeds[game.depth - 1];
                const known = (p?: { x: number; y: number }) => {
                    const c = p ? game.grid.getCell(p.x, p.y) : undefined;
                    return p && c && (c.isVisible || c.hasMemory) ? { x: p.x, y: p.y } : null;
                };
                return { down: known(s?.downStairsLoc), up: known(s?.upStairsLoc) };
            })(),
            inventory: game.player.inventory.items.map((i) => ({ letter: i.inventoryLetter, name: i.displayName, category: i.category })),
            isThrowing: game.isThrowing,
            referenceScreen: game.referenceScreen,
            // 画布内格子 → CSS 像素：x = offsetX + (cell + 0.5) * tile * scaleX
            mapLayout: { offsetX, offsetY, scaleX: layoutScaleX, scaleY: layoutScaleY, tile: TILE_SIZE, follow: cameraState.follow },
            autoPathLength: game.autoPath.length,
            monsters: visibleMonsters,
            revealedLocations,
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
        // FE-1：触屏拖动是平移相机，不应让悬停提示跟着手指闪；触屏查看走长按。
        if (e.pointerType !== 'mouse') return;
        const localPt = tileLayer.toLocal(e.global);
        const mapX = Math.floor(localPt.x / TILE_SIZE);
        const mapY = Math.floor(localPt.y / TILE_SIZE);
        if (mapX >= 0 && mapX < DCOLS && mapY >= 0 && mapY < DROWS) {
           game.updateHover(mapX, mapY);
        } else {
           game.clearHover();
        }
    });
    pixiApp.canvas.addEventListener('pointerleave', () => game.clearHover());

    // FE-1：触屏目标选择的命令落地（全部经 ui/commands 的录制边界）。
    const runTapCommand = (cmd: TapCommand) => {
        if (cmd.kind === 'none') return;
        if (cmd.kind === 'aim') {
            targetingState.aim = { x: cmd.x, y: cmd.y };
            render(); // 纯显示：立即画出瞄准格
            return;
        }
        if (cmd.kind === 'execute') {
            clearAim();
            travelTo(cmd.data.x, cmd.data.y);
            return;
        }
        if (cmd.action === 'move') dispatchCommand('move', cmd.data);
        else dispatchCommand(cmd.action);
    };

    /**
     * 一次"点选地图格"的完整语义（鼠标左/右键与触屏单击共用）。
     * 鼠标路径与 v0.1.0 完全一致，仅一处修正：投掷模式下点相邻格原先会被当成
     * "移动"（审查 P-18），现在与点远处格一样经 mouse_travel 投掷。
     * 触屏在投掷/法杖瞄准时改为"先瞄准、再确认"（ui/targeting.ts）。
     */
    const activateCell = (mapX: number, mapY: number, button: number, pointer: 'mouse' | 'touch') => {
        if (mapX < 0 || mapX >= DCOLS || mapY < 0 || mapY >= DROWS) return;
        if (game.pendingArcana) {
            if (pointer === 'touch') {
                runTapCommand(targetingTapCommand('arcana', { x: mapX, y: mapY }, null, game.pendingArcana.cursor, game.player.loc));
                return;
            }
            if (button === 2) inputManager.triggerAction('escape');
            else if (button === 0) {
                game.executeCommand('mouse_travel', { x: mapX, y: mapY });
                game.update();
            }
            return; // Adjacent/origin clicks also belong to spell selection.
        }
        if (button === 2) {
            game.handleInspectAt(mapX, mapY);
            return;
        }

        if (game.isThrowing && game.throwItemTarget && !game.isInventoryOpen) {
            if (pointer === 'touch') {
                runTapCommand(targetingTapCommand('throw', { x: mapX, y: mapY }, targetingState.aim, null, game.player.loc));
                return;
            }
            if (mapX !== game.player.loc.x || mapY !== game.player.loc.y) {
                game.executeCommand('mouse_travel', { x: mapX, y: mapY });
                game.update();
            }
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
            game.executeCommand('mouse_travel', { x: mapX, y: mapY });
            game.update();
        }
    };

    pixiApp.stage.on('pointerup', (e) => {
        // FE-1：触屏/触控笔由下方手势识别器处理（区分单击/长按/拖动/捏合）
        if (e.pointerType !== 'mouse') return;
        const localPt = tileLayer.toLocal(e.global);
        activateCell(Math.floor(localPt.x / TILE_SIZE), Math.floor(localPt.y / TILE_SIZE), e.button, 'mouse');
    });

    // ---------- FE-1：触屏手势（单击 / 长按查看 / 单指平移 / 双指缩放） ----------
    const gestures = new GestureTracker();
    const canvasEl = pixiApp.canvas;
    const cellAtClient = (clientX: number, clientY: number) => {
        const rect = canvasEl.getBoundingClientRect();
        const localPt = tileLayer.toLocal(new PIXI.Point(clientX - rect.left, clientY - rect.top));
        return { x: Math.floor(localPt.x / TILE_SIZE), y: Math.floor(localPt.y / TILE_SIZE) };
    };
    const handleGestures = (events: GestureEvent[]) => {
        for (const ev of events) {
            if (ev.type === 'tap') {
                const cell = cellAtClient(ev.x, ev.y);
                activateCell(cell.x, cell.y, 0, 'touch');
            } else if (ev.type === 'longpress') {
                // 与桌面右键同一条只读路径：悬停描述 + 详情面板（不产生命令）
                const cell = cellAtClient(ev.x, ev.y);
                if (cell.x >= 0 && cell.x < DCOLS && cell.y >= 0 && cell.y < DROWS) {
                    game.updateHover(cell.x, cell.y);
                    game.handleInspectAt(cell.x, cell.y);
                    navigator.vibrate?.(15);
                }
            } else if (ev.type === 'pan') {
                if (cameraState.follow) {
                    cameraState.panX += ev.dx;
                    cameraState.panY += ev.dy;
                }
            } else if (ev.type === 'pinch') {
                zoomBy(ev.factor);
            }
        }
    };
    let longPressTimer = 0;
    const isTouchLike = (e: PointerEvent) => e.pointerType === 'touch' || e.pointerType === 'pen';
    const onTouchDown = (e: PointerEvent) => {
        if (!isTouchLike(e)) return;
        e.preventDefault();
        try { canvasEl.setPointerCapture?.(e.pointerId); } catch { /* 合成事件无活动指针 */ }
        handleGestures(gestures.down(e.pointerId, e.clientX, e.clientY, performance.now()));
        if (!longPressTimer) {
            longPressTimer = window.setInterval(() => {
                handleGestures(gestures.poll(performance.now()));
                if (!gestures.active) { window.clearInterval(longPressTimer); longPressTimer = 0; }
            }, 50);
        }
    };
    const onTouchMove = (e: PointerEvent) => {
        if (!isTouchLike(e)) return;
        handleGestures(gestures.move(e.pointerId, e.clientX, e.clientY));
    };
    const onTouchUp = (e: PointerEvent) => {
        if (!isTouchLike(e)) return;
        handleGestures(gestures.up(e.pointerId, performance.now()));
    };
    const onTouchCancel = (e: PointerEvent) => {
        if (!isTouchLike(e)) return;
        gestures.cancel(e.pointerId);
    };
    canvasEl.addEventListener('pointerdown', onTouchDown);
    canvasEl.addEventListener('pointermove', onTouchMove);
    canvasEl.addEventListener('pointerup', onTouchUp);
    canvasEl.addEventListener('pointercancel', onTouchCancel);
    removeTouchListeners = () => {
        window.clearInterval(longPressTimer);
        canvasEl.removeEventListener('pointerdown', onTouchDown);
        canvasEl.removeEventListener('pointermove', onTouchMove);
        canvasEl.removeEventListener('pointerup', onTouchUp);
        canvasEl.removeEventListener('pointercancel', onTouchCancel);
    };

    let pathingTimer = 0;
    let colorTimer = 0;
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
        const boltChanged = game.tickBoltAnimation();
        const flareChanged = game.tickFlareAnimation(ticker.deltaMS);
        const terrainChanged = tickTerrainColors(game.grid, ticker.deltaMS, game.depth);
        colorTimer += ticker.deltaMS;
        const lightChanged = colorTimer >= 50;
        if (lightChanged) { colorTimer %= 50; game.lightMap.dance(); }
        if (boltChanged || flareChanged || terrainChanged || lightChanged) render();

        if (!game.replayRecording && game.isAutoTraveling()) {
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
  stopCameraWatch?.();
  stopCameraWatch = null;
  removeTouchListeners?.();
  removeTouchListeners = null;
  clearAim();

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
  <div class="game-container" ref="canvasContainer">
    <div v-if="arcanaPrompt" class="arcana-prompt" role="status">{{ arcanaPrompt }}</div>
  </div>
</template>

<style scoped>
.arcana-prompt {
  position: absolute;
  top: 52px;
  left: 12px;
  right: 12px;
  z-index: 1;
  padding: 8px;
  color: #ddd;
  background: #181818e8;
  pointer-events: none;
}
/* FE-1：紧凑模式下由 TargetBar 显示触屏版提示与确认/取消按钮 */
@media (max-width: 1023px), (max-height: 599px) {
  .arcana-prompt { display: none; }
}
.game-container {
  position: relative;
  width: 100%;
  height: 100%;
  touch-action: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-touch-callout: none;
  overflow: hidden;
  background-color: #000;
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
