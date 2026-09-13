/**
 * src/engine/Generator/RoomBuilder.ts
 * Generates specific room topologies onto a 2D number grid
 * 0: Empty/Granite
 * 1: Floor
 * 2: Door Site
 */

import { DCOLS, DROWS } from '../../types';
import { rng } from '../Random';

export type RoomGrid = number[][];

export function createEmptyRoomGrid(): RoomGrid {
    const grid: number[][] = [];
    for (let x = 0; x < DCOLS; x++) {
        grid[x] = new Array(DROWS).fill(0);
    }
    return grid;
}

export function drawRectangleOnGrid(grid: RoomGrid, startX: number, startY: number, width: number, height: number, value: number) {
    for (let x = startX; x < startX + width; x++) {
        for (let y = startY; y < startY + height; y++) {
            if (x >= 0 && x < DCOLS && y >= 0 && y < DROWS) {
                if (grid[x]) grid[x]![y] = value;
            }
        }
    }
}

export function drawCircleOnGrid(grid: RoomGrid, cx: number, cy: number, radius: number, value: number) {
    for (let x = cx - radius; x <= cx + radius; x++) {
        for (let y = cy - radius; y <= cy + radius; y++) {
            if (x >= 0 && x < DCOLS && y >= 0 && y < DROWS) {
                // Use standard circle distance roughly
                const distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);
                if (distSq <= radius * radius) {
                    if (grid[x]) grid[x]![y] = value;
                }
            }
        }
    }
}

export function designSmallRoom(grid: RoomGrid) {
    const width = rng.randRange(3, 6);
    const height = rng.randRange(2, 4);
    drawRectangleOnGrid(grid, Math.floor((DCOLS - width) / 2), Math.floor((DROWS - height) / 2), width, height, 1);
}

export function designCircularRoom(grid: RoomGrid) {
    const radius = rng.randPercent(5) ? rng.randRange(4, 10) : rng.randRange(2, 4);
    drawCircleOnGrid(grid, Math.floor(DCOLS / 2), Math.floor(DROWS / 2), radius, 1);

    if (radius > 6 && rng.randPercent(50)) {
        // Doughnut shape
        drawCircleOnGrid(grid, Math.floor(DCOLS / 2), Math.floor(DROWS / 2), rng.randRange(3, radius - 3), 0);
    }
}

const nbDirs = [
    [0, -1], [1, -1], [1, 0], [1, 1],
    [0, 1], [-1, 1], [-1, 0], [-1, -1]
];

function cellularAutomataRound(grid: RoomGrid, birth: string, survival: string, maxW: number, maxH: number) {
    const buffer = createEmptyRoomGrid();
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            buffer[x]![y] = grid[x]![y] as number;
        }
    }

    for (let x = 0; x < maxW; x++) {
        for (let y = 0; y < maxH; y++) {
            let nbCount = 0;
            for (const d of nbDirs) {
                const nx = x + (d[0] as number);
                const ny = y + (d[1] as number);
                if (nx >= 0 && nx < maxW && ny >= 0 && ny < maxH && buffer[nx]![ny]) {
                    nbCount++;
                }
            }

            if (!buffer[x]![y] && birth[nbCount] === 't') {
                grid[x]![y] = 1; // Birth
            } else if (buffer[x]![y] && survival[nbCount] === 't') {
                // Survive
            } else {
                grid[x]![y] = 0; // Death
            }
        }
    }
}

function fillContiguousRegion(grid: RoomGrid, x: number, y: number, fillValue: number, maxW: number, maxH: number): number {
    let count = 1;
    grid[x]![y] = fillValue;

    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const d of dirs) {
        const nx = x + (d[0] as number);
        const ny = y + (d[1] as number);
        if (nx >= 0 && nx < maxW && ny >= 0 && ny < maxH && grid[nx]![ny] === 1) {
            count += fillContiguousRegion(grid, nx, ny, fillValue, maxW, maxH);
        }
    }
    return count;
}

export function createBlobOnGrid(
    grid: RoomGrid,
    roundCount: number,
    minBlobWidth: number, minBlobHeight: number,
    maxBlobWidth: number, maxBlobHeight: number,
    percentSeeded: number,
    birthParameters: string,
    survivalParameters: string
): { minX: number, minY: number, width: number, height: number } {

    let blobWidth = 0;
    let blobHeight = 0;
    let topBlobNumber = 0;
    let topBlobMinX = maxBlobWidth;
    let topBlobMinY = maxBlobHeight;

    do {
        // Clear grid
        for (let x = 0; x < maxBlobWidth; x++) {
            for (let y = 0; y < maxBlobHeight; y++) {
                grid[x]![y] = rng.randPercent(percentSeeded) ? 1 : 0;
            }
        }

        for (let k = 0; k < roundCount; k++) {
            cellularAutomataRound(grid, birthParameters, survivalParameters, maxBlobWidth, maxBlobHeight);
        }

        let topBlobSize = 0;
        topBlobNumber = 0;
        topBlobMinX = maxBlobWidth;
        let topBlobMaxX = 0;
        topBlobMinY = maxBlobHeight;
        let topBlobMaxY = 0;

        let blobNumber = 2; // 1 is unmarked

        for (let x = 0; x < maxBlobWidth; x++) {
            for (let y = 0; y < maxBlobHeight; y++) {
                if (grid[x]![y] === 1) {
                    const blobSize = fillContiguousRegion(grid, x, y, blobNumber, maxBlobWidth, maxBlobHeight);
                    if (blobSize > topBlobSize) {
                        topBlobSize = blobSize;
                        topBlobNumber = blobNumber;
                    }
                    blobNumber++;
                }
            }
        }

        // Measure resulting top blob
        for (let x = 0; x < maxBlobWidth; x++) {
            let foundX = false;
            for (let y = 0; y < maxBlobHeight; y++) {
                if (grid[x]![y] === topBlobNumber) {
                    foundX = true;
                    break;
                }
            }
            if (foundX) {
                if (x < topBlobMinX) topBlobMinX = x;
                if (x > topBlobMaxX) topBlobMaxX = x;
            }
        }

        for (let y = 0; y < maxBlobHeight; y++) {
            let foundY = false;
            for (let x = 0; x < maxBlobWidth; x++) {
                if (grid[x]![y] === topBlobNumber) {
                    foundY = true;
                    break;
                }
            }
            if (foundY) {
                if (y < topBlobMinY) topBlobMinY = y;
                if (y > topBlobMaxY) topBlobMaxY = y;
            }
        }

        blobWidth = (topBlobMaxX - topBlobMinX) + 1;
        blobHeight = (topBlobMaxY - topBlobMinY) + 1;

    } while (blobWidth < minBlobWidth || blobHeight < minBlobHeight || topBlobNumber === 0);

    // Isolate top blob as 1s, others as 0s
    for (let x = 0; x < maxBlobWidth; x++) {
        for (let y = 0; y < maxBlobHeight; y++) {
            grid[x]![y] = (grid[x]![y] === topBlobNumber) ? 1 : 0;
        }
    }

    // Center it horizontally/vertically back onto the main DCOLS/DROWS grid
    const startX = Math.floor((DCOLS - blobWidth) / 2);
    const startY = Math.floor((DROWS - blobHeight) / 2);

    // Shift it into place
    const shiftedBuffer = createEmptyRoomGrid();
    for (let x = 0; x < blobWidth; x++) {
        for (let y = 0; y < blobHeight; y++) {
            if (grid[x + topBlobMinX]![y + topBlobMinY] === 1) {
                shiftedBuffer[startX + x]![startY + y] = 1;
            }
        }
    }

    // Overwrite original grid entirely
    for (let x = 0; x < DCOLS; x++) {
        for (let y = 0; y < DROWS; y++) {
            grid[x]![y] = shiftedBuffer[x]![y] as number;
        }
    }

    return { minX: startX, minY: startY, width: blobWidth, height: blobHeight };
}

export function designCavern(grid: RoomGrid, minW: number, maxW: number, minH: number, maxH: number) {
    createBlobOnGrid(grid, 5, minW, minH, maxW, maxH, 55, "ffffftttt", "ffffttttt");
}

// Additional rooms (Cross, Chunky, Entrance) can be implemented here...
export function designCrossRoom(grid: RoomGrid) {
    const w1 = rng.randRange(3, 12);
    const h1 = rng.randRange(2, 5);
    const w2 = rng.randRange(3, 12);
    const h2 = rng.randRange(2, 5);

    drawRectangleOnGrid(grid, Math.floor((DCOLS - w1) / 2), Math.floor((DROWS - h1) / 2), w1, h1, 1);
    drawRectangleOnGrid(grid, Math.floor((DCOLS - w2) / 2), Math.floor((DROWS - h2) / 2), w2, h2, 1);
}
