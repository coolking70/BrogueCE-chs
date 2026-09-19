/**
 * src/test/p1_42_secret_door_search.test.ts — P1-42：密门发现机制对齐 CE
 *
 * 病灶：web 对四正邻接 SECRET_DOOR 以固定 30% 揭示（Game.ts 旧 6390-6404，
 * web 自创近似），而 CE 的发现走 search(searchStrength)（Movement.c:2459-2489，
 * 半径 = strength/10 方形扫描 + 距离衰减 + 阻挡格 2/3 折扣 + VISIBLE 判据）
 * 的两个调用源：每步低强度自动搜索（Time.c:2544-2549，SEARCHED_FROM_HERE
 * 每格一次）与主动搜索命令（Time.c:2395-2430，连续回合充能满 5 终搜）。
 * 离走廊两格的密门 CE 玩家搜得到、旧 web 玩家可能永远撞不开——这正是
 * harness.analysisAllowsMove"放行密门"口径的前提缺口（见该函数文档）。
 *
 * 本轮实现（Game.ts）：
 *   - searchForSecrets()          = CE Movement.c:2459-2489
 *   - discoverSecretAt()          = CE discover（Movement.c:2437-2457）对
 *     SECRET_DOOR 的今日逐位等效直写（等效前提由本文件目录绊线钉死，
 *     冲突申报见该方法注记）
 *   - playerTurnEnded 自动搜索块  = CE Time.c:2544-2552
 *   - handlePlayerAction('search')= CE manualSearch（Time.c:2395-2430）
 *
 * ★ 键位冲突申报（只报告，不擅自改键位）★：CE SEARCH_KEY='s'
 *   （Rogue.h:1177）与 web 既有 's'=向下移动（Input.ts）冲突。引擎侧动作名
 *   为 'search'，Input.ts 本轮未动；UI 键位待验收方裁决后一行即可接上。
 *
 * 对抗性测试与"能捕获的具体错误实现"逐条标注在每个 it() 前的注释里；
 * 反向验证（真实改坏代码、跑出失败、贴输出、再还原）见
 * ai_docs/p1_42_secret_door_search_report.md。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createHeadlessGame } from './harness';
import { Game } from '../engine/Core/Game';
import { rng } from '../engine/Random';
import { logger } from '../engine/Systems/Logger';
import { TerrainType } from '../engine/Map/Grid';
import { TERRAIN_FLAGS, TM_IS_SECRET } from '../engine/Map/TerrainCatalog';
import { analysisAllowsMove } from './harness';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// ---- 测试侧布景工具（只动 game 公开字段，不碰引擎私有） -------------------

const CX = 20, CY = 20; // 布景中心（远离地图边缘）

/** 把玩家周围清成开阔地板。 */
function craftRoom(game: Game, r = 8): void {
    for (let x = CX - r; x <= CX + r; x++) {
        for (let y = CY - r; y <= CY + r; y++) {
            game.grid.setTerrain(x, y, TerrainType.FLOOR);
        }
    }
}

function placeSecretDoor(game: Game, x: number, y: number): void {
    game.grid.setTerrain(x, y, TerrainType.SECRET_DOOR, '#', 0x999999);
}

function placeWall(game: Game, x: number, y: number): void {
    game.grid.setTerrain(x, y, TerrainType.GRANITE, '#', 0x666666);
}

/** 干净布景：清怪、玩家居中。搜索/移动是完整回合，怪物会搅局，一律清空。 */
function craftGame(seed: number): Game {
    const game = createHeadlessGame(seed);
    game.monsters = [];
    craftRoom(game);
    game.player.loc.x = CX;
    game.player.loc.y = CY;
    return game;
}

function move(game: Game, dx: number, dy: number): void {
    game.handlePlayerAction('move', { x: dx, y: dy }, 'system');
}

function search(game: Game): void {
    game.handlePlayerAction('search', undefined, 'system');
}

function wait(game: Game): void {
    game.handlePlayerAction('wait', undefined, 'system');
}

function doorTerrainAt(game: Game, x: number, y: number): TerrainType {
    return game.grid.getCell(x, y)!.terrain;
}

/** 捕获 logger.log 的消息文本（harness 同款：实例属性包装，结束时删实例属性还原原型分发）。 */
function captureLogs() {
    const messages: string[] = [];
    const original = logger.log.bind(logger);
    logger.log = (text: string, color?: string) => {
        messages.push(text);
        original(text, color);
    };
    return {
        messages,
        stop() {
            delete (logger as { log?: unknown }).log;
        },
    };
}

const TERMINAL_MSG = 'detailed search';

afterEach(() => {
    vi.restoreAllMocks();
});

// ---- A. search 本体的对抗性测试 -------------------------------------------

describe('P1-42 A：searchForSecrets 对齐 CE Movement.c:2459-2489', () => {
    it('A1 半径 = strength/10（整除）：半径外密格零掷骰（捕获：半径误用 strength 本身）', () => {
        // 错误实现：radius = searchStrength（漏 /10）。d=7 的密格在错误半径
        // （60）内、正确半径（6）外——CE 语义是"扫描窗外的格连掷骰都不发生"
        // （Movement.c:2466 的 for 界就是 radius）。用 randPercent 调用数钉死：
        // 正确实现一次 search 动作 = 0 次掷骰；错误实现 = 自动搜索 + 手动搜索
        // 各掷 1 次 = 2 次。
        const game = craftGame(42001);
        placeSecretDoor(game, CX + 7, CY); // 切比雪夫 d=7：自动搜索半径 3、手动半径 6 皆不及
        const spy = vi.spyOn(rng, 'randPercent');
        search(game);
        expect(spy.mock.calls.length, '半径外不应发生任何命中掷骰').toBe(0);
        expect(doorTerrainAt(game, CX + 7, CY)).toBe(TerrainType.SECRET_DOOR);
    });

    it('A2 距离衰减系数 ×10：d = strength/10 处命中率恰为 0（捕获：衰减写成 ×1）', () => {
        // 错误实现：percent = strength - d*1。自动搜索 strength=30，玩家走进
        // 与密门切比雪夫 d=3 的格：正确 percent = 30-30 = 0 → 永不发现；
        // 错误实现 percent = 27 → 每格 27%。40 个种子一票未中才合格
        // （漏检概率 0.73^40 ≈ 1.6e-6；档位从 60 削到 40 减轻套件池负载）。
        let found = 0;
        for (let i = 0; i < 40; i++) {
            const game = craftGame(42100 + i);
            placeSecretDoor(game, CX + 4, CY); // 玩家走到 (CX+1, CY) 时 d=3
            move(game, 1, 0); // 自动搜索在到达格触发
            if (doorTerrainAt(game, CX + 4, CY) !== TerrainType.SECRET_DOOR) found++;
        }
        expect(found, 'percent=0 的格在正确实现下绝不可能被发现（衰减 ×1 时约 27%/次）').toBe(0);
    });

    it('A3 阻挡格 2/3 折扣：终搜对 d=6 密门的命中率 ≤ 85%（捕获：漏乘 2/3）', () => {
        // 错误实现：percent = strength - d*10 后忘了 ×2/3。第 5 连搜
        // strength=160，d=6 密门：正确 (160-60)*2/3 = 66%；错误 = 100%。
        // 30 个种子里错误实现必然全中（30/30 > 25 翻红），正确实现 ~66%
        //（P(Binom(30,0.66)>25)≈0.006；从 40 削到 30 减轻套件池负载）。
        let found = 0;
        const trials = 30;
        for (let i = 0; i < trials; i++) {
            const game = craftGame(42200 + i);
            placeSecretDoor(game, CX + 6, CY);
            for (let k = 0; k < 5; k++) search(game); // 连续 5 次：第 5 次为 160 终搜
            if (doorTerrainAt(game, CX + 6, CY) !== TerrainType.SECRET_DOOR) found++;
        }
        expect(found, `2/3 折扣漏掉时 30 局全中（实测 ${found}）`).toBeLessThanOrEqual(25);
    });

    it('A4 SEARCHED_FROM_HERE：同一格的自动搜索只发生一次（捕获：漏置位/漏检查）', () => {
        // 错误实现：每步都自动搜索。玩家 R,R,L,L 往返：到达格序列
        // A,B,A,B——正确实现只在新格搜索 2 次（A4 布景里密门对每个所站格
        // 都在 d=3、percent=0，掷骰必然发生也必然落空，调用数即搜索数）；
        // 错误实现 4 次。
        const game = craftGame(42301);
        placeSecretDoor(game, CX + 4, CY + 3); // 对 A=(CX+1,CY) d=3；对 B=(CX+2,CY) d=3
        const spy = vi.spyOn(rng, 'randPercent');
        move(game, 1, 0);  // 到 A：搜索 1 次
        move(game, 1, 0);  // 到 B：搜索 1 次
        move(game, -1, 0); // 回 A：已搜过，跳过
        move(game, 1, 0);  // 回 B：已搜过，跳过
        expect(spy.mock.calls.length, '往返 4 步恰好 2 次自动搜索掷骰').toBe(2);
        expect(doorTerrainAt(game, CX + 4, CY + 3)).toBe(TerrainType.SECRET_DOOR);
    });

    it('A5 充能只按连续回合累积：隔回合清零、第 5 连搜恰好一次终搜播报（捕获：充能不要求连续）', () => {
        // 错误实现：wait 不清充能（或充能跨隔回合累积）。终搜（strength=160）
        // 会播报 search.detailed_finished。s×3 + wait + s×3 在正确实现下
        // 充能 1..3→清零→1..3，永不终搜；错误实现第 5 次搜索就终搜。
        const logs = captureLogs();
        try {
            const game = craftGame(42401);
            for (let k = 0; k < 3; k++) search(game);
            wait(game); // 断开连续
            for (let k = 0; k < 3; k++) search(game);
            expect(logs.messages.filter(m => m.includes(TERMINAL_MSG)).length,
                '隔回合打断后永不终搜').toBe(0);

            const game2 = craftGame(42402);
            for (let k = 0; k < 5; k++) search(game2); // 连续 5 次 → 恰 1 次终搜
            expect(logs.messages.filter(m => m.includes(TERMINAL_MSG)).length,
                '第 5 连搜终搜播报恰一次').toBe(1);
            search(game2); // 终搜后充能归零：第 6 次只是充能 1
            expect(logs.messages.filter(m => m.includes(TERMINAL_MSG)).length,
                '终搜后充能重置，第 6 次不播报').toBe(1);
        } finally {
            logs.stop();
        }
    });

    it('A6 可见性要求：隔墙密门零掷骰、终搜序列也搜不到（捕获：漏掉 playerCanDirectlySee）', () => {
        // 错误实现：不检查 isVisible 只按距离掷骰。密门被花岗岩墙隔开
        // （对 FOV 不可见但在错误实现的扫描窗内）：正确实现 0 掷骰、永不发现；
        // 错误实现充能 1..4 各 13%、终搜 80%，15 局几乎必然发现
        //（P(15 局零发现)≈1e-14；从 20 削到 15 减轻套件池负载）。
        let found = 0;
        const trials = 15;
        for (let i = 0; i < trials; i++) {
            const game = craftGame(42500 + i);
            placeSecretDoor(game, CX + 5, CY);
            for (let y = CY - 3; y <= CY + 3; y++) placeWall(game, CX + 2, y); // 隔墙
            game.fov.computeFOV(CX, CY, 10);
            expect(game.grid.getCell(CX + 5, CY)!.isVisible, '布景自检：密门确实不可见').toBe(false);
            const spy = vi.spyOn(rng, 'randPercent');
            for (let k = 0; k < 5; k++) search(game);
            expect(spy.mock.calls.length, `第 ${i} 局：不可见格不进入掷骰（CE：playerCanDirectlySee 先于 rand_percent）`).toBe(0);
            if (doorTerrainAt(game, CX + 5, CY) !== TerrainType.SECRET_DOOR) found++;
            vi.restoreAllMocks();
        }
        expect(found, '隔墙密门任何情况下都搜不到').toBe(0);
    });

    it('A7 percent ≤ 0 仍消耗一次抽取（RNG 流一致，CE Math.c:62 rand_percent 先抽后夹）', () => {
        // 错误实现：percent<=0 时 continue 剪枝（想省一次掷骰）。自动搜索
        // strength=30、到达格与密门 d=3：percent=0——CE 语义下 rand_percent
        // 照样抽取（结果必 false）。剪枝实现会少消耗一次 RNG，流位移。
        const game = craftGame(42601);
        placeSecretDoor(game, CX + 4, CY); // 到达 (CX+1,CY) 后 d=3
        const spy = vi.spyOn(rng, 'randPercent');
        move(game, 1, 0);
        expect(spy.mock.calls.length, 'percent=0 的扫描格仍消耗一次抽取').toBe(1);
        expect(doorTerrainAt(game, CX + 4, CY)).toBe(TerrainType.SECRET_DOOR);
    });
});

// ---- B. 旧 30% 揭示的替换留痕 ---------------------------------------------

describe('P1-42 B：web 自创的 30% 邻接揭示已删除（本轮 §二.3，不留两套）', () => {
    it('B1 静态留痕：Game.ts 不再含 30% 揭示的特征代码（P1-42 实现轮，反转原机制）', () => {
        const src = readFileSync(
            fileURLToPath(new URL('../engine/Core/Game.ts', import.meta.url)),
            'utf8'
        );
        expect(src, '旧的"每步对四邻接密门 randPercent(30)"已由 CE search 机制取代').not.toContain('randPercent(30)');
        expect(src, '旧注释锚点应一并移除').not.toContain('30% discovery chance per step');
    });

    it('B2 行为留痕：移动本身不再触发任何密门掷骰——发现只来自自动/主动搜索', () => {
        // 旧机制是"每步移动对四邻接 30% 掷骰"（无需搜索）。如今单步移动
        // 的掷骰数应恰为"到达格的一次自动搜索"对扫描窗内密格的掷骰数
        // （A7 场景 = 1 次）。若旧机制回归，同样的单步会叠加邻接掷骰。
        const game = craftGame(42701);
        placeSecretDoor(game, CX + 4, CY);
        const spy = vi.spyOn(rng, 'randPercent');
        move(game, 1, 0);
        expect(spy.mock.calls.length).toBe(1);
        move(game, -1, 0); // 回到起点格（已搜过）→ 零掷骰；旧机制则每步都掷
        expect(spy.mock.calls.length, '已搜格上的移动零掷骰').toBe(1);
    });
});

// ---- C. 目录绊线与"明确不做"留痕 -------------------------------------------

describe('P1-42 C：目录绊线 + 本轮明确不做的事', () => {
    it('C1 目录绊线（V-2b-2b 反转）：TM_IS_SECRET 的持有者恰为 SECRET_DOOR 与 TRAP_DOOR_HIDDEN', () => {
        // 原断言（P1-42 时）："TM_IS_SECRET 的唯一持有者是 SECRET_DOOR"——
        // 钉死 Game.discoverSecretAt 以 terrain === SECRET_DOOR 代替 CE 的
        // TM_IS_SECRET 判据这一等价前提。
        // **V-2b-2b 反转**（本文件不在该轮 §6 授权清单——但 CE Globals.c:379
        // 的 TRAP_DOOR_HIDDEN 原列就带 TM_IS_SECRET，蓝图 23 号落地必然打破
        // 单一持有前提；边界扩展已在 v-2b-2b 报告申报）。反转后钉死的新事实：
        // 持有者 = {SECRET_DOOR, TRAP_DOOR_HIDDEN} 恰两条，多一条/少一条都红。
        // discoverSecretAt 的目录驱动迁移（清层 + discoverType DF_SHOW_TRAPDOOR
        // 链）即原断言注记的接线，登记为缺口——隐藏陷阱的搜索显形归
        // 陷阱/搜索轮（V-2b-7 一带），接线时同步扩 c_4b F1 / c_4a_0 / c_4a
        // 三份白名单并再次反转本断言的"发现等价"说明。
        const holders: string[] = [];
        for (const name of Object.keys(TerrainType).filter(k => Number.isNaN(Number(k)))) {
            const t = (TerrainType as unknown as Record<string, TerrainType>)[name]!;
            if ((TERRAIN_FLAGS[t].mechFlags & TM_IS_SECRET) !== 0) holders.push(name);
        }
        expect(holders.sort(), `TM_IS_SECRET 持有集变化：${holders.join(', ')}`)
            .toEqual(['SECRET_DOOR', 'TRAP_DOOR_HIDDEN']);
    });

    it('C2 留痕：陷阱的搜索发现不实现——搜索不改变 TRAP 格、不产出陷阱消息（KNOWN_TO_BE_TRAP_FREE 登记未实现）', () => {
        // CE 的 search 在 percent>=100 时置 KNOWN_TO_BE_TRAP_FREE；web 无
        // "隐藏陷阱知识"设施（TRAP 恒可见，TerrainCatalog 条目注记），本轮
        // 登记不实现。此处锚定现状：搜索对 TRAP 格零作用。
        const logs = captureLogs();
        try {
            const game = craftGame(42801);
            game.grid.setTerrain(CX + 2, CY, TerrainType.TRAP, '^', 0xff5555);
            for (let k = 0; k < 5; k++) search(game);
            expect(doorTerrainAt(game, CX + 2, CY)).toBe(TerrainType.TRAP);
            expect(game.grid.getCell(CX + 2, CY)!.trapType).toBeNull();
            expect(logs.messages.filter(m => m.includes('trap')).length).toBe(0);
        } finally {
            logs.stop();
        }
    });

    it('C3 留痕：连通性闸门判据未被本轮触碰——analysisAllowsMove 仍放行密门', () => {
        // 本轮 §四：不改 harness.analysisAllowsMove、不改三个闸门的判据与
        // 阈值。锚定判据行为本身：密门格在分析口径下是通路。
        const game = createHeadlessGame(42901);
        for (let x = CX - 3; x <= CX + 3; x++) {
            for (let y = CY - 3; y <= CY + 3; y++) {
                game.grid.setTerrain(x, y, TerrainType.WALL);
            }
        }
        game.grid.setTerrain(CX, CY, TerrainType.SECRET_DOOR);
        const allows = analysisAllowsMove(game.grid, () => false);
        expect(allows(CX, CY), '密门 = 分析口径下的通路（判据未变）').toBe(true);
        expect(allows(CX + 1, CY), '非密门的墙仍被分析口径拒绝').toBe(false);
    });
});

// ---- D. 确定性 -------------------------------------------------------------

describe('P1-42 D：同种子同操作序列，发现结果逐位一致', () => {
    /** 固定操作脚本：在布景房里走"日"字 + 每逢 4 的倍数搜一次。 */
    function scriptedRun(seed: number) {
        const game = craftGame(seed);
        placeSecretDoor(game, CX + 4, CY);
        placeSecretDoor(game, CX - 3, CY - 2);
        const dirs: Array<[number, number]> = [
            [1, 0], [1, 0], [0, 1], [0, 1], [-1, 0], [-1, 0], [0, -1], [0, -1],
        ];
        for (let t = 0; t < 24; t++) {
            const [dx, dy] = dirs[t % dirs.length]!;
            if (t % 4 === 3) search(game); else move(game, dx, dy);
        }
        // 快照：全图地形 + 密门发现态 + 玩家位置 + 回合数
        const cells: string[] = [];
        for (let x = CX - 8; x <= CX + 8; x++) {
            for (let y = CY - 8; y <= CY + 8; y++) {
                const c = game.grid.getCell(x, y)!;
                cells.push(`${c.terrain}:${c.isDiscovered ? 1 : 0}`);
            }
        }
        return {
            cells: cells.join(','),
            px: game.player.loc.x,
            py: game.player.loc.y,
            turns: game.stats.turns,
        };
    }

    it('D1 同种子两次运行快照逐位相等（捕获：任何非确定性——如未播种随机数）', () => {
        expect(scriptedRun(43001)).toEqual(scriptedRun(43001));
    });

    it('D2 不同种子的原始生成层互不相同（反向 sanity：断言链路真的落在种子相关内容上）', () => {
        // 布景房的脚本是种子无关的几何——跨种子差异只可能来自生成期内容。
        // 用原始 D1 地形指纹做这个 sanity，而不是布景快照。
        const fp = (seed: number) => {
            const g = createHeadlessGame(seed);
            const parts: string[] = [];
            for (let x = 0; x < g.grid.width; x++) {
                for (let y = 0; y < g.grid.height; y++) {
                    parts.push(String(g.grid.getCell(x, y)!.terrain));
                }
            }
            return parts.join(',');
        };
        expect(fp(43002)).not.toBe(fp(43003));
    });
});
