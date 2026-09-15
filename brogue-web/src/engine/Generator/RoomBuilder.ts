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

/**
 * CE Architect.c:1971-2003 designCavern：元胞自动机 blob（5 轮、55% 播种、
 * 出生串 "ffffffttt" / 存活串 "ffffttttt"——CE 原值；旧 web 实现的出生串
 * "ffffftttt" 与 CE 不符，本轮纠正）。min/max 语义与 CE 相同：
 * (minWidth, maxWidth, minHeight, maxHeight) 映射到 blob 的宽高上下限。
 */
export function designCavern(grid: RoomGrid, minW: number, maxW: number, minH: number, maxH: number) {
    createBlobOnGrid(grid, 5, minW, minH, maxW, maxH, 55, "ffffffttt", "ffffttttt");
}

/**
 * CE Architect.c:2005-2021 designEntranceRoom：深度 1 的入口房——
 * 底部中央的倒 T（竖 8×10 + 横 20×5），坐标相对全图画布（web 与 CE 同为
 * 79×29，CE Rogue.h:120-128/174 与 web types/index.ts:46-50 逐项一致）。
 */
export function designEntranceRoom(grid: RoomGrid) {
    const roomWidth = 8;
    const roomHeight = 10;
    const roomWidth2 = 20;
    const roomHeight2 = 5;
    const roomX = Math.floor(DCOLS / 2) - Math.floor(roomWidth / 2) - 1;
    const roomY = DROWS - roomHeight - 2;
    const roomX2 = Math.floor(DCOLS / 2) - Math.floor(roomWidth2 / 2) - 1;
    const roomY2 = DROWS - roomHeight2 - 2;

    drawRectangleOnGrid(grid, roomX, roomY, roomWidth, roomHeight, 1);
    drawRectangleOnGrid(grid, roomX2, roomY2, roomWidth2, roomHeight2, 1);
}

/**
 * CE Architect.c:2023-2041 designCrossRoom：两条相互垂直、带随机偏移的
 * 矩形组成的十字房。-5/+5 的平移把十字锚回画布中部（CE 原样移植，
 * 含 C 整数除法语义：正数域用 Math.floor）。
 */
export function designCrossRoom(grid: RoomGrid) {
    const roomWidth = rng.randRange(3, 12);
    const roomX = rng.randRange(Math.max(0, Math.floor(DCOLS / 2) - (roomWidth - 1)), Math.min(DCOLS, Math.floor(DCOLS / 2)));
    const roomWidth2 = rng.randRange(4, 20);
    const roomX2 = (roomX + Math.floor(roomWidth / 2) + rng.randRange(0, 2) + rng.randRange(0, 2) - 3) - Math.floor(roomWidth2 / 2);

    const roomHeight = rng.randRange(3, 7);
    const roomY = Math.floor(DROWS / 2) - roomHeight;

    const roomHeight2 = rng.randRange(2, 5);
    const roomY2 = Math.floor(DROWS / 2) - roomHeight2 - (rng.randRange(0, 2) + rng.randRange(0, 1));

    drawRectangleOnGrid(grid, roomX - 5, roomY + 5, roomWidth, roomHeight, 1);
    drawRectangleOnGrid(grid, roomX2 - 5, roomY2 + 5, roomWidth2, roomHeight2, 1);
}

/**
 * CE Architect.c:2043-2061 designSymmetricalCrossRoom：轴对称的小十字。
 * minorWidth/minorHeight 的奇偶修正保证十字完全对称。
 */
export function designSymmetricalCrossRoom(grid: RoomGrid) {
    const majorWidth = rng.randRange(4, 8);
    const majorHeight = rng.randRange(4, 5);
    let minorWidth = rng.randRange(3, 4);

    if (majorHeight % 2 === 0) {
        minorWidth -= 1;
    }
    let minorHeight = 3;
    if (majorWidth % 2 === 0) {
        minorHeight -= 1;
    }

    drawRectangleOnGrid(grid, Math.floor((DCOLS - majorWidth) / 2), Math.floor((DROWS - minorHeight) / 2), majorWidth, minorHeight, 1);
    drawRectangleOnGrid(grid, Math.floor((DCOLS - minorWidth) / 2), Math.floor((DROWS - majorHeight) / 2), minorWidth, majorHeight, 1);
}

/**
 * CE Architect.c:2091-2124 designChunkyRoom：从中心圆出发、逐个在已有
 * 地板上叠圆的"碎块房"。边界框随块扩展（min/max 钳制与 CE 一致）。
 */
export function designChunkyRoom(grid: RoomGrid) {
    const chunkCount = rng.randRange(2, 8);
    let minX = Math.floor(DCOLS / 2) - 3;
    let maxX = Math.floor(DCOLS / 2) + 3;
    let minY = Math.floor(DROWS / 2) - 3;
    let maxY = Math.floor(DROWS / 2) + 3;

    drawCircleOnGrid(grid, Math.floor(DCOLS / 2), Math.floor(DROWS / 2), 2, 1);

    for (let i = 0; i < chunkCount;) {
        const x = rng.randRange(minX, maxX);
        const y = rng.randRange(minY, maxY);
        if (grid[x]?.[y]) {
            drawCircleOnGrid(grid, x, y, 2, 1);
            i++;
            minX = Math.max(1, Math.min(x - 3, minX));
            maxX = Math.min(DCOLS - 2, Math.max(x + 3, maxX));
            minY = Math.max(1, Math.min(y - 3, minY));
            maxY = Math.min(DROWS - 2, Math.max(y + 3, maxY));
        }
    }
}
