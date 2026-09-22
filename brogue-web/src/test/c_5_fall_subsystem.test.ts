/**
 * src/test/c_5_fall_subsystem.test.ts — C-5：坠落子系统（深渊/洞/桥梁解禁）
 *
 * CE 对照（BrogueCE-master/src/brogue/，只读）：
 *   - monsterShouldFall        Time.c:110-116
 *   - 置位（回合末才坠）       Time.c:168-176；Movement.c:1474-1476
 *   - playerFalls              Time.c:1122-1180（8-10 clump2；深水零伤；浅水减半）
 *   - monstersFall             Time.c:1530-1583（6-12 clump2；守卫类必死；幸存者下层）
 *   - 跳渊确认                 Movement.c:1303-1322
 *   - 坠落落位                 RogueMain.c:820-841
 *   - 桥                       Architect.c:2786-2876；pathingDistance 不可达 =
 *                              30000（Dijkstra.c:247 pdsClear）——CE 桥的主场景
 *                              正是"干地被深渊带切断、绕不过去"
 *   - 药水                     Items.c:8095-8100（洞照开；悬浮不坠）
 *   - pit bloat 死亡 DF        Globals.c:1039 → DF_HOLE_POTION
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里。
 */
import { describe, it, expect } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { Monster, MonsterState, type MonsterData } from '../entities/Monster';
import { TerrainType } from '../engine/Map/Grid';
import { buildABridge } from '../engine/Map/LakeSystem';
import { Grid } from '../engine/Map/Grid';
import { Architect } from '../engine/Generator/Architect';
import { rng } from '../engine/Random';
import { ItemLoader } from '../engine/Items/ItemLoader';
import { timeSystem } from '../engine/Systems/Time';
import monsterDataJson from '../data/monsters.json';

const MONSTER_DATA = monsterDataJson as MonsterData[];

function monsterDataById(id: string): MonsterData {
    const row = MONSTER_DATA.find(m => m.id === id);
    if (!row) throw new Error(`monsters.json 中找不到 ${id}`);
    return row;
}

function priv(game: Game): any {
    return game as unknown as Record<string, unknown>;
}

/** 合成场景：封闭房间（可走区 x2-16 / y2-12），怪清空，玩家满血。 */
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

function setTile(game: Game, x: number, y: number, terrain: TerrainType, ch = '.', color = 0x888888): void {
    game.grid.setTerrain(x, y, terrain, ch, color);
    const cell = game.grid.getCell(x, y);
    if (cell) {
        cell.isVisible = true;
        cell.isDiscovered = true;
    }
}

function spawnMonsterAt(game: Game, id: string, x: number, y: number): Monster {
    const m = new Monster(x, y, monsterDataById(id));
    game.monsters.push(m);
    return m;
}

// ---------------------------------------------------------------------------
// 对抗①：回合末结算（不是踩上瞬间）
// ---------------------------------------------------------------------------
describe('C-5 对抗①：坠落是回合末结算（CE Time.c:168-176/2480）', () => {
    it('踩上渊格的同一动作里怪物不得获得回合（CE：playerFalls 整段 return，' +
        '没有怪物推进）；坠落本体在玩家回合末照常发生', () => {
        const game = createHeadlessGame(20260917);
        clearToOpenRoom(game);
        // 玩家 (4,5)；渊格 (6,5)（已发现）；rat 在 (4,4)（与玩家原位相邻，会行动）。
        setTile(game, 6, 5, TerrainType.CHASM, ' ', 0x222222);
        const rat = spawnMonsterAt(game, 'rat', 4, 4);
        rat.state = MonsterState.HUNTING;

        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system'); // (4,5)→(5,5)
        const rngBeforeDive = rng.randomNumbersGenerated;
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system'); // (5,5)→(6,5)=渊 → 回合末坠落

        expect(game.depth, '踩渊后未坠落（回合末时序被改成踩上瞬间或不坠）').toBe(2);
        // CE Time.c:2480（坠落门）整段 return——坠落回合没有推进循环、没有
        // 客观块、没有气味刷新：整个动作的 RNG 消耗恰为两次移动各自的固定
        // 账（流计数器见 Random.randomNumbersGenerated）。"踩上瞬间坠落"的
        // 错误实现会放行随后的完整 playerTurnEnded（推进循环+客观块），
        // 额外消耗 RNG，增量立即偏离。pin 值捕获自正确实现（seed 固定）。
        const rngAfter = rng.randomNumbersGenerated;
        // pin 值 = D2 一层的完整生成成本，随生成链 legitimately 变化：
        //   7550 = C-5 捕获（C-6 前）；
        //   12327 = C-6 重捕获——runAutogenerators(false) 接进 generateTerrain
        //   后，DF_GRASS/DF_FOLIAGE 的 spawnMapDF 传播骰 + randomMatchingLocation
        //   选点抽取计入固定生成成本（CE 同构：CE 的 runAutogenerators 也在
        //   digDungeon 里掷这些骰）；
        //   14218 = B-4a 重捕获——计量表读写 + 频率加权 chooseKind + 食物保底
        //   （web 此前一局 0 个食物）进入物品生成路径，每层掷骰增加；
        //   10611 = V-1c 重捕获——机器数量从 3.89/层降到 0.22/层（CE 奖励房配额
        //   还原），生成期掷骰大幅减少，故本轮是沿革里**唯一下降**的一次；
        //   15344 = B-4b 重捕获——数量公式改为 CE 的无上界几何分布、
        //   热力图选点 rand_range(1,totalHeat)、金币堆数与产量调度进入生成路径。
        //   15339 = V-1a 重捕获——拆掉 _random_good_ 直投（删六选一掷骰与
        //   11 处蓝图直投 feature；D2 层地图因此整体位移，生成成本微变 5 掷）。
        //   （本 pin 一夜内被 B-4a / B-4b 两个生成轮各顶一次，属预期成本：
        //   每个移动生成流的轮次 +1 行。）
        //   机制断言不变：坠落的消耗必须恰等于"一层的固定生成账"，
        //   多一分都是坠落门漏了 return。
        //
        // 验收方 2026-09-18 说明「为什么这里允许硬填数值」：
        // 本项目的哨兵纪律（见 project_conventions / 交接文档）禁止把撞断的
        // 哨兵硬填回去，但那条针对的是**锚定 RNG 流绝对位置**的哨兵。
        // 这一条本身已是形态①（消耗增量），只是它要断言的量
        // ——"恰等于一层的生成成本"——本质上就随生成链变化。
        // 试过改成"运行时测量生成成本再比对"：web 的 RNG 是**单条连续流、
        // 不按深度重播种**（Game.ts:543 全局只播种一次），换个流位置生成
        // 同一层的成本就不同（`while(rand_percent(60))` 这类无上界循环使然），
        // 故该量在本轮设计下**无法脱离 seed+路径独立测得**。
        // 保持维护式 pin 是原作者的既定设计（注释里本就列着 7550→12327 的
        // 沿革）；真正的机制防线是本 it 里另外 12 条断言（怪物不得推进、
        // 不得受伤、深度已变、玩家掉血），它们本轮全绿。
        expect(rngAfter - rngBeforeDive, '坠落回合的 RNG 消耗增量偏离（= 换层生成的固定消耗，'
            + 'CE 坠落门整段 return：无推进循环/客观块的额外消耗）')
            // 10401 = V-2b-8：强制 thematic 机器改变换层生成流。
            // 16214 = V-2b-9e-1：区域机器路由使同样本机器数 469→823，
            // 换层生成成本顺延；仍钉“只有换层、没有怪物推进”的固定增量。
            .toBe(16214);
        expect(rat.hp, '随落阶段 rat 不在渊上，不得受伤/死亡').toBeGreaterThan(0);
        expect([rat.loc.x, rat.loc.y], '坠落回合怪物不得获得推进（CE playerFalls 提前 return）')
            .toEqual([4, 4]);
        expect(game.player.hp, '坠落应造成 8-10（clump2）伤害（满血进入必掉血）')
            .toBeLessThan(game.player.maxHp);
    });
});

// ---------------------------------------------------------------------------
// 对抗②：悬浮豁免
// ---------------------------------------------------------------------------
describe('C-5 对抗②：悬浮豁免（CE monsterShouldFall Time.c:110-116）', () => {
    it('悬浮玩家站渊上多回合：不坠、层不变；且已发现渊格在悬浮时不触发跳渊确认', () => {
        const game = createHeadlessGame(20260918);
        clearToOpenRoom(game);
        setTile(game, 6, 5, TerrainType.CHASM, ' ', 0x222222);

        let confirmCalls = 0;
        game.onConfirmRequest = () => { confirmCalls++; return false; };

        game.player.applyStatus('levitating', 50);
        // 走到渊格：悬浮 → 无确认（CE STATUS_LEVITATING<=1 前置条件）且可站上。
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        expect(confirmCalls, '悬浮时踩已知渊格不得弹确认（Movement.c:1305 前置条件）').toBe(0);
        expect(game.depth, '悬浮玩家站渊上不得坠落').toBe(1);
        expect(game.grid.getCell(game.player.loc.x, game.player.loc.y)?.layers.includes(TerrainType.CHASM))
            .toBe(true);

        // 原地等待数回合（悬浮持续）：环境结算/客观块反复扫过，仍不得坠。
        for (let i = 0; i < 5; i++) game.handlePlayerAction('wait', undefined, 'system');
        expect(game.depth, '悬浮期间环境结算不得触发坠落').toBe(1);
    });

    it('飞行怪（MONST_FLIES）站渊上不坠；睡着的落地怪同场景必坠——豁免判据缺失即在此翻红', () => {
        const game = createHeadlessGame(20260919);
        clearToOpenRoom(game);
        setTile(game, 8, 5, TerrainType.CHASM, ' ', 0x222222);
        setTile(game, 8, 6, TerrainType.CHASM, ' ', 0x222222);
        const bloat = spawnMonsterAt(game, 'bloat', 8, 5); // bloat：MONST_FLIES
        bloat.state = MonsterState.ASLEEP; // 睡眠：排除"自己走下渊格"的歧义
        const kobold = spawnMonsterAt(game, 'kobold', 8, 6); // 无飞行
        kobold.state = MonsterState.ASLEEP;
        kobold.hp = 200; // 垫高血量，排除"6-12 伤害致死"的歧义

        for (let i = 0; i < 3; i++) game.handlePlayerAction('wait', undefined, 'system');

        expect(bloat.hp, '飞行怪（MONST_FLIES）不得从渊上坠落/受伤').toBeGreaterThan(0);
        expect(game.monsters.includes(bloat), '飞行怪必须留在本层').toBe(true);
        expect(game.monsters.includes(kobold), '落地怪必须已离开本层（坠层）').toBe(false);
        expect(kobold.hp, '睡着的满血落地怪应坠层幸存而非坠亡').toBeGreaterThan(0);
    });
});

// ---------------------------------------------------------------------------
// 对抗③：坠落伤害参数（clump2、深水零伤、浅水减半）
// ---------------------------------------------------------------------------
describe('C-5 对抗③：落地伤害（CE Time.c:1143-1162；GlobalsBrogue.c:1044-45）', () => {
    // S-1 改造（对流位移免疫）：原版每样本换种子重开两层的生成（40 样本），
    // 样本集整体随流位移重抽——任务书实测 C-6 下 40 样本方差 0.522 翻红而
    // [8,10] 仍过，纯属抽样运气。改造后：单局内连坠，层缓存恢复（零生成掷骰），
    // 样本只由坠落机制自身的伤害骰决定，对地图/流位移结构性免疫。
    //
    // ★ 授权反驳（S-1 实测，修正原版的分布假设）★
    // randClumpedRange(8,10,2) 的真实分布是 {8: 1/4, 9: 1/2, 10: 1/4}：
    // numSides = ⌊(10−8)/2⌋ = 1，remainder = 0，两次 randRange(0,1) 各出 {0,1}。
    // 其方差恰为 0.5——原版注释"clump=2 的方差 ≈ 1/3"与"阈值 <0.5"把门槛
    // 正好压在正确实现的真值上，这是原版掷硬币式翻红的根因（n=40 时
    // P(样本方差 < 0.5) ≈ 50%）。
    //
    // 新判据（n=240，比原版 n=40 扩 6 倍降噪）：
    //   - 支撑集 [8,10] 逐样本硬断言（min/max 写反 2d10/2d8 在此结构性翻红）；
    //   - 中值 9 的出现次数 ∈ [99,141]（二项(240, 1/2)，±3σ ≈ 120±26.0）。
    //     捕获的错误实现：
    //     · clump=1（均匀 {8,9,10}）：E[count9]=80，σ≈7.3 → ≥99 的概率 <0.1%；
    //     · "恒定 9"平扣复辟（p1_28 锚定的错误类）：count9=240 ≫ 141；
    //     · 任何把分布往两端或单边挪的改动（概率质量挪动 > ~8%）。
    //     误红率：正确实现下 P(count9 ∉ [99,141]) ≈ 0.3%。
    it('干地落点：240 连坠样本全部落在 [8,10]，中值 9 的频数落在二项 ±3σ 带内', () => {
        const game = createHeadlessGame(7000);
        const g = priv(game);
        // 场景搭设：先清出开放房，再预生成第 2 层并钉落点口袋，回第 1 层。
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
            }
        }
        game.depth = 2;
        g.generateDepth(false);
        // 清掉第 2 层原生怪/物与机器格（落点合格判据排除 HAS_MONSTER|HAS_ITEM；
        // machineNumber 在 cell 上，setTerrain 不清除——同原版口径）。
        game.monsters.length = 0;
        game.items.length = 0;
        (g.machineCells as Set<number>).clear();
        // 落点口袋：渊格 (7,6) 周围封墙，距离 2 处留 (9,6)、游泳出口 (10,6)。
        for (let x = 4; x <= 10; x++) {
            for (let y = 4; y <= 8; y++) {
                if (Math.max(Math.abs(x - 7), Math.abs(y - 6)) >= 1) {
                    game.grid.setTerrain(x, y, TerrainType.WALL, '#', 0x444444);
                }
            }
        }
        game.grid.setTerrain(9, 6, TerrainType.FLOOR, '.', 0x888888);
        game.grid.setTerrain(10, 6, TerrainType.FLOOR, '.', 0x888888);
        game.depth = 1;
        g.generateDepth(true); // 恢复缓存的第 1 层（levels Map 按层号持久，可反复往返）

        const damages: number[] = [];
        for (let i = 0; i < 240; i++) {
            if (game.depth === 2) {
                game.depth = 1; // generateDepth 不自行改层号——调用方先设（原版同款）
                g.generateDepth(true);
                expect(game.depth, `第 ${i} 轮：层缓存恢复失败`).toBe(1);
            }
            game.player.hp = game.player.maxHp;
            game.player.loc.x = 5;
            game.player.loc.y = 6;
            game.grid.setTerrain(7, 6, TerrainType.CHASM, ' ', 0x222222);
            game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
            game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
            expect(game.depth, `第 ${i} 轮：跳渊未换层`).toBe(2);
            damages.push(game.player.maxHp - game.player.hp);
        }

        expect(Math.min(...damages), `实测最小伤害 ${Math.min(...damages)}——低于 CE 下界 8`)
            .toBeGreaterThanOrEqual(8);
        expect(Math.max(...damages), `实测最大伤害 ${Math.max(...damages)}——高于 CE 上界 10`)
            .toBeLessThanOrEqual(10);
        const count9 = damages.filter(d => d === 9).length;
        expect(count9, `中值 9 出现 ${count9}/240 次，须在 [99,141]（二项(240,½) ±3σ）；` +
            'clump=1 的 E=80、恒定 9 的 E=240 都在此翻红').toBeGreaterThanOrEqual(99);
        expect(count9).toBeLessThanOrEqual(141);
    }, 60_000);

    it('深水落点零伤害（CE :1146-1150 "unharmed"）；浅水落点减半（CE :1156-1158 ' +
        'TM_ALLOWS_SUBMERGING，damage /= 2 整除）', () => {
        expect(fallDamageWithLanding(8001, TerrainType.WATER_DEEP), '深水落点必须零伤害')
            .toBe(0);
        const shallow = fallDamageWithLanding(8002, TerrainType.WATER_SHALLOW);
        expect(shallow, `浅水落点伤害 ${shallow}——CE 减半后应为 4-5（8-10 的一半整除）`)
            .toBeGreaterThanOrEqual(4);
        expect(shallow).toBeLessThanOrEqual(5);
    }, 60_000);

    /** 深水/浅水单样本（保留原版逐种子形态：落点地形是断言对象，每样本独立造层）。 */
    function fallDamageWithLanding(seed: number, landing: TerrainType): number {
        const game = createHeadlessGame(seed);
        clearToOpenRoom(game);
        const g = priv(game);
        game.depth = 2;
        g.generateDepth(false);
        game.monsters.length = 0;
        game.items.length = 0;
        (g.machineCells as Set<number>).clear();
        // 落位算法在最近切比雪夫环内随机选格；不要把测试答案绑到生成流
        // 改动后会移动的单个随机格。最近环全部铺目标地形，外一环铺干地，
        // 既保证落点类型，也让深水通过“能游到干地”的 CE 检查。
        for (let x = 5; x <= 9; x++) {
            for (let y = 4; y <= 8; y++) {
                const r = Math.max(Math.abs(x - 7), Math.abs(y - 6));
                if (r === 1) setTile(game, x, y, landing);
                else if (r === 2) setTile(game, x, y, TerrainType.FLOOR);
                const cell = game.grid.getCell(x, y)!;
                cell.machineNumber = 0;
                (g.machineCells as Set<number>).delete(y * game.grid.width + x);
            }
        }
        game.depth = 1;
        g.generateDepth(true);
        game.player.hp = game.player.maxHp;
        game.player.loc.x = 5;
        game.player.loc.y = 6;
        setTile(game, 7, 6, TerrainType.CHASM, ' ', 0x222222);
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(game.depth, `seed${seed}：跳渊未换层`).toBe(2);
        return game.player.maxHp - game.player.hp;
    }
});

// ---------------------------------------------------------------------------
// 对抗④：怪物会掉（CE Time.c:1530-1583 monstersFall）
// ---------------------------------------------------------------------------
describe('C-5 对抗④：怪物坠落与跨层幸存', () => {
    it('渊上高血怪在玩家回合末离开本层且活着（坠层不坠亡），玩家跟下去能遇见它'
        + '——"怪物不会掉"或"掉了即消失"的实现都在此翻红', () => {
        const game = createHeadlessGame(20260920);
        clearToOpenRoom(game);
        setTile(game, 8, 5, TerrainType.CHASM, ' ', 0x222222);
        const troll = spawnMonsterAt(game, 'troll', 8, 5);
        troll.hp = 200;
        troll.state = MonsterState.ASLEEP; // 睡眠：排除"自己走下渊格"的歧义

        game.handlePlayerAction('wait', undefined, 'system');
        expect(game.monsters.includes(troll), '坠层幸存者必须离开本层怪物表').toBe(false);
        expect(troll.hp, `垫了 200 血的怪只剩 ${troll.hp}——坠落伤害不是 6-12 clump2`).toBeGreaterThan(0);

        // 玩家脚下开渊再等一回合：玩家坠落 → 同一次 generateDepth 排空
        // pendingFallen（CE：怪物必须与玩家一起坠到下一层，playerFalls :1124）。
        setTile(game, 4, 5, TerrainType.CHASM, ' ', 0x222222);
        game.handlePlayerAction('wait', undefined, 'system');
        expect(game.depth, '玩家应已坠落').toBe(2);
        expect(game.monsters.includes(troll), '坠层幸存者必须出现在下一层（pendingFallen 排空）').toBe(true);
        expect(troll.preplaced, 'CE restoreMonster :3548——落位后必须清 MB_PREPLACED').toBe(false);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑤：跳渊确认（Movement.c:1303-1322 的前置条件串）
// ---------------------------------------------------------------------------
describe('C-5 对抗⑤：已知渊确认 / 未知渊不确认', () => {
    it('已发现的渊：确认弹出、拒绝则不移动不耗回合；接受则坠落', () => {
        const game = createHeadlessGame(20260921);
        clearToOpenRoom(game);
        setTile(game, 5, 5, TerrainType.CHASM, ' ', 0x222222);

        const prompts: string[] = [];
        game.onConfirmRequest = (msg) => { prompts.push(msg); return false; };
        const tickBefore = timeSystem.currentTick;
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        expect(prompts.length, '踩已知渊必须弹确认').toBe(1);
        expect(prompts[0], '确认文案缺失（i18n fall.confirm）').toBeTruthy();
        expect([game.player.loc.x, game.player.loc.y], '拒绝确认后不得移动').toEqual([4, 5]);
        expect(game.depth).toBe(1);
        expect(timeSystem.currentTick - tickBefore, '拒绝确认不得耗回合（cancelKeystroke）')
            .toBe(0);

        game.onConfirmRequest = () => true;
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');
        expect(game.depth, '接受确认后应坠落换层').toBe(2);
    });

    it('未发现的渊：不弹确认直接坠落（蒙眼跳坑是 CE 原味——方向写反即在此翻红）', () => {
        const game = createHeadlessGame(20260922);
        clearToOpenRoom(game);
        setTile(game, 5, 5, TerrainType.CHASM, ' ', 0x222222);
        const cell = game.grid.getCell(5, 5)!;
        cell.isDiscovered = false;

        let confirmCalls = 0;
        game.onConfirmRequest = () => { confirmCalls++; return false; };
        game.handlePlayerAction('move', { x: 1, y: 0 }, 'system');

        expect(confirmCalls, '未知渊格不得弹确认').toBe(0);
        expect(game.depth, '未知渊格应直接坠落').toBe(2);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑥：桥梁解禁（buildABridge + pathingDistance 不可达哨兵）
// ---------------------------------------------------------------------------
describe('C-5 对抗⑥：桥梁（CE Architect.c:2786-2876；Dijkstra.c:247 pdsClear 30000）', () => {
    function bridgeScene(): Grid {
        // 全墙底盘（NOTHING 格在 buildABridge 的旗标口径下是"岸"，必须封死）；
        // 左岸 x1-8 / 深渊带 x9-12（全高）/ 右岸 x13-18——干地被
        // 深渊带完全切断（pathingDistance 不可达 = CE 30000 = 桥的主场景）。
        const g = new Grid(20, 15);
        for (let x = 0; x < 20; x++) {
            for (let y = 0; y < 15; y++) g.setTerrain(x, y, TerrainType.GRANITE, '#', 0x444444);
        }
        for (let x = 1; x <= 8; x++) {
            for (let y = 1; y <= 13; y++) g.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
        for (let x = 9; x <= 12; x++) {
            for (let y = 1; y <= 13; y++) g.setTerrain(x, y, TerrainType.CHASM, ' ', 0x222222);
        }
        for (let x = 13; x <= 18; x++) {
            for (let y = 1; y <= 13; y++) g.setTerrain(x, y, TerrainType.FLOOR, '.', 0x888888);
        }
        return g;
    }

    it('干地被全高深渊带切断时必须架桥（pathingDistance 不可达 = 30000）——' +
        'C-2 留形的"不可达返回 -1"在此场景恒不架桥，就是本轮逐字重核抓出的错', () => {
        const g = bridgeScene();
        rng.seedRandomGenerator(20260923);
        let built = 0;
        let guard = 0;
        while (buildABridge(g, 5) && guard++ < 50) built++;
        expect(built, '被深渊切断的两岸必须能架桥（比值判据对 30000 恒真）').toBeGreaterThan(0);
        let bridge = 0, edge = 0;
        for (let x = 0; x < g.width; x++) {
            for (let y = 0; y < g.height; y++) {
                const t = g.getCell(x, y)?.terrain;
                if (t === TerrainType.BRIDGE) bridge++;
                if (t === TerrainType.BRIDGE_EDGE) edge++;
            }
        }
        expect(bridge, '桥面必须落在深渊带上').toBeGreaterThan(0);
        expect(edge, '两端岸格必须有桥端桩点').toBe(2 * built);
    });

    it('真实生成：解禁后深渊族地形出现（对 c_2_lakes_e2e 的单元级快速代理）', () => {
        let chasmCells = 0;
        for (const genSeed of [424242, 777]) {
            for (let depth = 1; depth <= 26; depth++) {
                rng.seedRandomGenerator(genSeed);
                const arch = new Architect();
                const grid = arch.generateLevel(depth);
                for (let x = 0; x < grid.width; x++) {
                    for (let y = 0; y < grid.height; y++) {
                        const t = grid.getCell(x, y)?.terrain;
                        if (t === TerrainType.CHASM || t === TerrainType.CHASM_EDGE) chasmCells++;
                    }
                }
            }
        }
        expect(chasmCells, '2 种子 × D1-D26 真实生成全无深渊族地形——解禁未生效').toBeGreaterThan(0);
    }, 120_000);
});

// ---------------------------------------------------------------------------
// 对抗⑦：下坠药水 + pit_bloat 载体（P1-22；CE Items.c:8095-8100 / Globals.c:1039）
// ---------------------------------------------------------------------------
describe('C-5 对抗⑦：下坠药水与 pit bloat 的洞', () => {
    it('喝下坠药水：原地开出 HOLE（DF_HOLE_POTION → DF_HOLE_2 链）且回合末坠落；' +
        '悬浮时洞照开、人不坠（CE Items.c:8098-8100）', () => {
        const game = createHeadlessGame(20260924);
        clearToOpenRoom(game);
        const potion = ItemLoader.spawnPotion('potion_of_descent', 4, 5);
        expect(potion, 'spawnPotion 失败').toBeTruthy();
        game.player.inventory.addItem(potion!);
        const oldGrid = game.grid; // 坠落后 game.grid 换成新层，洞在旧层上
        game.quaffItem(potion!);
        expect(oldGrid.getCell(4, 5)?.layers.includes(TerrainType.HOLE), '药水必须在脚下开出 HOLE（DF 链未接通）').toBe(true);
        expect(game.depth, '非悬浮喝药必须坠落').toBe(2);

        // 悬浮半边。
        const game2 = createHeadlessGame(20260925);
        clearToOpenRoom(game2);
        game2.player.applyStatus('levitating', 50);
        const potion2 = ItemLoader.spawnPotion('potion_of_descent', 4, 5);
        game2.player.inventory.addItem(potion2!);
        game2.quaffItem(potion2!);
        expect(game2.grid.getCell(4, 5)?.layers.includes(TerrainType.HOLE), '悬浮时洞也必须照开')
            .toBe(true);
        expect(game2.depth, '悬浮时喝药不得坠落').toBe(1);
    });

    it('pit_bloat 死亡触发 DF_HOLE_POTION（Globals.c:1039 死亡 DFType）——原地出洞', () => {
        const game = createHeadlessGame(20260926);
        clearToOpenRoom(game);
        const pit = spawnMonsterAt(game, 'pit_bloat', 9, 6);
        pit.hp = 0; // 击杀
        (priv(game).triggerDeathFeatures as () => void).call(game);
        const cell = game.grid.getCell(9, 6)!;
        expect(cell.layers.includes(TerrainType.HOLE), 'pit_bloat 死亡必须开出 HOLE（死亡 DF 未接线）')
            .toBe(true);
    });
});

// ---------------------------------------------------------------------------
// 对抗⑧：火侧回归哨兵（S-1 改造：test 层合成场景——"与地图无关"这次为真）
// ---------------------------------------------------------------------------
// 原版（C-5 立）在真实生成的地图上铺合成草地并复位流，自注"不受地图生成
// 变化影响"——C-6 实证不成立：handlePlayerAction 的完整回合里怪物 AI 与火
// 共享全局流，地图变 → 怪物耗骰形态变 → 火骰漂移。S-1 改造补上缺的那半：
//   1. mode='test' —— 层生成走 generateTestDepth 合成层（Game.ts:720），
//      结构性绕开真实生成器，改生成的轮次触达不了本场景；
//   2. 清怪清物 —— 场景内无共享全局流的其它系统（mode='test' 同时免周期刷怪）；
//   3. 场景搭好后显式重播种（原版已有，保留）。
// 守卫保留：蔓延概率/衰老掷骰/点燃判据被顺手改动 → 曲线逐位翻红。
describe('C-5 对抗⑧：火侧哨兵（S-1 改造：test 层全隔离场景）', () => {
    it('草地上点火蔓延曲线逐位恒定（test 层 + 流复位，对流位移结构性免疫）', () => {
        const game = createHeadlessGame(1, 'test');
        game.monsters.length = 0;
        game.items.length = 0;
        // 合成场景：10x8 草地嵌在地板里。
        for (let x = 4; x <= 13; x++) {
            for (let y = 4; y <= 11; y++) {
                setTile(game, x, y, x >= 6 && x <= 11 && y >= 6 && y <= 9 ? TerrainType.GRASS : TerrainType.FLOOR);
            }
        }
        rng.seedRandomGenerator(20260927); // 场景铺完后复位流——曲线只由火行为决定
        game.environment.ignite(8, 7);
        const series: number[] = [];
        for (let t = 0; t < 14; t++) {
            game.handlePlayerAction('wait', undefined, 'system');
            let b = 0;
            for (let x = 4; x <= 13; x++) {
                for (let y = 4; y <= 11; y++) {
                    if (game.grid.getCell(x, y)?.isBurning) b++;
                }
            }
            series.push(b);
        }
        expect(series.length).toBe(14);
        // 蔓延应真实发生（火行为被改坏的任何形态都会挪动曲线）。
        expect(Math.max(...series), '火未蔓延——ignite/蔓延行为被本轮改动').toBeGreaterThan(3);
        // 逐位基线（S-1 捕获，20260927 流复位 + test 层）：确定性。
        expect(series, '火侧曲线漂移——本轮触碰了火/RNG 行为（登记到报告）').toEqual([
            1, 2, 2, 2, 4, 5, 7, 8, 10, 8, 8, 8, 9, 8,
        ]);
    });
});
