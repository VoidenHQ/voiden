import { describe, expect, it } from "vitest";
import { pickBlobView, TEXT_DIFF_LIMIT } from "../BinaryDiffView";
import type { FileBlob } from "@/core/git/hooks";

const blob = (over: Partial<FileBlob> = {}): FileBlob => ({ exists: true, size: 100, binary: false, category: "text", label: "Text file", ...over });
const missing = blob({ exists: false, size: 0 });

describe("pickBlobView", () => {
  it("shows pictures when either side can be previewed", () => {
    const png = blob({ binary: true, category: "image", dataUrl: "data:image/png;base64,AA" });
    expect(pickBlobView(png, png)).toBe("image");
    expect(pickBlobView(missing, png)).toBe("image");
    expect(pickBlobView(png, missing)).toBe("image");
  });

  it("uses the binary card for other binary files", () => {
    const pdf = blob({ binary: true, category: "document" });
    expect(pickBlobView(pdf, pdf)).toBe("binary");
    expect(pickBlobView(missing, pdf)).toBe("binary");
  });

  it("uses the binary card for images too large or unknown to preview", () => {
    const tiff = blob({ binary: true, category: "image" });
    expect(pickBlobView(tiff, tiff)).toBe("binary");
  });

  it("keeps the line diff for normal text and stops it for huge text", () => {
    expect(pickBlobView(blob(), blob())).toBe("text");
    expect(pickBlobView(blob(), blob({ size: TEXT_DIFF_LIMIT + 1 }))).toBe("tooLarge");
  });

  it("falls back to text when nothing is known", () => {
    expect(pickBlobView(null, undefined)).toBe("text");
    expect(pickBlobView(missing, missing)).toBe("text");
  });
});
