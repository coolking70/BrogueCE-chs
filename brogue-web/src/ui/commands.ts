/**
 * src/ui/commands.ts — FE-1 触屏输入的唯一出口（录制/回放边界）。
 *
 * 触屏命令栏、方向键、手势、目标选择条发出的每一个会改变游戏状态的输入，
 * 都只能经过这里的两个函数：
 *  - dispatch → inputManager.triggerAction → GameCanvas 注册的回调
 *    → game.handlePlayerAction(action, data)（= executeCommand，进 U27 命令日志）
 *    → game.update()。与键盘按键完全同一路径。
 *  - travelTo → game.executeCommand('mouse_travel', pos) → game.update()。
 *    与桌面鼠标点选远处格子完全同一条命令（投掷落点 / 自动寻路 / 法杖点选）。
 *
 * 守卫：fe_1_touch.test.ts 断言触屏组件不直接调用引擎的状态修改方法。
 */
import { inputManager } from '../engine/Input';
import { activeGame } from '../engine/Core/Game';

export function dispatch(action: string, data?: unknown): void {
    inputManager.triggerAction(action, data);
}

export function travelTo(x: number, y: number): void {
    activeGame.executeCommand('mouse_travel', { x, y });
    activeGame.update();
}
