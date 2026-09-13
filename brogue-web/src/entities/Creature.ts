/**
 * src/entities/Creature.ts
 * Base class for all living things (Player and Monsters)
 */

import type { Entity, Pos } from '../types';
import { Direction } from '../types';

export type StatusId = 'paralyzed' | 'invisible' | 'telepathy' | 'levitating' | 'hallucinating' | 'confused' | 'regenerating' | 'haste' | 'poisoned' | 'slowed' | 'hasted' | 'weakened' | 'flying' | 'immune_fire';
type StatusStackMode = 'refresh' | 'stack';

export class Creature implements Entity {
    public id: number;
    public loc: Pos;
    public hp: number;
    public maxHp: number;
    public name: string;
    public color: number;
    public char: string;
    public statusDurations: Partial<Record<StatusId, number>>;
    public statusImmunities: Set<StatusId>;

    constructor(x: number, y: number, name: string, char: string, color: number) {
        this.id = Math.floor(Math.random() * 1000000); // Simple ID generation
        this.loc = { x, y };
        this.name = name;
        this.char = char;
        this.color = color;
        this.hp = 10;
        this.maxHp = 10;
        this.statusDurations = {};
        this.statusImmunities = new Set<StatusId>();
    }

    get x(): number { return this.loc.x; }
    get y(): number { return this.loc.y; }

    public hasStatus(id: StatusId): boolean {
        return (this.statusDurations[id] ?? 0) > 0;
    }

    public getStatusDuration(id: StatusId): number {
        return this.statusDurations[id] ?? 0;
    }

    public setStatusDuration(id: StatusId, duration: number) {
        if (duration > 0) {
            this.statusDurations[id] = duration;
        } else {
            delete this.statusDurations[id];
        }
    }

    public applyStatus(id: StatusId, duration: number, stackMode: StatusStackMode = 'refresh'): boolean {
        if (duration <= 0 || this.statusImmunities.has(id)) return false;
        const current = this.statusDurations[id] ?? 0;
        const next = stackMode === 'stack' ? current + duration : Math.max(current, duration);
        if (next === current) return false;
        this.statusDurations[id] = next;
        return true;
    }

    public tickStatuses(): StatusId[] {
        const expired: StatusId[] = [];
        const entries = Object.entries(this.statusDurations) as Array<[StatusId, number]>;
        for (const [id, turns] of entries) {
            const next = turns - 1;
            if (next <= 0) {
                delete this.statusDurations[id];
                expired.push(id);
            } else {
                this.statusDurations[id] = next;
            }
        }
        return expired;
    }

    public move(_dir: Direction) {
        // Implement movement logic
    }

    public takeDamage(amount: number) {
        this.hp -= amount;
        if (this.hp <= 0) {
            this.die();
        }
    }

    protected die() {
        // Handle death
        this.char = '%';
        this.color = 0x880000;
    }
}
