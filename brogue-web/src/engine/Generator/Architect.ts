/**
 * src/engine/Generator/Architect.ts
 * Porting Brogue's procedural dungeon generation logic
 */

import { Grid, TerrainType, DCOLS, DROWS } from '../Map/Grid';
import { rng } from '../Random';
import { RoomType, ROOM_TYPE_COUNT } from '../../types';
import type { DungeonProfile, Pos } from '../../types';
import * as RoomBuilder from './RoomBuilder';
import { BlueprintEngine, resetMachineCounter } from './BlueprintEngine';
import type { MachineResult } from './BlueprintEngine';

export class Architect {
    public grid: Grid;
    public machines: Array<{ door: Pos, center: Pos }> = [];
    public altars: Array<{ door: Pos, positions: Pos[], groupId: number }> = [];
    public trapVaults: Array<{ door: Pos, center: Pos, trapType: 'fire' | 'poison_gas' }> = [];
    public cages: Array<{ door: Pos, cells: Pos[] }> = [];
    public machineResults: MachineResult[] = [];

    constructor() {
        this.grid = new Grid(DCOLS, DROWS);
    }

    public generateLevel(depth: number): Grid {
        // Reset the grid
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                this.grid.setTerrain(x, y, TerrainType.GRANITE, ' ', 0x333333);
            }
        }

        // 1. Initial Room (Entrance)
        const roomMap = RoomBuilder.createEmptyRoomGrid();
        RoomBuilder.designCrossRoom(roomMap);
        this.insertRoomAt(0, 0, roomMap);

        // 2. Grow Dungeon
        const dpBasic: DungeonProfile = {
            roomFrequencies: [2, 1, 1, 1, 7, 1, 0, 0],
            corridorChance: 10
        };
        this.attachRooms(dpBasic, 40, 15);

        // 3. Generate Lakes and Foliage overlays
        this.designEnvironmentOvelays(depth);

        // 4. Place terrain traps/secret doors based on depth
        if (depth >= 3) {
            this.placeTraps(depth);
        }

        // 5. Build machines via data-driven BlueprintEngine
        resetMachineCounter();
        const bpEngine = new BlueprintEngine(this.grid, depth);
        this.machineResults = bpEngine.buildMachines();

        // Backward-compat: populate legacy arrays from machine results
        for (const mr of this.machineResults) {
            if (mr.needsKey && mr.door) {
                this.machines.push({ door: mr.door, center: mr.center });
            }
            if (mr.altarGroupId !== null) {
                const altarPositions = mr.cells.filter(p => {
                    const cell = this.grid.getCell(p.x, p.y);
                    return cell && cell.terrain === TerrainType.ALTAR;
                });
                if (altarPositions.length > 0) {
                    this.altars.push({
                        door: mr.door ?? mr.center,
                        positions: altarPositions,
                        groupId: mr.altarGroupId
                    });
                }
            }
        }

        return this.grid;
    }

    /** Scatter traps, secret doors, and pressure plates across floor tiles. */
    private placeTraps(depth: number) {
        // Collect all walkable floor tiles (far from entrance/exit)
        const floorTiles: { x: number, y: number }[] = [];
        for (let x = 2; x < DCOLS - 2; x++) {
            for (let y = 2; y < DROWS - 2; y++) {
                const c = this.grid.getCell(x, y);
                if (c && c.terrain === TerrainType.FLOOR) {
                    floorTiles.push({ x, y });
                }
            }
        }

        if (floorTiles.length === 0) return;

        // Shuffle floor tiles
        for (let i = floorTiles.length - 1; i > 0; i--) {
            const j = rng.randRange(0, i);
            const tmp = floorTiles[i]!;
            floorTiles[i] = floorTiles[j]!;
            floorTiles[j] = tmp;
        }

        const trapTypes: Array<'poison_gas' | 'teleport' | 'fire'> = ['poison_gas', 'teleport', 'fire'];
        const trapCount = Math.min(Math.floor(depth / 2) + 1, 5);

        // Place traps
        for (let i = 0; i < trapCount && i < floorTiles.length; i++) {
            const tile = floorTiles[i]!;
            this.grid.setTerrain(tile.x, tile.y, TerrainType.TRAP, '^', 0x884400);
            const cell = this.grid.getCell(tile.x, tile.y);
            if (cell) {
                cell.trapType = trapTypes[i % trapTypes.length]!;
                cell.isPassable = true; // Traps are walkable
            }
        }

        // Place secret doors (depth 4+): replace a WALL adjacent to FLOOR on both sides
        if (depth >= 4) {
            const secretDoorCount = Math.min(Math.floor((depth - 2) / 2), 3);
            let placed = 0;
            for (let attempt = 0; attempt < 200 && placed < secretDoorCount; attempt++) {
                const rx = rng.randRange(1, DCOLS - 2);
                const ry = rng.randRange(1, DROWS - 2);
                const cell = this.grid.getCell(rx, ry);
                if (cell?.terrain !== TerrainType.WALL) continue;

                // Check that there is a FLOOR on two opposite sides (horizontal or vertical)
                const left = this.grid.getCell(rx - 1, ry)?.terrain === TerrainType.FLOOR;
                const right = this.grid.getCell(rx + 1, ry)?.terrain === TerrainType.FLOOR;
                const up = this.grid.getCell(rx, ry - 1)?.terrain === TerrainType.FLOOR;
                const down = this.grid.getCell(rx, ry + 1)?.terrain === TerrainType.FLOOR;

                if ((left && right) || (up && down)) {
                    this.grid.setTerrain(rx, ry, TerrainType.SECRET_DOOR, '#', 0x555555);
                    placed++;
                }
            }
        }

        // Place pressure plate (depth 5+): triggers adjacent traps
        if (depth >= 5 && floorTiles.length > trapCount) {
            const plateIdx = trapCount; // Use next floor tile after traps
            const tile = floorTiles[plateIdx]!;
            this.grid.setTerrain(tile.x, tile.y, TerrainType.PRESSURE_PLATE, '_', 0x446644);
            const cell = this.grid.getCell(tile.x, tile.y);
            if (cell) cell.isPassable = true;
        }
    }

    private attachRooms(dp: DungeonProfile, maxAttempts: number, maxRooms: number) {
        let roomsBuilt = 1;
        const roomMap = RoomBuilder.createEmptyRoomGrid();

        // Very basic room attachment. We look for a wall adjacent to a floor, and try
        // to stamp a room there. Fully replicating Brogue's doorSites logic implies
        // searching the perimeter for valid door locations.

        for (let attempt = 0; attempt < maxAttempts && roomsBuilt < maxRooms; attempt++) {
            this.designRandomRoom(roomMap, dp);

            // Try to find a place to attach
            const attachPoint = this.findAttachPoint(roomMap);
            if (attachPoint) {
                this.insertRoomAt(attachPoint.x, attachPoint.y, roomMap);

                // Cut a door
                if (attachPoint.doorX > 0 && attachPoint.doorY > 0) {
                    const isDoor = rng.randPercent(40);
                    if (isDoor) {
                        const isOpen = rng.randPercent(50);
                        if (isOpen) {
                            this.grid.setTerrain(attachPoint.doorX, attachPoint.doorY, TerrainType.OPEN_DOOR, "'", 0xaa8844);
                        } else {
                            this.grid.setTerrain(attachPoint.doorX, attachPoint.doorY, TerrainType.DOOR, '+', 0xaa8844);
                        }
                    } else {
                        this.grid.setTerrain(attachPoint.doorX, attachPoint.doorY, TerrainType.FLOOR, '.', 0x888888);
                    }
                }

                roomsBuilt++;
            }
        }
    }

    private designRandomRoom(roomMap: RoomBuilder.RoomGrid, dp: DungeonProfile) {
        // Clear roomMap
        for (let x = 0; x < DCOLS; x++) roomMap[x]?.fill(0);

        // Choose weighted room
        const sum = dp.roomFrequencies.reduce((a, b) => a + b, 0);
        let randIndex = rng.randRange(0, sum - 1);
        let selectedType = RoomType.SMALL_ROOM;

        for (let i = 0; i < ROOM_TYPE_COUNT; i++) {
            const frequency = dp.roomFrequencies[i] ?? 0;
            if (randIndex < frequency) {
                selectedType = i;
                break;
            }
            randIndex -= frequency;
        }

        switch (selectedType) {
            case RoomType.CROSS_ROOM:
                RoomBuilder.designCrossRoom(roomMap);
                break;
            case RoomType.SMALL_ROOM:
            case RoomType.SMALL_SYMMETRICAL_CROSS_ROOM:
                RoomBuilder.designSmallRoom(roomMap);
                break;
            case RoomType.CIRCULAR_ROOM:
                RoomBuilder.designCircularRoom(roomMap);
                break;
            case RoomType.CAVE:
                RoomBuilder.designCavern(roomMap, 4, 12, 4, 12);
                break;
            case RoomType.CAVERN:
                RoomBuilder.designCavern(roomMap, 15, DCOLS - 2, 10, DROWS - 2);
                break;
            case RoomType.CHUNKY_ROOM:
            case RoomType.ENTRANCE_ROOM:
            default:
                RoomBuilder.designSmallRoom(roomMap); // Fallback
                break;
        }
    }

    private findAttachPoint(roomMap: RoomBuilder.RoomGrid): { x: number, y: number, doorX: number, doorY: number } | null {
        // Try up to 200 random spots on the map perimeter
        for (let attempt = 0; attempt < 200; attempt++) {
            const rx = rng.randRange(1, DCOLS - 2);
            const ry = rng.randRange(1, DROWS - 2);

            // Is this a granite next to a floor?
            if (this.grid.getCell(rx, ry)?.terrain === TerrainType.GRANITE) {
                const adj = this.getAdjacentFloor(rx, ry);
                if (adj) {
                    const dx = rx - adj.x;
                    const dy = ry - adj.y;
                    const targetX = rx + dx;
                    const targetY = ry + dy;

                    if (!this.grid.isValidPos(targetX, targetY)) continue;

                    // Collect floor tiles from the roomMap to serve as attachment anchors
                    const anchors: Pos[] = [];
                    for (let x = 1; x < DCOLS - 1; x++) {
                        for (let y = 1; y < DROWS - 1; y++) {
                            if (roomMap[x]![y] === 1) { // 1 is FLOOR
                                anchors.push({ x, y });
                            }
                        }
                    }

                    if (anchors.length > 0) {
                        // Shuffle anchors
                        for (let i = anchors.length - 1; i > 0; i--) {
                            const j = rng.randRange(0, i);
                            const temp = anchors[i] as Pos;
                            anchors[i] = anchors[j] as Pos;
                            anchors[j] = temp;
                        }

                        // Try up to 20 random anchors
                        for (let i = 0; i < Math.min(20, anchors.length); i++) {
                            const anchor = anchors[i] as Pos;
                            const offsetX = targetX - anchor.x;
                            const offsetY = targetY - anchor.y;

                            if (this.roomFitsAt(roomMap, offsetX, offsetY)) {
                                return { x: offsetX, y: offsetY, doorX: rx, doorY: ry };
                            }
                        }
                    }
                }
            }
        }
        return null;
    }

    private getAdjacentFloor(x: number, y: number): Pos | null {
        const dirs: Array<readonly [number, number]> = [[0, -1], [0, 1], [-1, 0], [1, 0]];
        for (const d of dirs) {
            const nx = x + d[0];
            const ny = y + d[1];
            if (this.grid.isValidPos(nx, ny) && this.grid.getCell(nx, ny)?.terrain === TerrainType.FLOOR) {
                return { x: nx, y: ny };
            }
        }
        return null;
    }

    private roomFitsAt(roomMap: RoomBuilder.RoomGrid, offsetX: number, offsetY: number): boolean {
        // Simple overlapping check
        for (let x = 0; x < DCOLS; x++) {
            const roomColumn = roomMap[x];
            if (!roomColumn) continue;
            for (let y = 0; y < DROWS; y++) {
                if (roomColumn[y]! > 0) {
                    const gx = x + offsetX;
                    const gy = y + offsetY;
                    if (!this.grid.isValidPos(gx, gy)) return false;

                    const cell = this.grid.getCell(gx, gy);
                    if (cell && cell.terrain !== TerrainType.GRANITE) {
                        return false;
                    }
                }
            }
        }
        return true;
    }

    private insertRoomAt(offsetX: number, offsetY: number, roomMap: RoomBuilder.RoomGrid) {
        for (let x = 0; x < DCOLS; x++) {
            const roomColumn = roomMap[x];
            if (!roomColumn) continue;
            for (let y = 0; y < DROWS; y++) {
                if (roomColumn[y]! > 0) {
                    const gx = x + offsetX;
                    const gy = y + offsetY;
                    if (this.grid.isValidPos(gx, gy)) {
                        this.grid.setTerrain(gx, gy, TerrainType.FLOOR, '.', 0x888888);
                    }
                }
            }
        }
    }

    private designEnvironmentOvelays(depth: number) {
        // Brogue generates lakes by stamping blobs and making sure they don't block chokepoints.
        // For our simplified TS version, we'll stamp a few water and grass patches directly onto FLOOR tiles.

        const overlays = [
            { type: TerrainType.WATER_SHALLOW, count: rng.randRange(1, 4), char: '~', color: 0x3366cc, name: 'shallow water' },
            { type: TerrainType.WATER_DEEP, count: rng.randRange(0, 2), char: '~', color: 0x1133aa, name: 'deep water' },
            { type: TerrainType.GRASS, count: rng.randRange(2, 6), char: '"', color: 0x33aa33, name: 'grass' },
            { type: TerrainType.FOLIAGE, count: rng.randRange(1, 3), char: '♠', color: 0x228822, name: 'foliage' }
        ];

        if (depth >= 3) {
            overlays.push({ type: TerrainType.MUD, count: rng.randRange(0, 2), char: '~', color: 0x664422, name: 'mud' });
        }
        if (depth >= 4) {
            overlays.push({ type: TerrainType.WEB, count: rng.randRange(0, Math.floor(depth / 3)), char: '\\', color: 0xcccccc, name: 'spider web' });
        }

        for (const overlay of overlays) {
            for (let i = 0; i < overlay.count; i++) {
                // Generate a random organic shape
                const blobMap = RoomBuilder.createEmptyRoomGrid();
                const scaleW = rng.randRange(8, 20);
                const scaleH = rng.randRange(6, 15);

                const blob = RoomBuilder.createBlobOnGrid(blobMap, 5, 4, 4, scaleW, scaleH, 50, "ffffftttt", "ffffttttt");

                // Find a random floor spot to center it on
                for (let attempt = 0; attempt < 10; attempt++) {
                    const cx = rng.randRange(1, DCOLS - blob.width - 2);
                    const cy = rng.randRange(1, DROWS - blob.height - 2);

                    if (this.grid.getCell(cx + Math.floor(blob.width / 2), cy + Math.floor(blob.height / 2))?.terrain === TerrainType.FLOOR) {
                        // Stamp the blob
                        for (let bx = 0; bx < blob.width; bx++) {
                            for (let by = 0; by < blob.height; by++) {
                                // Important: We only overwrite FLOOR with these environmental patches
                                // We don't want water digging through walls or replacing doors.
                                if (blobMap[blob.minX + bx]![blob.minY + by] === 1) {
                                    const gx = cx + bx;
                                    const gy = cy + by;
                                    if (this.grid.isValidPos(gx, gy) && this.grid.getCell(gx, gy)?.terrain === TerrainType.FLOOR) {
                                        this.grid.setTerrain(gx, gy, overlay.type, overlay.char, overlay.color);
                                    }
                                }
                            }
                        }
                        break; // Successful stamp
                    }
                }
            }
        }
    }
}
