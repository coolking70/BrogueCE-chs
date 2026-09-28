/**
 * src/ui/targeting.ts — FE-1 触屏目标选择的纯 UI 状态与命令路由。
 *
 * 触屏上"点一下就投出去"太容易误触，所以投掷改为两步：点地图只设 UI 瞄准格
 * （高亮，不进录像），再点同一格或按"确认"才提交 `mouse_travel`（与桌面鼠标
 * 点选完全同一条已录制的命令）。法杖/魔杖则直接移动引擎光标（`move` 增量，
 * 本就是录制在内的 CE 光标命令），确认发 `confirm_target`。
 *
 * 所有改状态的输出都经 `dispatch`（= inputManager.triggerAction → handlePlayerAction）
 * 或 `executeCommand`（mouse_travel），本模块自身不碰引擎内部。
 */
import { reactive } from 'vue';

/** 投掷瞄准格描边色（纯绘制原语，放在这里而非 GameCanvas，见 r_1 颜色字面量守卫）。 */
export const THROW_AIM_STROKE = 0xffcc44;
export const THROW_AIM_FILL = { color: 0xffcc44, alpha: 0.18 } as const;

export interface TargetingState {
    /** 投掷的 UI 瞄准格（null = 尚未点选） */
    aim: { x: number; y: number } | null;
}

export const targetingState = reactive<TargetingState>({ aim: null });

export function clearAim(): void {
    targetingState.aim = null;
}

/** 目标选择期间，一次触屏点选对应的命令（纯函数，便于单测）。 */
export type TapCommand =
    | { kind: 'none' }                                            // 忽略（如投掷点自己脚下）
    | { kind: 'aim'; x: number; y: number }                       // 只设 UI 瞄准格
    | { kind: 'execute'; action: 'mouse_travel'; data: { x: number; y: number } }
    | { kind: 'dispatch'; action: 'move'; data: { x: number; y: number } }
    | { kind: 'dispatch'; action: 'confirm_target' };

export function targetingTapCommand(
    mode: 'throw' | 'arcana',
    cell: { x: number; y: number },
    aim: { x: number; y: number } | null,
    arcanaCursor: { x: number; y: number } | null,
    player: { x: number; y: number },
): TapCommand {
    if (mode === 'arcana') {
        if (arcanaCursor && arcanaCursor.x === cell.x && arcanaCursor.y === cell.y) {
            return { kind: 'dispatch', action: 'confirm_target' };
        }
        const from = arcanaCursor ?? cell;
        return { kind: 'dispatch', action: 'move', data: { x: cell.x - from.x, y: cell.y - from.y } };
    }
    // CE chooseTarget 不接受以自身为目标（Items.c:6502-6506 同口径）
    if (cell.x === player.x && cell.y === player.y) return { kind: 'none' };
    if (aim && aim.x === cell.x && aim.y === cell.y) {
        return { kind: 'execute', action: 'mouse_travel', data: { x: cell.x, y: cell.y } };
    }
    return { kind: 'aim', x: cell.x, y: cell.y };
}
