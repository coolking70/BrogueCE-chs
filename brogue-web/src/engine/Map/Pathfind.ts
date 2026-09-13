/**
 * src/engine/Map/Pathfind.ts
 * A* Pathfinding for Auto-move and Monster AI
 */

import { Grid } from './Grid';
import type { Pos } from '../../types';

export class Pathfind {
    /**
     * Compute an A* path from start to goal.
     * Returns an array of Pos from the next step up to the goal.
     * Returns null if no path found.
     */
    static findPath(grid: Grid, startX: number, startY: number, goalX: number, goalY: number, canPass: (x: number, y: number) => boolean): Pos[] | null {
        if (!grid.isValidPos(goalX, goalY)) return null;
        if (!canPass(goalX, goalY)) return null;

        const openSet: Pos[] = [{ x: startX, y: startY }];
        const cameFrom = new Map<string, Pos>();
        const gScore = new Map<string, number>();
        const fScore = new Map<string, number>();

        const toKey = (x: number, y: number) => `${x},${y}`;
        const startKey = toKey(startX, startY);

        gScore.set(startKey, 0);
        fScore.set(startKey, this.heuristic(startX, startY, goalX, goalY));

        while (openSet.length > 0) {
            // Find lowest fScore
            let currentIdx = 0;
            let current = openSet[0]!;
            let currentF = fScore.get(toKey(current.x, current.y)) ?? Infinity;

            for (let i = 1; i < openSet.length; i++) {
                const node = openSet[i]!;
                const f = fScore.get(toKey(node.x, node.y)) ?? Infinity;
                if (f < currentF) {
                    current = node;
                    currentF = f;
                    currentIdx = i;
                }
            }

            if (current.x === goalX && current.y === goalY) {
                return this.reconstructPath(cameFrom, current);
            }

            openSet.splice(currentIdx, 1);
            const currentKey = toKey(current.x, current.y);
            const currentG = gScore.get(currentKey)!;

            // Neighbors (8-way)
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;

                    const nx = current.x + dx;
                    const ny = current.y + dy;

                    if (!grid.isValidPos(nx, ny) || !canPass(nx, ny)) continue;

                    // Diagonals cost slightly more
                    const moveCost = (dx !== 0 && dy !== 0) ? 1.414 : 1.0;
                    const tentative_gScore = currentG + moveCost;

                    const neighborKey = toKey(nx, ny);
                    const nGScore = gScore.get(neighborKey) ?? Infinity;

                    if (tentative_gScore < nGScore) {
                        cameFrom.set(neighborKey, { x: current.x, y: current.y });
                        gScore.set(neighborKey, tentative_gScore);
                        fScore.set(neighborKey, tentative_gScore + this.heuristic(nx, ny, goalX, goalY));

                        if (!openSet.some(n => n.x === nx && n.y === ny)) {
                            openSet.push({ x: nx, y: ny });
                        }
                    }
                }
            }
        }

        return null; // No path
    }

    private static heuristic(x1: number, y1: number, x2: number, y2: number): number {
        // Octile distance
        const dx = Math.abs(x1 - x2);
        const dy = Math.abs(y1 - y2);
        return Math.max(dx, dy) + (Math.sqrt(2) - 1) * Math.min(dx, dy);
    }

    private static reconstructPath(cameFrom: Map<string, Pos>, current: Pos): Pos[] {
        const totalPath = [current];
        let currKey = `${current.x},${current.y}`;

        while (cameFrom.has(currKey)) {
            current = cameFrom.get(currKey)!;
            currKey = `${current.x},${current.y}`;
            totalPath.unshift(current);
        }

        // Remove start node
        totalPath.shift();
        return totalPath;
    }
}
