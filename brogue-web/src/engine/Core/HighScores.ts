/** CE platformdependent.c:268-318,434-472 and Rogue.h HIGH_SCORES_COUNT. */
export const HIGH_SCORES_COUNT = 30;
const STORAGE_KEY = 'brogue-web-high-scores-v1';

export interface HighScoreEntry {
    score: number;
    date: string; // CE DATE_FORMAT: %Y-%m-%d, in local time
    description: string;
    recordedAt: number;
}

function isEntry(value: unknown): value is HighScoreEntry {
    if (!value || typeof value !== 'object') return false;
    const entry = value as Partial<HighScoreEntry>;
    return Number.isSafeInteger(entry.score) && entry.score! >= 0
        && Number.isFinite(entry.recordedAt)
        && typeof entry.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(entry.date)
        && typeof entry.description === 'string';
}

function sorted(entries: HighScoreEntry[]): HighScoreEntry[] {
    // CE's selection sort chooses the last equal-score slot first.
    return entries.map((entry, index) => ({ entry, index }))
        .sort((a, b) => b.entry.score - a.entry.score || b.index - a.index)
        .slice(0, HIGH_SCORES_COUNT).map(({ entry }) => entry);
}

export function readHighScores(): HighScoreEntry[] {
    try {
        const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        return Array.isArray(parsed) ? sorted(parsed.filter(isEntry)) : [];
    } catch {
        return [];
    }
}

export function saveHighScore(score: number, description: string, now: Date = new Date()): boolean {
    if (!Number.isSafeInteger(score) || score < 0) return false;
    const entries = readHighScores();
    // CE replaces the first lowest slot, including a tie. Empty slots have score 0.
    if (entries.length === HIGH_SCORES_COUNT && entries[entries.length - 1]!.score > score) return false;
    const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const entry: HighScoreEntry = { score, date, description, recordedAt: now.getTime() };
    if (entries.length === HIGH_SCORES_COUNT) {
        const lowest = entries[entries.length - 1]!.score;
        entries[entries.findIndex(row => row.score === lowest)] = entry;
    } else {
        entries.push(entry);
    }
    try {
        // CE saves the replaced buffer as-is; sorting happens on the next read.
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(entries));
        return !!globalThis.localStorage;
    } catch {
        return false;
    }
}
