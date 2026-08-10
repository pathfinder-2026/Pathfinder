import type { StoredObject } from "./storagePort";

export type ScanVerdict = "clean" | "infected";

/**
 * Malware/security scanning port (FR-CONT-001, NEW v1.4). Production wires a real
 * scanner (e.g. an in-AU scanning service). The default in-memory scanner flags
 * an object as infected when it is marked `malware` or contains the EICAR test
 * signature — enough to exercise the reject/quarantine path deterministically.
 */
export interface ScannerPort {
  scan(object: StoredObject): ScanVerdict;
}

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR";

export class InMemoryScanner implements ScannerPort {
  scan(object: StoredObject): ScanVerdict {
    if (object.malware) return "infected";
    if (object.text && object.text.includes(EICAR)) return "infected";
    return "clean";
  }
}
