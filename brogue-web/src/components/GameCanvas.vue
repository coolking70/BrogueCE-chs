<script lang="ts">
import { rng, RNGType } from '../engine/Random';

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
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import * as PIXI from 'pixi.js';
import { Application, Text, TextStyle, Graphics, Container } from 'pixi.js';
import { TerrainType } from '../engine/Map/Grid';
import { GasType } from '../engine/Environment/Gas';
import { ColorUtils } from '../engine/Map/Color';
import { DCOLS, DROWS, Direction } from '../types';
import { activeGame } from '../engine/Core/Game';
import { inputManager } from '../engine/Input';
import { MonsterState } from '../entities/Monster';

const canvasContainer = ref<HTMLDivElement | null>(null);
let pixiApp: Application | null = null;
const TILE_SIZE = 16;

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

    // Compute centering offset
    const offsetX = Math.max(0, (window.innerWidth  - DCOLS * TILE_SIZE) / 2);
    const offsetY = Math.max(0, (window.innerHeight - DROWS * TILE_SIZE) / 2);

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

    const game = activeGame;
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
    pixiApp.stage.hitArea = new PIXI.Rectangle(0, 0, window.innerWidth, window.innerHeight);

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
    pixiApp.ticker.add(() => {
        game.tickReplay();

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
