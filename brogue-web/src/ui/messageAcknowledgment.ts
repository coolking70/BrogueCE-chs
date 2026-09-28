import { logger } from '../engine/Systems/Logger';

/** Capture before Input.ts without adding a command or repeating a held key. */
export function acknowledgmentKeys() {
    const swallowed = new Set<string>();
    const keydown = (event: KeyboardEvent) => {
        if (!logger.pendingAcknowledgment && !swallowed.has(event.code)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        swallowed.add(event.code);
        if (!event.repeat && !['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) logger.acknowledgeNext();
    };
    const keyup = (event: KeyboardEvent) => {
        if (!swallowed.delete(event.code)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
    };
    return { keydown, keyup };
}
