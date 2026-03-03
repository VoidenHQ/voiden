import { useEffect, useState, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { useSettings } from "../../settings/hooks/useSettings";
import { useNerdFont } from "../hooks/useNerdFont";

interface TerminalProps {
  tabId: string;
  cwd: string;
}

const getCssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const Terminal = ({ tabId, cwd }: TerminalProps) => {
  const { settings } = useSettings();
  const { fontFamily } = useNerdFont();
  const terminalRef = useRef<HTMLDivElement>(null);
  const fitAddonRef = useRef<FitAddon>();
  const xtermRef = useRef<XTerm | null>(null);
  // In our design, we use the tabId as the session id.
  const sessionIdRef = useRef<string | null>(null);
  // Throttling for terminal output
  const outputBufferRef = useRef<string>("");
  const writeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [exitInfo, setExitInfo] = useState<{ code: number | null; signal: number | null }>({
    code: null,
    signal: null,
  });

  // Get font size from settings, fallback to 14
  const fontSize = settings?.appearance?.font_size || 14;

  // Helper to fit terminal and sync dimensions with PTY
  const fitTerminal = () => {
    if (!fitAddonRef.current || !xtermRef.current || !sessionIdRef.current) return;
    fitAddonRef.current.fit();
    const { cols, rows } = xtermRef.current;
    if (cols && rows) {
      window.electron?.terminal.resize?.({ id: sessionIdRef.current, cols, rows });
    }
  };

  // Throttled write function to batch terminal output for better performance
  const throttledWrite = (data: string) => {
    outputBufferRef.current += data;

    if (writeTimeoutRef.current) {
      return; // Already scheduled
    }

    // Use requestIdleCallback for writing during browser idle time
    // This prevents blocking the main thread during heavy terminal output
    writeTimeoutRef.current = setTimeout(() => {
      if (xtermRef.current && outputBufferRef.current) {
        const chunk = outputBufferRef.current;
        outputBufferRef.current = "";

        // For large chunks (>2KB), split writes across idle callbacks
        if (chunk.length > 2048) {
          let offset = 0;
          const writeChunk = () => {
            if (offset < chunk.length && xtermRef.current) {
              const slice = chunk.slice(offset, offset + 2048);
              xtermRef.current.write(slice);
              offset += 2048;
              if (offset < chunk.length) {
                // Use requestIdleCallback if available, otherwise requestAnimationFrame
                if ('requestIdleCallback' in window) {
                  (window as any).requestIdleCallback(writeChunk, { timeout: 50 });
                } else {
                  requestAnimationFrame(writeChunk);
                }
              }
            }
          };
          writeChunk();
        } else {
          xtermRef.current.write(chunk);
        }
      }
      writeTimeoutRef.current = null;
    }, 8); // Reduced batch interval for faster updates
  };

  // Debounced fit terminal to prevent excessive calls
  const debouncedFitRef = useRef<NodeJS.Timeout | null>(null);
  const debouncedFit = () => {
    if (debouncedFitRef.current) {
      clearTimeout(debouncedFitRef.current);
    }
    debouncedFitRef.current = setTimeout(() => {
      fitTerminal();
      debouncedFitRef.current = null;
    }, 100);
  };

  // Update terminal font size when settings change
  useEffect(() => {
    if (xtermRef.current && fontSize) {
      xtermRef.current.options.fontSize = fontSize;
      // Debounced fit to prevent excessive re-renders
      debouncedFit();
    }
  }, [fontSize]);

  // Update terminal font family when Nerd Font is loaded or unloaded
  useEffect(() => {
    if (xtermRef.current) {
      xtermRef.current.options.fontFamily = fontFamily || "'SF Mono', 'Monaco', 'Menlo', 'Consolas', 'Cascadia Mono', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace";
      // Debounced fit to prevent excessive re-renders
      debouncedFit();
    }
  }, [fontFamily]);

  // Update terminal colors when theme changes
  // Use a ref to track the last theme name to avoid unnecessary updates
  const lastThemeRef = useRef<string | null>(null);

  useEffect(() => {
    const currentTheme = settings?.appearance?.theme;

    // Only update if theme actually changed
    if (xtermRef.current && currentTheme !== lastThemeRef.current) {
      lastThemeRef.current = currentTheme || null;

      // Batch the theme update in requestIdleCallback to prevent blocking
      const updateTheme = () => {
        if (xtermRef.current) {
          xtermRef.current.options.theme = {
            // Base colors
            background: getCssVar("--editor-bg"),
            foreground: getCssVar("--editor-fg"),
            cursor: getCssVar("--editor-fg"),
            selectionBackground: getCssVar("--editor-selection"),

            // ANSI colors from theme
            black: getCssVar("--ansi-black"),
            red: getCssVar("--ansi-red"),
            green: getCssVar("--ansi-green"),
            yellow: getCssVar("--ansi-yellow"),
            blue: getCssVar("--ansi-blue"),
            magenta: getCssVar("--ansi-magenta"),
            cyan: getCssVar("--ansi-cyan"),
            white: getCssVar("--ansi-white"),

            // Bright ANSI colors from theme
            brightBlack: getCssVar("--ansi-bright-black"),
            brightRed: getCssVar("--ansi-bright-red"),
            brightGreen: getCssVar("--ansi-bright-green"),
            brightYellow: getCssVar("--ansi-bright-yellow"),
            brightBlue: getCssVar("--ansi-bright-blue"),
            brightMagenta: getCssVar("--ansi-bright-magenta"),
            brightCyan: getCssVar("--ansi-bright-cyan"),
            brightWhite: getCssVar("--ansi-bright-white"),
          };
        }
      };

      const observer = new MutationObserver(() => {
        updateTheme();
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'style']
      })
      // Use requestIdleCallback if available to update theme during idle time
      if ('requestIdleCallback' in window) {
        (window as any).requestIdleCallback(updateTheme, { timeout: 100 });
      } else {
        updateTheme();
      }
    }
  }, [settings?.appearance?.theme]);
  const isMouseDownRef = useRef(false);
  const hasActiveSelectionRef = useRef(false);
  const cleanupFunctionsRef = useRef<Array<() => void>>([]);
  useEffect(() => {
    if (!terminalRef.current) return;

    const xterm = new XTerm({
      theme: {
        // Base colors
        background: getCssVar("--editor-bg"),
        foreground: getCssVar("--editor-fg"),
        cursor: getCssVar("--editor-fg"),
        selectionBackground: getCssVar("--editor-selection"),

        // ANSI colors from theme
        black: getCssVar("--ansi-black"),
        red: getCssVar("--ansi-red"),
        green: getCssVar("--ansi-green"),
        yellow: getCssVar("--ansi-yellow"),
        blue: getCssVar("--ansi-blue"),
        magenta: getCssVar("--ansi-magenta"),
        cyan: getCssVar("--ansi-cyan"),
        white: getCssVar("--ansi-white"),

        // Bright ANSI colors from theme
        brightBlack: getCssVar("--ansi-bright-black"),
        brightRed: getCssVar("--ansi-bright-red"),
        brightGreen: getCssVar("--ansi-bright-green"),
        brightYellow: getCssVar("--ansi-bright-yellow"),
        brightBlue: getCssVar("--ansi-bright-blue"),
        brightMagenta: getCssVar("--ansi-bright-magenta"),
        brightCyan: getCssVar("--ansi-bright-cyan"),
        brightWhite: getCssVar("--ansi-bright-white"),
      },
      fontSize: fontSize,
      fontFamily: fontFamily || "'SF Mono', 'Monaco', 'Menlo', 'Consolas', 'Cascadia Mono', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace",
      fontWeight: "normal",
      fontWeightBold: "bold",
      cursorBlink: true,
      allowProposedApi: true,
      allowTransparency: false,
      drawBoldTextInBrightColors: true,
      // Performance optimizations
      scrollback: 5000, // Reduced scrollback buffer to prevent memory bloat
      fastScrollModifier: "shift", // Enable fast scroll
      fastScrollSensitivity: 5,
      windowOptions: {
        setWinLines: false,
      },
      // Additional performance settings
      smoothScrollDuration: 0, // Disable smooth scrolling for better performance
      rescaleOverlappingGlyphs: false, // Disable expensive glyph rescaling
      disableStdin: false, // ← Important: must be false for mouse to work
    });

    const fitAddon = new FitAddon();
    fitAddonRef.current = fitAddon;
    xtermRef.current = xterm;
    xterm.loadAddon(fitAddon);
    xterm.open(terminalRef.current);
    xterm.focus();

   
    const pasteEventHandler = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    xterm.element?.addEventListener('paste', pasteEventHandler, true);
    cleanupFunctionsRef.current.push(() => {
      xterm.element?.removeEventListener('paste', pasteEventHandler, true);
    });

    xterm.attachCustomKeyEventHandler((e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        handlePaste();
        return false; // Prevent default browser behavior
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'a') {
        handleSelectAll();
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        handleCopy();
        return false;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        handleClear();
        return false;
      }
      return true;
    });
    xterm.onSelectionChange(() => {
      const selection = xterm.getSelection();
      setSelectedText(selection || "");
    });

    const handleMouseDown = (e: MouseEvent) => {
      isMouseDownRef.current = true;
      hasActiveSelectionRef.current = false;
    };

    const handleMouseUp = (e: MouseEvent) => {
      isMouseDownRef.current = false;

      // Check if we have a valid selection after mouse up
      setTimeout(() => {
        const selection = xterm.getSelection();
        if (selection && selection.length > 0) {
          hasActiveSelectionRef.current = true;
          setSelectedText(selection);
        }
      }, 10);
    };

    // Clear selection when clicking without dragging
    const handleClick = (e: MouseEvent) => {
      // If click without drag, clear selection
      if (!hasActiveSelectionRef.current) {
        const selection = xterm.getSelection();
        if (!selection || selection.length === 0) {
          xterm.clearSelection();
          setSelectedText('');
        }
      }
    };
    xterm.element?.addEventListener('mousedown', handleMouseDown);
    xterm.element?.addEventListener('mouseup', handleMouseUp);
    xterm.element?.addEventListener('click', handleClick);
    // Load WebGL renderer for better performance
    let webglLoaded = false;
    const webglAddonRef = { current: null as WebglAddon | null };
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
        webglAddonRef.current = null;
      });
      xterm.loadAddon(webglAddon);
      webglAddonRef.current = webglAddon;
      webglLoaded = true;
    } catch (e) {
      // WebGL not available, will use canvas renderer (slower but functional)
    }

    // Attach terminal session
    let mounted = true;
    const attachTerminal = async () => {
      // Wait for initial layout to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Fit the terminal to get correct dimensions
      fitAddon.fit();

      // Wait a tick for fit to complete
      await new Promise(resolve => setTimeout(resolve, 0));

      if (!mounted) return;
      // Get terminal dimensions to pass to PTY (with fallback defaults)
      const cols = xterm.cols || 80;
      const rows = xterm.rows || 24;
      const result = await window.electron?.terminal.attachOrCreate({ tabId, cwd, cols, rows });

      if (!result || !mounted) return;

      const { id, buffer, isNew } = result;
      sessionIdRef.current = id;


      // Subscribe to exit events
      const unsubscribeExit = window.electron?.terminal.onExit(id, ({ exitCode, signal }: any) => {
        setExitInfo({ code: exitCode, signal });
        xterm.writeln(`\r\n\r\n[Process exited with code ${exitCode}]`);
        xterm.blur(); // visually show that the terminal is not active
      });
      if (unsubscribeExit) {
        cleanupFunctionsRef.current.push(unsubscribeExit);
      }



      // Fit again, sync dimensions with PTY, and focus before writing content
      fitAddon.fit();
      if (xterm.cols && xterm.rows) {
        window.electron?.terminal.resize?.({ id, cols: xterm.cols, rows: xterm.rows });
      }
      xterm.focus();

      // Only write buffer for existing terminals, not new ones
      // New terminals will output their prompt after we set the correct size
      if (!isNew && buffer) {
        xterm.write(buffer);
      }

      // Subscribe to output for this session and capture the cleanup function.
      const unsubscribeOutput = window.electron?.terminal.onOutput(id, (data: string) => {
        throttledWrite(data);
      });
      if (unsubscribeOutput) {
        cleanupFunctionsRef.current.push(unsubscribeOutput);
      }


      // Store unsubscribe in ref if needed later or include it in cleanup below.
      // (Here we simply call it during cleanup.)

      // Forward user input to the terminal session.
      const onDataDisposable = xterm.onData((data) => {
        if (sessionIdRef.current) {
          window.electron?.terminal.sendInput({ id: sessionIdRef.current, data });
        }
      });
      cleanupFunctionsRef.current.push(() => {
        onDataDisposable.dispose();
      });
    };

    attachTerminal();

    // Cleanup function
    return () => {
      mounted = false;

      // Clear pending operations
      if (writeTimeoutRef.current) {
        clearTimeout(writeTimeoutRef.current);
        writeTimeoutRef.current = null;
      }
      outputBufferRef.current = "";

      if (debouncedFitRef.current) {
        clearTimeout(debouncedFitRef.current);
        debouncedFitRef.current = null;
      }

      // Dispose WebGL
      if (webglAddonRef.current) {
        try {
          webglAddonRef.current.dispose();
        } catch (e) {
          // Ignore
        }
        webglAddonRef.current = null;
      }

      // Run all cleanup functions (unsubscribe from events, dispose listeners)
      cleanupFunctionsRef.current.forEach(cleanup => {
        try {
          cleanup();
        } catch (e) {
          console.error('Cleanup error:', e);
        }
      });
      cleanupFunctionsRef.current = [];

      // Detach and dispose terminal
      if (sessionIdRef.current) {
        window.electron?.terminal.detach?.(sessionIdRef.current);
      }
      xterm.element?.removeEventListener('mousedown', handleMouseDown);
      xterm.element?.removeEventListener('mouseup', handleMouseUp);
      xterm.element?.removeEventListener('click', handleClick);
      xterm.dispose();
      xtermRef.current = null;
      sessionIdRef.current = null;
    };
  }, [cwd, tabId]); // ONLY re-run when cwd or tabId changes

  const [contextMenu, setContextMenu] = useState({
    visible: false,
    x: 0,
    y: 0
  });
  const [selectedText, setSelectedText] = useState('');
  // Handle right-click for context menu
  const handleContextMenu = (e) => {
    e.preventDefault();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const menuWidth = 200;
    const menuHeight = 200;
    let x = e.clientX;
    let y = e.clientY;
    if (x + menuWidth > viewportWidth) {
      x = viewportWidth - menuWidth - 5;
    }
    if (y + menuHeight > viewportHeight) {
      y = viewportHeight - menuHeight - 5;
    }
    if (x < 10) {
      x = 10;
    }
    if (y < 10) {
      y = 10;
    }
    setContextMenu({
      visible: true,
      x,
      y
    });
  };

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClick = () => {
      setContextMenu({ visible: false, x: 0, y: 0 });
    };

    if (contextMenu.visible) {
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
    }
  }, [contextMenu.visible]);

  const handleMouseUp = () => {
    const selection = xtermRef.current ? xtermRef.current.getSelection() : '';
    const text = selection?.toString() || '';
    setSelectedText(text);
    if (xtermRef.current) {
      xtermRef.current.selection = text;
    }
  };

  const handleCopy = () => {
    if (xtermRef.current) {
      navigator.clipboard.writeText(xtermRef.current.getSelection() || "");
    }
    setContextMenu({ visible: false, x: 0, y: 0 });
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      xtermRef.current?.paste(text);
    } catch (err) {
      console.error('Failed to paste:', err);
    }
    setContextMenu({ visible: false, x: 0, y: 0 });
  };

  const handleClear = () => {
    if (!xtermRef.current) return;
    xtermRef.current.clear();
    setContextMenu({ visible: false, x: 0, y: 0 });
  };

  const handleSelectAll = () => {
    if (!xtermRef.current) return;
    xtermRef.current.selectAll();
    setContextMenu({ visible: false, x: 0, y: 0 });
  };

  const menuItems = [
    {
      label: 'Copy',
      action: handleCopy,
      disabled: (xtermRef.current ? xtermRef.current.getSelection() : '').length == 0,
      shortcut: 'Ctrl+C'
    },
    {
      label: 'Paste',
      action: handlePaste,
      shortcut: 'Ctrl+V'
    },
    { separator: true },
    {
      label: 'Select All',
      action: handleSelectAll,
      shortcut: 'Ctrl+A'
    },
    { separator: true },
    {
      label: 'Clear Terminal',
      action: handleClear,
      shortcut: 'Ctrl+L'
    }
  ];


  // Resize observer
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;

    const resizeObserver = new ResizeObserver(() => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          if (sessionIdRef.current) {
            const { cols, rows } = xtermRef.current;
            if (cols && rows) {
              window.electron?.terminal.resize?.({ id: sessionIdRef.current, cols, rows });
            }
          }
        }
      }, 100);
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
    };
  }, []);

  // Keep the terminal resized correctly with throttling.
  useEffect(() => {
    let resizeTimeout: NodeJS.Timeout | null = null;

    const resizeObserver = new ResizeObserver(() => {
      // Throttle resize operations to prevent excessive calls
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }

      resizeTimeout = setTimeout(() => {
        if (fitAddonRef.current && xtermRef.current) {
          fitAddonRef.current.fit();
          // Sync dimensions with PTY after resize
          if (sessionIdRef.current) {
            const { cols, rows } = xtermRef.current;
            if (cols && rows) {
              window.electron?.terminal.resize?.({ id: sessionIdRef.current, cols, rows });
            }
          }
        }
      }, 100); // Throttle resize to max once per 100ms
    });

    if (terminalRef.current) {
      resizeObserver.observe(terminalRef.current);
    }

    return () => {
      if (resizeTimeout) {
        clearTimeout(resizeTimeout);
      }
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className="h-full w-full p-2 bg-editor">
      <div ref={terminalRef} className="h-full w-full" onContextMenu={handleContextMenu} onMouseUp={handleMouseUp} />

      {/* Context Menu */}
      {contextMenu.visible && (
        <div
          className="fixed bg-bg border border-border rounded-md shadow-lg text-text text-sm p-1 z-50"
          style={{
            left: `${contextMenu.x}px`,
            top: `${contextMenu.y}px`
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {menuItems.map((item, index) => {
            if (item.separator) {
              return (
                <div
                  key={`separator-${index}`}
                  className="h-px bg-panel my-1"
                />
              );
            }

            return (
              <button
                key={item.label}
                onClick={item.action}
                disabled={item.disabled}
                className={`
                  w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-3
                  ${item.disabled
                    ? 'text-comment cursor-not-allowed'
                    : 'text-text hover:bg-active cursor-pointer'
                  }
                `}
              >
                <div className="flex items-center gap-2">
                  <span>{item.label}</span>
                </div>
                {item.shortcut && (
                  <span className="text-xs text-comment">{item.shortcut}</span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {exitInfo.code !== null && (
        <div className="text-xs text-gray-400 mt-2">
          Process exited with code {exitInfo.code}. Close tab or restart the terminal.
        </div>
      )}
    </div>
  );
};
