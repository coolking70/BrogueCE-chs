/**
 * src/test/harness.ts — headless 测试 harness
 *
 * 目的：在 node 环境（vitest 默认环境）中实例化引擎、确定性推进回合，
 * 为后续所有引擎改动提供回归手段。本文件只做测试侧装配（stub/包装），
 * 不修改 src/ 下任何实现。
 *
 * headless 可行性事实（已核实）：
 * - Game.ts 对 DOM 的唯一依赖是文件末尾 `if (typeof window !== 'undefined')` 守卫，
 *   其余 import 闭包（Grid/Architect/Entities/…）均无 window/document/localStorage
 *   （唯一碰 window 的 Input.ts 不在 Game 的依赖图里）。
 * - 引擎内所有 i18next 调用点都带 defaultValue，空资源的最小 init 即可跑通；
 *   Game.ts 在模块加载期就会构造单例 activeGame，此时 i18next 可能尚未 init，
 *   实测 i18next v25 未初始化时 t() 返回 undefined 而不抛错，故无导入顺序问题。
 * - rng / timeSystem / logger 是全局单例：startNewGame 会重置 rng 种子、timeSystem
 *   tick 与 logger.messages，因此测试各自构造独立 Game 实例即可隔离（不要复用
 *   activeGame 单例）。
 */
import i18next from 'i18next';
import { Game, type GameMode } from '../engine/Core/Game';
import { logger } from '../engine/Systems/Logger';
import { rng } from '../engine/Random';
import { TerrainType, type Grid } from '../engine/Map/Grid';

const SECRET_DOOR_TERRAIN = TerrainType.SECRET_DOOR;

/** Game 上对测试有用但非 public 的成员（只读访问，不做任何写入/绕过逻辑）。
 *  Omit 技巧：同名属性在 Game 里是 private，直接交叉会被 TS 归约为 never。 */
type GamePrivates = Omit<Game, 'canMoveTo'> & {
    canMoveTo(x: number, y: number): boolean;
};

/** 一次"回合动作"：交给 Game.handlePlayerAction 执行；返回 undefined 表示原地等待。 */
export interface TurnAction {
    action: string;
    data?: unknown;
}

/**
 * 回合策略：第 turn 回合（0 起）该做什么。
 * 默认策略见 defaultTurnPolicy。
 */
export type TurnPolicy = (game: Game, turn: number) => TurnAction | undefined;

export interface RunTurnsResult {
    /** 实际推进的回合数（含死亡的那一回合，若发生）。 */
    turnsRun: number;
    /** 玩家是否在本次运行中死亡（isGameOver 或 hp<=0）。 */
    died: boolean;
    /** 本次运行期间 logger.log 被调用的次数（harness 侧包装计数，不受 50 条封顶影响）。 */
    logCount: number;
}

const DIRS8: ReadonlyArray<readonly [number, number]> = [
    [0, -1], [0, 1], [-1, 0], [1, 0],
    [-1, -1], [1, -1], [-1, 1], [1, 1],
];

/** i18next 最小初始化，幂等：已初始化（无论被谁初始化）则跳过。 */
function initI18nOnce(): void {
    if (i18next.isInitialized) return;
    i18next.init({
        lng: 'en',
        fallbackLng: false, // 空资源 + 无 fallback：所有文案走 defaultValue
        resources: {},
        initImmediate: false, // 同步初始化，init 后立即可用
    });
}

/**
 * 创建一个 headless 游戏实例并完成开局生成。
 * 每次调用返回全新的 Game（绝不复用 activeGame 单例，避免用例间状态串味）。
 *
 * 注意：Game 构造器内部会以"当前时间"种子先跑一次 startNewGame；
 * 随后这里以固定 seed 再次 startNewGame 覆盖之——rng/timeSystem/logger 均会被
 * startNewGame 重置，因此最终状态只由 (seed, mode) 决定。
 */
export function createHeadlessGame(seed: number, mode: GameMode = 'normal'): Game {
    initI18nOnce();
    const game = new Game();
    game.startNewGame({ seed, mode });
    return game;
}

/**
 * 默认回合策略："有相邻敌人则攻击，否则随机选一个合法方向移动"。
 * - 相邻敌人：8 向、存活、非盟友；走向它即触发 Game 的移动=攻击分支。
 * - 合法方向：目标格 canMoveTo（私有成员，测试侧只读访问）且无怪物占据。
 * - 随机源用项目 rng（保持在 seed 流上），不用 Math.random。
 */
function defaultTurnPolicy(game: Game): TurnAction {
    const px = game.player.loc.x;
    const py = game.player.loc.y;
    const privates = game as unknown as GamePrivates;

    for (const [dx, dy] of DIRS8) {
        const monster = game.getMonsterAt(px + dx, py + dy);
        if (monster && monster.hp > 0 && !monster.isAlly) {
            return { action: 'move', data: { x: dx, y: dy } };
        }
    }

    const movable = DIRS8.filter(([dx, dy]) =>
        privates.canMoveTo(px + dx, py + dy) && !game.getMonsterAt(px + dx, py + dy)
    );
    if (movable.length === 0) {
        return { action: 'wait' };
    }
    const [dx, dy] = movable[rng.randRange(0, movable.length - 1)]!;
    return { action: 'move', data: { x: dx, y: dy } };
}

/**
 * 推进至多 n 个回合。玩家死亡时提前返回并如实报告（died=true），
 * 不吞掉、不为跑满 n 回合而干预游戏。
 * 以 'system' source 调用 handlePlayerAction：跳过输入录制与回放拦截。
 */
export function runTurns(game: Game, n: number, policy: TurnPolicy = defaultTurnPolicy): RunTurnsResult {
    let turnsRun = 0;
    let died = false;
    let logCount = 0;

    // Logger 单例封顶保留 50 条消息，这里包装实例方法统计真实调用数，结束后恢复。
    const originalLog = logger.log.bind(logger);
    logger.log = (text: string, color?: string) => {
        logCount++;
        originalLog(text, color);
    };

    try {
        for (let turn = 0; turn < n; turn++) {
            if (game.isGameOver || game.player.hp <= 0) {
                died = true;
                break;
            }
            const action = policy(game, turn);
            game.handlePlayerAction(action?.action ?? 'wait', action?.data, 'system');
            turnsRun++;
            if (game.isGameOver || game.player.hp <= 0) {
                died = true;
                break;
            }
        }
    } finally {
        delete (logger as { log?: unknown }).log; // 移除实例属性，还原原型方法分发
    }

    return { turnsRun, died, logCount };
}

/**
 * 整层 terrain 的稳定指纹：逐格 terrain 码拼串后做 FNV-1a 32 位哈希。
 * 只取 terrain（不含光照/探索/可见性等依赖玩家行为的位）；
 * 附带串长后缀，使"哈希碰撞但内容不同"的情形可被肉眼识别。
 */
export function terrainFingerprint(grid: Grid): string {
    const parts: string[] = [`${grid.width}x${grid.height}`];
    for (let y = 0; y < grid.height; y++) {
        for (let x = 0; x < grid.width; x++) {
            parts.push(String(grid.getCell(x, y)?.terrain ?? 0));
        }
    }
    const serialized = parts.join(',');

    let hash = 0x811c9dc5;
    for (let i = 0; i < serialized.length; i++) {
        hash ^= serialized.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `${(hash >>> 0).toString(16).padStart(8, '0')}:${serialized.length}`;
}

/**
 * 连通性**分析**口径：在实际移动判据之上放行密门。
 *
 * ★ 这不是放宽，是对齐 CE 自己的分析口径 ★
 *
 * CE 判断关卡是否连通时，本来就把密门当通路：
 *   - `Architect.c:202-203`（analyzeMap）：passMap 置 false 的条件是
 *     `T_PATHING_BLOCKER && !TM_IS_SECRET`；
 *   - `Architect.c:50-56`（cellIsPassableOrDoor）：同样豁免 TM_IS_SECRET；
 *   - `Globals.c:330`：SECRET_DOOR 的 mechFlags 带 TM_IS_SECRET。
 * web 侧已有同款对应物 `LoopMap.blocksPathing`（环分析视密门为通路）。
 *
 * 为什么 C-3 之后才需要它：C-3 之前 web 几乎不生成密门，字面口径
 * （密门=墙）与分析口径没有可观测差别；C-3 让密门按 CE 概率如实生成
 * （D26 封顶 67%，实测 5 种子 × D1-D26 共 327 扇）之后，字面口径在
 * p1_26/p1_29/p1_33 上给出 **68/390 层假阳性**，实测全部满足
 * "把密门视作门后即完全连通"。
 *
 * **阈值一律不放宽**：这三处的坏层门槛仍是严格 0。换的是判据口径。
 * 仍能抓住的错误实现：任何把通路真正堵死的回归（墙/深水/上锁的门/
 * 机器封区/湖泊切割）——密门放行不会让它们蒙混过关。
 *
 * ⚠️ 它的前提是"玩家找得到密门"。web 的发现机制远弱于 CE
 * （见路线图 P1-42），在那条补上之前，这个口径对**玩家实际可玩性**
 * 是乐观的。生成器层面的连通性判据用它是对的；不要用它论证"关卡可玩"。
 */
export function analysisAllowsMove(
    grid: Grid,
    baseAllows: (x: number, y: number) => boolean,
): (x: number, y: number) => boolean {
    return (x, y) => baseAllows(x, y)
        || grid.getCell(x, y)?.terrain === SECRET_DOOR_TERRAIN;
}
