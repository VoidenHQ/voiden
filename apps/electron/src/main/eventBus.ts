// main/eventBus.ts
import { EventEmitter } from "events";
import { BrowserWindow } from "electron";

// A singleton EventBus that both stores BrowserWindow references and emits events.
class EventBus extends EventEmitter {
  private static instance: EventBus;
  private windows: BrowserWindow[] = [];

  private constructor() {
    super();
  }

  public static getInstance(): EventBus {
    if (!EventBus.instance) {
      EventBus.instance = new EventBus();
    }
    return EventBus.instance;
  }

  // Call this after creating a new BrowserWindow
  public registerWindow(win: BrowserWindow): void {
    this.windows.push(win);
  }

  // Optionally, you can also remove windows when they're closed.
  public unregisterWindow(win: BrowserWindow): void {
    this.windows = this.windows.filter((w) => w !== win);
  }

  // Emit an event on the bus and send it to all registered renderer windows.
  public emitEvent<T>(channel: string, data: T): void {
    // Emit on our EventEmitter for internal consumption if needed.
    this.emit(channel, data);
    // Forward to all registered windows that aren't destroyed
    this.windows.forEach((win) => {
      try {
        if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
          win.webContents.send(channel, data);
        }
      } catch {
        // Renderer frame was disposed — ignore
      }
    });
  }
}

export default EventBus.getInstance();
