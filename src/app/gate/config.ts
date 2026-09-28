import { parseGateHash } from './hash';

/** Build-time configured gate hash. Empty => gate disabled (local dev / tests). */
export const GATE_HASH_STRING: string = (import.meta.env.VITE_GATE_HASH as string | undefined) ?? '';
export const gateEnabled = () => parseGateHash(GATE_HASH_STRING) !== null;
