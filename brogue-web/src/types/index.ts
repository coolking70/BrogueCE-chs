/**
 * src/types/index.ts
 * Core Data Structures and Interfaces for Brogue-Web
 */

// ----------------------------------------------------------------------------
// 1. Fundamentals (Coordinates & Directions)
// ----------------------------------------------------------------------------

export interface Pos {
    x: number;
    y: number;
}

export const INVALID_POS: Pos = { x: -1, y: -1 };

export function posEq(a: Pos, b: Pos): boolean {
    return a.x === b.x && a.y === b.y;
}

export interface WindowPos {
    window_x: number;
    window_y: number;
}

export enum Direction {
    NO_DIRECTION = -1,
    // Cardinal directions
    UP = 0,
    DOWN = 1,
    LEFT = 2,
    RIGHT = 3,
    // Secondary directions
    UPLEFT = 4,
    DOWNLEFT = 5,
    UPRIGHT = 6,
    DOWNRIGHT = 7,
}

export const DIRECTION_COUNT = 8;

// ----------------------------------------------------------------------------
// 2. Map & Grid Constants
// ----------------------------------------------------------------------------

export const COLS = 100;
export const ROWS = 34; // 31 + MESSAGE_LINES (3)
export const MESSAGE_LINES = 3;

export const STAT_BAR_WIDTH = 20;

export const DCOLS = COLS - STAT_BAR_WIDTH - 1;
export const DROWS = ROWS - MESSAGE_LINES - 2;

// ----------------------------------------------------------------------------
// 3. Game Variants & Modes
// ----------------------------------------------------------------------------

export enum GameVariant {
    VARIANT_BROGUE,
    VARIANT_RAPID_BROGUE,
    VARIANT_BULLET_BROGUE,
    NUMBER_VARIANTS
}

export enum GraphicsMode {
    TEXT_GRAPHICS,
    TILES_GRAPHICS,
    HYBRID_GRAPHICS,
}

// ----------------------------------------------------------------------------
// 4. Input & Events
// ----------------------------------------------------------------------------

export enum EventType {
    KEYSTROKE,
    MOUSE_UP,
    MOUSE_DOWN,
    RIGHT_MOUSE_DOWN,
    RIGHT_MOUSE_UP,
    MOUSE_ENTERED_CELL,
    RNG_CHECK,
    SAVED_GAME_LOADED,
    END_OF_RECORDING,
    EVENT_ERROR,
}

export interface RogueEvent {
    eventType: EventType;
    param1: number;
    param2: number;
    controlKey: boolean;
    shiftKey: boolean;
}

export enum NotificationEventType {
    GAMEOVER_QUIT,
    GAMEOVER_DEATH,
    GAMEOVER_VICTORY,
    GAMEOVER_SUPERVICTORY,
    GAMEOVER_RECORDING
}

// ----------------------------------------------------------------------------
// 5. Entities & Display values
// ----------------------------------------------------------------------------

export enum DisplayDetailValue {
    DV_UNLIT = 0,
    DV_LIT,
    DV_DARK,
}

/**
 * Base interface for everything that exists on the map
 */
export interface Entity {
    id: number; // Used for ECS / quick lookup
    x: number;
    y: number;
    char: string;
    // We will expand Color to an object { r, g, b } or strict number format later
    color: number; // Hex code or PixiJS tint
}

// More specific types (Creatures, Items, Terrain) will be added as we port more modules.

// ----------------------------------------------------------------------------
// 6. Dungeon Generation (Architect)
// ----------------------------------------------------------------------------

export enum RoomType {
    CROSS_ROOM = 0,
    SMALL_SYMMETRICAL_CROSS_ROOM = 1,
    SMALL_ROOM = 2,
    CIRCULAR_ROOM = 3,
    CHUNKY_ROOM = 4,
    CAVE = 5,
    CAVERN = 6,
    ENTRANCE_ROOM = 7
}

export const ROOM_TYPE_COUNT = 8;

export interface DungeonProfile {
    roomFrequencies: number[]; // Length: ROOM_TYPE_COUNT
    corridorChance: number;
}
