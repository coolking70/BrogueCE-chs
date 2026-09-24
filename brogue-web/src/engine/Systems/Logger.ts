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

export class Logger {
    public messages: LogMessage[] = [];
    private nextId: number = 0;

    public reset(): void {
        this.messages = [];
        this.nextId = 0;
    }

    public log(text: string, color: string = '#ffffff') {
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
