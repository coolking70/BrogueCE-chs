/**
 * src/engine/Systems/Logger.ts
 * Manages the message log (history of events)
 */

export interface LogMessage {
    id: number;
    text: string;
    color: string;
    count: number;
}

// Session wiring, like the grid effect callbacks: never part of the run graph
// or log history. New/load/command boundaries bind the active Game explicitly.
const disturbanceCallbacks = new WeakMap<Logger, () => void>();

export class Logger {
    public messages: LogMessage[] = [];
    private nextId: number = 0;
    /** CE message() always disturbs, including folded messages. The active
     * Game owns the latch; loading history must not emit a new message. */
    public get onDisturb(): (() => void) | null { return disturbanceCallbacks.get(this) ?? null; }
    public set onDisturb(callback: (() => void) | null) {
        if (callback) disturbanceCallbacks.set(this, callback);
        else disturbanceCallbacks.delete(this);
    }
    public blockCombatText = false;

    public disturb(): void { this.onDisturb?.(); }

    /** CE attack(): suppress ordinary hits/misses during startFighting. */
    public combat(text: string, color: string = '#ffffff', lethal = false): void {
        if (!this.blockCombatText || lethal) this.log(text, color);
    }

    public getState() {
        return { messages: this.messages.map(m => ({ ...m })), nextId: this.nextId };
    }

    public setState(state: ReturnType<Logger['getState']>): void {
        this.messages = state.messages.map(m => ({ ...m }));
        this.nextId = state.nextId;
    }

    public reset(): void {
        this.messages = [];
        this.nextId = 0;
        this.blockCombatText = false;
    }

    public log(text: string, color: string = '#ffffff') {
        this.disturb();
        // If it's the same as the last message, just increment the counter
        if (this.messages.length > 0) {
            const last = this.messages[this.messages.length - 1];
            if (last && last.text === text) {
                last.count++;
                return;
            }
        }

        this.messages.push({
            id: this.nextId++,
            text,
            color,
            count: 1
        });

        // Keep a max of 50 logs for memory limits
        if (this.messages.length > 50) {
            this.messages.shift();
        }
    }
}

export const logger = new Logger();
