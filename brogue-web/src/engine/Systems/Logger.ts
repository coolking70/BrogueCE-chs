/** CE IO.c:3451-3515 message archive and presentation-only acknowledgement. */
export interface LogMessage {
    id: number;
    text: string;
    color: string;
    count: number;
    turn: number;
    acknowledge?: boolean;
    foldable?: boolean;
}

export interface MessageOptions {
    acknowledge?: boolean;
    /** CE FOLDABLE: combat text; only same-turn duplicates collapse. */
    foldable?: boolean;
}

// CE Rogue.h:120-128: ROWS * 10 * 4, not the number of visible lines.
export const MESSAGE_ARCHIVE_ENTRIES = 34 * 10 * 4;
export const MAX_MESSAGE_REPEATS = 100;
const disturbanceCallbacks = new WeakMap<Logger, () => void>();
// UI wiring and pending clicks must never enter snapshots or recording hashes.
const presentations = new WeakMap<Logger, { enabled: () => boolean; pending: LogMessage[] }>();
const combatBuffers = new WeakMap<Logger, { text: string; color: string }[]>();
const heardCombat = new WeakSet<Logger>();

/** CE FOLDABLE presentation: preserve the individual archive entries/repeats. */
export function foldCombatMessages(messages: readonly LogMessage[], width = 100): LogMessage[] {
    const lines: LogMessage[] = [];
    for (const message of messages) {
        const last = lines[lines.length - 1];
        if (last?.foldable && message.foldable && last.turn === message.turn
            && last.count === 1 && message.count === 1 && last.color === message.color
            && !last.acknowledge && !message.acknowledge
            && last.text.length + message.text.length + 2 <= width) {
            last.text = last.text.replace(/[.。]$/, '') + '; ' + message.text;
        } else lines.push({ ...message });
    }
    return lines;
}

export class Logger {
    public messages: LogMessage[] = [];
    public turn = 0;
    private nextId = 0;
    public get onDisturb(): (() => void) | null { return disturbanceCallbacks.get(this) ?? null; }
    public set onDisturb(callback: (() => void) | null) {
        if (callback) disturbanceCallbacks.set(this, callback);
        else disturbanceCallbacks.delete(this);
    }
    public blockCombatText = false;
    public disturb(): void { this.onDisturb?.(); }

    /** Mounted UI opts in; headless and replay never wait for a human. */
    public presentAcknowledgments(enabled: (() => boolean) | null): void {
        if (enabled) presentations.set(this, { enabled, pending: [] });
        else presentations.delete(this);
    }
    public get pendingAcknowledgment(): LogMessage | undefined {
        const display = presentations.get(this);
        if (display && !display.enabled()) display.pending = [];
        return display?.pending[0];
    }
    public acknowledgeNext(): void { presentations.get(this)?.pending.shift(); }
    public clearAcknowledgments(): void {
        const display = presentations.get(this);
        if (display) display.pending = [];
    }

    public combat(text: string, color = '#ffffff', lethal = false): void {
        if (!text || (this.blockCombatText && !lethal)) return;
        const buffer = combatBuffers.get(this) ?? [];
        // CE COLS * 2 buffer; flush before an overflow, retaining message order.
        if (buffer.reduce((n, m) => n + m.text.length + 1, 0) + text.length > 198) this.flushCombat();
        const pending = combatBuffers.get(this) ?? [];
        pending.push({ text, color });
        combatBuffers.set(this, pending);
    }
    public hearCombat(text: string, lethal = false): void {
        if (!lethal && (this.blockCombatText || heardCombat.has(this))) return;
        if (!lethal) heardCombat.add(this);
        this.combat(text, '#ffffff', lethal);
    }
    public flushCombat(): void {
        const pending = combatBuffers.get(this) ?? [];
        combatBuffers.delete(this); // log() flushes too; clear before recursion.
        for (const message of pending) this.log(message.text, message.color, { foldable: true });
    }
    public endCombatTurn(): void {
        this.flushCombat();
        heardCombat.delete(this);
    }
    public getState() {
        this.flushCombat();
        return { messages: this.messages.map(m => ({ ...m })), nextId: this.nextId, turn: this.turn };
    }
    public setState(state: ReturnType<Logger['getState']>): void {
        combatBuffers.delete(this);
        heardCombat.delete(this);
        this.messages = state.messages.map(m => ({ ...m }));
        this.nextId = state.nextId;
        this.turn = state.turn;
        this.clearAcknowledgments();
    }
    public reset(): void {
        combatBuffers.delete(this);
        heardCombat.delete(this);
        this.messages = [];
        this.nextId = 0;
        this.turn = 0;
        this.blockCombatText = false;
        this.clearAcknowledgments();
    }

    public log(text: string, color = '#ffffff', options: MessageOptions = {}): void {
        if (!text) return;
        this.flushCombat();
        this.disturb();
        let entry: LogMessage | undefined;
        // CE examines at most ARCHIVE_ENTRIES - 1 preceding entries. Stop at
        // the first other-turn entry, except the latest non-FOLDABLE message.
        for (let back = 1; back < MESSAGE_ARCHIVE_ENTRIES && back <= this.messages.length; back++) {
            const previous = this.messages[this.messages.length - back]!;
            if (!((back === 1 && !options.foldable) || previous.turn === this.turn)) break;
            if (previous.text === text) {
                previous.turn = this.turn;
                previous.count = Math.min(MAX_MESSAGE_REPEATS, previous.count + 1);
                entry = previous;
                break;
            }
        }
        if (!entry) {
            entry = { id: this.nextId++, text, color, count: 1, turn: this.turn,
                ...(options.acknowledge ? { acknowledge: true } : {}),
                ...(options.foldable ? { foldable: true } : {}) };
            this.messages.push(entry);
            if (this.messages.length > MESSAGE_ARCHIVE_ENTRIES) this.messages.shift();
        }
        if (options.acknowledge) {
            entry.acknowledge = true;
            const display = presentations.get(this);
            // Each occurrence still needs acknowledgment, even at count 100.
            if (display?.enabled()) display.pending.push({ ...entry, text, color });
        }
    }
}
export const logger = new Logger();
