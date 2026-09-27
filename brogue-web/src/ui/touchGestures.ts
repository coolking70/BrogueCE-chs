/**
 * src/ui/touchGestures.ts — FE-1 地图触屏手势识别（纯逻辑，无 DOM / 无定时器）。
 *
 *  - 单指按下后位移 < TAP_SLOP 且在 LONG_PRESS_MS 前抬起 → tap
 *  - 单指按住 ≥ LONG_PRESS_MS 且位移 < TAP_SLOP → longpress（调用方定时器轮询 poll）
 *  - 单指位移 ≥ TAP_SLOP → pan（逐次增量），此后不再产生 tap/longpress
 *  - 双指 → pinch（逐次缩放比），此后本轮不再产生 tap
 *
 * 只输出"意图"，由 GameCanvas 翻译为显示操作（平移/缩放/查看）或经录制边界的命令。
 */
export const TAP_SLOP_PX = 10;
export const LONG_PRESS_MS = 450;

export type GestureEvent =
    | { type: 'tap'; x: number; y: number }
    | { type: 'longpress'; x: number; y: number }
    | { type: 'pan'; dx: number; dy: number }
    | { type: 'pinch'; factor: number };

interface Pointer { x: number; y: number; startX: number; startY: number; startT: number }

export class GestureTracker {
    private pointers = new Map<number, Pointer>();
    private mode: 'idle' | 'press' | 'pan' | 'pinch' | 'consumed' = 'idle';
    private pinchDist = 0;

    get active(): boolean {
        return this.pointers.size > 0;
    }

    down(id: number, x: number, y: number, t: number): GestureEvent[] {
        this.pointers.set(id, { x, y, startX: x, startY: y, startT: t });
        if (this.pointers.size === 1) {
            this.mode = 'press';
        } else if (this.pointers.size === 2) {
            this.mode = 'pinch';
            this.pinchDist = this.distance();
        }
        return [];
    }

    move(id: number, x: number, y: number): GestureEvent[] {
        const p = this.pointers.get(id);
        if (!p) return [];
        const dx = x - p.x;
        const dy = y - p.y;
        p.x = x;
        p.y = y;
        if (this.mode === 'pinch' && this.pointers.size >= 2) {
            const d = this.distance();
            const factor = this.pinchDist > 0 ? d / this.pinchDist : 1;
            this.pinchDist = d;
            return factor !== 1 && Number.isFinite(factor) ? [{ type: 'pinch', factor }] : [];
        }
        if (this.mode === 'press') {
            if (Math.hypot(x - p.startX, y - p.startY) >= TAP_SLOP_PX) {
                this.mode = 'pan';
                return [{ type: 'pan', dx: x - p.startX, dy: y - p.startY }];
            }
            return [];
        }
        if (this.mode === 'pan') return [{ type: 'pan', dx, dy }];
        return [];
    }

    up(id: number, t: number): GestureEvent[] {
        const p = this.pointers.get(id);
        if (!p) return [];
        this.pointers.delete(id);
        const out: GestureEvent[] = [];
        if (this.mode === 'press' && t - p.startT < LONG_PRESS_MS) {
            out.push({ type: 'tap', x: p.x, y: p.y });
        }
        if (this.pointers.size === 0) this.mode = 'idle';
        else if (this.mode === 'pinch') this.mode = 'consumed'; // 双指松开一指：本轮结束前不再触发
        return out;
    }

    cancel(id: number): void {
        this.pointers.delete(id);
        if (this.pointers.size === 0) this.mode = 'idle';
        else this.mode = 'consumed';
    }

    /** 调用方定时器轮询：按住足够久且未移动 → 一次 longpress（之后抬起不再算 tap）。 */
    poll(t: number): GestureEvent[] {
        if (this.mode !== 'press' || this.pointers.size !== 1) return [];
        const p = this.pointers.values().next().value as Pointer;
        if (t - p.startT >= LONG_PRESS_MS) {
            this.mode = 'consumed';
            return [{ type: 'longpress', x: p.x, y: p.y }];
        }
        return [];
    }

    private distance(): number {
        const [a, b] = [...this.pointers.values()];
        return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    }
}
