/**
 * src/engine/Systems/Time.ts
 * 全局时钟簿记
 *
 * P2-1 说明：CE 的调度不是事件队列，而是 Time.c:2468 playerTurnEnded 的
 * "最近事件推进"循环（web 实现在 Game.playerTurnEnded，基于实体各自的
 * ticksUntilTurn）。原先的排队式事件 API（入队/出队/按实体清队）全仓
 * 无调用、且与 CE 结构不符，已删除；p2_1 测试对相关符号做全仓守卫扫描。
 *
 * currentTick 仍被输入录制等使用，保留为纯簿记；其中的差异化耗时
 * （50/100/200）尚未接入 tick 调度，P2-2 以真实 movementDuration 统一口径。
 */

export class TimeSystem {
    public currentTick: number = 0;
}

export const timeSystem = new TimeSystem();
