/**
 * src/engine/Map/Grid.ts
 * Grid and Cell structures reflecting Brogue's 2D map.
 */
import type { Pos } from '../../types';
import { DCOLS, DROWS } from '../../types';
export { DCOLS, DROWS };

export enum TerrainType {
    NOTHING = 0,
    GRANITE,
    FLOOR,
    WALL,
    DOOR,
    OPEN_DOOR,
    WATER_SHALLOW,
    WATER_DEEP,
    CHASM,
    LAVA,
    GRASS,
    FOLIAGE,
    BOG,
    STAIRS_UP,
    STAIRS_DOWN,
    CHARRED_FLOOR,
    SIGN,
    RESET_PLATE,
    TRAP,
    SECRET_DOOR,
    PRESSURE_PLATE,
    LOCKED_DOOR,
    ALTAR,
    WEB,
    BLOOD,
    MUD
}

export enum LightType {
    NO_LIGHT = 0,
    LIT,
    DARK
}

/**
 * Represents a single tile on the map.
 */
export class Cell {
    public x: number;
    public y: number;

    // Base features
    public terrain: TerrainType = TerrainType.NOTHING;
    public char: string = ' ';
    public color: number = 0x000000;

    // Flags for state
    public isExplored: boolean = false;
    public isVisible: boolean = false;
    public hasMemory: boolean = false; // Does the player remember this tile

    // Light
    public light: LightType = LightType.NO_LIGHT;

    // Movement & Sight blocking
    public isPassable: boolean = false;
    public isOpaque: boolean = false;

    // Environmental states
    public isBurning: boolean = false;
    public burnDuration: number = 0;

    // Trap metadata (for TRAP and PRESSURE_PLATE terrain)
    public trapType: 'poison_gas' | 'teleport' | 'fire' | null = null;
    // Whether a SECRET_DOOR has been discovered
    public isDiscovered: boolean = false;

    // Altar linking (if > 0, picking an item from this altar destroys all others with the same ID)
    public altarGroupId: number | null = null;

    // Machine zone tracking (0 = no machine)
    public machineNumber: number = 0;

    constructor(x: number, y: number) {
        this.x = x;
        this.y = y;
    }
}

/**
 * The 2D Dungeon Map Grid
 */
export class Grid {
    public readonly width: number;
    public readonly height: number;
    private cells: Cell[][];

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.cells = this.initializeGrid(width, height);
    }

    private initializeGrid(w: number, h: number): Cell[][] {
        const grid: Cell[][] = [];
        for (let x = 0; x < w; x++) {
            grid[x] = [];
            for (let y = 0; y < h; y++) {
                grid[x]![y] = new Cell(x, y);
            }
        }
        return grid;
    }

    public getCell(x: number, y: number): Cell | null {
        if (!this.isValidPos(x, y)) {
            return null;
        }
        return this.cells[x]?.[y] ?? null;
    }

    public getCellPos(pos: Pos): Cell | null {
        return this.getCell(pos.x, pos.y);
    }

    public isValidPos(x: number, y: number): boolean {
        return x >= 0 && x < this.width && y >= 0 && y < this.height;
    }

    public setTerrain(x: number, y: number, terrain: TerrainType, char: string = ' ', color: number = 0xFFFFFF) {
        const cell = this.getCell(x, y);
        if (cell) {
            cell.terrain = terrain;
            cell.char = char;
            cell.color = color;
            // Basic heuristics for passability / opacity.
            cell.isPassable = (
                terrain !== TerrainType.WALL &&
                terrain !== TerrainType.GRANITE &&
                terrain !== TerrainType.CHASM &&
                terrain !== TerrainType.SECRET_DOOR
            );
            cell.isOpaque = (
                terrain === TerrainType.WALL ||
                terrain === TerrainType.GRANITE ||
                terrain === TerrainType.DOOR ||
                terrain === TerrainType.SECRET_DOOR
            );
        }
    }
}
