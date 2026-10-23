import { createHash } from "node:crypto";

/** Recognize checkout line endings without changing executed SQL or stored history. */
export function migrationHistoryHashes(content: string): readonly string[] {
  const lf = content.replace(/\r\n/g, "\n");
  return [...new Set([content, lf, lf.replace(/\n/g, "\r\n")]
    .map(value => createHash("sha256").update(value).digest("hex")))];
}

export function bindMigrationHistoryHash(index: Map<string, string>, hash: string, file: string): void {
  const previous = index.get(hash);
  if (previous !== undefined && previous !== file) throw new Error(`Ambiguous migration history hash: ${previous}, ${file}`);
  index.set(hash, file);
}
