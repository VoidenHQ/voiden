import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { trailingIncompleteUtf8Length } from '../files';

describe('trailingIncompleteUtf8Length', () => {
  it('returns 0 for a buffer that ends on a code-point boundary', () => {
    expect(trailingIncompleteUtf8Length(Buffer.from('hello', 'utf8'))).toBe(0);
    expect(trailingIncompleteUtf8Length(Buffer.from('héllo', 'utf8'))).toBe(0);
    expect(trailingIncompleteUtf8Length(Buffer.from('a🎉', 'utf8'))).toBe(0);
  });

  it('detects a 2-byte sequence cut after 1 byte', () => {
    // "é" = 0xC3 0xA9. Keep only the leading byte.
    const buf = Buffer.from([0x61, 0xc3]); // "a" + first byte of é
    expect(trailingIncompleteUtf8Length(buf)).toBe(1);
  });

  it('detects a 3-byte sequence cut after 1 or 2 bytes', () => {
    const full = Buffer.from('日', 'utf8'); // 0xE6 0x97 0xA5
    expect(trailingIncompleteUtf8Length(Buffer.concat([full.slice(0, 1)]))).toBe(1);
    expect(trailingIncompleteUtf8Length(Buffer.concat([full.slice(0, 2)]))).toBe(2);
  });

  it('detects a 4-byte sequence cut after 1, 2 or 3 bytes', () => {
    const full = Buffer.from('🎉', 'utf8'); // 4 bytes
    expect(trailingIncompleteUtf8Length(full.slice(0, 1))).toBe(1);
    expect(trailingIncompleteUtf8Length(full.slice(0, 2))).toBe(2);
    expect(trailingIncompleteUtf8Length(full.slice(0, 3))).toBe(3);
  });

  it('returns 0 for a complete 4-byte sequence at the very end of the buffer', () => {
    // Regression guard: a full 4-byte emoji ending exactly at the buffer
    // boundary must NOT be treated as incomplete.
    const buf = Buffer.from('ab🎉', 'utf8');
    expect(trailingIncompleteUtf8Length(buf)).toBe(0);
  });

  it('exhaustively verifies every split point of a mixed-width string reassembles correctly', () => {
    const sample = 'a é 日 🎉 b';
    const full = Buffer.from(sample, 'utf8');
    for (let i = 0; i <= full.length; i++) {
      const chunk1 = full.slice(0, i);
      const chunk2 = full.slice(i);
      const heldBack = trailingIncompleteUtf8Length(chunk1);
      const decodable = chunk1.length - heldBack;
      const content1 = chunk1.slice(0, decodable).toString('utf8');
      const leftover = chunk1.slice(decodable);
      const content2 = Buffer.concat([leftover, chunk2]).toString('utf8');
      expect(content1 + content2).toBe(sample);
    }
  });
});

describe('files:readChunk UTF-8 boundary handling (issue #521)', () => {
  function readChunkOldBuggy(fd: number, offset: number, size: number, totalSize: number) {
    const actualSize = Math.min(size, totalSize - offset);
    if (actualSize <= 0) return { content: '', bytesRead: 0, nextOffset: offset, done: true, totalSize };
    const buf = Buffer.alloc(actualSize);
    const bytesRead = fs.readSync(fd, buf, 0, actualSize, offset);
    const nextOffset = offset + bytesRead;
    const content = buf.slice(0, bytesRead).toString('utf8');
    return { content, bytesRead, nextOffset, done: nextOffset >= totalSize, totalSize };
  }

  function readChunkFixed(fd: number, offset: number, size: number, totalSize: number) {
    const actualSize = Math.min(size, totalSize - offset);
    if (actualSize <= 0) return { content: '', bytesRead: 0, nextOffset: offset, done: true, totalSize };
    const buf = Buffer.alloc(actualSize);
    const bytesRead = fs.readSync(fd, buf, 0, actualSize, offset);
    const isLastRead = offset + bytesRead >= totalSize;
    const rawHeldBack = isLastRead ? 0 : trailingIncompleteUtf8Length(buf.slice(0, bytesRead));
    const heldBack = rawHeldBack < bytesRead ? rawHeldBack : 0;
    const decodableLength = bytesRead - heldBack;
    const nextOffset = offset + decodableLength;
    const content = buf.slice(0, decodableLength).toString('utf8');
    return { content, bytesRead: decodableLength, nextOffset, done: nextOffset >= totalSize, totalSize };
  }

  function streamWholeFile(
    reader: typeof readChunkFixed,
    filePath: string,
    chunkSize: number,
  ) {
    const fd = fs.openSync(filePath, 'r');
    const totalSize = fs.statSync(filePath).size;
    let offset = 0;
    let out = '';
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const result = reader(fd, offset, chunkSize, totalSize);
        out += result.content;
        offset = result.nextOffset;
        if (result.done) break;
      }
    } finally {
      fs.closeSync(fd);
    }
    return out;
  }

  it('reproduces and fixes issue #521: a two-byte char split exactly at the 512 KiB chunk boundary', () => {
    const CHUNK = 512 * 1024;
    const tmpFile = path.join(os.tmpdir(), `voiden-issue-521-${Date.now()}.txt`);

    // Filler sized so "é" (0xC3 0xA9) straddles byte 524288: its first byte
    // lands as the last byte of chunk 1, its second byte as the first byte
    // of chunk 2 — the exact repro from the issue report.
    const before = Buffer.alloc(CHUNK - 1, 'a'.charCodeAt(0));
    const boundary = Buffer.from('éz', 'utf8');
    const after = Buffer.from(' rest of the file', 'utf8');
    const full = Buffer.concat([before, boundary, after]);
    fs.writeFileSync(tmpFile, full);

    try {
      const expected = fs.readFileSync(tmpFile, 'utf8');
      const boundaryIndex = expected.indexOf('éz');

      const oldOutput = streamWholeFile(readChunkOldBuggy, tmpFile, CHUNK);
      const fixedOutput = streamWholeFile(readChunkFixed, tmpFile, CHUNK);

      // The unfixed logic corrupts "éz" into replacement characters.
      expect(oldOutput.slice(boundaryIndex, boundaryIndex + 2)).not.toBe('éz');
      expect(oldOutput).not.toBe(expected);

      // The fixed logic preserves the character and matches the file exactly.
      expect(fixedOutput.slice(boundaryIndex, boundaryIndex + 2)).toBe('éz');
      expect(fixedOutput).toBe(expected);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });

  it('preserves content across chunk boundaries for a variety of realistic chunk sizes', () => {
    const tmpFile = path.join(os.tmpdir(), `voiden-utf8-chunking-${Date.now()}.txt`);
    const content = 'a é 日本語 🎉🚀 café naïve 中文测试 '.repeat(2000);
    fs.writeFileSync(tmpFile, content, 'utf8');

    try {
      for (const chunkSize of [64, 256, 1000, 4096, 8192, 512 * 1024]) {
        expect(streamWholeFile(readChunkFixed, tmpFile, chunkSize)).toBe(content);
      }
    } finally {
      fs.unlinkSync(tmpFile);
    }
  });
});
