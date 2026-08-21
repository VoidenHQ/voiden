const WRITE_BATCH_DELAY_MS = 8;
const MAX_WRITE_CHUNK_LENGTH = 2048;

interface TerminalWriter {
  write(data: string, callback: () => void): void;
}

/** Serializes renderer writes so PTY output reaches xterm in order. */
export class TerminalOutputQueue {
  private buffer = "";
  private writeTimeout: ReturnType<typeof setTimeout> | null = null;
  private isWriting = false;
  private disposed = false;

  constructor(private readonly getTerminal: () => TerminalWriter | null) {}

  /** Adds terminal output to the shared FIFO buffer. */
  enqueue(data: string): void {
    if (this.disposed || !data) return;

    this.buffer += data;
    if (this.writeTimeout !== null || this.isWriting) return;

    this.writeTimeout = setTimeout(() => {
      this.writeTimeout = null;
      this.isWriting = true;
      this.writeNextChunk();
    }, WRITE_BATCH_DELAY_MS);
  }

  /** Cancels queued output and prevents pending callbacks from continuing. */
  dispose(): void {
    this.disposed = true;
    this.buffer = "";
    this.isWriting = false;

    if (this.writeTimeout !== null) {
      clearTimeout(this.writeTimeout);
      this.writeTimeout = null;
    }
  }

  private writeNextChunk = (): void => {
    if (this.disposed) {
      this.isWriting = false;
      return;
    }

    const terminal = this.getTerminal();
    if (!terminal) {
      this.buffer = "";
      this.isWriting = false;
      return;
    }

    const chunk = this.buffer.slice(0, MAX_WRITE_CHUNK_LENGTH);
    if (!chunk) {
      this.isWriting = false;
      return;
    }

    this.buffer = this.buffer.slice(chunk.length);
    // Do not take another slice until xterm has parsed this one. This keeps
    // later PTY events behind every byte that was already queued.
    terminal.write(chunk, this.writeNextChunk);
  };
}
