import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { bindMigrationHistoryHash, migrationHistoryHashes } from "./migration-history-hashes.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
describe("migration history across checkout line endings", () => {
  it("recognizes LF and CRLF receipts in either direction", () => {
    const lf = 'CREATE TABLE "existing" (id integer);\n--> statement-breakpoint\nSELECT 1;\n';
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(migrationHistoryHashes(lf)).toContain(hash(crlf));
    expect(migrationHistoryHashes(crlf)).toContain(hash(lf));
    expect(new Set(migrationHistoryHashes(lf))).toEqual(new Set(migrationHistoryHashes(crlf)));
  });
  it("does not recognize substantive SQL edits or erase lone carriage returns", () => {
    const original = "SELECT E'one\rtwo';\n";
    expect(migrationHistoryHashes(original)).not.toContain(hash("SELECT E'onetwo';\n"));
    expect(migrationHistoryHashes(original)).not.toContain(hash("SELECT E'changed\rtwo';\n"));
  });
  it("rejects ambiguous content rather than selecting a migration by iteration order", () => {
    const index = new Map<string, string>();
    bindMigrationHistoryHash(index, "hash", "first.sql");
    bindMigrationHistoryHash(index, "hash", "first.sql");
    expect(() => bindMigrationHistoryHash(index, "hash", "second.sql")).toThrow("Ambiguous migration history hash");
    expect(index.get("hash")).toBe("first.sql");
  });
});
