import type { Pos } from '../../types';

export interface MachineFeatureTrace {
    index: number;
    request: {
        terrain?: string; featureDF?: string; itemCategory?: string;
        itemId?: string; monsterId?: string; hordeFlags?: string[];
        instanceCount: [number, number]; minimum: number; flags: string[];
    };
    iterations: number;
    placements: Pos[];
    status: 'placed' | 'insufficient' | 'skipped';
}

export interface MachineProductTrace {
    kind: 'item' | 'monster' | 'terrain' | 'featureDF';
    featureIndex: number | null;
    sourceMachineNumber?: number;
    sourceFeatureIndex?: number;
    instanceId?: number | string;
    name?: string;
    pos: Pos;
    owner?: 'floor' | 'monster' | 'dormant';
    ownerId?: number;
    outcome?: string;
}

export interface MachineTrace {
    seed: string;
    depth: number;
    blueprintId: string;
    ceBlueprintId?: number;
    machineNumber: number;
    status: 'committed' | 'rolled_back';
    reason?: string;
    interiorIterations?: number;
    interiorAddedCells?: number;
    features: MachineFeatureTrace[];
    products: MachineProductTrace[];
}

export type MachineObservationHook = (trace: MachineTrace) => void;
let hook: MachineObservationHook | null = null;
let observedSeed = '';

/** Optional diagnostic hook. No observer is installed during ordinary play. */
export function setMachineObservationHook(next: MachineObservationHook | null): void { hook = next; }
export function getMachineObservationHook(): MachineObservationHook | null { return hook; }
export function setMachineObservationSeed(seed: string): void { observedSeed = seed; }
export function getMachineObservationSeed(): string { return observedSeed; }

/** Called only on an existing failure path; keeps the disabled path allocation free. */
export function recordMachineRollback(trace: MachineTrace | undefined, reason: string): null {
    if (trace) {
        trace.status = 'rolled_back';
        trace.reason = reason;
        hook?.(trace);
    }
    return null;
}
