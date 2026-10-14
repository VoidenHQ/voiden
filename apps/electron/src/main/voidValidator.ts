import * as fs from "node:fs";
import { parseVoidFile } from "@voiden/executors";

// Counts fenced ```void blocks the same way voidParser.ts does, and compares
// that against how many actually parsed. parseVoidFile silently drops a fence
// it can't parse (missing "---" header, bad YAML) rather than throwing, so a
// count mismatch is the only honest "this block is malformed" signal
// available today — see packages/executors/src/voidParser.ts.
const FENCE_RE = /^```void\n/gm;

export interface VoidValidationResult {
  valid: boolean;
  totalFences: number;
  parsedBlocks: number;
}

export function validateVoidFile(filePath: string): VoidValidationResult {
  const content = fs.readFileSync(filePath, "utf-8");
  const totalFences = content.match(FENCE_RE)?.length ?? 0;
  const parsedBlocks = parseVoidFile(content).length;
  return { valid: parsedBlocks === totalFences, totalFences, parsedBlocks };
}
