/**
 * src/test/p1_24_death_sink.test.ts — P1-24：淹死/熔岩烧死的怪物必须真的死了
 *
 * 病灶：Creature.die() 此前只改尸体外观（'%' + 深红），不归零 hp。
 * Game.applyEnvironmentalEffects 的深水/熔岩分支把 die() 当唯一致死手段，
 * 结果怪物满血留在 this.monsters 里：继续行动、继续攻击、死亡消息每回合重播，
 * playerTurnEnded 的 filter(m => m.hp > 0) 永远清不掉。
 *
 * CE 对照（见 ai_docs/p1_24_death_sink_report.md）：
 *   - killCreature 最后 currentHP = 0          Combat.c:2042
 *   - MB_IS_DYING|MB_HAS_DIED 幂等守卫          Combat.c:1938-1941
 *   - 死亡 DF 只被 administrativeDeath/MB_IS_FALLING 抑制，无水/岩浆否决
 *                                              Combat.c:1963-1967
 *   - DF_BLOAT_DEATH = GAS 层毒气，spawnDungeonFeature 无条件加体积
 *                                              Globals.c:651（DF 表 34 号）
 *   - DF_BLOAT_EXPLOSION = 表层 GAS_EXPLOSION 火格，爆炸伤害只豁免
 *     STATUS_EXPLOSION_IMMUNITY 与 MB_SUBMERGED，没有"站在水里"豁免
 *                                              Time.c:343-345
 * 结论：水中/岩浆中死亡的膨胀怪照常触发死亡地形——本文件把该结论锁死。
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里；
 * 反向验证（真实改坏代码、跑出失败、贴输出、再还原）见报告。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { GasType } from '../engine/Environment/Gas';
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

// ---------------------------------------------------------------------------
// 验收 1：die() 是真正的致死收口
// ---------------------------------------------------------------------------
describe('P1-24 验收 1：die() 归零 hp，怪物真的被移出列表', () => {
    it('对抗性①：深水淹死后 hp 必须精确为 0（CE Combat.c:2042 currentHP=0）。' +
        '捕获的错误实现：die() 保持旧版只改外观不归零——6 HP 的老鼠淹死后 hp 仍是 6，' +
        '断言 hp===0 直接失败。', () => {
        const game = createHeadlessGame(21);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        expect(rat.hp).toBe(6); // 前置：满血入水（与验收方探针同款场景）
        game.monsters.push(rat);

        priv(game).applyEnvironmentalEffects();

        expect(rat.hp).toBe(0);
        expect(rat.char).toBe('%');
    });

    it('对抗性①（续）：淹死的怪物必须在下一次回合清扫中被移出 this.monsters。' +
        '捕获的错误实现：同上——旧实现 hp>0，filter(m => m.hp > 0) 永远清不掉，' +
        '怪物赖在列表里（验收方探针的"清扫后仍在列表=true"）。', () => {
        const game = createHeadlessGame(22);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        game.monsters.push(rat);

        priv(game).applyEnvironmentalEffects();
        priv(game).playerTurnEnded();

        expect(game.monsters.find(m => m === rat)).toBeUndefined();
    });

    it('对抗性①（续）：淹死的尸体不再苏醒/不再行动——沉睡老鼠被淹死后 takeTurn 必须是空转。' +
        '捕获的错误实现：die() 不归零（旧版）时，takeTurn 会照常走"沉睡→惊醒"分支，' +
        '在玩家头顶弹 \'!\' 漂浮字并进入追击。', () => {
        const game = createHeadlessGame(23);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        rat.state = 0; // ASLEEP：若 die() 没归零，相邻玩家会把它惊醒（弹 '!'）
        game.monsters.push(rat);
        const player = game.player;
        player.loc.x = 6; player.loc.y = 6; // 与水格相邻

        priv(game).applyEnvironmentalEffects();
        const floatsBefore = game.floatingTexts.length;
        const playerHpBefore = player.hp;
        rat.takeTurn(game, 3);

        expect(rat.hp).toBe(0);
        expect(game.floatingTexts.length).toBe(floatsBefore); // 没有 '!' 惊醒字
        expect(player.hp).toBe(playerHpBefore);               // 也没有攻击
    });

    it('对抗性②：死亡消息只播一次。连续两轮环境结算（模拟两次客观时间块），' +
        '"drowns" 消息恰好出现 1 次。捕获的错误实现：①旧版 die() 不归零，第二轮' +
        'checkEntity 再次进入水分支重播；②任何"把消息日志挪到 hp 闸之前"的重排。' +
        'Logger 会合并连续同文（count++），所以必须包一层 log 计数才测得出重播。', () => {
        const game = createHeadlessGame(24);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        game.monsters.push(rat);

        const { calls, restore } = wrapLog();
        try {
            priv(game).applyEnvironmentalEffects();
            priv(game).applyEnvironmentalEffects(); // 第二轮：已死，必须早退
        } finally {
            restore();
        }

        expect(calls.filter(t => t.includes('drowns')).length).toBe(1);
        // Logger 的合并计数器同样必须停在 1（这就是验收探针里"每回合重播"的读数）
        const entry = logger.messages.find(m => m.text.includes('drowns'));
        expect(entry).toBeDefined();
        expect(entry!.count).toBe(1);
    });

    it('对抗性②（续）：熔岩烧死同理，"incinerated" 只播一次。', () => {
        const game = createHeadlessGame(25);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA);

        const rat = new Monster(7, 6, monsterDataById('rat'));
        game.monsters.push(rat);

        const { calls, restore } = wrapLog();
        try {
            priv(game).applyEnvironmentalEffects();
            priv(game).applyEnvironmentalEffects();
        } finally {
            restore();
        }

        expect(calls.filter(t => t.includes('incinerated')).length).toBe(1);
        const entry = logger.messages.find(m => m.text.includes('incinerated'));
        expect(entry!.count).toBe(1);
    });

    it('对抗性③：hp -= N 之后才调用 die() 的既有路径不得被改成重复结算——' +
        '火焰致死的尸体 hp 必须精确停在 0（CE 口径），不能是负数。' +
        '捕获的错误实现：把 die() 写成"再补一刀"（如 hp -= maxHp 确保死亡），' +
        '2 HP 的受害者被火焰扣到 0 后又被补刀扣成负数，=== 0 断言失败。', () => {
        const game = createHeadlessGame(26);
        clearToOpenRoom(game);
        const cell = game.grid.getCell(7, 6)!;
        cell.isBurning = true; // 燃烧格：每轮对格上生物 -2
        cell.burnDuration = 5;

        const victim = new Monster(7, 6, monsterDataById('rat'));
        victim.hp = 2; // 恰好一烧即死
        game.monsters.push(victim);

        const { calls, restore } = wrapLog();
        try {
            priv(game).applyEnvironmentalEffects();
        } finally {
            restore();
        }

        expect(victim.hp).toBe(0); // 精确 0：既不是 -4（重复结算），也没被漏杀
        expect(victim.char).toBe('%');
        expect(calls.filter(t => t.includes('burns to death')).length).toBe(1);
    });

    it('对抗性③（续）：蒸汽致死同样精确归零——1 HP 受害者被蒸汽扣 1 后死透，' +
        '不残留负 hp（重复结算实现会把它扣成 -1 或更低）。', () => {
        const game = createHeadlessGame(27);
        clearToOpenRoom(game);
        game.environment.addGas(7, 6, GasType.STEAM, 50); // density>20 才结算

        const victim = new Monster(7, 6, monsterDataById('rat'));
        victim.hp = 1;
        game.monsters.push(victim);

        priv(game).applyEnvironmentalEffects();

        expect(victim.hp).toBe(0);
        expect(victim.char).toBe('%');
    });
});

// ---------------------------------------------------------------------------
// 验收 2：与 P4-4 的交互——水中/岩浆中死亡照常触发死亡地形（CE 行为）
// CE 依据：killCreature 传 administrativeDeath=false，MA_DF_ON_DEATH 分支只看
// MB_IS_FALLING（Combat.c:1963-1965）；spawnDungeonFeature 对 GAS 层无条件加
// 体积、对表层格 killCreature 传 abortIfBlocking=false（Architect.c:3359 起），
// 全链路没有"脚下是水/岩浆就不触发"的判断；爆炸伤害豁免里也没有水
// （Time.c:343-345 只豁免爆炸免疫与 MB_SUBMERGED）。
// ---------------------------------------------------------------------------
describe('P1-24 验收 2：水中/岩浆中死亡的死亡地形照常触发', () => {
    it('对抗性④：深水里的 bloat 淹死后照样放毒气。捕获的错误实现：' +
        '①旧版 die() 不归零——bloat 根本没死，triggerDeathFeatures 按 hp<=0 扫描' +
        '扫不到它，毒气密度恒 0；②"水中死亡抑制死亡地形"的错误结论被实现成' +
        '水中跳过 DF——同样密度恒 0。两种坏实现都过不了这条。', () => {
        const game = createHeadlessGame(28);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const bloat = new Monster(7, 6, monsterDataById('bloat'));
        expect(bloat.hp).toBeGreaterThan(0);
        game.monsters.push(bloat);

        priv(game).applyEnvironmentalEffects(); // 淹死（走 die()，不是手工置 hp=0）
        expect(bloat.hp).toBe(0);               // 前置确认：确实死于水
        priv(game).triggerDeathFeatures();      // 回合收尾的死亡地形扫描

        const gasCell = game.environment.gasGrid[7]![6]!;
        expect(gasCell.type).toBe(GasType.POISON);
        expect(gasCell.density).toBeGreaterThan(0);
        expect(bloat.deathEffectTriggered).toBe(true);
    });

    it('对抗性④（续）：岩浆里的 explosive bloat 烧死后照样爆燃——死亡格与四邻点燃。' +
        'CE 岩浆致死走 killCreature(monst, false)（Time.c:218），DF 不被抑制。' +
        '"岩浆里就不用点火"的错误实现会在 isBurning 断言上失败。', () => {
        const game = createHeadlessGame(29);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.LAVA); // 邻格保持 FLOOR，观察四邻点火

        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        game.monsters.push(bloat);

        priv(game).applyEnvironmentalEffects();
        expect(bloat.hp).toBe(0);
        priv(game).triggerDeathFeatures();

        expect(game.grid.getCell(7, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 5)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 7)?.isBurning).toBe(true);
        expect(game.grid.getCell(6, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(8, 6)?.isBurning).toBe(true);
        expect(bloat.deathEffectTriggered).toBe(true);
    });

    it('对抗性④（续）：深水里的 explosive bloat 淹死后照样爆燃——"水里燃起大火"' +
        '是 CE 行为：GAS_EXPLOSION 火格铺在表层、覆盖在水上，爆炸伤害路径对' +
        '站水里的生物没有豁免（Time.c:343-345）。"水中抑制点火"的错误实现在此失败。', () => {
        const game = createHeadlessGame(30);
        clearToOpenRoom(game);
        setTile(game, 7, 6, TerrainType.WATER_DEEP);

        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        game.monsters.push(bloat);

        priv(game).applyEnvironmentalEffects();
        expect(bloat.hp).toBe(0);
        priv(game).triggerDeathFeatures();

        expect(game.grid.getCell(7, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(8, 6)?.isBurning).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 验收 3：对照组——正常战斗致死行为不变
// ---------------------------------------------------------------------------
describe('P1-24 验收 3：对照组——正常战斗致死不受影响', () => {
    it('玩家近战击杀 bloat：仍被清扫、仍掉落、死亡地形照常触发、hp 精确归零。' +
        '捕获的错误实现：die() 归零被写成"在 die() 里额外扣一次伤害/改动 takeDamage' +
        '语义"——hp 会偏离 0，或掉落/清扫路径被误伤。', () => {
        const game = createHeadlessGame(31);
        clearToOpenRoom(game);

        const bloat = new Monster(5, 5, monsterDataById('bloat'));
        bloat.hp = 2;            // 保证一刀必死（玩家命中即 ≥1 伤害）
        bloat.defense = -999;    // 保证必定命中
        bloat.goldDropChance = 1;  // randPercent(100) 恒真 → 必掉金
        bloat.itemDropChance = 1;  // 必掉物品
        game.monsters.push(bloat);
        const player = game.player;
        player.loc.x = 4; player.loc.y = 5;

        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        // 击杀落账
        expect(game.stats.kills).toBe(1);
        // die() 收口：hp 精确归零（takeDamage 扣到 <=0 后由 die() 钳到 0）
        expect(bloat.hp).toBe(0);
        // 清扫：本回合内被移出列表
        expect(game.monsters.find(m => m === bloat)).toBeUndefined();
        // 掉落：金 + 物品各一（randPercent(100) 恒真）
        expect(game.items.length).toBe(2);
        expect(game.items.some(i => i.char === '$')).toBe(true);
        // 死亡地形：MA_DF_ON_DEATH 照常（与修复前一致的既有行为）
        expect(game.environment.gasGrid[5]![5]!.type).toBe(GasType.POISON);
        expect(game.environment.gasGrid[5]![5]!.density).toBeGreaterThan(0);
    });

    it('对照组：战斗致死与水淹致死走同一条收口——被玩家砍死在水里的 bloat 一样放毒气' +
        '（CE：killCreature 不区分伤害来源，只看 administrativeDeath/MB_IS_FALLING）。', () => {
        const game = createHeadlessGame(32);
        clearToOpenRoom(game);
        setTile(game, 5, 5, TerrainType.WATER_SHALLOW); // 浅水不淹死，怪站在水里挨打

        const bloat = new Monster(5, 5, monsterDataById('bloat'));
        bloat.hp = 2;
        bloat.defense = -999;
        game.monsters.push(bloat);
        const player = game.player;
        player.loc.x = 4; player.loc.y = 5;

        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        expect(bloat.hp).toBe(0);
        expect(game.monsters.find(m => m === bloat)).toBeUndefined();
        expect(game.environment.gasGrid[5]![5]!.type).toBe(GasType.POISON);
        expect(game.environment.gasGrid[5]![5]!.density).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 验收 4：玩家路径——深水/熔岩仍走 triggerGameOver，不经过 die()
// ---------------------------------------------------------------------------
describe('P1-24 验收 4：玩家落水/落熔岩仍走 triggerGameOver', () => {
    it('玩家在深水中：游戏结束、hp 不被扣（溺水是事件死不是伤害死）、尸体外观不是 die() 给的 %。' +
        '捕获的错误实现：把玩家也改走 die()——hp 会被清 0 或 char 变 %。', () => {
        const game = createHeadlessGame(33);
        clearToOpenRoom(game);
        setTile(game, 4, 5, TerrainType.WATER_DEEP); // 玩家脚下

        const player = game.player;
        player.hp = 30; // 明确满血入水：淹死与 hp 无关
        expect(player.char).toBe('@');

        priv(game).applyEnvironmentalEffects();

        expect(game.isGameOver).toBe(true);
        expect(player.hp).toBe(30);      // 未走 takeDamage/die()
        expect(player.char).toBe('@');   // 未走 die()
    });

    it('玩家在熔岩中：同样走 triggerGameOver，hp 与外观不被 die() 触碰。', () => {
        const game = createHeadlessGame(34);
        clearToOpenRoom(game);
        setTile(game, 4, 5, TerrainType.LAVA);

        const player = game.player;
        player.hp = 30;

        priv(game).applyEnvironmentalEffects();

        expect(game.isGameOver).toBe(true);
        expect(player.hp).toBe(30);
        expect(player.char).toBe('@');
    });
});
