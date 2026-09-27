import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findHardcodedLogStrings } from './i18n_scan';

describe('X2i visible runtime templates', () => {
    it('follows a local template into logger.log without flagging translated values', () => {
        const root = mkdtempSync(join(tmpdir(), 'x2i-i18n-'));
        try {
            mkdirSync(join(root, 'feature'));
            writeFileSync(join(root, 'feature', 'messages.ts'), [
                'function show(index: number) {',
                '  const failure = `OOS at command ${index}`;',
                '  logger.log(failure);',
                "  const localized = i18next.t('replay.out_of_sync');",
                '  logger.log(localized);',
                '}',
            ].join('\n'));
            const hits = findHardcodedLogStrings(root);
            expect(hits.map(hit => [hit.file, hit.text, hit.hasAsciiLetters]))
                .toEqual([['feature/messages.ts', 'OOS at command ', true]]);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
