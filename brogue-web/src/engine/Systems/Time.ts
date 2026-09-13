/**
 * src/engine/Systems/Time.ts
 * Porting Brogue's turn and tick-based scheduling mechanism
 */

import type { Entity } from '../../types';

export enum EventType {
    NONE,
    ACTOR_MOVE,
    ACTOR_ATTACK,
    SPAWN_MONSTER,
    ENVIRONMENT_TICK,
}

export interface ScheduledEvent {
    tick: number;
    type: EventType;
    actor?: Entity;
    data?: any;
}

export class TimeSystem {
    public currentTick: number = 0;
    private eventQueue: ScheduledEvent[] = [];

    constructor() { }

    /**
     * Schedule a future event
     */
    public scheduleEvent(delayTicks: number, type: EventType, actor?: Entity, data?: any) {
        const event: ScheduledEvent = {
            tick: this.currentTick + delayTicks,
            type,
            actor,
            data
        };

        this.eventQueue.push(event);
        // Sort queue by tick (lowest first)
        this.eventQueue.sort((a, b) => a.tick - b.tick);
    }

    /**
     * Fast forward time until the next event
     */
    public advanceToNextEvent(): ScheduledEvent | null {
        if (this.eventQueue.length === 0) return null;

        const nextEvent = this.eventQueue.shift()!;

        // Fast forward global time
        if (nextEvent.tick > this.currentTick) {
            this.currentTick = nextEvent.tick;
        }

        return nextEvent;
    }

    public clearEventsForActor(actor: Entity) {
        this.eventQueue = this.eventQueue.filter(e => e.actor !== actor);
    }
}

export const timeSystem = new TimeSystem();
