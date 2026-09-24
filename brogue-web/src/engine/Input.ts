/**
 * src/engine/Input.ts
 * Handling keyboard and mouse/touch input
 */

import { Direction } from '../types';

export class InputManager {
    private keybMap: Record<string, boolean> = {};
    private onActionCallback: ((action: string, data?: any) => void) | null = null;

    constructor() {
        window.addEventListener('keydown', this.handleKeyDown.bind(this));
        window.addEventListener('keyup', this.handleKeyUp.bind(this));
    }

    public setCallback(cb: (action: string, data?: any) => void) {
        this.onActionCallback = cb;
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
            switch (e.key) {
                // ── 移动：纯 vi 键 + 方向键（P1-46，2026-09-17 用户裁决）──
                //
                // 原先 web 在 vi 键之上还绑了一套 WASD，那**一次性占掉了四个
                // CE 命令键**——CE 只用 vi 键移动（`Rogue.h:1161-1172`），
                // 而 `w`/`a`/`s`/`d` 在 CE 里全是命令：
                //   w = SWAP_KEY(:1186)   a = APPLY_KEY(:1182)
                //   s = SEARCH_KEY(:1177) d = DROP_KEY(:1189)
                // P1-42 的主动搜索就是因此无处安放。"使用"与"丢弃"是 Phase B
                // 必然要接的，再拖下去每轮都要重撞一次，故本次一并让出。
                //
                // 方向键不是 CE 的东西，但不与任何 CE 命令冲突，保留。
                // 键位自定义功能留给二次开发（用户裁决时明确延后）。
                case 'ArrowUp':
                case 'k':
                    this.onActionCallback('move', Direction.UP);
                    break;
                case 'ArrowDown':
                case 'j':
                    this.onActionCallback('move', Direction.DOWN);
                    break;
                case 'ArrowLeft':
                case 'h':
                    this.onActionCallback('move', Direction.LEFT);
                    break;
                case 'ArrowRight':
                case 'l':
                    this.onActionCallback('move', Direction.RIGHT);
                    break;
                // Diagonals (vim keys)
                case 'y': this.onActionCallback('move', Direction.UPLEFT); break;
                case 'u': this.onActionCallback('move', Direction.UPRIGHT); break;
                case 'b': this.onActionCallback('move', Direction.DOWNLEFT); break;
                case 'n': this.onActionCallback('move', Direction.DOWNRIGHT); break;
                // CE SEARCH_KEY（`Rogue.h:1177`）。P1-42 把引擎侧动作接好了，
                // 一直缺的就是这一行——`s` 让出来之后终于能接上。
                case 's':
                case 'S':
                    this.onActionCallback('search');
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
                    this.onActionCallback('wait_or_stairs_down');
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
                    this.onActionCallback('examine');
                    break;
                case 'X':
                    this.onActionCallback('auto_explore');
                    break;
                case '<':
                case ',':
                case '，':
                case '《':
                    this.onActionCallback('stairs_up');
                    break;
                case '>':
                case '》':
                    this.onActionCallback('stairs_down');
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
