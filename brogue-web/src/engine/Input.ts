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
        this.keybMap[e.key] = true;

        if (this.onActionCallback) {
            switch (e.key) {
                case 'ArrowUp':
                case 'w':
                case 'W':
                case 'k':
                    this.onActionCallback('move', Direction.UP);
                    break;
                case 'ArrowDown':
                case 's':
                case 'S':
                case 'j':
                    this.onActionCallback('move', Direction.DOWN);
                    break;
                case 'ArrowLeft':
                case 'a':
                case 'A':
                case 'h':
                    this.onActionCallback('move', Direction.LEFT);
                    break;
                case 'ArrowRight':
                case 'd':
                case 'D':
                case 'l':
                    this.onActionCallback('move', Direction.RIGHT);
                    break;
                // Diagonals (vim keys)
                case 'y': this.onActionCallback('move', Direction.UPLEFT); break;
                case 'u': this.onActionCallback('move', Direction.UPRIGHT); break;
                case 'b': this.onActionCallback('move', Direction.DOWNLEFT); break;
                case 'n': this.onActionCallback('move', Direction.DOWNRIGHT); break;
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
