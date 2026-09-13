/**
 * src/engine/Visuals/FloatingText.ts
 * Manages floating text for damage numbers, effects, etc.
 */

import { rng } from '../Random';

export class FloatingText {
    public id: number;
    public text: string;
    public x: number;
    public y: number;
    public color: number | string;
    public life: number; // Ticks remaining until it disappears
    public dy: number; // Vertical movement per tick

    constructor(text: string, x: number, y: number, color: number | string = 0xffffff, life: number = 30) {
        this.id = rng.randRange(1, 1000000);
        this.text = text;
        this.x = x;
        this.y = y;
        this.color = color;
        this.life = life;
        this.dy = -0.02; // Float upwards
    }

    public update() {
        this.y += this.dy;
        this.life--;
    }
}
