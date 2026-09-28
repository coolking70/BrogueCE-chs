/**
 * src/engine/Input.ts
 * Handling keyboard and mouse/touch input
 */

import { Direction } from '../types';

export class InputManager {
    private keybMap: Record<string, boolean> = {};
    private onActionCallback: ((action: string, data?: any) => void) | null = null;
    /** CE: any keystroke interrupts automation (Movement.c:2345-2351, IO.c:2366-2375).
     *  Unbound keys are not game commands (P1-46); the host decides whether an
     *  automation is running and only then issues `interrupt_auto`. */
    private onUnboundKeyCallback: (() => void) | null = null;

    constructor() {
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('keyup', this.handleKeyUp.bind(this));
    }

    public setCallback(cb: (action: string, data?: any) => void) {
        this.onActionCallback = cb;
    }

    public setUnboundKeyCallback(cb: (() => void) | null) {
        this.onUnboundKeyCallback = cb;
    }

    public triggerAction(action: string, data?: any) {
        if (this.onActionCallback) {
            this.onActionCallback(action, data);
        }
    }

    private handleKeyDown(e: KeyboardEvent) {
        // Text entry (e.g. call-item nickname) must not become a game command.
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
        this.keybMap[e.key] = true;

        if (this.onActionCallback) {
            // CE IO.c:2700-2711: modifiers run in all eight directions.
            // Use code for the numeric keypad, including when NumLock is off.
            const directions: Record<string, Direction> = {
                ArrowUp: Direction.UP, k: Direction.UP, K: Direction.UP,
                ArrowDown: Direction.DOWN, j: Direction.DOWN, J: Direction.DOWN,
                ArrowLeft: Direction.LEFT, h: Direction.LEFT, H: Direction.LEFT,
                ArrowRight: Direction.RIGHT, l: Direction.RIGHT, L: Direction.RIGHT,
                y: Direction.UPLEFT, Y: Direction.UPLEFT, u: Direction.UPRIGHT, U: Direction.UPRIGHT,
                b: Direction.DOWNLEFT, B: Direction.DOWNLEFT, n: Direction.DOWNRIGHT, N: Direction.DOWNRIGHT,
                Numpad1: Direction.DOWNLEFT, Numpad2: Direction.DOWN, Numpad3: Direction.DOWNRIGHT,
                Numpad4: Direction.LEFT, Numpad6: Direction.RIGHT,
                Numpad7: Direction.UPLEFT, Numpad8: Direction.UP, Numpad9: Direction.UPRIGHT,
            };
            const direction = directions[e.code?.startsWith('Numpad') ? e.code : e.key];
            if (direction !== undefined) {
                e.preventDefault?.();
                this.onActionCallback(e.shiftKey || e.ctrlKey ? 'run' : 'move', direction);
                return;
            }
            if (e.code === 'Numpad5') {
                e.preventDefault?.();
                this.onActionCallback('wait');
                return;
            }
            switch (e.key) {
                // P1-46: WASD stays free for CE commands; w/T/M/S remain unbound.
                case 's':
                    e.preventDefault?.(); // Ctrl-S must not open the browser Save dialog.
                    this.onActionCallback(e.ctrlKey ? 'search_long' : 'search');
                    break;
                // B-2：CE THROW_KEY（`Rogue.h:1183`）。P1-46 把移动键回归纯 vi 键
                // 后 `t` 空闲，接上投掷入口。CE 的大写 `T` 是 RETHROW_KEY
                //（`Rogue.h:1184`，重扔上一件）——web 无 lastItemThrown 簿记，
                // 不接（b_2 报告登记），也不得悄悄映射到其它动作。
                case 'a':
                    this.onActionCallback('apply_item');
                    break;
                case 'Tab':
                    e.preventDefault?.();
                    this.onActionCallback('cycle_target', e.shiftKey ? -1 : 1);
                    break;
                case ' ':
                    e.preventDefault?.();
                    this.onActionCallback('cancel_target');
                    break;
                case 'Enter':
                    this.onActionCallback('confirm_target');
                    break;
                case 't':
                    this.onActionCallback('throw_item');
                    break;
                case '.':
                case '。':
                case 'z':
                    this.onActionCallback('wait');
                    break;
                case 'Z':
                    this.onActionCallback('auto_rest');
                    break;
                case 'e':
                    this.onActionCallback('inventory_action', 'equip');
                    break;
                case 'r':
                    this.onActionCallback('inventory_action', 'unequip');
                    break;
                case 'd':
                    this.onActionCallback('inventory_action', 'drop');
                    break;
                case 'c':
                    this.onActionCallback('inventory_action', 'call');
                    break;
                case 'g':
                    this.onActionCallback('pickup');
                    break;
                case 'i':
                case 'I':
                    this.onActionCallback('toggle_inventory');
                    break;
                case 'D':
                    this.onActionCallback('discoveries');
                    break;
                case '?':
                    this.onActionCallback('help');
                    break;
                case 'Escape':
                    this.onActionCallback('escape');
                    break;
                case 'x':
                case 'X':
                    this.onActionCallback('auto_explore');
                    break;
                case '<':
                case ',':
                case '，':
                case '《':
                    this.onActionCallback('travel_stairs', 'up');
                    break;
                case '>':
                case '》':
                    this.onActionCallback('travel_stairs', 'down');
                    break;
                default:
                    this.onUnboundKeyCallback?.();
                    break;
                // null dir means rest
            }
        }
    }

    private handleKeyUp(e: KeyboardEvent) {
        this.keybMap[e.key] = false;
    }
}

export const inputManager = new InputManager();
