/**
 * src/engine/Map/Pathfinding.ts
 * Implements Dijkstra Maps for grid navigation based on Brogue's Dijkstra.c
 */

import { Grid, TerrainType } from './Grid';

export const PDS_OBSTRUCTION = 30000;
export const PDS_FORBIDDEN = 29999;
export const MAX_DISTANCE = 30000;

export interface DijkstraLink {
    distance: number;
    cost: number;
    left: DijkstraLink | null;
    right: DijkstraLink | null;
    x: number;
    y: number;
}

export class DijkstraMap {
    public width: number;
    public height: number;
    public links: DijkstraLink[][];
    private front: DijkstraLink;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.links = [];
        this.front = { distance: -1, cost: -1, left: null, right: null, x: -1, y: -1 };

        for (let x = 0; x < width; x++) {
            this.links[x] = [];
            const column = this.links[x]!;
            for (let y = 0; y < height; y++) {
                column[y] = {
                    distance: MAX_DISTANCE,
                    cost: 1,
                    left: null,
                    right: null,
                    x: x,
                    y: y
                };
            }
        }
    }

    private clear(maxDist: number) {
        this.front.right = null;
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const link = this.links[x]![y]!;
                link.distance = maxDist;
                link.left = null;
                link.right = null;
            }
        }
    }

    private getCell(x: number, y: number): DijkstraLink | null {
        if (x >= 0 && x < this.width && y >= 0 && y < this.height) {
            return this.links[x]![y] ?? null;
        }
        return null;
    }

    public calculateMap(grid: Grid, targetX: number, targetY: number, maxDistance: number = MAX_DISTANCE) {
        this.clear(maxDistance);

        // Calculate Cost Map
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const cell = grid.getCell(x, y);
                const link = this.links[x]![y]!;

                if (x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1) {
                    link.cost = PDS_OBSTRUCTION;
                } else if (!cell || !cell.isPassable) {
                    // Simplistic heuristic: if not passable, it's either an obstruction (wall) or forbidden (chasm).
                    if (cell && (cell.terrain === TerrainType.WALL || cell.terrain === TerrainType.GRANITE)) {
                        link.cost = PDS_OBSTRUCTION;
                    } else {
                        link.cost = PDS_FORBIDDEN;
                    }
                } else {
                    link.cost = 1;
                }
            }
        }

        // Set target distance to 0 and start queue
        const targetLink = this.getCell(targetX, targetY);
        if (targetLink && targetLink.cost < PDS_FORBIDDEN) {
            targetLink.distance = 0;
            this.front.right = targetLink;
            targetLink.left = this.front;
        }

        this.updateMap(true); // use diagonals
    }

    private updateMap(useDiagonals: boolean) {
        const dirs = useDiagonals ? 8 : 4;
        const dx = [0, 0, -1, 1, -1, -1, 1, 1];
        const dy = [-1, 1, 0, 0, -1, 1, -1, 1];

        let head = this.front.right;
        this.front.right = null;

        while (head !== null) {
            for (let dir = 0; dir < dirs; dir++) {
                const link = this.getCell(head.x + dx[dir]!, head.y + dy[dir]!);
                if (!link) continue;

                if (link.cost < 0 || link.cost >= PDS_FORBIDDEN) continue;

                // Diagonal obstruction check
                if (dir >= 4) {
                    const way1 = this.getCell(head.x + dx[dir]!, head.y);
                    const way2 = this.getCell(head.x, head.y + dy[dir]!);
                    if ((way1 && way1.cost === PDS_OBSTRUCTION) || (way2 && Math.abs(way2.cost) === PDS_OBSTRUCTION)) {
                        continue;
                    }
                }

                if (head.distance + link.cost < link.distance) {
                    link.distance = head.distance + link.cost;

                    // Remove link from current list position
                    if (link.right !== null) link.right.left = link.left;
                    if (link.left !== null) link.left.right = link.right;

                    // Re-insert into sorted list
                    let left: DijkstraLink | null = head;
                    let right = head.right;
                    while (right !== null && right.distance < link.distance) {
                        left = right;
                        right = right.right;
                    }

                    if (left !== null) left.right = link;
                    link.right = right;
                    link.left = left;
                    if (right !== null) right.left = link;
                }
            }

            const right = head.right;
            head.left = null;
            head.right = null;
            head = right;
        }
    }

    public getDistance(x: number, y: number): number {
        const link = this.getCell(x, y);
        return link ? link.distance : MAX_DISTANCE;
    }

    /**
     * P4-9：CE Dijkstra.c:202 dijkstraScan 的批量端口——以 distanceMap 的
     * 现有值为种子（可为负/可为多个源），按 costMap 的入格代价传播，结果
     * 写回 distanceMap。与 CE 一致的三条规则：
     *   - 代价 < 0（CE PDS_FORBIDDEN=-1 / PDS_OBSTRUCTION=-2，Rogue.h:2782-2783）
     *     或 >= PDS_FORBIDDEN 的格子不进入、不传播；
     *   - 边界格代价强制 PDS_OBSTRUCTION（pdsBatchInput 的边框特例）；
     *   - 种子值 < maxDistance 且代价 > 0 才进初始队列（30000 的格子靠松弛
     *     再入队，仅是队列规模优化）。
     * 仅新增方法，不改动既有 calculateMap/updateMap 语义（既有调用方不受影响）。
     */
    public batchScan(distanceGrid: number[][], costGrid: number[][], useDiagonals: boolean, maxDistance: number = MAX_DISTANCE): void {
        this.clear(maxDistance);

        // pdsBatchInput（Dijkstra.c:117-168）：逐格播种 + 排序入队
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                const link = this.links[x]![y]!;
                link.distance = distanceGrid[x]![y]!;
                const cost = (x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1)
                    ? -2 // CE PDS_OBSTRUCTION：边框一律不可通行
                    : costGrid[x]![y]!;
                link.cost = cost;
                if (cost > 0 && link.distance < maxDistance) {
                    this.insertSorted(link);
                }
            }
        }

        this.updateMap(useDiagonals);

        // pdsBatchOutput（Dijkstra.c:181-191）：写回
        for (let x = 0; x < this.width; x++) {
            for (let y = 0; y < this.height; y++) {
                distanceGrid[x]![y] = this.links[x]![y]!.distance;
            }
        }
    }

    /** 排序入队（升序；等值插在等值段之前，与 CE pdsBatchInput 的停机条件一致）。 */
    private insertSorted(link: DijkstraLink): void {
        let left: DijkstraLink | null = this.front;
        let right = this.front.right;
        while (right !== null && right.distance < link.distance) {
            left = right;
            right = right.right;
        }
        link.right = right;
        link.left = left;
        left.right = link;
        if (right !== null) right.left = link;
    }
}
