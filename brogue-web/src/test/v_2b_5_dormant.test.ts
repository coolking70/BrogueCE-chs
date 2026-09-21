/**
 * src/test/v_2b_5_dormant.test.ts — V-2b-5 休眠唤醒 + horde 接线轮
 *
 * 覆盖四块（每条用例头注回答"在什么实现缺陷下翻红"——§7 对抗性要求二）：
 *   A. 数据钉死：7 地形 / 4 新 DF / 8 蓝图 ≡ CE 原表（结构性穷尽）。
 *   B. toggleMonsterDormancy 双向（CE Monsters.c:4156-4210）。
 *   C. DFF_ACTIVATE_DORMANT_MONSTER 的唤醒消费（CE Architect.c:3487-3496），
 *      含 blockingMap 半句与原点半句两个独立断言。
 *   D. 生成接线：machineHome / 休眠怪入 dormantMonsters（CE :1661 / :1655-1659）。
 *
 * CE 依据（BrogueCE-master，只读）：
 *   - Monsters.c:4156-4210 toggleMonsterDormancy（双向 + 占用重选址 + 200 tick）
 *   - Architect.c:1655-1661 MF_MONSTERS_DORMANT 置休眠 + 否定条件 + machineHome
 *   - Architect.c:3487-3496 spawnDungeonFeature 的唤醒段（原点 ∨ blockingMap）
 *   - Architect.c:1591-1599 MF_GENERATE_HORDE → spawnHorde(0, loc, …)
 *   - Globals.c:352/356/357/361/366/551/559 七条 tile 行
 *   - Globals.c:723/818/872/876 四条 DF 目录行；Rogue.h:1576/1666/1720/1724
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { rng } from '../engine/Random';
import {
    DungeonLayer as L, DRAW_PRIORITY, Grid,
    TERRAIN_HOME_LAYER, TerrainType as C,
} from '../engine/Map/Grid';
import {
    TERRAIN_FLAGS,
    T_OBSTRUCTS_PASSABILITY, T_OBSTRUCTS_ITEMS, T_OBSTRUCTS_GAS,
    T_OBSTRUCTS_SURFACE_EFFECTS, T_OBSTRUCTS_EVERYTHING,
    TM_STAND_IN_TILE, TM_VANISHES_UPON_PROMOTION, TM_IS_WIRED,
    TM_CONNECTS_LEVEL, TM_PROMOTES_ON_ITEM_PICKUP, TM_PROMOTES_ON_PLAYER_ENTRY,
    TM_LIST_IN_SIDEBAR, TM_VISUALLY_DISTINCT,
} from '../engine/Map/TerrainCatalog';
import { LightKind } from '../engine/Map/LightCatalog';
import {
    DF, DFF_ACTIVATE_DORMANT_MONSTER, DFF_TREAT_AS_BLOCKING, DF_MISSING_TILES,
    DUNGEON_FEATURE_CATALOG,
} from '../engine/Map/DungeonFeatureCatalog';
import {
    setDormantAwakener, spawnDungeonFeature, catalogFeature, type DungeonFeature,
} from '../engine/Map/DungeonFeature';
import type { BlueprintDef, FeatureDef } from '../engine/Generator/BlueprintEngine';
import blueprintData from '../data/blueprints.json';
import monsterDataJson from '../data/monsters.json';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import type { Game } from '../engine/Core/Game';

const monsterData = monsterDataJson as unknown as MonsterData[];

function makeMonster(x: number, y: number, id = 'rat'): Monster {
    const data = monsterData.find(m => m.id === id);
    if (!data) throw new Error(`monsters.json 缺 ${id}`);
    return new Monster(x, y, data);
}

/** 在生成图上找一块 3×3 全 FLOOR 的平地（C 组多格 DF 的落点前提）。 */
function findFloorPatch(grid: Grid): { x: number; y: number } | null {
    for (let x = 2; x < grid.width - 2; x++) {
        for (let y = 2; y < grid.height - 2; y++) {
            let ok = true;
            for (let dx = -1; dx <= 1 && ok; dx++) {
                for (let dy = -1; dy <= 1 && ok; dy++) {
                    const cell = grid.getCell(x + dx, y + dy);
                    if (!cell || cell.terrain !== C.FLOOR) ok = false;
                }
            }
            if (ok) return { x, y };
        }
    }
    return null;
}

/** 把一只怪造成"机器休眠怪"的测试形态：入 monsters → 立即睡下。 */
function makeDormant(game: Game, x: number, y: number, id = 'rat'): Monster {
    const mon = makeMonster(x, y, id);
    game.monsters.push(mon);
    mon.machineHome = 99; // 模拟"机器生成"（真实路径见 D 组的统计断言）
    game.toggleMonsterDormancy(mon);
    return mon;
}

/** 直呼 private 的唤醒判定（原点半句的独立测口，见 C2）。 */
function awakenAt(game: Game, origin: { x: number; y: number }, built: readonly { x: number; y: number }[]): void {
    (game as unknown as {
        awakenDormantMonstersAt(o: { x: number; y: number }, b: readonly { x: number; y: number }[]): void;
    }).awakenDormantMonstersAt(origin, built);
}

// ══════════════════════════════════════════════════════════════════════════
// A. 数据钉死
// ══════════════════════════════════════════════════════════════════════════

describe('V-2b-5 A：七个休眠载体地形 ≡ CE Globals.c 原行', () => {
    it('A1 逐字段钉死（flags/mech/ignite/fire/discover/promote/glow/prio/home）', () => {
        // 翻红条件：任何一列抄错——特别是 promoteType/discoverType 放错列
        //（STATUE_INSTACRACK 的历史错误形态，见 A2）。
        const STATUE_FLAGS =
            T_OBSTRUCTS_PASSABILITY | T_OBSTRUCTS_ITEMS | T_OBSTRUCTS_GAS |
            T_OBSTRUCTS_SURFACE_EFFECTS;
        const STATUE_MECH =
            TM_STAND_IN_TILE | TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED;
        const cases: Array<[C, { flags: number; mech: number; fire: string; discover: string; promote: string; prio: number; glow: number }]> = [
            [C.ALTAR_SWITCH, {
                flags: T_OBSTRUCTS_SURFACE_EFFECTS,
                mech: TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_ITEM_PICKUP |
                    TM_LIST_IN_SIDEBAR | TM_VISUALLY_DISTINCT,
                fire: '', discover: '', promote: 'DF_ALTAR_INERT',
                prio: 17, glow: LightKind.CANDLE_LIGHT,
            }], // Globals.c:366（fireType/discoverType 两列都是 0）
            [C.MACHINE_TRIGGER_FLOOR, {
                flags: 0,
                mech: TM_VANISHES_UPON_PROMOTION | TM_IS_WIRED | TM_PROMOTES_ON_PLAYER_ENTRY,
                fire: 'DF_PLAIN_FIRE', discover: '', promote: '',
                prio: 95, glow: 0,
            }], // Globals.c:361
            [C.STATUE_DORMANT, {
                flags: STATUE_FLAGS, mech: STATUE_MECH,
                fire: 'DF_PLAIN_FIRE', discover: '', promote: 'DF_CRACKING_STATUE',
                prio: 0, glow: 0,
            }], // Globals.c:352
            [C.STATUE_DORMANT_DOORWAY, {
                flags: STATUE_FLAGS,
                mech: STATUE_MECH | TM_CONNECTS_LEVEL,
                fire: 'DF_PLAIN_FIRE', discover: '', promote: 'DF_CRACKING_STATUE',
                prio: 0, glow: 0,
            }], // Globals.c:551（比 STATUE_DORMANT 多 CONNECTS_LEVEL）
            [C.WALL_MONSTER_DORMANT, {
                flags: T_OBSTRUCTS_EVERYTHING, mech: STATUE_MECH,
                fire: 'DF_PLAIN_FIRE', discover: '', promote: 'DF_WALL_SHATTER',
                prio: 0, glow: 0,
            }], // Globals.c:357
            [C.RAT_TRAP_WALL_DORMANT, {
                flags: T_OBSTRUCTS_EVERYTHING, mech: STATUE_MECH,
                fire: 'DF_PLAIN_FIRE', discover: '', promote: 'DF_WALL_CRACK',
                prio: 0, glow: 0,
            }], // Globals.c:559
            [C.TURRET_DORMANT, {
                flags: T_OBSTRUCTS_EVERYTHING, mech: STATUE_MECH,
                fire: 'DF_PLAIN_FIRE', discover: '', promote: 'DF_TURRET_EMERGE',
                prio: 0, glow: 0,
            }], // Globals.c:356
        ];
        for (const [t, want] of cases) {
            const e = TERRAIN_FLAGS[t]!;
            const nm = C[t];
            expect(e.flags, `${nm}.flags`).toBe(want.flags);
            expect(e.mechFlags, `${nm}.mechFlags`).toBe(want.mech);
            expect(e.chanceToIgnite, `${nm}.chanceToIgnite`).toBe(0);
            expect(e.fireType, `${nm}.fireType`).toBe(want.fire);
            expect(e.discoverType, `${nm}.discoverType（CE 该列抄进 promoteType 即红）`).toBe(want.discover);
            expect(e.promoteType, `${nm}.promoteType`).toBe(want.promote);
            expect(e.promoteChance, `${nm}.promoteChance`).toBe(0);
            expect(e.glowLight, `${nm}.glowLight`).toBe(want.glow);
            expect(DRAW_PRIORITY[t], `${nm}.drawPriority`).toBe(want.prio);
            expect(TERRAIN_HOME_LAYER[t], `${nm}.homeLayer`).toBe(L.DUNGEON);
        }
    });

    it('A2 STATUE_INSTACRACK 链位更正钉死：promoteType=DF_STATUE_SHATTER、discoverType 空', () => {
        // 翻红条件：回退到 V-2b-4 的 discoverType 抄法——那会让"护符被取走 →
        // 全机通电 → 雕像震裂"整条链在 promoteTile 上断掉（promoteTile 只读
        // promoteType）。
        const e = TERRAIN_FLAGS[C.STATUE_INSTACRACK]!;
        expect(e.promoteType).toBe('DF_STATUE_SHATTER');
        expect(e.discoverType).toBe('');
    });

    it('A3 四条新 DF 条目 ≡ CE 目录行；DF_MISSING_TILES 顺延为 28（顺延不放宽）', () => {
        const cases: Array<[DF, { line: number; tile: string; hasTile: boolean; layer: L; start: number; decr: number; flags: number; subseq: DF | null; desc: string }]> = [
            [DF.DF_ALTAR_INERT, { line: 723, tile: 'ALTAR_INERT', hasTile: true, layer: L.DUNGEON, start: 0, decr: 0, flags: 0, subseq: null, desc: '' }],
            [DF.DF_WALL_CRACK, { line: 818, tile: 'RAT_TRAP_WALL_CRACKING', hasTile: false, layer: L.DUNGEON, start: 0, decr: 0, flags: 0, subseq: DF.DF_RUBBLE, desc: 'a scratching sound emanates from the nearby walls!' }],
            [DF.DF_CRACKING_STATUE, { line: 872, tile: 'STATUE_CRACKING', hasTile: false, layer: L.DUNGEON, start: 0, decr: 0, flags: 0, subseq: DF.DF_RUBBLE, desc: 'cracks begin snaking across the marble surface of the statue!' }],
            [DF.DF_TURRET_EMERGE, { line: 876, tile: 'WALL', hasTile: true, layer: L.DUNGEON, start: 0, decr: 0, flags: DFF_ACTIVATE_DORMANT_MONSTER, subseq: DF.DF_RUBBLE, desc: 'you hear a click, and the stones in the wall shift to reveal turrets!' }],
        ];
        for (const [id, want] of cases) {
            const e = DUNGEON_FEATURE_CATALOG[id]!;
            expect(e, `DF#${id} 缺目录条目`).toBeDefined();
            expect(e.ceLine).toBe(want.line);
            expect(e.ceTile).toBe(want.tile);
            if (want.hasTile) expect(e.tile, `DF#${id} 应有 web tile`).not.toBeNull();
            else expect(e.tile, `DF#${id} web 无 tile，须登记 null`).toBeNull();
            expect(e.layer).toBe(want.layer);
            expect(e.startProbability).toBe(want.start);
            expect(e.probabilityDecrement).toBe(want.decr);
            expect(e.flags).toBe(want.flags);
            expect(e.subsequentDF).toBe(want.subseq);
            expect(e.description).toBe(want.desc);
        }
        // 顺延守卫（B-3 / V-2b-3 / V-2b-4 同款机理：跨轮公共登记表只顺延不放宽）
        // V-2b-6：净 28 → 29（+2 钥匙轮无 tile 条目、−1 DF_OPEN_PORTCULLIS
        // 摘除——tile PORTCULLIS_DORMANT 该轮落地）。逐条见
        // DungeonFeatureCatalog 的 V-2b-6 块注。
        expect(DF_MISSING_TILES).toHaveLength(29);
        expect(DF_MISSING_TILES).toContain(DF.DF_WALL_CRACK);
        expect(DF_MISSING_TILES).toContain(DF.DF_CRACKING_STATUE);
        expect(DF_MISSING_TILES, '带完整 tile 的条目不得混进缺 tile 名单').not.toContain(DF.DF_ALTAR_INERT);
        expect(DF_MISSING_TILES, 'DF_TURRET_EMERGE 的 tile 是 WALL（web 有）').not.toContain(DF.DF_TURRET_EMERGE);
    });
});

describe('V-2b-5 A4：八条新蓝图 ≡ CE GlobalsBrogue.c 原表', () => {
    const byId = new Map<string, BlueprintDef>(
        (blueprintData as unknown as BlueprintDef[]).map(b => [b.id, b]),
    );

    /** 逐 feature 钉死（CE 行：DF/terrain/layer/instanceCt/minInsts/itemCat/
     *  itemKind/monsterKind/reqSpace/hordeFl/itemFlags/featureFlags）。 */
    function expectFeature(f: FeatureDef | undefined, want: Partial<FeatureDef>): void {
        expect(f, 'feature 缺失').toBeDefined();
        for (const [k, v] of Object.entries(want)) {
            expect((f as unknown as Record<string, unknown>)[k], `feature.${k}`).toEqual(v);
        }
    }

    it('21 号 vestibule_statue_monster（:318-321）', () => {
        const bp = byId.get('vestibule_statue_monster')!;
        expect(bp.depthRange).toEqual([5, 26]);
        expect(bp.roomSize).toEqual([2, 2]);
        expect(bp.frequency).toBe(6);
        expect(bp.category).toBe('vestibule');
        expect(bp.flags).toEqual(['BP_VESTIBULE']);
        expect(bp.features).toHaveLength(2);
        expectFeature(bp.features[0], {
            terrain: 'STATUE_DORMANT_DOORWAY', layer: 'DUNGEON',
            instanceCount: [1, 1], minimumInstanceCount: 1, personalSpace: 1,
            hordeFlags: ['HORDE_MACHINE_STATUE'],
            flags: ['MF_PERMIT_BLOCKING', 'MF_GENERATE_HORDE', 'MF_MONSTERS_DORMANT', 'MF_BUILD_AT_ORIGIN', 'MF_ALTERNATIVE'],
        });
        expectFeature(bp.features[1], {
            terrain: 'MACHINE_TRIGGER_FLOOR', layer: 'DUNGEON',
            instanceCount: [0, 0], minimumInstanceCount: 1, personalSpace: 0,
            flags: ['MF_EVERYWHERE'],
        });
    });

    it('29 号 key_rat_trap_dormant（:364-368）', () => {
        const bp = byId.get('key_rat_trap_dormant')!;
        expect(bp.depthRange).toEqual([1, 8]);
        expect(bp.roomSize).toEqual([30, 70]);
        expect(bp.frequency).toBe(7);
        expect(bp.flags).toEqual(['BP_ROOM', 'BP_ADOPT_ITEM']);
        expect(bp.features).toHaveLength(3);
        expectFeature(bp.features[0], {
            terrain: 'ALTAR_SWITCH', flags: ['MF_ADOPT_ITEM', 'MF_FAR_FROM_ORIGIN', 'MF_TREAT_AS_BLOCKING', 'MF_NOT_IN_HALLWAY'],
        });
        expectFeature(bp.features[1], {
            terrain: 'MACHINE_PARALYSIS_VENT_HIDDEN', instanceCount: [1, 1], personalSpace: 2,
        });
        expectFeature(bp.features[2], {
            terrain: 'RAT_TRAP_WALL_DORMANT', instanceCount: [10, 20], minimumInstanceCount: 5,
            monsterId: 'rat',
            flags: ['MF_MONSTERS_DORMANT', 'MF_BUILD_IN_WALLS', 'MF_NOT_ON_LEVEL_PERIMETER'],
        });
    });

    it('41 号 key_explosive_trap（:445-449，V-2b-3 推迟项）', () => {
        const bp = byId.get('key_explosive_trap')!;
        expect(bp.depthRange).toEqual([7, 26]);
        expect(bp.roomSize).toEqual([80, 90]);
        expect(bp.frequency).toBe(10);
        expect(bp.flags).toEqual(['BP_ROOM', 'BP_PURGE_LIQUIDS', 'BP_SURROUND_WITH_WALLS', 'BP_ADOPT_ITEM']);
        expect(bp.features).toHaveLength(5);
        expectFeature(bp.features[2], {
            terrain: 'ALTAR_SWITCH', flags: ['MF_ADOPT_ITEM', 'MF_TREAT_AS_BLOCKING', 'MF_FAR_FROM_ORIGIN'],
        });
        expectFeature(bp.features[4], {
            terrain: 'PILOT_LIGHT_DORMANT', flags: ['MF_FAR_FROM_ORIGIN', 'MF_BUILD_IN_WALLS'],
        });
    });

    it('43 号 key_statuary（:460-463）与 50 号 key_worm_trap（:505-508）', () => {
        const s = byId.get('key_statuary')!;
        expect(s.depthRange).toEqual([10, 26]);
        expect(s.roomSize).toEqual([35, 90]);
        expect(s.frequency).toBe(10);
        expect(s.flags).toEqual(['BP_ADOPT_ITEM', 'BP_NO_INTERIOR_FLAG']);
        expect(s.features).toHaveLength(2);
        expectFeature(s.features[1], {
            terrain: 'STATUE_DORMANT', instanceCount: [3, 5], minimumInstanceCount: 3, personalSpace: 2,
            hordeFlags: ['HORDE_MACHINE_STATUE'],
            flags: ['MF_TREAT_AS_BLOCKING', 'MF_NOT_IN_HALLWAY', 'MF_GENERATE_HORDE', 'MF_MONSTERS_DORMANT', 'MF_FAR_FROM_ORIGIN'],
        });

        const w = byId.get('key_worm_trap')!;
        expect(w.depthRange).toEqual([12, 26]);
        expect(w.roomSize).toEqual([7, 7]);
        expect(w.frequency).toBe(7);
        expect(w.features).toHaveLength(2);
        expectFeature(w.features[1], {
            terrain: 'WALL_MONSTER_DORMANT', instanceCount: [5, 8], minimumInstanceCount: 5,
            monsterId: 'underworm',
            flags: ['MF_MONSTERS_DORMANT', 'MF_BUILD_IN_WALLS', 'MF_NOT_ON_LEVEL_PERIMETER'],
        });
    });

    it('56 号 key_turret_trap（:545-548）；69/70 号（:608-616）freq 0 退池留形', () => {
        const g = byId.get('key_turret_trap')!;
        expect(g.depthRange).toEqual([5, 24]);
        expect(g.frequency).toBe(10);
        expect(g.flags).toEqual(['BP_ADOPT_ITEM', 'BP_NO_INTERIOR_FLAG']);
        expectFeature(g.features[1], {
            terrain: 'TURRET_DORMANT', instanceCount: [4, 6], minimumInstanceCount: 4,
            hordeFlags: ['HORDE_MACHINE_TURRET'],
            flags: ['MF_TREAT_AS_BLOCKING', 'MF_GENERATE_HORDE', 'MF_MONSTERS_DORMANT', 'MF_BUILD_IN_WALLS', 'MF_IN_VIEW_OF_ORIGIN'],
        });

        const ts = byId.get('area_trick_statue')!;
        expect(ts.depthRange).toEqual([1, 40]); // CE {1, DEEPEST_LEVEL}，字面 40
        expect(ts.frequency).toBe(0);
        expect(ts.category).toBe('thematic');
        expect(ts.features).toHaveLength(3);
        expectFeature(ts.features[2], { terrain: 'MACHINE_TRIGGER_FLOOR', instanceCount: [0, 0], minimumInstanceCount: 2 });

        const wm = byId.get('area_worm')!;
        expect(wm.depthRange).toEqual([1, 40]);
        expect(wm.frequency).toBe(0);
        expect(wm.category).toBe('thematic');
        expectFeature(wm.features[0], {
            terrain: 'WALL_MONSTER_DORMANT', instanceCount: [1, 3], monsterId: 'underworm',
        });
    });
});

// ══════════════════════════════════════════════════════════════════════════
// B. toggleMonsterDormancy 双向（CE Monsters.c:4156-4210）
// ══════════════════════════════════════════════════════════════════════════

describe('V-2b-5 B：toggleMonsterDormancy（CE Monsters.c:4156-4210 双向直译）', () => {
    it('B1 睡下方向：换表 + isDormant + 格标记；getMonsterAt 从此看不见它', () => {
        // 翻红条件：①只置 isDormant 不换表 → getMonsterAt 仍能找到（CE 语义
        // 是"不占格"）；②换表但漏格标记 → hasDormantMonster 断言红。
        const game = createHeadlessGame(424242);
        const patch = findFloorPatch(game.grid)!;
        const mon = makeMonster(patch.x, patch.y);
        game.monsters.push(mon);
        expect(game.getMonsterAt(patch.x, patch.y)).toBe(mon);

        game.toggleMonsterDormancy(mon);

        expect(game.monsters).not.toContain(mon);
        expect(game.dormantMonsters).toContain(mon);
        expect(mon.isDormant).toBe(true);
        expect(game.grid.getCell(patch.x, patch.y)!.hasDormantMonster).toBe(true);
        expect(game.getMonsterAt(patch.x, patch.y)).toBeUndefined();
    });

    it('B2 醒来方向：移回 monsters（prepend）+ 清标记 + 200 tick 不动', () => {
        // 翻红条件：①单向实现（只写了睡下半边）→ 怪凭空消失；②漏 200 tick
        // → ticksUntilTurn 断言红；③醒来后仍留在 dormantMonsters → 幽灵休眠。
        const game = createHeadlessGame(424242);
        const patch = findFloorPatch(game.grid)!;
        const mon = makeDormant(game, patch.x, patch.y);
        expect(game.dormantMonsters).toContain(mon);

        game.toggleMonsterDormancy(mon);

        expect(game.dormantMonsters).not.toContain(mon);
        expect(game.monsters).toContain(mon);
        expect(mon.isDormant).toBe(false);
        expect(game.grid.getCell(patch.x, patch.y)!.hasDormantMonster).toBe(false);
        // CE :4192 "Don't want it to move before the player has a chance to react."
        expect(mon.ticksUntilTurn).toBeGreaterThanOrEqual(200);
        expect(game.getMonsterAt(mon.loc.x, mon.loc.y)).toBe(mon);
    });

    it('B3 格被占则重选址（CE :4168-4181）——被普通怪占与被玩家占两种形态', () => {
        // 翻红条件：漏掉占用重选址分支 → 唤醒后两只怪叠在同一格
        //（CE 明确写着 "Occupied!" 分支，漏了就是两只怪同格）。
        for (const occupier of ['monster', 'player'] as const) {
            const game = createHeadlessGame(424242);
            const patch = findFloorPatch(game.grid)!;
            const mon = makeDormant(game, patch.x, patch.y);
            if (occupier === 'monster') {
                game.monsters.push(makeMonster(patch.x, patch.y, 'goblin'));
            } else {
                game.player.loc = { x: patch.x, y: patch.y };
            }

            game.toggleMonsterDormancy(mon);

            expect(mon.loc.x === patch.x && mon.loc.y === patch.y,
                `占用者=${occupier}：唤醒后必须重选址（CE :4168-4181），仍叠在 (${patch.x},${patch.y})`)
                .toBe(false);
            // 重选址目标必须合格：无怪、无玩家
            expect(game.getMonsterAt(mon.loc.x, mon.loc.y)).toBe(mon);
            expect(game.player.loc.x === mon.loc.x && game.player.loc.y === mon.loc.y).toBe(false);
        }
    });

    it('B4 两表皆无 → 无操作（CE 两次 removeCreature 都失败时不做任何事）', () => {
        // 翻红条件：把"不在 dormantMonsters"直接当成"该睡下"→ 一只野生怪被
        // 凭空塞进休眠表（醒来分支与睡下分支的判定顺序错了）。
        const game = createHeadlessGame(424242);
        const patch = findFloorPatch(game.grid)!;
        const mon = makeMonster(patch.x, patch.y, 'goblin'); // 从未入表
        const nMonsters = game.monsters.length;
        const nDormant = game.dormantMonsters.length;
        game.toggleMonsterDormancy(mon);
        expect(game.monsters).toHaveLength(nMonsters);
        expect(game.dormantMonsters).toHaveLength(nDormant);
        expect(mon.isDormant).toBe(false);
    });
});

// ══════════════════════════════════════════════════════════════════════════
// C. 唤醒消费（CE Architect.c:3487-3496）
// ══════════════════════════════════════════════════════════════════════════

/** 合成唤醒 DF（CE 的 spawnDungeonFeature 收的是可改写的 dungeonFeature 副本）。
 *  tile 用 SURFACE 层的 GRASS：落点格的 DUNGEON 层已是 FLOOR，若 DF tile 也用
 *  FLOOR，fillSpawnMap 的"该层已是目标地形 → 不建"判据会让 builtCells 恒空。 */
function wakeDF(over: Partial<DungeonFeature> = {}): DungeonFeature {
    return {
        tile: C.GRASS,
        layer: L.SURFACE,
        startProbability: 100,
        probabilityDecrement: 50,
        flags: DFF_ACTIVATE_DORMANT_MONSTER,
        propagationTerrain: C.FLOOR,
        subsequentDF: null,
        description: '',
        lightFlare: '',
        flashColor: '',
        effectRadius: 0,
        ...over,
    };
}

describe('V-2b-5 C：DFF_ACTIVATE_DORMANT_MONSTER 的唤醒消费（CE Architect.c:3487-3496）', () => {
    it('C1 blockingMap 半句：DF 铺开多大一片，那片里的休眠怪全醒（不只原点）', () => {
        // 翻红条件：只唤醒原点那一只——STATUE_DORMANT {3,5} 一类一次多格的
        // 雕像群就只会活一个（§1.3 明示的漏法）。
        const game = createHeadlessGame(424242);
        const patch = findFloorPatch(game.grid)!;
        expect(patch, '生成图必有 3×3 地板平地').not.toBeNull();

        // 一次探路（seed 固定 → 扩散形状确定），得知 DF 会铺到哪些格。
        rng.seedRandomGenerator(1);
        const probe = spawnDungeonFeature(game.grid, patch.x, patch.y, wakeDF(), false);
        expect(probe.succeeded).toBe(true);
        expect(probe.builtCells.length, '合成 DF 应铺开多格（否则测不出 blockingMap 半句）').toBeGreaterThan(1);
        const spread = probe.builtCells;

        // 把 probe 落下的 GRASS 清回 FLOOR（否则重放时 fillSpawnMap 判
        // "该层已是目标地形"不建格，builtCells 恒空），再按已知形状布休眠怪，
        // 重播种重放同一 DF（同 seed 同形状）。
        for (const p of spread) {
            game.grid.setTerrain(p.x, p.y, C.FLOOR, '.', 0x888888);
        }
        const dormantInSpread = spread.map(p => makeDormant(game, p.x, p.y));
        rng.seedRandomGenerator(1);
        const result = spawnDungeonFeature(game.grid, patch.x, patch.y, wakeDF(), false);
        expect(result.succeeded).toBe(true);
        expect(result.builtCells.length, '重放必须复现同一铺开形状').toBe(spread.length);

        const stillDormant = dormantInSpread.filter(m => m.isDormant);
        expect(stillDormant, '铺开集内的休眠怪必须全部唤醒（blockingMap 半句）').toEqual([]);
    });

    it('C2 原点半句：builtCells 为空时原点那只仍要醒（startProbability=0 的 DF，CE :679 形态）', () => {
        // 翻红条件：只实现 blockingMap 半句——CE 那行的 `monst->loc.x == x &&
        // monst->loc.y == y ||` 析取被漏，零起点 DF 连原点都漏。
        const game = createHeadlessGame(424242);
        const patch = findFloorPatch(game.grid)!;
        const mon = makeDormant(game, patch.x, patch.y);
        awakenAt(game, patch, []);
        expect(mon.isDormant, '原点半句缺失（CE :3491 的第一个析取项）').toBe(false);
    });

    it('C3 不带唤醒旗标的 DF 不得唤醒（DF_ALTAR_INERT：flags=0、tile=ALTAR web 有）', () => {
        // 翻红条件：无脑唤醒——不看 flags 位就把 dormantMonsters 全放出来。
        const game = createHeadlessGame(424242);
        const patch = findFloorPatch(game.grid)!;
        game.grid.setTerrain(patch.x, patch.y, C.ALTAR, '_', 0xccccff);
        const mon = makeDormant(game, patch.x, patch.y);
        rng.seedRandomGenerator(7);
        spawnDungeonFeature(game.grid, patch.x, patch.y, catalogFeature(DF.DF_ALTAR_INERT), false);
        expect(mon.isDormant, '无旗标 DF 不得唤醒').toBe(true);
        expect(game.dormantMonsters).toContain(mon);
    });

    it('C4 连通性否决失败（succeeded=false）时不得唤醒（CE 该段在 if(succeeded) 里）', () => {
        // 翻红条件：把唤醒段挪出 succeeded 守卫——被否决的 DF 也会放怪。
        const grid = new Grid(20, 20);
        for (let x = 0; x < 20; x++) {
            for (let y = 0; y < 20; y++) grid.setTerrain(x, y, C.GRANITE, '#', 0x444444);
        }
        for (let x = 1; x <= 8; x++) {
            for (let y = 8; y <= 12; y++) grid.setTerrain(x, y, C.FLOOR, '.', 0x888888); // 左房
        }
        for (let x = 11; x <= 18; x++) {
            for (let y = 8; y <= 12; y++) grid.setTerrain(x, y, C.FLOOR, '.', 0x888888); // 右房
        }
        for (const x of [9, 10]) grid.setTerrain(x, 10, C.FLOOR, '.', 0x888888); // 唯一走廊
        const game = createHeadlessGame(424242);
        // 休眠怪放进左房；唤醒回调绑到这手工 grid 上（生产路径由 Game.bindDormantAwakener 完成）。
        const mon = makeMonster(5, 10);
        game.monsters.push(mon);
        mon.machineHome = 99;
        game.toggleMonsterDormancy(mon);
        setDormantAwakener(grid, (o, b) => awakenAt(game, o, b));

        const blockingDF = wakeDF({
            tile: C.WALL,
            propagationTerrain: C.NOTHING,
            startProbability: 0,
            flags: DFF_ACTIVATE_DORMANT_MONSTER | DFF_TREAT_AS_BLOCKING,
        });
        const result = spawnDungeonFeature(grid, 9, 10, blockingDF, true); // 堵唯一走廊
        expect(result.succeeded, '堵死唯一通路必须被判否决').toBe(false);
        expect(mon.isDormant, 'DF 被连通性否决时不得唤醒（CE :3487 在 if(succeeded) 内）').toBe(true);
    });
});

// ══════════════════════════════════════════════════════════════════════════
// D. 生成接线（统计性：CE :1661 machineHome + :1655-1659 休眠落地）
// ══════════════════════════════════════════════════════════════════════════

describe('V-2b-5 D：生成接线（machineHome / dormantMonsters）', () => {
    const SEEDS = [424242, 777, 20260916];

    it('D1 三 seed × D1-D26：机器怪记属机；休眠怪在 dormantMonsters 且不在 monsters；两者无交集', () => {
        // 翻红条件：
        //  - 漏 CE :1661 → machineHome 恒 0 → 第一条反真空断言红；
        //  - 休眠怪落进 monsters（没换表）→ 互斥/格标记断言红；
        //  - 否定条件漏写 → 休眠怪 state 保持构造器的 70% ASLEEP 掷骰 → state 断言红。
        let totalMonsters = 0;
        let machineHomeSeen = 0;
        let dormantSeen = 0;

        for (const seed of SEEDS) {
            const game = createHeadlessGame(seed);
            const g = game as unknown as { generateDepth(isGoingUp: boolean, isFirstLevel: boolean): void };
            for (let depth = 1; depth <= 26; depth++) {
                if (depth > 1) {
                    game.depth = depth;
                    g.generateDepth(false, false);
                }
                totalMonsters += game.monsters.length + game.dormantMonsters.length;
                machineHomeSeen += game.monsters.filter(m => m.machineHome > 0).length;
                machineHomeSeen += game.dormantMonsters.filter(m => m.machineHome > 0).length;
                dormantSeen += game.dormantMonsters.length;

                // 休眠怪必属机器（CE 里休眠只来自 MF_MONSTERS_DORMANT 的机器
                // feature；普通 populateMonsters 的怪从不休眠），且醒来即追踪。
                for (const m of game.dormantMonsters) {
                    expect(m.isDormant, `${seed}/D${depth} 休眠表里的怪 isDormant 必须为真`).toBe(true);
                    expect(m.machineHome, `${seed}/D${depth} 休眠怪必须记属机`).toBeGreaterThan(0);
                    expect(m.state, `${seed}/D${depth} 休眠怪醒来应为 TRACKING_SCENT（web HUNTING）——否定条件漏写即红`)
                        .toBe(MonsterState.HUNTING);
                }
                // 两表互斥（CE 的两条链表）。
                const dormantIds = new Set(game.dormantMonsters.map(m => m.id));
                for (const m of game.monsters) {
                    expect(dormantIds.has(m.id), `${seed}/D${depth} 怪 #${m.id} 同时在两表`).toBe(false);
                }
                // 格标记与表一致（活怪不得坐在带休眠标记的格上）。
                for (const m of game.monsters) {
                    const cell = game.grid.getCell(m.loc.x, m.loc.y);
                    if (cell?.hasDormantMonster) {
                        expect(game.dormantMonsters.some(d => d.loc.x === m.loc.x && d.loc.y === m.loc.y),
                            `${seed}/D${depth} (${m.loc.x},${m.loc.y}) 格标记指向的休眠怪不在表`).toBe(true);
                    }
                }
            }
        }

        // 反真空
        expect(totalMonsters).toBeGreaterThan(300);
        // CE :1661 接线必须有真实行使（机器在 3 seed × 26 层里必然出现）
        expect(machineHomeSeen, 'machineHome 全 0 → CE :1661 未接线').toBeGreaterThan(0);
        // 休眠接线必须有真实行使（新 key_guard 蓝图占领养抽签约 1/3）
        expect(dormantSeen, '整轮扫描没有任何休眠怪 → MF_MONSTERS_DORMANT 未接线').toBeGreaterThan(0);
    });
});
