import type {ProcessGraph} from './engine.mjs';
export function layoutObservedGraph(process: ProcessGraph): {
  ordered: ProcessGraph['states']; edgeLabels: string[]; linear: boolean; cyclic: boolean;
};