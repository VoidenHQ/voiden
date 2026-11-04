import { describe, expect, it } from "vitest";
import { categoryLabel, fileCategory, fileExtension, isBinaryCategory, looksBinary, previewImageType } from "../fileKind";

describe("fileExtension", () => {
  it("reads the extension from any path style", () => {
    expect(fileExtension("assets/Logo.PNG")).toBe("png");
    expect(fileExtension("C:\\work\\report.pdf")).toBe("pdf");
    expect(fileExtension(".gitignore")).toBe("");
    expect(fileExtension("noext")).toBe("");
  });
});

describe("previewImageType", () => {
  it("previews images Chromium can draw", () => {
    for (const [file, type] of [["a.png", "image/png"], ["a.jpg", "image/jpeg"], ["a.gif", "image/gif"], ["a.webp", "image/webp"], ["a.avif", "image/avif"], ["a.bmp", "image/bmp"], ["a.ico", "image/x-icon"], ["a.svg", "image/svg+xml"]]) {
      expect(previewImageType(file)).toBe(type);
    }
  });

  it("does not preview images Chromium cannot draw", () => {
    expect(previewImageType("scan.tiff")).toBeNull();
    expect(previewImageType("photo.heic")).toBeNull();
    expect(previewImageType("design.psd")).toBeNull();
  });
});

describe("fileCategory", () => {
  it("knows common binary types", () => {
    expect(fileCategory("report.pdf")).toBe("document");
    expect(fileCategory("sheet.xlsx")).toBe("document");
    expect(fileCategory("sound.mp3")).toBe("audio");
    expect(fileCategory("clip.mov")).toBe("video");
    expect(fileCategory("font.woff2")).toBe("font");
    expect(fileCategory("big.zip")).toBe("archive");
    expect(fileCategory("installer.dmg")).toBe("archive");
    expect(fileCategory("tool.exe")).toBe("executable");
    expect(fileCategory("data.sqlite")).toBe("database");
    expect(fileCategory("scan.tiff")).toBe("image");
  });

  it("checks the content of unknown types", () => {
    expect(fileCategory("noext", new Uint8Array([1, 2, 0, 3]))).toBe("binary");
    expect(fileCategory("data.bin", new Uint8Array([0x89, 0x50, 0, 0]))).toBe("binary");
    expect(fileCategory("notes.txt", new TextEncoder().encode("hello"))).toBe("text");
    expect(fileCategory("Makefile")).toBe("text");
  });
});

describe("looksBinary", () => {
  it("finds a NUL byte only in the first 8000 bytes", () => {
    const late = new Uint8Array(9000).fill(65);
    late[8500] = 0;
    expect(looksBinary(late)).toBe(false);
    late[10] = 0;
    expect(looksBinary(late)).toBe(true);
  });
});

describe("isBinaryCategory and labels", () => {
  it("treats SVG as text that can also be previewed", () => {
    expect(isBinaryCategory(fileCategory("icon.svg"), "icon.svg")).toBe(false);
    expect(isBinaryCategory(fileCategory("logo.png"), "logo.png")).toBe(true);
    expect(isBinaryCategory("text", "notes.txt")).toBe(false);
  });

  it("gives readable labels", () => {
    expect(categoryLabel("document", "report.pdf")).toBe("PDF document");
    expect(categoryLabel("audio", "sound.mp3")).toBe("MP3 audio file");
    expect(categoryLabel("binary", "noext")).toBe("Binary file");
  });
});
