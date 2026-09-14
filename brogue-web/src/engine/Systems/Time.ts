/**
 * src/engine/Systems/Time.ts
 * 全局时钟簿记
 *
 * P2-1 说明：CE 的调度不是事件队列，而是 Time.c:2468 playerTurnEnded 的
 * "最近事件推进"循环（web 实现在 Game.playerTurnEnded，基于实体各自的
 * ticksUntilTurn）。原先的排队式事件 API（入队/出队/按实体清队）全仓
 * 无调用、且与 CE 结构不符，已删除；p2_1 测试对相关符号做全仓守卫扫描。
 *
 * currentTick 仍被输入录制等使用，保留为纯簿记；各动作耗时按
 * player.movementSpeed/attackSpeed 口径累加（P2-2/P2-3）。
 * 客观时间门（ticksTillUpdateEnvironment）自 P2-3 起挂在 Game 上，
 * 作为 advancementLoop soonestTurn 的第三候选——本文件不再是时间语义的权威位置。
 */

export class TimeSystem {
    public currentTick: number = 0;
}

export const timeSystem = new TimeSystem();
