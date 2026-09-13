/**
 * src/engine/Systems/EventBus.ts
 * Global event bus for decoupled subsystems and modding hooks
 */

type EventHandler = (data?: any) => void;

class EventBusManager {
    private listeners: Record<string, EventHandler[]> = {};

    public on(event: string, handler: EventHandler) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(handler);
    }

    public off(event: string, handler: EventHandler) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(h => h !== handler);
    }

    public emit(event: string, data?: any) {
        if (!this.listeners[event]) return;
        for (const handler of this.listeners[event]) {
            handler(data);
        }
    }
}

export const EventBus = new EventBusManager();
