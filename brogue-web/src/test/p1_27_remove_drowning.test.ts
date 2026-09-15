/**
 * src/test/p1_27_remove_drowning.test.ts — P1-27：按 D2 移除自创的"深水淹死"
 *
 * 病灶：web 的深水格会让站上去的玩家 triggerGameOver、怪物 die()——这是 CE
 * 不存在的自创机制。CE 全源码 grep drown 零匹配；地形旗标定义（Rogue.h）：
 *   T_LAVA_INSTA_DEATH = Fl(8)   // kills any non-levitating non-fire-immune creature instantly
 *   T_IS_DEEP_WATER    = Fl(13)  // steals items 50% of the time and moves them around randomly
 * 即唯一即死地形是熔岩；深水只偷物品、不杀任何东西（坠入深水零伤害，
 * Time.c:1146-1150）。CE 深水 tile（Globals.c:413）连 T_CAUSES_DAMAGE 都没有。
 *
 * 本轮改动（src/engine/Core/Game.ts，applyEnvironmentalEffects）：
 *   1. 深水分支的致死代码原样保留，但被 WEB_ONLY_DEEP_WATER_DROWNING=false
 *      （D2 标志）退出实际生效路径；
 *   2. 熔岩豁免对齐 CE applyInstantTileEffectsToCreature（Time.c:183-190）：
 *      悬浮 或 火焰免疫 之外，CE 还有第三条豁免 MONST_INVULNERABLE
 *      （全 CE 仅 Warden of Yendor 使用），web 原来缺这条，已补齐。
 *
 * 与 src/test/p1_24_death_sink.test.ts 的关系：该文件的对抗性①/②（水）/④（水）
 * 与玩家深水两条锁定的是"淹死会发生且死透"——它们假设的机制正是本轮按 D2
 * 移除的对象，本文件与之正面冲突（详见 ai_docs/p1_27_remove_drowning_report.md
 * 开头"与任务书预设不符"一节）。
 *
 * 每条测试前的注释写明它能捕获的具体错误实现；反向验证（真实改坏、真实失败
 * 输出、还原）见报告 §反向验证。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { logger } from '../engine/Systems/Logger';
import monsterDataJson from '../data/monsters.json';

const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

function clearToOpenRoom(game: Game): void {
    game.monsters.length = 0;
    game.items.length = 0;
    for (let x = 1; x < 30; x++) {
        for (let y = 1; y < 20; y++) {
            game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
        }
    }
    for (let x = 2; x <= 16; x++) {
        for (let y = 2; y <= 12; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            const cell = game.grid.getCell(x, y);
            if (cell) cell.isVisible = true;
        }
    }
    game.player.loc.x = 4;
    game.player.loc.y = 5;
    game.player.hp = game.player.maxHp;
}

/** 把 (x,y) 铺成指定地形（深水/熔岩），保持可见。 */
function setTile(game: Game, x: number, y: number, terrain: TerrainType): void {
    game.grid.setTerrain(x, y, terrain, '~', 0x3366cc);
    const cell = game.grid.getCell(x, y);
    if (cell) cell.isVisible = true;
}

/** 包装 logger.log 统计真实调用次数（Logger 会合并连续同文，不能靠 messages 数）。 */
function wrapLog(): { calls: string[]; restore: () => void } {
    const calls: string[] = [];
    const original = logger.log.bind(logger);
    logger.log = (text: string, color?: string) => {
        calls.push(text);
        original(text, color);
    };
    return { calls, restore: () => { delete (logger as { log?: unknown }).log; } };
}

function priv(game: Game): any {
    return game as any;
}

/** 模拟若干回合的环境结算（客观时间块每回合都会跑一遍）。 */
function tickEnvironment(game: Game, turns: number): void {
    for (let i = 0; i < turns; i++) {
        priv(game).applyEnvironmentalEffects();
    }
}

// ---------------------------------------------------------------------------
// 深水不再致死（D2 移除的对象）
// ---------------------------------------------------------------------------
describe('P1-27：深水不杀任何东西（CE T_IS_DEEP_WATER 只偷物品）', () => {
    it('对抗性①：怪物站在深水里连续若干回合必须仍然满血存活。' +
        '捕获的错误实现：旧版 web 自创淹死——第一轮环境结算就让怪物 die()，' +
        'hp 归 0、char 变 %、被清扫出列表；本条在任何"深水仍致死"的实现下失败。', () => {
        const game = createHeadlessGame(71);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        expect(rat.hp).toBe(6); // 前置：满血入水
        game.monsters.push(rat);

        const { calls, restore } = wrapLog();
        try {
            tickEnvironment(game, 5); // 5 个回合块：旧实现第 1 轮就会淹死它
        } finally {
            restore();
        }

        expect(rat.hp).toBe(6);                    // 毫发无损（深水零伤害，CE Time.c:1146-1150）
        expect(rat.char).not.toBe('%');            // 没有被当成尸体
        expect(calls.filter(t => t.includes('drowns')).length).toBe(0); // 没有淹死消息
        expect(game.monsters.find(m => m === rat)).toBeDefined();       // 还在列表里
    });

    it('对抗性①（续）：存活怪物经回合清扫（playerTurnEnded）后仍在场上——' +
        '深水不产生 hp<=0 的尸体供 filter(m => m.hp > 0) 清掉。' +
        '捕获的错误实现：任何"换个地方补刀"的变体（如把致死挪进回合收尾）。', () => {
        const game = createHeadlessGame(72);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        game.monsters.push(rat);

        tickEnvironment(game, 3);
        priv(game).playerTurnEnded(); // 回合收尾的死亡清扫

        expect(rat.hp).toBe(6);
        expect(game.monsters.find(m => m === rat)).toBeDefined();
    });

    it('对抗性②：玩家站在深水里连续若干回合不得 game over，hp 不得被扣。' +
        '捕获的错误实现：旧版玩家分支 triggerGameOver(false, Drowned…)——' +
        '第 1 轮结算 isGameOver 就翻 true，本条失败。', () => {
        const game = createHeadlessGame(73);
        clearToOpenRoom(game);
        setTile(game, 4, 5, TerrainType.WATER_DEEP); // 玩家脚下

        const player = game.player;
        player.hp = 30; // 明确满血入水：CE 里站在深水与 hp 无关

        const { calls, restore } = wrapLog();
        try {
            tickEnvironment(game, 5);
        } finally {
            restore();
        }

        expect(game.isGameOver).toBe(false);
        expect(player.hp).toBe(30);
        expect(player.char).toBe('@');
        expect(calls.filter(t => t.includes('drown')).length).toBe(0);
    });

    it('对抗性②（续）：满血怪物与玩家同时泡在深水里，谁也不死、无任何 drowns 消息。' +
        '捕获的错误实现：只删玩家分支漏删怪物分支（或反之）的部分移除——' +
        '残留的那个分支会在本条失败。', () => {
        const game = createHeadlessGame(74);
        clearToOpenRoom(game);
        setTile(game, 4, 5, TerrainType.WATER_DEEP); // 玩家脚下
        setTile(game, 5, 5, TerrainType.WATER_DEEP); // 怪物格（玩家邻格）

        const kobold = new Monster(5, 5, monsterDataById('kobold'));
        game.monsters.push(kobold);
        game.player.hp = 30;

        const { calls, restore } = wrapLog();
        try {
            tickEnvironment(game, 4);
        } finally {
            restore();
        }

        expect(kobold.hp).toBe(kobold.maxHp);
        expect(game.isGameOver).toBe(false);
        expect(calls.filter(t => t.includes('drown')).length).toBe(0);
    });
});

// ---------------------------------------------------------------------------
// 熔岩仍即死（对照组）与 CE 豁免条件
// ---------------------------------------------------------------------------
describe('P1-27：熔岩仍是唯一即死地形，豁免=悬浮/火焰免疫/无敌（CE Time.c:183-190）', () => {
    it('对照组：普通怪物站在熔岩上必须即死——防止"顺手把熔岩也关掉"。' +
        '捕获的错误实现：把深水移除写成"水/岩浆即死分支整体退役"——' +
        'rat.hp 停在 6 而非 0，本条失败。', () => {
        const game = createHeadlessGame(75);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        expect(rat.hp).toBe(6);
        game.monsters.push(rat);

        tickEnvironment(game, 1); // 即死：一轮足够

        expect(rat.hp).toBe(0);        // die() 收口（P1-24）
        expect(rat.char).toBe('%');
    });

    it('对照组（玩家）：玩家站熔岩仍然 game over。' +
        '捕获的错误实现：同上——熔岩分支被整体退役时 isGameOver 停留 false。', () => {
        const game = createHeadlessGame(76);
        clearToOpenRoom(game);
        setTile(game, 4, 5, TerrainType.LAVA);
        game.player.hp = 30;

        tickEnvironment(game, 1);

        expect(game.isGameOver).toBe(true);
    });

    it('豁免（悬浮）：levitating 状态的生物站熔岩不死（CE !status[STATUS_LEVITATING] 条款）。' +
        '捕获的错误实现：豁免条件被删/被写反（如漏了 !isFlying）——悬浮怪被烧死。', () => {
        const game = createHeadlessGame(77);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const bat = new Monster(7, 6, monsterDataById('rat'));
        bat.applyStatus('levitating', 20);
        expect(bat.hasStatus('levitating')).toBe(true); // 前置：豁免确实生效中
        game.monsters.push(bat);

        tickEnvironment(game, 3);

        expect(bat.hp).toBe(6);
        expect(bat.char).not.toBe('%');
    });

    it('豁免（火焰免疫）：immune_fire 状态的生物站熔岩不死（CE !status[STATUS_IMMUNE_TO_FIRE] 条款）。' +
        '捕获的错误实现：豁免条件被删/被写反——火免怪被烧死。', () => {
        const game = createHeadlessGame(78);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const fireproof = new Monster(7, 6, monsterDataById('rat'));
        fireproof.applyStatus('immune_fire', 20);
        expect(fireproof.hasStatus('immune_fire')).toBe(true);
        game.monsters.push(fireproof);

        tickEnvironment(game, 3);

        expect(fireproof.hp).toBe(6);
        expect(fireproof.char).not.toBe('%');
    });

    it('对抗性③（本轮对齐项）：MONST_INVULNERABLE 的生物站熔岩不死——' +
        'CE 第三条豁免（Time.c:185 !(info.flags & MONST_INVULNERABLE)，' +
        '全 CE 仅 Warden of Yendor 使用）。捕获的错误实现：改动前的 web——' +
        '熔岩分支只查悬浮/火免，Warden 会被岩浆烧死（P1-24 报告 §八.3 申报的缺口）。', () => {
        const game = createHeadlessGame(79);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const warden = new Monster(7, 6, monsterDataById('Warden_of_Yendor'));
        expect(warden.isInvulnerable()).toBe(true); // 前置：数据表确实带 MONST_INVULNERABLE
        game.monsters.push(warden);

        tickEnvironment(game, 3);

        expect(warden.hp).toBe(warden.maxHp);
        expect(warden.char).not.toBe('%');
        expect(game.monsters.find(m => m === warden)).toBeDefined();
    });
});
