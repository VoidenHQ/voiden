import { describe, expect, it } from "vitest";
import {
  formatRelativeTime,
  getInitials,
  parseCoAuthors,
  parseRefs,
  reflowCommitMessage,
  splitFilePath,
  toCommitWebLink,
} from "../commitInfo";

const HASH = "00528bb1234567890abcdef";

describe("toCommitWebLink", () => {
  it.each([
    ["https://github.com/VoidenHQ/voiden.git", "https://github.com/VoidenHQ/voiden/commit/" + HASH, "GitHub"],
    ["git@github.com:VoidenHQ/voiden.git", "https://github.com/VoidenHQ/voiden/commit/" + HASH, "GitHub"],
    ["ssh://git@github.com/VoidenHQ/voiden", "https://github.com/VoidenHQ/voiden/commit/" + HASH, "GitHub"],
    ["https://token@github.com/VoidenHQ/voiden.git", "https://github.com/VoidenHQ/voiden/commit/" + HASH, "GitHub"],
    ["git@gitlab.com:group/sub/repo.git", "https://gitlab.com/group/sub/repo/-/commit/" + HASH, "GitLab"],
    ["https://bitbucket.org/team/repo.git", "https://bitbucket.org/team/repo/commits/" + HASH, "Bitbucket"],
    ["https://git.example.com/team/repo.git/", "https://git.example.com/team/repo/commit/" + HASH, "git.example.com"],
  ])("%s", (remote, url, provider) => {
    expect(toCommitWebLink(remote, HASH)).toEqual({ url, provider });
  });

  it("never leaks credentials from the remote URL", () => {
    expect(toCommitWebLink("https://user:secret@github.com/a/b.git", HASH)?.url).not.toContain("secret");
  });

  it.each([
    null,
    "",
    "/local/path/repo",
    "file:///tmp/repo",
    "not a url",
    // Windows local remotes
    "C:\\repos\\voiden",
    "C:/repos/voiden",
    "\\\\server\\share\\voiden.git",
    "file:///C:/repos/voiden",
  ])("returns null for %s", (remote) => {
    expect(toCommitWebLink(remote, HASH)).toBeNull();
  });
});

describe("parseCoAuthors", () => {
  it("reads trailers case-insensitively and de-duplicates", () => {
    const body = "Body\n\nCo-Authored-By: Claude Opus <noreply@anthropic.com>\nco-authored-by: Pair <p@x.io>\nCo-authored-by: Pair <p@x.io>";
    expect(parseCoAuthors(body)).toEqual([
      { name: "Claude Opus", email: "noreply@anthropic.com" },
      { name: "Pair", email: "p@x.io" },
    ]);
  });

  it("handles CRLF bodies from Windows editors", () => {
    expect(parseCoAuthors("Body\r\n\r\nCo-authored-by: Pair <p@x.io>\r\n")).toEqual([{ name: "Pair", email: "p@x.io" }]);
  });

  it("ignores bodies without trailers", () => {
    expect(parseCoAuthors("mentions co-authored-by inline only")).toEqual([]);
    expect(parseCoAuthors(undefined)).toEqual([]);
  });
});

describe("parseRefs", () => {
  it("types HEAD, local, remote and tag refs and drops origin/HEAD", () => {
    expect(parseRefs("HEAD -> beta, origin/beta, origin/HEAD, main, tag: v2.3.2")).toEqual([
      { name: "beta", kind: "head" },
      { name: "origin/beta", kind: "remote" },
      { name: "main", kind: "branch" },
      { name: "v2.3.2", kind: "tag" },
    ]);
    expect(parseRefs("HEAD")).toEqual([{ name: "HEAD", kind: "head" }]);
    expect(parseRefs("")).toEqual([]);
  });
});

describe("formatRelativeTime", () => {
  const now = new Date("2026-10-19T12:00:00Z");
  it("picks the largest whole unit", () => {
    expect(formatRelativeTime("2026-10-12T12:00:00Z", now)).toMatch(/1 week ago|last week/);
    expect(formatRelativeTime("2026-10-19T09:00:00Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime("2026-10-19T11:59:40Z", now)).toBe("now");
  });
  it("returns empty text for invalid dates", () => {
    expect(formatRelativeTime("nope", now)).toBe("");
  });
});

describe("reflowCommitMessage", () => {
  it("joins hard-wrapped lines but keeps paragraphs, lists and trailers", () => {
    const raw = "feat: subject\n\nSettings chooses which windows reopen when Voiden\nis launched. Restarts Voiden does\nitself.\n\n- first item\n- second item\n\nCo-Authored-By: A <a@x.io>\nCo-Authored-By: B <b@x.io>";
    expect(reflowCommitMessage(raw)).toBe(
      "feat: subject\n\nSettings chooses which windows reopen when Voiden is launched. Restarts Voiden does itself.\n\n- first item\n- second item\n\nCo-Authored-By: A <a@x.io>\nCo-Authored-By: B <b@x.io>",
    );
  });
});

describe("reflowCommitMessage with CRLF", () => {
  it("treats CRLF like LF", () => {
    expect(reflowCommitMessage("subject\r\n\r\nwrapped\r\nline\r\n- item")).toBe("subject\n\nwrapped line\n- item");
  });
});

describe("splitFilePath / getInitials", () => {
  it("splits paths", () => {
    expect(splitFilePath("apps/ui/src/a.tsx")).toEqual({ name: "a.tsx", dir: "apps/ui/src" });
    expect(splitFilePath("root.md")).toEqual({ name: "root.md", dir: "" });
  });
  it("builds initials", () => {
    expect(getInitials("Phurpa Tsering")).toBe("PT");
    expect(getInitials("phurpa-tsering")).toBe("PT");
    expect(getInitials("simran")).toBe("SI");
    expect(getInitials("  ")).toBe("?");
  });
});
