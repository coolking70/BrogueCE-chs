/**
 * src/engine/Map/Scent.ts — P4-8：气味图（scent map）
 *
 * 对照 CE（../BrogueCE-master/src/brogue，只读事实来源）：
 *   - scentDistance        Time.c:756-762（长轴权重 2、短轴权重 1）
 *   - updateScent          Time.c:764-782（每主观玩家回合一次；Game.playerTurnEnded 调用）
 *   - addScentToCell       Movement.c:2875-2882（写值条件是 `||` 不是 `&&`，照抄，见方法注释）
 *   - isLocalScentMaximum  Monsters.c:2820-2840
 *   - scentDirection       Monsters.c:2842-2900（8 邻域上坡 + 对角弥散重试）
 *   - resetScentTurnNumber Time.c:2924-2942（15000 回卷；web 单层版）
 *   - awarenessDistance    Monsters.c:1630-1654（P4-8 返工：感知距离 = 气味陈旧度）
 *   - awareOfTarget        Monsters.c:1658-1690（P4-8 返工：3% 丢目标 + awareness*3 硬截断）
 *
 * 已知 web 侧取舍（详见 ai_docs/p4_8_scent_map_report.md）：
 *   - U18a: 遮挡与留味已使用四层 flags，旧显示层近似已移除。
 *   - CE 的 diagonalBlocked（对角墙角）web 全局无对应判定，两处邻接检查均省略，
 *     与 P4-5/P4-6 以来移动代码的同口径一致。
 *   - U03: 每层保留 values；Game 在换层时传递全局 turnNumber。
 */

import type { Grid } from './Grid';
import { terrainBlocksMovement, terrainBlocksScent } from './TerrainRules';
import { rng } from '../Random';

/**
 * CE Time.c:756 scentDistance。注意这不是欧氏距离也不是切比雪夫距离：
 * 长轴权重 2、短轴权重 1（如 (0,0)->(3,1) = 2*3+1 = 7）。
 */
export function scentDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = Math.abs(x1 - x2);
    const dy = Math.abs(y1 - y2);
    return dx > dy ? 2 * dx + dy : dx + 2 * dy;
}

/** CE T_OBSTRUCTS_PASSABILITY: four-layer flag union (U18a). */
export const obstructsPassability = terrainBlocksMovement;

/** CE T_OBSTRUCTS_SCENT: four-layer flag union, independent of display priority. */
export const obstructsScent = terrainBlocksScent;

/** CE nbDirs（GlobalsBase.c:38）：N S W E NW SW NE SE——前 4 个是基本方向。 */
const NB_DIRS: ReadonlyArray<readonly [number, number]> =
    [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [-1, 1], [1, -1], [1, 1]];

/** stepDirection 的移动准入回调（monsterAvoids/占用的 web 近似，由调用方组装）。 */
export interface ScentMoveRules {
    canEnter(x: number, y: number): boolean;
}

/**
 * CE Monsters.c:1658 awareOfTarget 的入参。web 无 creatureState 全景枚举，
 * 只取本轮消费到的字段；target 恒为玩家（web 单玩家），故 CE 里
 * `target != &player` 的 openPathBetween 分支不存在。
 */
export interface AwareOfTargetParams {
    /** CE MONST_ALWAYS_HUNTING——恒感知（awareOfTarget 首分支）。 */
    alwaysHunting: boolean;
    /** CE MONST_IMMOBILE——感知 ⇔ perceived <= awareness（无掷骰）。 */
    immobile: boolean;
    /** CE creatureState == MONSTER_TRACKING_SCENT（web 的 HUNTING）。 */
    tracking: boolean;
    /** CE rogue.stealthRange（web 为 Game.calculateStealthRange 的 CE 口径值）。 */
    stealthRange: number;
}

export class ScentMap {
    /** CE rogue.scentTurnNumber（RogueMain.c:378 初值 1000）。 */
    public turnNumber: number = 1000;

    private readonly width: number;
    private readonly height: number;
    private values: Int32Array;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.values = new Int32Array(width * height);
    }

    public get(x: number, y: number): number {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return 0;
        return this.values[y * this.width + x]!;
    }

    public getState() {
        return { width: this.width, height: this.height, turnNumber: this.turnNumber, values: Array.from(this.values) };
    }

    public static fromState(state: ReturnType<ScentMap['getState']>): ScentMap {
        if (state.values.length !== state.width * state.height) throw new Error('Invalid scent dimensions');
        const map = new ScentMap(state.width, state.height);
        map.turnNumber = state.turnNumber;
        map.values = Int32Array.from(state.values);
        return map;
    }

    private set(x: number, y: number, value: number): void {
        if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
        this.values[y * this.width + x] = value;
    }

    /**
     * CE Movement.c:2875 addScentToCell。写值条件照抄 CE 的 `||`：
     *   if (!T_OBSTRUCTS_SCENT || !T_OBSTRUCTS_PASSABILITY) → 写入
     * 即只有"既挡气味又挡通行"的格子才完全不留气味。这不是笔误的可改点：
     * CE 的关闭门（DOOR）挡视线（T_OBSTRUCTS_VISION ∈ T_OBSTRUCTS_SCENT）
     * 但不挡通行（可以推门走进去），靠这条 `||` 门格上会留下气味——
     * 怪物因此能"隔着门闻到你"、把门当作气味跳板。改成 `&&` 会杀死该行为。
     */
    public addScent(grid: Grid, x: number, y: number, distance: number): void {
        const cell = grid.getCell(x, y);
        if (!cell) return; // CE 无此守卫（坐标保证在图内），web 防越界
        if (!obstructsScent(cell) || !obstructsPassability(cell)) {
            const value = this.turnNumber - distance;
            this.set(x, y, Math.max(value, this.get(x, y)));
        }
    }

    /**
     * CE Time.c:764 updateScent。mask 为按 T_OBSTRUCTS_SCENT 遮挡算出的
     * 全图 FOV 掩码（Game 侧用 FOVSys.computeFOVMask 生成）；玩家所在格
     * 最后单独写 distance=0（CE 原样，尽管掩码本就覆盖原点）。
     */
    public update(grid: Grid, playerX: number, playerY: number,
        mask: ReadonlyArray<ReadonlyArray<boolean>>): void {
        for (let x = 0; x < this.width; x++) {
            const column = mask[x];
            if (!column) continue;
            for (let y = 0; y < this.height; y++) {
                if (column[y]) {
                    this.addScent(grid, x, y, scentDistance(playerX, playerY, x, y));
                }
            }
        }
        this.addScent(grid, playerX, playerY, 0);
    }

    /**
     * CE Time.c:2924 resetScentTurnNumber 的单层版：rogue.scentTurnNumber
     * 逼近 unsigned short 上界时整体回卷 15000，图上超过 15000 的值同步回卷、
     * 否则清零。U03 Game also calls this for every cached visited floor.
     */
    public resetTurnNumber(): void {
        this.turnNumber -= 15000;
        for (let i = 0; i < this.values.length; i++) {
            const v = this.values[i]!;
            this.values[i] = v > 15000 ? v - 15000 : 0;
        }
    }

    /**
     * CE Monsters.c:2820 isLocalScentMaximum：8 个邻格里只要存在"气味更浓、
     * 可通行"的格子就不是局部最大。省略 CE 的 diagonalBlocked（web 无对应判定）。
     */
    public isLocalScentMaximum(grid: Grid, x: number, y: number): boolean {
        const baseline = this.get(x, y);
        for (const [dx, dy] of NB_DIRS) {
            const nx = x + dx, ny = y + dy;
            if (!grid.isValidPos(nx, ny)) continue;
            const cell = grid.getCell(nx, ny);
            if (cell && this.get(nx, ny) > baseline && !obstructsPassability(cell)) {
                return false;
            }
        }
        return true;
    }

    /**
     * CE Monsters.c:2842 scentDirection。返回指向气味更浓邻格的方向 [dx,dy]；
     * 严格大于当前格气味才走（上坡），并列时按 CE nbDirs 顺序取先扫到的方向。
     * 浓味邻格全被挡住时，CE 允许做一次"对角弥散"——把斜向 kink 处的气味
     * 以 -1 衰减抹平后重试一轮（会写入本图；CE 原样，确定性）。
     * 仍无路可走返回 null（NO_DIRECTION）。
     */
    public stepDirection(grid: Grid, x: number, y: number, rules: ScentMoveRules): readonly [number, number] | null {
        let bestDir = -1;
        let bestNearbyScent = 0;
        let canTryAgain = true;

        for (;;) {
            for (let dir = 0; dir < NB_DIRS.length; dir++) {
                const nx = x + NB_DIRS[dir]![0]!;
                const ny = y + NB_DIRS[dir]![1]!;
                if (!grid.isValidPos(nx, ny)) continue;
                if (!(this.get(nx, ny) > bestNearbyScent)) continue;
                if (!rules.canEnter(nx, ny)) continue;
                bestNearbyScent = this.get(nx, ny);
                bestDir = dir;
            }

            if (bestDir >= 0 && bestNearbyScent > this.get(x, y)) {
                return NB_DIRS[bestDir]!;
            }

            if (canTryAgain) {
                // Monsters.c:2884-2896：气味弥散进对角 kink，只重试一次
                canTryAgain = false;
                for (let d1 = 0; d1 < 4; d1++) {
                    const nx = x + NB_DIRS[d1]![0]!;
                    const ny = y + NB_DIRS[d1]![1]!;
                    for (let d2 = 0; d2 < 4; d2++) {
                        const mx = nx + NB_DIRS[d2]![0]!;
                        const my = ny + NB_DIRS[d2]![1]!;
                        if (grid.isValidPos(nx, ny) && grid.isValidPos(mx, my)) {
                            this.set(nx, ny, Math.max(this.get(nx, ny), this.get(mx, my) - 1));
                        }
                    }
                }
            } else {
                return null;
            }
        }
    }

    /**
     * P4-8 返工：CE Monsters.c:1630-1654 awarenessDistance（target=玩家）。
     * "感知距离"就是气味的陈旧度：观察者脚下气味值与 scentTurnNumber 的差
     * （该值 ≈ 表观距离 ×2——气味每回合老化 +3、scentDistance 长轴权重 2）。
     * 观察者在玩家 FOV 内时与真实 scentDistance 取 min（隔着透明障碍也能
     * "看得见"地拉近感知），再封顶 1000；负值（理论上只在回卷瞬间出现）
     * 视为 1000（完全失去踪迹）。CE 的 `target != &player` 分支
     * （openPathBetween）web 无多目标场景，不存在。
     */
    public awarenessDistance(grid: Grid, ox: number, oy: number, px: number, py: number): number {
        let perceivedDistance = this.turnNumber - this.get(ox, oy);
        if (grid.getCell(ox, oy)?.isVisible) {
            perceivedDistance = Math.min(perceivedDistance, scentDistance(ox, oy, px, py));
        }
        perceivedDistance = Math.min(perceivedDistance, 1000);
        if (perceivedDistance < 0) {
            perceivedDistance = 1000;
        }
        return perceivedDistance;
    }

    /**
     * P4-8 返工：CE Monsters.c:1658-1690 awareOfTarget（target=玩家）。
     * 分支顺序照抄 CE——ALWAYS_HUNTING 恒真 → IMMOBILE 看 perceived <=
     * awareness → `> awareness*3` 硬截断（"out of awareness range, even if
     * hunting"）→ 追踪态超出 awareness 时 3% 概率丢目标（CE 写作
     * rand_percent(97) 保持）→ 观察者不在玩家 FOV 内则未感知 →
     * `<= awareness` 时 25% 概率警觉（唤醒用，web 本轮唤醒仍走旧路径，
     * 见报告取舍）→ 其余未感知。rand_percent 走项目 rng（RNG_SUBSTANTIVE，
     * 同种子可复现）；不满足分支时不消耗随机数（与 CE rand_percent 短路一致）。
     */
    public awareOfTarget(grid: Grid, ox: number, oy: number, px: number, py: number,
        p: AwareOfTargetParams): boolean {
        const perceivedDistance = this.awarenessDistance(grid, ox, oy, px, py);
        const awareness = p.stealthRange * 2;

        if (p.alwaysHunting) {
            return true;
        }
        if (p.immobile) {
            // CE：炮塔/图腾类，感知 ⇔ 在潜行半径内（镜图腾靠 ALWAYS_HUNTING 豁免）
            return perceivedDistance <= awareness;
        }
        if (perceivedDistance > awareness * 3) {
            // 硬截断，追踪态也逃不掉
            return false;
        }
        if (p.tracking) {
            // 已感知：超出潜行半径时每回合 3% 概率丢目标
            return perceivedDistance > awareness ? rng.randPercent(97) : true;
        }
        if (!grid.getCell(ox, oy)?.isVisible) {
            // CE：非追踪态且玩家不在观察者 FOV（pmapAt(observer)->IN_FIELD_OF_VIEW）
            return false;
        }
        if (perceivedDistance <= awareness) {
            // 半径内但当前未感知（唤醒掷骰，CE rand_percent(25)）
            return rng.randPercent(25);
        }
        return false;
    }
}
