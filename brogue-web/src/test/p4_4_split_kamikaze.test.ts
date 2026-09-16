/**
 * src/test/p4_4_split_kamikaze.test.ts — P4-4：分裂（MA_CLONE_SELF_ON_DEFEND）
 * 与自爆（MA_KAMIKAZE）+ 死亡地形（MA_DF_ON_DEATH）
 *
 * 对照 CE 源码（见 ai_docs/p4_4_split_kamikaze_report.md）：
 *   - splitMonster              Combat.c:222-310
 *   - alliedCloneCount          Combat.c:180-208
 *   - MA_KAMIKAZE               Combat.c:1159-1162（attack() 早退，早于命中掷骰）
 *   - MA_DF_ON_DEATH            Combat.c:1963-1990
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
import { rng } from '../engine/Random';
import { CombatSystem } from '../engine/Combat/Combat';
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

// 私有方法访问（与 harness.ts 的 GamePrivates 同一思路）：本轮的核心算法
// （trySplitMonster/triggerDeathFeatures/alliedCloneCount）刻意保持 private，
// 测试用 as any 拿到引用，不代表这是公开 API。
function priv(game: Game): any {
    return game as any;
}

// ---------------------------------------------------------------------------
// 验收 1：MA_CLONE_SELF_ON_DEFEND — 三只果冻正确分裂
// ---------------------------------------------------------------------------
describe('P4-4 验收 1：分裂 — pink/acidic/black jelly', () => {
    it('对抗性①：血量对半必须是 (hp+1)/2 向上取整，不能是 floor(hp/2)。' +
        '1 HP 的果冻分裂后，母体与克隆体都应存活于 1 HP —— 用 floor 会把母体打到 0 HP（应为存活但用例失败）。', () => {
        const game = createHeadlessGame(1);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(101);

        const jelly = new Monster(6, 5, monsterDataById('pink_jelly'));
        jelly.hp = 1;
        jelly.maxHp = 10;
        game.monsters.push(jelly);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;

        priv(game).trySplitMonster(jelly, player);

        expect(jelly.hp).toBe(1); // ceil(1/2) = 1，母体应仍存活
        expect(game.monsters.length).toBe(2);
        const clone = game.monsters.find(m => m !== jelly)!;
        expect(clone).toBeDefined();
        expect(clone.hp).toBe(1);
        expect(clone.typeId).toBe('pink_jelly');
    });

    it('对抗性②：走廊里攻击者所在格必须并入连通群，克隆体才可能出现在玩家身后。' +
        '漏掉这一步的实现里，1 格宽走廊中克隆体永远只会出现在果冻远离玩家的那一侧，' +
        '玩家这一侧（(4,5)）永远选不中——多次不同种子重复分裂应能观察到两侧都被选中过。', () => {
        // 1 格宽水平走廊：x=3..8, y=5；上下（y=4/y=6）与左右端点外是墙。
        const game = createHeadlessGame(2);
        clearToOpenRoom(game);
        for (let x = 2; x <= 9; x++) {
            for (let y = 4; y <= 6; y++) {
                game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
            }
        }
        for (let x = 3; x <= 8; x++) {
            game.grid.setTerrain(x, 5, TerrainType.FLOOR, '.', 0x888888);
            const c = game.grid.getCell(x, 5);
            if (c) c.isVisible = true;
        }
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;

        const seenLeftOfPlayer = new Set<number>(); // x < 5：玩家身后一侧
        const seenRightOfJelly = new Set<number>(); // x > 6：果冻远离玩家一侧

        for (let seed = 1; seed <= 60; seed++) {
            game.monsters.length = 0;
            const jelly = new Monster(6, 5, monsterDataById('pink_jelly'));
            jelly.hp = 20;
            jelly.maxHp = 20;
            game.monsters.push(jelly);
            rng.seedRandomGenerator(seed);

            priv(game).trySplitMonster(jelly, player);

            const clone = game.monsters.find(m => m !== jelly);
            if (clone) {
                if (clone.loc.x < player.loc.x) seenLeftOfPlayer.add(clone.loc.x);
                if (clone.loc.x > jelly.loc.x) seenRightOfJelly.add(clone.loc.x);
            }
        }

        expect(seenRightOfJelly.has(7)).toBe(true); // (7,5)：果冻自身连通群的边缘，两种实现都该选中
        expect(seenLeftOfPlayer.has(4)).toBe(true); // (4,5)：只有并入攻击者格才可能选中
    });

    it('对抗性③：连通群与合格格子的搜索必须是四方向，不能是八方向（含对角）。' +
        '果冻与玩家之间只留一条正交走廊，唯一开放的对角格 (7,4) 不应被选中——' +
        '八方向实现会偶尔选中它，四方向实现永远不会。', () => {
        const game = createHeadlessGame(3);
        clearToOpenRoom(game);
        // 果冻 (6,5) 的四个正交邻格：(5,5)=玩家、(7,5)=墙、(6,4)=墙、(6,6)=墙。
        // 对角 (7,4) 是唯一额外开放格，只能通过八方向"漏洞"被发现。
        for (let x = 2; x <= 16; x++) {
            for (let y = 2; y <= 12; y++) {
                game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
            }
        }
        const openFloor = (x: number, y: number) => {
            game.grid.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
            const c = game.grid.getCell(x, y);
            if (c) c.isVisible = true;
        };
        openFloor(5, 5); // 玩家
        openFloor(6, 5); // 果冻
        openFloor(4, 5); // 玩家身后（正交合格格，应该能被选中）
        openFloor(7, 4); // 对角格（不应该被选中）

        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;

        for (let seed = 1; seed <= 80; seed++) {
            game.monsters.length = 0;
            const jelly = new Monster(6, 5, monsterDataById('pink_jelly'));
            jelly.hp = 20;
            jelly.maxHp = 20;
            game.monsters.push(jelly);
            rng.seedRandomGenerator(seed);

            priv(game).trySplitMonster(jelly, player);

            const clone = game.monsters.find(m => m !== jelly);
            if (clone) {
                expect(clone.loc.x === 7 && clone.loc.y === 4).toBe(false);
            }
        }
    });

    it('acidic jelly 与 black jelly 也能分裂（同一套算法，覆盖三只果冻的名单要求）', () => {
        for (const id of ['acidic_jelly', 'black_jelly']) {
            const game = createHeadlessGame(4);
            clearToOpenRoom(game);
            rng.seedRandomGenerator(5);
            const jelly = new Monster(6, 5, monsterDataById(id));
            jelly.hp = jelly.maxHp; // 满血，确保 currentHP>0 分裂条件成立
            game.monsters.push(jelly);
            const player = game.player;
            player.loc.x = 5; player.loc.y = 5;

            priv(game).trySplitMonster(jelly, player);

            expect(game.monsters.length).toBe(2);
            const clone = game.monsters.find(m => m !== jelly)!;
            expect(clone.typeId).toBe(id);
        }
    });

    it('分裂条件：defender.hp<=0（已死）时不分裂，也不额外扣血', () => {
        const game = createHeadlessGame(5);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(6);
        const jelly = new Monster(6, 5, monsterDataById('pink_jelly'));
        jelly.hp = 0;
        game.monsters.push(jelly);
        const player = game.player;
        player.loc.x = 5; player.loc.y = 5;

        priv(game).trySplitMonster(jelly, player);

        expect(game.monsters.length).toBe(1);
        expect(jelly.hp).toBe(0);
    });

    it('无合格格子时不分裂：果冻被完全堵死（四邻全是墙或已占用），血量不变', () => {
        const game = createHeadlessGame(6);
        clearToOpenRoom(game);
        for (let x = 5; x <= 7; x++) {
            for (let y = 4; y <= 6; y++) {
                if (x === 6 && y === 5) continue;
                game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
            }
        }
        const jelly = new Monster(6, 5, monsterDataById('pink_jelly'));
        jelly.hp = 10;
        game.monsters.push(jelly);
        const player = game.player;
        // 玩家硬塞在墙缝之外，不与果冻相邻，避免把自己算进连通群开外挂通道
        player.loc.x = 10; player.loc.y = 10;

        priv(game).trySplitMonster(jelly, player);

        expect(game.monsters.length).toBe(1);
        expect(jelly.hp).toBe(10);
    });

    it('端到端：玩家近战攻击真的会经由 handlePlayerAction 触发分裂（不是只有单元测试里手调）', () => {
        const game = createHeadlessGame(7);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(42);

        const jelly = new Monster(5, 4, monsterDataById('pink_jelly'));
        jelly.hp = 30; // 高血量，避免一击打死导致没有"仍存活"的分裂条件
        jelly.maxHp = 30;
        jelly.defense = -999; // 保证必定命中
        game.monsters.push(jelly);
        game.player.loc.x = 5; game.player.loc.y = 5;

        let splitHappened = false;
        for (let i = 0; i < 20 && !splitHappened; i++) {
            const before = game.monsters.length;
            game.handlePlayerAction('move', { x: 0, y: -1 });
            if (game.monsters.length > before) splitHappened = true;
            if (game.monsters.find(m => m === jelly)?.hp! <= 0) break;
        }
        expect(splitHappened).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 验收 2：MA_KAMIKAZE — bloat / pit bloat / explosive bloat 自爆
// ---------------------------------------------------------------------------
describe('P4-4 验收 2：自爆 — bloat/pit_bloat/explosive_bloat', () => {
    it('对抗性④：kamikaze 检查必须在命中掷骰之前。把 defender 的防御力拉到' +
        '"正常情况下命中率≈0%"，kamikaze 攻击者仍必定"命中"（自毁），伤害恒为 0。' +
        '若实现把该检查放在命中判定之后，本用例会因为大量 miss 而在统计上偏离"每次都自毁"。', () => {
        const game = createHeadlessGame(8);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(7);

        const tank = new Monster(6, 5, monsterDataById('goblin')); // 无特殊旗标，纯粹当靶子
        tank.defense = 999; // 让 hitProbability 正常情况下几乎为 0
        game.monsters.push(tank);

        for (const id of ['bloat', 'pit_bloat', 'explosive_bloat']) {
            for (let i = 0; i < 20; i++) {
                const bloat = new Monster(5, 5, monsterDataById(id));
                const hpBefore = bloat.hp;
                const res = CombatSystem.attack(bloat, tank);
                expect(res.kamikazeSelfDestruct).toBe(true);
                expect(res.damage).toBe(0);
                expect(bloat.hp).toBeLessThanOrEqual(0);
                expect(hpBefore).toBeGreaterThan(0);
                expect(tank.hp).toBe(tank.maxHp); // defender 完全未受影响
            }
        }
    });

    it('自爆怪物攻击玩家：玩家血量不变，攻击者死亡', () => {
        const game = createHeadlessGame(9);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(8);

        const bloat = new Monster(5, 5, monsterDataById('bloat'));
        const hpBefore = game.player.hp;
        const res = CombatSystem.attack(bloat, game.player);

        expect(res.kamikazeSelfDestruct).toBe(true);
        expect(game.player.hp).toBe(hpBefore);
        expect(bloat.hp).toBeLessThanOrEqual(0);
    });

    it('对照组：vampire 有 MA_DF_ON_DEATH 但没有 MA_KAMIKAZE，攻击不应自爆', () => {
        const game = createHeadlessGame(10);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(9);

        const vampire = new Monster(5, 5, monsterDataById('vampire'));
        const res = CombatSystem.attack(vampire, game.player);
        expect(res.kamikazeSelfDestruct).toBeUndefined();
        expect(vampire.hp).toBeGreaterThan(0); // 没有自毁
    });

    it('对照组：goblin 没有任何特殊旗标，正常战斗不受影响', () => {
        const game = createHeadlessGame(11);
        clearToOpenRoom(game);
        rng.seedRandomGenerator(10);

        const goblin = new Monster(5, 5, monsterDataById('goblin'));
        const res = CombatSystem.attack(goblin, game.player);
        expect(res.kamikazeSelfDestruct).toBeUndefined();
        expect(goblin.hp).toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 验收 3：MA_DF_ON_DEATH — bloat 毒气 / explosive bloat 爆燃
// ---------------------------------------------------------------------------
describe('P4-4 验收 3：死亡地形 — bloat 毒气 / explosive bloat 爆燃', () => {
    it('bloat 死亡在原地释放毒气（GasType.POISON，G-1 起注入 CE 体积 2000）', () => {
        const game = createHeadlessGame(12);
        clearToOpenRoom(game);

        const bloat = new Monster(7, 6, monsterDataById('bloat'));
        bloat.hp = 0;
        game.monsters.push(bloat);

        priv(game).triggerDeathFeatures();

        const gasCell = game.environment.gasGrid[7]![6]!;
        // G-1 翻正：GasType 改基到 GAS 层地形值（旧枚举值 2 = TerrainType.FLOOR，
        // 与新 POISON 不再同值）；density 语义 = CE volume（bloat 注入 2000）。
        expect(gasCell.type).toBe(GasType.POISON);
        expect(gasCell.density).toBeGreaterThan(0);
        expect(bloat.deathEffectTriggered).toBe(true);
    });

    it('explosive bloat 死亡在原地及四方向邻格点燃火焰（可燃地形 GRASS，用作与下一条"默认石地板"对照）', () => {
        const game = createHeadlessGame(13);
        clearToOpenRoom(game);
        for (let x = 6; x <= 8; x++) {
            for (let y = 5; y <= 7; y++) {
                game.grid.setTerrain(x, y, TerrainType.GRASS, '"', 0x44aa44);
                const c = game.grid.getCell(x, y);
                if (c) c.isVisible = true;
            }
        }
        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        bloat.hp = 0;
        game.monsters.push(bloat);

        priv(game).triggerDeathFeatures();

        expect(game.grid.getCell(7, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 5)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 7)?.isBurning).toBe(true);
        expect(game.grid.getCell(6, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(8, 6)?.isBurning).toBe(true);
    });

    it('验收打回修正：explosive bloat 死亡在默认（不可燃）石地板上也必须点燃死亡格与四方向邻格。' +
        '这是本轮真正要保证的场景——地牢里绝大多数格子不是 GRASS。' +
        '对抗性⑥：若"强制点燃"被误实现成直接调用老的 ignite()（检查地形白名单），' +
        '这条用例会在石地板上全部落空。', () => {
        const game = createHeadlessGame(19);
        clearToOpenRoom(game); // clearToOpenRoom 铺的是 TerrainType.FLOOR，不在 ignite() 白名单里
        expect(game.grid.getCell(7, 6)?.terrain).toBe(TerrainType.FLOOR);

        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        bloat.hp = 0;
        game.monsters.push(bloat);

        priv(game).triggerDeathFeatures();

        expect(game.grid.getCell(7, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 5)?.isBurning).toBe(true);
        expect(game.grid.getCell(7, 7)?.isBurning).toBe(true);
        expect(game.grid.getCell(6, 6)?.isBurning).toBe(true);
        expect(game.grid.getCell(8, 6)?.isBurning).toBe(true);
        // 对角格不应被点燃（爆炸只覆盖四方向，与分裂的四方向约束同口径）。
        expect(game.grid.getCell(8, 5)?.isBurning).toBeFalsy();
    });

    // 验收方 F-2b 后翻正（原名："…走完整回合结算后真的掉血（不是只读 isBurning）"）。
    //
    // 过期的是**实现细节假设**，不是断言意图：F-2b 把燃烧改成生物自身的状态
    // （CE STATUS_BURNING），于是 CE 客观块的原序生效——环境段 `applyEnvironmentalEffects`
    // 负责**点火**（Time.c:2671），状态段 `tickCreatureStatuses` 才**结算伤害**
    // （Time.c:2677 / :2581-2591）。原测试只调一次环境段就断言掉血，
    // 那是"环境段即伤害段"的旧模型。
    //
    // **守卫语义完整保留、未放宽**：把"必须掉血"拆成两段各自断言——
    // 环境段后必须挂上燃烧状态、状态段后必须掉血。漏掉任一段都会翻红。
    //
    // 另：CE 里 bloat 爆炸对生物的伤害其实来自 GAS_EXPLOSION 地形的
    // `T_CAUSES_EXPLOSIVE_DAMAGE` 瞬时伤害（Globals.c:496 + DF_BLOAT_EXPLOSION:654），
    // 与燃烧状态无关——那条归 **F-2c**，本断言不代表爆炸伤害已按 CE 实现。
    it('F-2b 翻正：站在爆炸格上的生物，环境段挂燃烧状态、状态段真的掉血', () => {
        const game = createHeadlessGame(20);
        clearToOpenRoom(game);

        const victim = new Monster(8, 6, monsterDataById('rat'));
        victim.hp = victim.maxHp;
        game.monsters.push(victim);

        const bloat = new Monster(7, 6, monsterDataById('explosive_bloat'));
        bloat.hp = 0;
        game.monsters.push(bloat);

        const hpBefore = victim.hp;
        priv(game).triggerDeathFeatures();

        // 环境段：点火（CE Time.c:2671）。F-2b 起它只挂状态、不结算伤害。
        priv(game).applyEnvironmentalEffects();
        expect(
            priv(game).burningDuration(victim),
            '环境段后受害者没挂上燃烧状态——爆炸格的火没点着它'
        ).toBeGreaterThan(0);

        // 状态段：燃烧结算（CE Time.c:2677 → :2581-2591，rand_range(1,3)）。
        priv(game).tickCreatureStatuses();
        expect(
            victim.hp,
            '状态段后没掉血——燃烧状态挂上了却不结算伤害'
        ).toBeLessThan(hpBefore);
    });

    it('对抗性⑤：同一只怪物的死亡地形效果只能触发一次。' +
        '若实现没有 deathEffectTriggered 兜底且被多次调用（例如某条路径在同一回合内重复扫描），' +
        '毒气密度会被反复叠加，超过单次触发应有的量——这里直接调用两次断言密度不变。', () => {
        const game = createHeadlessGame(14);
        clearToOpenRoom(game);
        const bloat = new Monster(7, 6, monsterDataById('bloat'));
        bloat.hp = 0;
        game.monsters.push(bloat);

        priv(game).triggerDeathFeatures();
        const densityAfterFirst = game.environment.gasGrid[7]![6]!.density;

        priv(game).triggerDeathFeatures();
        const densityAfterSecond = game.environment.gasGrid[7]![6]!.density;

        expect(densityAfterSecond).toBe(densityAfterFirst);
    });

    it('对照组：vampire 死亡不产生毒气/火焰（DF_BLOOD_EXPLOSION 是血迹装饰，web 无血迹层，本轮不接）', () => {
        const game = createHeadlessGame(15);
        clearToOpenRoom(game);
        const vampire = new Monster(7, 6, monsterDataById('vampire'));
        vampire.hp = 0;
        game.monsters.push(vampire);

        priv(game).triggerDeathFeatures();

        expect(game.environment.gasGrid[7]![6]!.density).toBe(0);
        expect(game.grid.getCell(7, 6)?.isBurning).toBeFalsy();
        expect(vampire.deathEffectTriggered).toBe(true); // 仍标记已处理（有 MA_DF_ON_DEATH），只是没有落地效果
    });

    it('对照组：goblin（无 MA_DF_ON_DEATH）死亡不触发也不被标记', () => {
        const game = createHeadlessGame(16);
        clearToOpenRoom(game);
        const goblin = new Monster(7, 6, monsterDataById('goblin'));
        goblin.hp = 0;
        game.monsters.push(goblin);

        priv(game).triggerDeathFeatures();

        expect(game.environment.gasGrid[7]![6]!.density).toBe(0);
        expect(goblin.deathEffectTriggered).toBe(false);
    });

    it('pit_bloat 只自爆、不产生毒气/火焰/洞（web 无坠落子系统，登记为已知缺口）', () => {
        const game = createHeadlessGame(17);
        clearToOpenRoom(game);
        const pitBloat = new Monster(7, 6, monsterDataById('pit_bloat'));
        pitBloat.hp = 0;
        game.monsters.push(pitBloat);

        priv(game).triggerDeathFeatures();

        expect(game.environment.gasGrid[7]![6]!.density).toBe(0);
        expect(game.grid.getCell(7, 6)?.isBurning).toBeFalsy();
        expect(pitBloat.deathEffectTriggered).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 验收 4：盟友不主动冲向自爆怪物（monsterFleesFrom 的最小移植）
// ---------------------------------------------------------------------------
describe('P4-4 验收 4：AI 不主动冲向 kamikaze 目标', () => {
    it('盟友在有其它可选目标时，不会把尚未贴脸的 bloat 选为追击目标', () => {
        const game = createHeadlessGame(18);
        clearToOpenRoom(game);

        const ally = new Monster(5, 5, monsterDataById('goblin'));
        ally.isAlly = true;
        ally.state = 2 /* HUNTING，任意非 ASLEEP 值即可，takeTurn 内部会再判 */;

        const bloat = new Monster(8, 5, monsterDataById('bloat')); // 距离 3，不相邻
        const rat = new Monster(6, 5, monsterDataById('rat'));     // 距离 1，可选的非 kamikaze 目标

        game.monsters.push(ally, bloat, rat);

        ally.takeTurn(game, 3);

        // ally 应该攻击/选择 rat（近且非 kamikaze），而不是绕过更近目标去冲向 bloat。
        // 用"bloat 未掉血"间接验证：ally 贴脸时才会真正伤到 bloat。
        expect(bloat.hp).toBe(monsterDataById('bloat').hp);
    });
});
