/**
 * src/engine/Environment/Gas.ts
 * Manages gas spread and effects (fire, poison, steam)
 */

import { Grid, DCOLS, DROWS, TerrainType } from '../Map/Grid';
import { rng } from '../Random';

export enum GasType {
    NONE = 0,
    FIRE = 1,
    POISON = 2,
    CONFUSION = 3,
    STEAM = 4,
    CREEPING_DEATH = 5
}

export interface GasCell {
    type: GasType;
    density: number; // 0-100
}

export class EnvironmentManager {
    public gasGrid: GasCell[][] = [];
    private grid: Grid;

    constructor(grid: Grid) {
        this.grid = grid;
        // Initialize empty gas grid
        for (let x = 0; x < DCOLS; x++) {
            this.gasGrid[x] = [];
            for (let y = 0; y < DROWS; y++) {
                this.gasGrid[x]![y] = { type: GasType.NONE, density: 0 };
            }
        }
    }

    public addGas(x: number, y: number, type: GasType, amount: number) {
        if (!this.grid.isValidPos(x, y)) return;

        const cell = this.gasGrid[x]![y]!;
        if (cell.type === GasType.NONE || cell.type === type) {
            cell.type = type;
            cell.density = Math.min(100, cell.density + amount);
        } else {
            // Very simplified gas mixing (override if strong enough)
            if (amount > cell.density) {
                cell.type = type;
                cell.density = amount;
            }
        }
    }

    public ignite(x: number, y: number) {
        const cell = this.grid.getCell(x, y);
        if (!cell) return;

        // Only ignite flammable terrain
        if (cell.terrain === TerrainType.GRASS || cell.terrain === TerrainType.FOLIAGE || cell.terrain === TerrainType.BOG) {
            if (!cell.isBurning) {
                cell.isBurning = true;
                cell.burnDuration = rng.randRange(4, 7);
            }
        } else if (cell.terrain === TerrainType.DOOR) {
            if (!cell.isBurning) {
                cell.isBurning = true;
                cell.burnDuration = rng.randRange(2, 4); // Doors burn up quickly
            }
        }
    }

    public updateFires() {
        const ignitions: { x: number, y: number }[] = [];
        const regrowths: { x: number, y: number, terrain: TerrainType }[] = [];

        for (let x = 0; x < this.grid.width; x++) {
            for (let y = 0; y < this.grid.height; y++) {
                const cell = this.grid.getCell(x, y);
                if (!cell) continue;

                // 1. Regrowth mechanic: Charred floors rarely grow grass
                if (cell.terrain === TerrainType.CHARRED_FLOOR && !cell.isBurning) {
                    if (rng.randPercent(1) && rng.randPercent(5)) { // Very rare: 0.05% chance per turn
                        regrowths.push({ x, y, terrain: rng.randPercent(20) ? TerrainType.FOLIAGE : TerrainType.GRASS });
                    }
                }

                if (!cell.isBurning) continue;

                cell.burnDuration--;

                if (cell.burnDuration <= 0) {
                    cell.isBurning = false;

                    // Burn out into charred floor
                    if (cell.terrain === TerrainType.GRASS || cell.terrain === TerrainType.FOLIAGE || cell.terrain === TerrainType.BOG) {
                        cell.terrain = TerrainType.CHARRED_FLOOR;
                        cell.char = '.';
                        cell.color = 0x444444;
                        cell.isOpaque = false;
                    } else if (cell.terrain === TerrainType.DOOR) {
                        cell.terrain = TerrainType.CHARRED_FLOOR;
                        cell.char = '.';
                        cell.color = 0x554433;
                        cell.isOpaque = false;
                        cell.isPassable = true;
                    } else if (cell.terrain === TerrainType.WEB) {
                        cell.terrain = TerrainType.CHARRED_FLOOR;
                        cell.char = '.';
                        cell.color = 0x222222;
                        cell.isPassable = true;
                        cell.isOpaque = false;
                    }
                } else {
                    // Spread fire to neighbors and check for steam
                    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0], [-1, -1], [1, 1], [-1, 1], [1, -1]];
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx!;
                        const ny = y + dy!;
                        const ncell = this.grid.getCell(nx, ny);
                        if (!ncell) continue;

                        // Create steam if near water
                        if (ncell.terrain === TerrainType.WATER_SHALLOW || ncell.terrain === TerrainType.WATER_DEEP) {
                            if (rng.randPercent(30)) {
                                this.addGas(nx, ny, GasType.STEAM, 50);
                            }
                        }

                        // Spread fire
                        const isFlammable = (ncell.terrain === TerrainType.GRASS || ncell.terrain === TerrainType.FOLIAGE || ncell.terrain === TerrainType.BOG || ncell.terrain === TerrainType.DOOR || ncell.terrain === TerrainType.WEB);
                        if (isFlammable && !ncell.isBurning) {
                            // High chance per burning neighbor per turn encourages fast, unified burn wave
                            if (rng.randPercent(40)) {
                                ignitions.push({ x: nx, y: ny });
                            }
                        }
                    }
                }
            }
        }

        for (const pos of ignitions) {
            this.ignite(pos.x, pos.y);
        }

        for (const pos of regrowths) {
            const cell = this.grid.getCell(pos.x, pos.y);
            if (cell) {
                cell.terrain = pos.terrain;
                if (pos.terrain === TerrainType.FOLIAGE) {
                    cell.char = '♠';
                    cell.color = 0x228822;
                } else {
                    cell.char = '"';
                    cell.color = 0x33aa33;
                }
            }
        }
    }

    public updateGases() {
        const newGrid: GasCell[][] = [];
        for (let x = 0; x < DCOLS; x++) {
            newGrid[x] = [];
            for (let y = 0; y < DROWS; y++) {
                newGrid[x]![y] = { type: this.gasGrid[x]![y]!.type, density: this.gasGrid[x]![y]!.density };
            }
        }

        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                const cell = this.gasGrid[x]![y]!;
                if (cell.density <= 0) continue;

                // Natural dissipation
                let dissipationRate = 2;
                if (cell.type === GasType.STEAM) dissipationRate = 5;
                if (cell.type === GasType.CREEPING_DEATH) dissipationRate = 1;

                newGrid[x]![y]!.density -= dissipationRate;
                if (newGrid[x]![y]!.density <= 0 && this.gasGrid[x]![y]!.type === newGrid[x]![y]!.type) {
                    newGrid[x]![y]!.type = GasType.NONE;
                    newGrid[x]![y]!.density = 0;
                }

                if (cell.density > 10) {
                    const dirs = [[0, -1], [0, 1], [-1, 0], [1, 0]];
                    for (const [dx, dy] of dirs) {
                        const nx = x + dx!;
                        const ny = y + dy!;
                        if (!this.grid.isValidPos(nx, ny)) continue;

                        const terrainCell = this.grid.getCell(nx, ny);
                        if (!terrainCell || terrainCell.isOpaque) continue; // Don't spread into walls/doors

                        // Creeping death does not spread onto grass/foliage/bog
                        if (cell.type === GasType.CREEPING_DEATH) {
                            if (terrainCell.terrain === TerrainType.GRASS || terrainCell.terrain === TerrainType.FOLIAGE || terrainCell.terrain === TerrainType.BOG) {
                                continue;
                            }
                        }

                        const neighbor = newGrid[nx]![ny]!;
                        // Simple diffusion pressure
                        const spreadAmount = Math.floor(cell.density * 0.15); // 15% spreads to each neighbor

                        // Creeping Death spreads aggressively
                        const actualSpread = cell.type === GasType.CREEPING_DEATH ? Math.floor(cell.density * 0.25) : spreadAmount;

                        if (neighbor.type === GasType.NONE || neighbor.type === cell.type) {
                            neighbor.type = cell.type;
                            neighbor.density = Math.min(100, neighbor.density + actualSpread);
                            newGrid[x]![y]!.density -= actualSpread; // Conservation of volume
                        } else if (neighbor.type !== cell.type) {
                            // Heavy gas replaces lighter gas
                            if (cell.density > neighbor.density + 20) {
                                neighbor.type = cell.type;
                                neighbor.density = actualSpread;
                                newGrid[x]![y]!.density -= actualSpread;
                            }
                        }
                    }
                }
            }
        }

        // Clean up and clamp
        for (let x = 0; x < DCOLS; x++) {
            for (let y = 0; y < DROWS; y++) {
                if (newGrid[x]![y]!.density <= 0) {
                    newGrid[x]![y]!.type = GasType.NONE;
                    newGrid[x]![y]!.density = 0;
                } else if (newGrid[x]![y]!.density > 100) {
                    newGrid[x]![y]!.density = 100;
                }
            }
        }

        this.gasGrid = newGrid;
    }
}
