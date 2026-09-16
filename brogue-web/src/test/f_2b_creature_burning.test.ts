/**
 * src/test/f_2b_creature_burning.test.ts — F-2b：生物燃烧状态机 + 火免通道修复
 * （F-0 §5.3-4/5，P1-44 回归哨兵）。
 *
 * 被测事实（CE 出处逐条写在断言注释）：
 *   - 着火是生物自身的状态 STATUS_BURNING：踩 T_IS_FIRE → exposeCreatureToFire
 *     （Time.c:527-528 → :28-61），豁免四条 + (!levitating && 灭火层) 合取
 *     （:30-35，那个括号只包两条）；上状态 max(,7) 刷新非叠加（:59-60）；
 *   - 伤害在燃烧结算段每回合 rand_range(1,3)（玩家 Time.c:2581-2591、
 *     怪 Monsters.c:1877-1901）——离开火格后状态仍在、继续烧到自然熄灭；
 *   - 灭火层扑灭在烧生物（Time.c:226-232，!levitating 守卫）；
 *   - 着火生物点燃所踩的可燃非火格（Time.c:529-540，alwaysIgnite 直燃）；
 *   - 抗火药水 = STATUS_IMMUNE_TO_FIRE(50) + 立即灭火（Items.c:8188-8193）
 *     ——P1-44 的三重断线（'burning' as any）修复哨兵；
 *   - 气体六条曲线是本轮的反向哨兵：POISON/CONFUSION/STEAM/CREEPING_DEATH
 *     签名与 2026-09-16 F-2a 硬编码基线逐位一致（POISON≡CONFUSION 恒等式在内）。
 *
 * 每条断言在注释里写明它捕获的错误实现。反向验证（真实改坏→红→还原）
 * 见 ai_docs/f_2b_creature_burning_report.md，不落在本文件。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import type { Game } from '../engine/Core/Game';
import { TerrainType, DungeonLayer as L } from '../engine/Map/Grid';
import { Monster, type MonsterData } from '../entities/Monster';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { logger } from '../engine/Systems/Logger';
import { GasType } from '../engine/Environment/Gas';
import monsterDataJson from '../data/monsters.json';

const C = TerrainType;
const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

/** 无怪物骚扰的封闭房间（f_2a openRoom 同款）。 */
function openRoom(game: Game, w = 30, h = 20): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < w; x++) {
        for (let y = 1; y < h; y++) {
            game.grid.setTerrain(x, y, C.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= w - 2; x++) {
        for (let y = 2; y <= h - 2; y++) {
            game.grid.setTerrain(x, y, C.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 4;
    game.player.hp = game.player.maxHp;
}

function setTile(game: Game, x: number, y: number, terrain: TerrainType): void {
    game.grid.setTerrain(x, y, terrain, '~', 0x3366cc);
    const cell = game.grid.getCell(x, y);
    if (cell) cell.isVisible = true;
}

type Priv = {
    objectiveTimeBlock(): void;
    tickCreatureStatuses(): void;
    applyEnvironmentalEffects(): void;
    burningDuration(entity: unknown): number;
    finishTurnEpilogue(): void;
};
const priv = (game: Game): Priv => game as unknown as Priv;

/**
 * 两趟驱动（客观块的环境段 + 状态段，不含晋升/火段/气体/营养）：
 * 隔离被测的状态机——火源不衰老，曲线只反映燃烧状态本身。
 * 次序与 F-2b 后的 objectiveTimeBlock 一致：环境段（点火/灭火）先于状态段
 * （燃烧伤害结算）——CE Time.c:2671 → :2677 的块内序。
 */
function tickStateAndEnv(game: Game, n = 1): void {
    for (let i = 0; i < n; i++) {
        priv(game).applyEnvironmentalEffects();
        priv(game).tickCreatureStatuses();
    }
}

/** 包装 logger.log 统计真实调用次数（Logger 会合并连续同文）。 */
function wrapLog(): { calls: string[]; restore: () => void } {
    const calls: string[] = [];
    const original = logger.log.bind(logger);
    logger.log = (text: string, color?: string) => {
        calls.push(text);
        original(text, color);
    };
    return { calls, restore: () => { delete (logger as { log?: unknown }).log; } };
}

// ---------------------------------------------------------------------------
// 对抗①②：状态真挂上（离开火格继续烧）+ 刷新非叠加（Time.c:59-60 max(,7)）
// ---------------------------------------------------------------------------
describe('F-2b 对抗①②：燃烧状态挂载与刷新语义', () => {
    it('对抗①：离开火格后燃烧必须继续——状态没挂上的实现（伤害只在站火格时' +
        '发生，web 旧"平扣"形态）在此翻红。CE：exposeCreatureToFire 只上状态' +
        '（Time.c:59-60），伤害来自每回合燃烧结算（Time.c:2581-2591），与脚下' +
        '地形无关；烧 ~7 回合后自然熄灭，伤害随之停止。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.igniteForced(4, 4); // 玩家脚下着火（openRoom 玩家在 (4,4)）
        tickStateAndEnv(game, 1);
        // 踩火当块：环境段挂 7、状态段掉血 1-3 并递减到 6（CE Time.c:2671
        // tile → :2677 decrement 的块内序）。
        expect(priv(game).burningDuration(game.player)).toBe(6);
        expect(game.player.hp).toBeLessThanOrEqual(game.player.maxHp - 1);
        expect(game.player.hp).toBeGreaterThanOrEqual(game.player.maxHp - 3);

        // 离开火格：状态必须带着走，且继续掉血。
        game.player.loc.x = 20;
        game.player.loc.y = 10;
        const hpAfterLeavingFire = game.player.hp;
        tickStateAndEnv(game, 1);
        expect(priv(game).burningDuration(game.player)).toBe(5);
        expect(game.player.hp).toBeLessThan(hpAfterLeavingFire);

        // 烧到自然熄灭：CE max(,7) ⇒ 至多再烧 7 回合；熄灭后 hp 冻结
        // （openRoom 无怪物、离开火格后无其他伤害/回血路径——营养满不扣血）。
        let turnsBurned = 0;
        for (let i = 0; i < 10 && priv(game).burningDuration(game.player) > 0; i++) {
            const before = game.player.hp;
            tickStateAndEnv(game, 1);
            if (game.player.hp < before) turnsBurned++;
        }
        expect(priv(game).burningDuration(game.player)).toBe(0);
        expect(turnsBurned).toBeLessThanOrEqual(7);
        const frozen = game.player.hp;
        tickStateAndEnv(game, 3);
        expect(game.player.hp).toBe(frozen);
    });

    it('对抗②：站在火里反复暴露，剩余时长必须刷新到恰好 7 而非叠加——' +
        '写成 current + 7 的堆叠实现 12 块后累计 80+，在此翻红。' +
        'CE Time.c:59-60：status = max(status, 7)。（CE 的 max 语义下靠暴露' +
        '本身到不了 >7，"更高值保留"半边不可达，不设断言。）', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.player.hp = 100; // 抬血线：12 回合 × 1-3 不致死，隔离死亡结算
        game.environment.igniteForced(4, 4); // 玩家脚下（openRoom 玩家在 (4,4)）
        for (let i = 1; i <= 12; i++) {
            tickStateAndEnv(game, 1);
            // 每块：环境段刷新 max(剩,7)=7、结算段递减 ⇒ 稳态恒 6。
            expect(priv(game).burningDuration(game.player),
                `第 ${i} 块后剩余时长必须恒为 6（刷新非叠加）`).toBe(6);
        }
        expect(game.player.hp).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 对抗③④：灭火层（TM_EXTINGUISHES_FIRE）与那个 !levitating 括号
// ---------------------------------------------------------------------------
describe('F-2b 对抗③④：灭火层与 !levitating 括号（Time.c:34-35/226-232）', () => {
    it('对抗③：燃烧的生物蹚进浅水必须被扑灭——灭火分支失效（站水里还在烧）' +
        '在此翻红。CE Time.c:226-232：TM_EXTINGUISHES_FIRE && burning && ' +
        '!levitating → extinguishFireOnCreature。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.igniteForced(4, 4); // 玩家脚下（openRoom 玩家在 (4,4)）
        tickStateAndEnv(game, 1);
        expect(priv(game).burningDuration(game.player)).toBe(6); // 挂 7 − 结算递减 1

        setTile(game, 8, 4, C.WATER_SHALLOW); // 玩家所在行（y=4），只改 x 走进水格
        game.player.loc.x = 8;
        tickStateAndEnv(game, 1);
        // 入水当回合：结算段（伤害）先于灭火段——与 CE 玩家序一致
        // （playerTurnEnded 的燃烧伤害 Time.c:2581 先于客观块 :2698 的
        // applyInstantTileEffectsToCreature 灭火 :227）。挨最后一次 1-3
        // 伤害后被扑灭，状态归零。
        expect(priv(game).burningDuration(game.player)).toBe(0);
        expect(game.player.hp).toBeLessThanOrEqual(game.player.maxHp - 1);
        expect(game.player.hp).toBeGreaterThanOrEqual(game.player.maxHp - 3);
        // 扑灭后不再掉血。
        const frozen = game.player.hp;
        tickStateAndEnv(game, 2);
        expect(game.player.hp).toBe(frozen);
    });

    it('对抗④a：火盖水的格子（药水/爆炸把 PLAIN_FIRE 铺在浅水上）——非悬浮' +
        '生物免疫点火（Time.c:34-35 的合取豁免：!levitating && 灭火层）。' +
        '捕获的错误实现：豁免漏掉灭火层条件（站水上的火照烧）或漏掉整个合取。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        // 先铺水再点火（setTerrain 会清其他层，次序不能反）。
        setTile(game, 7, 6, C.WATER_SHALLOW);
        game.environment.igniteForced(7, 6);
        const cell = game.grid.getCell(7, 6)!;
        expect(cell.isBurning).toBe(true); // 前置：火 DF 确实落在水格上
        expect(cell.layers[L.LIQUID]).toBe(C.WATER_SHALLOW);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        rat.hp = 10;
        game.monsters.push(rat);
        tickStateAndEnv(game, 2);
        expect(priv(game).burningDuration(rat)).toBe(0);
        expect(rat.hp).toBe(10); // 豁免 ⇒ 既不上状态也不掉血
    });

    it('对抗④b：同一个火盖水格子——悬浮生物照样被点燃（Time.c:34-35 括号' +
        '只包 !levitating && 灭火层的合取：悬浮者悬在水上方，不被水豁免）。' +
        '捕获的错误实现：把 !levitating 括号读反/扩大成"整个豁免要求非悬浮"' +
        '或"悬浮也免点火"。旗标飞行的 vampire_bat（派生悬浮）在此当探针。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        setTile(game, 7, 6, C.WATER_SHALLOW);
        game.environment.igniteForced(7, 6);

        const bat = new Monster(7, 6, monsterDataById('vampire_bat'));
        expect(bat.hasStatus('levitating')).toBe(true); // 派生悬浮在位
        bat.hp = 10;
        game.monsters.push(bat);
        tickStateAndEnv(game, 1);
        // 悬浮不被水豁免点火：挂 7、同块结算掉血后剩 6。
        expect(priv(game).burningDuration(bat)).toBe(6);
        expect(bat.hp).toBeLessThan(10);
        expect(bat.hp).toBeGreaterThanOrEqual(7);
    });

    it('对抗④c：悬浮且在烧的生物悬在浅水上不被扑灭（Time.c:228 灭火守卫的' +
        '!levitating——水只灭踩在水里的火）。捕获的错误实现：灭火分支漏掉' +
        '!levitating 守卫（悬在水上的火被水灭）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.igniteForced(7, 6);
        const bat = new Monster(7, 6, monsterDataById('vampire_bat'));
        bat.hp = 10;
        game.monsters.push(bat);
        tickStateAndEnv(game, 1);
        expect(priv(game).burningDuration(bat)).toBe(6); // 前置：已在烧（挂 7 − 递减 1）

        setTile(game, 7, 6, C.WATER_SHALLOW); // 脚下变浅水（悬浮其上）
        tickStateAndEnv(game, 1);
        expect(priv(game).burningDuration(bat)).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑤⑨：P1-44 修复哨兵——抗火药水必须真的有效（Items.c:8188-8193）
// ---------------------------------------------------------------------------
describe('F-2b 对抗⑤⑨：抗火药水（P1-44 回归哨兵）', () => {
    function givePotion(game: Game) {
        const potion = ItemLoader.spawnPotion('potion_of_fire_immunity', -1, -1)!;
        game.player.inventory.addItem(potion);
        return potion;
    }

    it('对抗⑤：喝下抗火药水后站进火里必须完全不掉血、不上燃烧状态——' +
        'P1-44 的三重断线（grantTemporaryImmunity(\'burning\' as any)：键不' +
        '存在 + 通道无读者 + 伤害端查的是 immune_fire）复发时在此翻红。' +
        'CE Items.c:8188-8193：IMMUNE_TO_FIRE = magnitude，且 exposeCreatureToFire' +
        ' 的豁免让免疫者连状态都拿不到（Time.c:31 直接 return）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const potion = givePotion(game);
        game.quaffItem(potion);
        expect(game.player.hasStatus('immune_fire')).toBe(true);
        // quaff 是完整回合（CE Items.c:7633 → playerTurnEnded）：药水给的 150
        // 在该回合的客观块里被 tickStatuses 递减一次 ⇒ 149。
        expect(game.player.getStatusDuration('immune_fire')).toBe(149);

        game.environment.igniteForced(4, 5);
        tickStateAndEnv(game, 8);
        expect(priv(game).burningDuration(game.player)).toBe(0);
        expect(game.player.hp).toBe(game.player.maxHp);
    });

    it('对抗⑨：着火时喝药必须立即扑灭（CE Items.c:8190-8191：若在烧则' +
        'extinguishFireOnCreature）——只加免疫、不灭 existing 火的半实现翻红。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.igniteForced(4, 4); // 玩家脚下（openRoom 玩家在 (4,4)）
        tickStateAndEnv(game, 1);
        expect(priv(game).burningDuration(game.player)).toBe(6); // 前置：在烧（挂 7 − 递减 1）

        const potion = givePotion(game);
        game.quaffItem(potion);
        expect(priv(game).burningDuration(game.player)).toBe(0);
        expect(game.player.getStatusDuration('immune_fire')).toBe(149); // 150 − 完整回合 1 次 tickStatuses
    });
});

// ---------------------------------------------------------------------------
// 对抗⑥：着火生物点燃所踩地形（Time.c:529-540）——移动火种
// ---------------------------------------------------------------------------
describe('F-2b 对抗⑥：着火生物点燃所踩的可燃非火格', () => {
    it('在火格挂上状态后走到草地，草地必须被直燃（alwaysIgnite：Gas.ignite 即' +
        'CE Time.c:539 exposeTileToFire(x,y,true)）；未着火的对照生物不得点燃' +
        '脚下草地。捕获的错误实现：else-if 接线缺失（移动火种不点火）或漏掉' +
        'burning 前置（任何生物都能点火）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        // 先确认两块草地真的可燃（合成房间是 FLOOR——不可燃，换真草）。
        setTile(game, 10, 8, C.GRASS);
        setTile(game, 12, 8, C.GRASS);
        expect(game.grid.getCell(10, 8)!.isBurning).toBe(false);

        // 火源在 (4,5)（玩家脚下）——玩家与 rat 分头当探针。
        game.environment.igniteForced(4, 5);
        const rat = new Monster(4, 5, monsterDataById('rat'));
        game.monsters.push(rat);
        tickStateAndEnv(game, 1);
        expect(priv(game).burningDuration(rat)).toBe(6); // 挂 7 − 结算递减 1

        // 着火 rat 走上草地：下一回合草地被点燃。
        rat.loc.x = 10;
        rat.loc.y = 8;
        tickStateAndEnv(game, 1);
        expect(game.grid.getCell(10, 8)!.isBurning).toBe(true);

        // 对照：未着火的 rat 踩草地不点燃（burning 前置）。
        const coldRat = new Monster(12, 8, monsterDataById('rat'));
        game.monsters.push(coldRat);
        tickStateAndEnv(game, 1);
        expect(game.grid.getCell(12, 8)!.isBurning).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑦：气体回归哨兵（本轮不碰气体——与 f_2a 对抗⑪ 同一硬编码基线）
// ---------------------------------------------------------------------------
describe('F-2b 对抗⑦：气体子系统回归哨兵', () => {
    it('四种气体注入合成房间后的消散/扩散曲线必须与 2026-09-16 F-2a 基线' +
        '逐位一致（F-0 §4.5 口径，POISON≡CONFUSION 恒等式在内）。错误实现：' +
        '燃烧状态机顺手改动了 updateGases/addGas/客观块次序，或燃烧掷骰污染' +
        '了气体试验的 RNG 流。', () => {
        for (const type of [GasType.POISON, GasType.CONFUSION, GasType.STEAM, GasType.CREEPING_DEATH]) {
            const game = createHeadlessGame(42);
            openRoom(game);
            game.environment.addGas(10, 8, type, 100);
            const curve: string[] = [];
            for (let t = 0; t < 14; t++) {
                priv(game).objectiveTimeBlock();
                const cells: string[] = [];
                for (let x = 0; x < game.grid.width; x++) {
                    for (let y = 0; y < game.grid.height; y++) {
                        const g = game.environment.gasGrid[x]?.[y];
                        if (g && g.density > 0) cells.push(`${x},${y},${g.type},${g.density}`);
                    }
                }
                cells.sort();
                curve.push(cells.join(';'));
            }
            expect(GAS_BASELINE[type], `type=${type} 气体曲线漂移`).toEqual(curve);
        }
    });
});

/**
 * 硬编码基线：2026-09-16（F-2a 轮实测，f_2a_fire_mechanics.test.ts 对抗⑪
 * 同源照抄）。合成房间、(10,8) 注入 100 密度、每回合 objectiveTimeBlock 后
 * 的全场气格签名。F-2b 零改动气体 ⇒ 逐位一致；POISON 与 CONFUSION 除 type
 * 位外逐位相同（F-0 §4.5 恒等式）。G-1 迁 CE 消散谱系时翻转。
 */
const GAS_BASELINE: Record<number, string[]> = {
    [GasType.POISON]: ["10,7,2,15;10,8,2,38;10,9,2,15;11,8,2,15;9,8,2,15", "10,10,2,2;10,6,2,2;10,7,2,10;10,8,2,24;10,9,2,10;11,7,2,4;11,8,2,10;11,9,2,4;12,8,2,2;8,8,2,2;9,7,2,4;9,8,2,10;9,9,2,4", "10,7,2,11;10,8,2,10;10,9,2,11;11,7,2,2;11,8,2,11;11,9,2,2;9,7,2,2;9,8,2,11;9,9,2,2", "10,10,2,1;10,6,2,1;10,7,2,5;10,8,2,12;10,9,2,5;11,7,2,2;11,8,2,5;11,9,2,2;12,8,2,1;8,8,2,1;9,7,2,2;9,8,2,5;9,9,2,2", "10,7,2,4;10,8,2,6;10,9,2,4;11,8,2,4;9,8,2,4", "10,7,2,2;10,8,2,4;10,9,2,2;11,8,2,2;9,8,2,2", "10,8,2,2", "", "", "", "", "", "", ""],
    [GasType.CONFUSION]: ["10,7,3,15;10,8,3,38;10,9,3,15;11,8,3,15;9,8,3,15", "10,10,3,2;10,6,3,2;10,7,3,10;10,8,3,24;10,9,3,10;11,7,3,4;11,8,3,10;11,9,3,4;12,8,3,2;8,8,3,2;9,7,3,4;9,8,3,10;9,9,3,4", "10,7,3,11;10,8,3,10;10,9,3,11;11,7,3,2;11,8,3,11;11,9,3,2;9,7,3,2;9,8,3,11;9,9,3,2", "10,10,3,1;10,6,3,1;10,7,3,5;10,8,3,12;10,9,3,5;11,7,3,2;11,8,3,5;11,9,3,2;12,8,3,1;8,8,3,1;9,7,3,2;9,8,3,5;9,9,3,2", "10,7,3,4;10,8,3,6;10,9,3,4;11,8,3,4;9,8,3,4", "10,7,3,2;10,8,3,4;10,9,3,2;11,8,3,2;9,8,3,2", "10,8,3,2", "", "", "", "", "", "", ""],
    [GasType.STEAM]: ["10,7,4,15;10,8,4,35;10,9,4,15;11,8,4,15;9,8,4,15", "10,10,4,2;10,6,4,2;10,7,4,7;10,8,4,18;10,9,4,7;11,7,4,4;11,8,4,7;11,9,4,4;12,8,4,2;8,8,4,2;9,7,4,4;9,8,4,7;9,9,4,4", "10,7,4,4;10,8,4,5;10,9,4,4;11,8,4,4;9,8,4,4", "", "", "", "", "", "", "", "", "", "", ""],
    [GasType.CREEPING_DEATH]: ["10,7,5,25;10,9,5,25;11,8,5,25;9,8,5,25", "10,10,5,6;10,6,5,6;10,8,5,24;11,7,5,12;11,9,5,12;12,8,5,6;8,8,5,6;9,7,5,12;9,9,5,12", "10,10,5,5;10,6,5,5;10,7,5,12;10,9,5,12;11,10,5,3;11,6,5,3;11,8,5,12;12,7,5,3;12,8,5,5;12,9,5,3;8,7,5,3;8,8,5,5;8,9,5,3;9,10,5,3;9,6,5,3;9,8,5,12", "10,10,5,7;10,6,5,7;10,8,5,12;11,10,5,2;11,6,5,2;11,7,5,6;11,9,5,6;12,7,5,2;12,8,5,7;12,9,5,2;8,7,5,2;8,8,5,7;8,9,5,2;9,10,5,2;9,6,5,2;9,7,5,6;9,9,5,6", "10,10,5,6;10,6,5,6;10,7,5,3;10,9,5,3;11,10,5,1;11,6,5,1;11,7,5,5;11,8,5,3;11,9,5,5;12,7,5,1;12,8,5,6;12,9,5,1;8,7,5,1;8,8,5,6;8,9,5,1;9,10,5,1;9,6,5,1;9,7,5,5;9,8,5,3;9,9,5,5", "10,10,5,5;10,6,5,5;10,7,5,2;10,9,5,2;11,7,5,4;11,8,5,2;11,9,5,4;12,8,5,5;8,8,5,5;9,7,5,4;9,8,5,2;9,9,5,4", "10,10,5,4;10,6,5,4;10,7,5,1;10,9,5,1;11,7,5,3;11,8,5,1;11,9,5,3;12,8,5,4;8,8,5,4;9,7,5,3;9,8,5,1;9,9,5,3", "10,10,5,3;10,6,5,3;11,7,5,2;11,9,5,2;12,8,5,3;8,8,5,3;9,7,5,2;9,9,5,2", "10,10,5,2;10,6,5,2;11,7,5,1;11,9,5,1;12,8,5,2;8,8,5,2;9,7,5,1;9,9,5,1", "10,10,5,1;10,6,5,1;12,8,5,1;8,8,5,1", "", "", "", ""],
};

// ---------------------------------------------------------------------------
// 对抗⑧⑩⑪：伤害量级、玩家/怪物烧死的结算
// ---------------------------------------------------------------------------
describe('F-2b 对抗⑧⑩⑪：燃烧伤害量级与死亡结算', () => {
    it('对抗⑧：燃烧伤害必须落在 CE rand_range(1,3) 的支撑集内——30 只独立' +
        '各烧一块的 rat 总伤 ∈ [30, 90]（支撑带，带外概率为 0，非统计脆弱）。' +
        '捕获的错误实现：0 伤害（结算段没接）或 ≥4/块（量级走样）。' +
        '"伤害恒等于 2"的平扣复辟由 p1_28 对照组的分布锁翻红。', () => {
        let totalDamage = 0;
        for (let i = 0; i < 30; i++) {
            const game = createHeadlessGame(1000 + i);
            openRoom(game);
            game.environment.igniteForced(4, 5);
            const rat = new Monster(4, 5, monsterDataById('rat'));
            rat.hp = 10;
            game.monsters.push(rat);
            tickStateAndEnv(game, 1); // 一块：挂状态 + 恰好一次燃烧伤害
            expect(priv(game).burningDuration(rat)).toBe(6);
            totalDamage += 10 - rat.hp;
        }
        expect(totalDamage).toBeGreaterThanOrEqual(30);
        expect(totalDamage).toBeLessThanOrEqual(90);
    });

    it('对抗⑩：玩家被烧死 → hp 归零、lastDamageSource=fire、回合收尾判定' +
        'game over（death.burned 通道）。捕获的错误实现：燃烧伤害漏设' +
        'lastDamageSource（死因错报）或玩家死亡链断线。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        game.environment.igniteForced(4, 4); // 玩家脚下（openRoom 玩家在 (4,4)）
        tickStateAndEnv(game, 1);
        game.player.hp = 1; // 任一 1-3 伤害都致死（hp=2 会被掷出的 1 留活口）
        tickStateAndEnv(game, 1);
        expect(game.player.hp).toBeLessThanOrEqual(0);
        expect(game.lastDamageSource).toBe('fire');
        priv(game).finishTurnEpilogue();
        expect(game.isGameOver).toBe(true);
    });

    it('对抗⑪：怪物被烧死 → die() 收口（hp=0、尸符）+ "burns to death" 铭牌' +
        '（CE Monsters.c:1887-1895 "%s burns to death." + killCreature）。' +
        '捕获的错误实现：烧死只扣血不收口（尸体满血赖在怪物表）。', () => {
        const game = createHeadlessGame(42);
        openRoom(game);
        const log = wrapLog();
        try {
            game.environment.igniteForced(4, 5);
            const rat = new Monster(4, 5, monsterDataById('rat'));
            rat.hp = 1; // 任一 1-3 伤害都致死（hp=2 会被掷出的 1 留活口）
            game.monsters.push(rat);
            tickStateAndEnv(game, 1); // 挂状态
            tickStateAndEnv(game, 1); // 1-3 伤害 ⇒ 死
            expect(rat.hp).toBe(0);
            expect(rat.char).toBe('%');
            expect(log.calls.filter(t => t.includes('burns to death')).length).toBe(1);
        } finally {
            log.restore();
        }
    });
});
