// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  conflictLabels,
  getHunks,
  groupConflictsByBlock,
  parseConflicts,
  resolveConflicts,
  validateVoidContent,
} from "../conflictMarkers";

const simple = ["a", "<<<<<<< HEAD", "mine", "=======", "theirs", ">>>>>>> feature", "b"].join("\n");

describe("parseConflicts / resolveConflicts", () => {
  it("parses a hunk with its labels", () => {
    const segments = parseConflicts(simple);
    expect(getHunks(segments)).toEqual([
      { index: 0, open: "<<<<<<< HEAD", current: ["mine"], base: null, separator: "=======", incoming: ["theirs"], close: ">>>>>>> feature" },
    ]);
    expect(conflictLabels(segments)).toEqual({ current: "HEAD", incoming: "feature" });
  });

  it("resolves each side and both", () => {
    expect(resolveConflicts(simple, new Map([[0, "current"]]))).toBe("a\nmine\nb");
    expect(resolveConflicts(simple, new Map([[0, "incoming"]]))).toBe("a\ntheirs\nb");
    // Both sides stay separate blocks, so a blank line goes between them.
    expect(resolveConflicts(simple, new Map([[0, "both"]]))).toBe("a\nmine\n\ntheirs\nb");
    const gapped = ["<<<<<<< HEAD", "mine", "", "=======", "theirs", ">>>>>>> f"].join("\n");
    expect(resolveConflicts(gapped, new Map([[0, "both"]]))).toBe("mine\n\ntheirs");
  });

  it("leaves unresolved conflicts byte for byte", () => {
    const two = `${simple}\n${simple}`;
    const out = resolveConflicts(two, new Map([[1, "incoming"]]));
    expect(out).toBe(`${simple}\na\ntheirs\nb`);
    expect(resolveConflicts(two, new Map())).toBe(two);
  });

  it("keeps diff3 base sections when unresolved and drops them when resolved", () => {
    const diff3 = ["<<<<<<< HEAD", "mine", "||||||| base", "orig", "=======", "theirs", ">>>>>>> feature"].join("\n");
    expect(resolveConflicts(diff3, new Map())).toBe(diff3);
    expect(resolveConflicts(diff3, new Map([[0, "current"]]))).toBe("mine");
  });

  it("keeps Windows line endings", () => {
    const crlf = simple.replace(/\n/g, "\r\n");
    expect(getHunks(parseConflicts(crlf))).toHaveLength(1);
    expect(resolveConflicts(crlf, new Map([[0, "incoming"]]))).toBe("a\r\ntheirs\r\nb");
    expect(resolveConflicts(crlf, new Map([[0, "both"]]))).toBe("a\r\nmine\r\n\r\ntheirs\r\nb");
  });

  it("treats an unterminated marker as text", () => {
    const broken = "a\n<<<<<<< HEAD\nmine\n=======\ntheirs";
    expect(getHunks(parseConflicts(broken))).toEqual([]);
    expect(resolveConflicts(broken, new Map())).toBe(broken);
  });
});

describe("validateVoidContent", () => {
  const fence = (yaml: string) => "```void\n---\n" + yaml + "\n---\n```";

  it("accepts valid blocks and rejects broken YAML or leftover markers", () => {
    expect(validateVoidContent(`# Title\n\n${fence("type: request")}\n`).valid).toBe(true);
    expect(validateVoidContent(fence("type: [unclosed"))).toMatchObject({ valid: false, invalidBlocks: 1 });
    expect(validateVoidContent(`${fence("type: request")}\n${simple}`)).toMatchObject({ valid: false, hasMarkers: true });
  });

  it("rejects the duplicate key that accepting both sides of a YAML line creates", () => {
    expect(validateVoidContent(fence("content: a\ncontent: b")).valid).toBe(false);
  });
});

// A real merge conflict in a .void file, produced by git.
describe("against a real git merge conflict", () => {
  let repo: string;
  let conflicted: string;
  const request = (url: string, method = "POST") =>
    [
      "```void",
      "---",
      "type: request",
      "attrs:",
      "  uid: 05119029-b827-45fe-a2cc-55a5f0ba6709",
      "content:",
      "  - type: method",
      "    attrs:",
      "      uid: bb4678ef-eafb-48ec-9471-33d37c030ae3",
      `    content: ${method}`,
      "  - type: url",
      "    attrs:",
      "      uid: f7cbeda7-4ed2-4a3a-91ea-ce8b7eed20ab",
      `    content: ${url}`,
      "---",
      "```",
    ].join("\n");
  const headers = (contentType: string) =>
    ["```void", "---", "type: headers-table", "attrs:", "  uid: 825cb614", "content:", "  - type: table", "    rows:", "      - row:", "          - Content-Type", `          - ${contentType}`, "---", "```"].join("\n");
  const file = (generatedAt: string, method: string, url: string, contentType: string, note: string) =>
    [
      "---",
      "version: 0.20.1",
      `generatedAt: ${generatedAt}`,
      "---",
      "",
      "## Headers",
      "",
      request(url, method),
      note,
      "",
      headers(contentType),
      "",
    ].join("\n");

  beforeAll(() => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "voiden-conflicts-"));
    const emptyConfig = path.join(tmp, "empty.gitconfig");
    fs.writeFileSync(emptyConfig, "");
    repo = path.join(tmp, "repo");
    fs.mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: repo, encoding: "utf8", env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: "1" } });
    const write = (content: string) => fs.writeFileSync(path.join(repo, "headers.void"), content);
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.com");
    write(file("2025-01-01", "GET", "https://echo.apyhub.com", "application/json", "Base note."));
    git("add", "-A");
    git("commit", "-qm", "base");
    git("checkout", "-qb", "teammate");
    write(file("2025-02-02", "PATCH", "https://staging.apyhub.com/v2", "application/json; charset=utf-8", "Base note."));
    git("commit", "-qam", "teammate");
    git("checkout", "-q", "main");
    write(file("2025-03-03", "PUT", "https://echo.apyhub.com/v3", "text/plain", "Base note."));
    git("commit", "-qam", "mine");
    try {
      git("merge", "teammate");
    } catch {
      // Expected: the merge stops with conflicts.
    }
    conflicted = fs.readFileSync(path.join(repo, "headers.void"), "utf8");
  });

  afterAll(() => {
    fs.rmSync(path.dirname(repo), { recursive: true, force: true });
  });

  it("finds the conflicts git wrote", () => {
    expect(getHunks(parseConflicts(conflicted)).length).toBeGreaterThanOrEqual(3);
    expect(conflictLabels(parseConflicts(conflicted))).toEqual({ current: "HEAD", incoming: "teammate" });
    expect(validateVoidContent(conflicted).valid).toBe(false);
  });

  it("groups conflicts by block: header, request (method and URL together) and headers table", () => {
    const groups = groupConflictsByBlock(conflicted);
    expect(groups.map((g) => g.metadata)).toEqual([true, false, false]);
    expect(groups.flatMap((g) => g.indices)).toEqual(getHunks(parseConflicts(conflicted)).map((h) => h.index));
  });

  it("produces a valid file for every whole-side choice and keeps unrelated lines intact", () => {
    for (const side of ["current", "incoming"] as const) {
      const all = new Map(getHunks(parseConflicts(conflicted)).map((h) => [h.index, side]));
      const out = resolveConflicts(conflicted, all);
      expect(validateVoidContent(out).valid).toBe(true);
      expect(out).toContain("Base note.");
      expect(out).toContain("version: 0.20.1");
    }
  });

  it("lets the request come from one side and the headers from the other", () => {
    const groups = groupConflictsByBlock(conflicted);
    const choices = new Map<number, "current" | "incoming">();
    groups[0].indices.forEach((i) => choices.set(i, "current"));
    groups[1].indices.forEach((i) => choices.set(i, "incoming"));
    groups[2].indices.forEach((i) => choices.set(i, "current"));
    const out = resolveConflicts(conflicted, choices);
    expect(validateVoidContent(out).valid).toBe(true);
    expect(out).toContain("content: PATCH");
    expect(out).toContain("https://staging.apyhub.com/v2");
    expect(out).toContain("- text/plain");
    expect(out).toContain("generatedAt: 2025-03-03");
  });

  it("flags 'both' inside a request as invalid instead of saving it", () => {
    const groups = groupConflictsByBlock(conflicted);
    const choices = new Map(getHunks(parseConflicts(conflicted)).map((h) => [h.index, "current" as const]));
    groups[1].indices.forEach((i) => choices.set(i, "both" as never));
    expect(validateVoidContent(resolveConflicts(conflicted, choices)).valid).toBe(false);
  });
});
