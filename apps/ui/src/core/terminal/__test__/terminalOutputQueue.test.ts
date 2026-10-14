// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalOutputQueue } from "../terminalOutputQueue";

const createTerminalHarness = () => {
  const writes: string[] = [];
  const callbacks: Array<() => void> = [];
  const terminal = {
    write: vi.fn((data: string, callback?: () => void) => {
      writes.push(data);
      if (callback) callbacks.push(callback);
    }),
  };

  const completeNextWrite = () => {
    const callback = callbacks.shift();
    if (!callback) throw new Error("No terminal write is pending");
    callback();
  };

  const completeAllWrites = () => {
    while (callbacks.length > 0) completeNextWrite();
  };

  return { terminal, writes, completeNextWrite, completeAllWrites };
};

describe("TerminalOutputQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches small writes received during the initial delay", () => {
    const harness = createTerminalHarness();
    const queue = new TerminalOutputQueue(() => harness.terminal);

    queue.enqueue("first");
    queue.enqueue(" second");
    vi.advanceTimersByTime(8);

    expect(harness.writes).toEqual(["first second"]);
  });

  it("keeps later output behind every pending chunk", () => {
    const harness = createTerminalHarness();
    const queue = new TerminalOutputQueue(() => harness.terminal);
    const firstBatch = "A".repeat(4097);
    const secondBatch = "B".repeat(2049);

    queue.enqueue(firstBatch);
    vi.advanceTimersByTime(8);
    expect(harness.writes).toEqual(["A".repeat(2048)]);

    queue.enqueue(secondBatch);
    vi.advanceTimersByTime(8);
    expect(harness.writes).toHaveLength(1);

    harness.completeAllWrites();
    expect(harness.writes.join("")).toBe(firstBatch + secondBatch);
    expect(harness.writes.every((chunk) => chunk.length <= 2048)).toBe(true);
  });

  it("preserves an ANSI sequence split at the chunk boundary", () => {
    const harness = createTerminalHarness();
    const queue = new TerminalOutputQueue(() => harness.terminal);
    const firstBatch = `${"A".repeat(2047)}\x1b[38;2;153;204;255mTEXT`;
    const secondBatch = "\x1b[0mB";

    queue.enqueue(firstBatch);
    vi.advanceTimersByTime(8);
    queue.enqueue(secondBatch);
    harness.completeAllWrites();

    expect(harness.writes.join("")).toBe(firstBatch + secondBatch);
  });

  it("starts a new batch after the previous drain becomes empty", () => {
    const harness = createTerminalHarness();
    const queue = new TerminalOutputQueue(() => harness.terminal);

    queue.enqueue("first");
    vi.advanceTimersByTime(8);
    harness.completeNextWrite();

    queue.enqueue("second");
    expect(harness.writes).toEqual(["first"]);
    vi.advanceTimersByTime(8);

    expect(harness.writes).toEqual(["first", "second"]);
  });

  it("drops pending work after disposal", () => {
    const harness = createTerminalHarness();
    const queue = new TerminalOutputQueue(() => harness.terminal);

    queue.enqueue("pending");
    queue.dispose();
    vi.runAllTimers();

    expect(harness.writes).toEqual([]);
  });

  it("does not continue an active drain after disposal", () => {
    const harness = createTerminalHarness();
    const queue = new TerminalOutputQueue(() => harness.terminal);

    queue.enqueue("A".repeat(4097));
    vi.advanceTimersByTime(8);
    queue.dispose();
    harness.completeNextWrite();

    expect(harness.writes).toEqual(["A".repeat(2048)]);
  });
});
