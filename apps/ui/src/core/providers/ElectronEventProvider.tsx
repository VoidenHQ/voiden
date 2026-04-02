// src/providers/ElectronEventProvider.tsx
import React, { createContext, useContext, useEffect, useRef } from "react";
import { EventEmitter } from "events";
import { useQueryClient } from "@tanstack/react-query";

import { globalSaveFile, saveTabById } from "@/core/file-system/hooks";
import { useLoadEnv, useSetActiveEnv } from "@/core/environment/hooks";
import { toast } from "@/core/components/ui/sonner";

// Define the shape of our context.
interface ElectronEventContextType {
  emitter: EventEmitter;
}

// Create the context.
const ElectronEventContext = createContext<ElectronEventContextType | null>(null);

// Provider component. Wrap your app (or part of it) with this.
export const ElectronEventProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient(); // Get the react-query client.

  // Create emitter with increased max listeners to handle multiple file links and linked blocks
  // Each file link and linked block adds listeners, which is expected behavior
  const emitterRef = useRef<EventEmitter | null>(null);
  if (!emitterRef.current) {
    emitterRef.current = new EventEmitter();
    emitterRef.current.setMaxListeners(100);
  }

  const { mutate: setActiveEnv } = useSetActiveEnv();

  // Track if listeners are currently attached
  const listenersAttachedRef = useRef(false);

  // Debounce timers — prevent IPC flood during clone/bulk file ops
  const fileTreeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitChangedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileDeleteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirDeleteDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fileNewDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Handler for all electron events
    const handleEvent = (channel: string, data: unknown) => {
      emitterRef.current!.emit(channel, data);
    };

    // Define all listener functions
    const listeners = {
      "file:newTab": (data: any) => {
        // Only invalidate the specific panel tabs
        queryClient.invalidateQueries({
          queryKey: ["panel:tabs"],
          exact: false,
        });
        handleEvent("file:newTab", data);
      },
      "file:new": (data: any) => {
        // Debounce: during clone this fires for every file written to disk.
        // Only refresh the file tree and env — new files on disk don't affect
        // open tab content or the tab list (file:newTab handles that separately).
        if (fileNewDebounceRef.current) clearTimeout(fileNewDebounceRef.current);
        fileNewDebounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["files:tree"] });
          queryClient.invalidateQueries({ queryKey: ["env"] });
          handleEvent("file:new", data);
        }, 400);
      },
      "file:duplicate": (event: any, data: any) => {
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["environments"] });
        queryClient.invalidateQueries({ queryKey: ["env"] });
        handleEvent("file:duplicate", data);
      },
      "git:clone:progress": (_event: any, data: any) => {
        handleEvent("git:clone:progress", data);
      },
      "file:delete-start": (_event: any) => {
        handleEvent("file:delete-start", {});
      },
      "file:delete": (event: any, data: any) => {
        // Per-event: handle .env side-effect and emit immediately
        if (data.path.replace(/\\/g, "/").split("/").pop()?.startsWith(".env")) {
          setActiveEnv(null);
        }
        handleEvent("file:delete", data);
        // Debounce heavy invalidations — folder deletes fire this per-file
        if (fileDeleteDebounceRef.current) clearTimeout(fileDeleteDebounceRef.current);
        fileDeleteDebounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["files:tree"] });
          queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
          queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"], exact: false });
          queryClient.invalidateQueries({ queryKey: ["env"] });
        }, 400);
      },
      "file:create": (event: any, data: any) => {
        handleEvent("file:create", data);
      },
      "file:create-void": (event: any, data: any) => {
        handleEvent("file:create-void", data);
      },
      "directory:create": (event: any, data: any) => {
        handleEvent("directory:create", data);
      },
      "directory:close-project": (event: any, data: any) => {
        queryClient.removeQueries({
          predicate: (query) => typeof query.queryKey[0] === "string" && (query.queryKey[0] as string).startsWith("git:"),
        });
        queryClient.invalidateQueries({ queryKey: ["app:state"] });
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        handleEvent("directory:close-project", data);
      },
      "file:rename": (event: any, data: any) => {
        handleEvent("file:rename", data);
        // When a file is renamed, invalidate tab content queries as well
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["app:state"] });
        queryClient.invalidateQueries({ queryKey: ["env"] });
      },
      "files:tree:changed": () => {
        // Debounce: during clone/bulk ops this fires per-file. Batch into one refresh.
        if (fileTreeDebounceRef.current) clearTimeout(fileTreeDebounceRef.current);
        fileTreeDebounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["files:tree"] });
          queryClient.invalidateQueries({ queryKey: ['env'] });
        }, 400);
      },
      "folder:opened": (data: any) => {
        // Clear all git cache so the new project's git state is fetched fresh.
        queryClient.removeQueries({
          predicate: (query) => typeof query.queryKey[0] === "string" && (query.queryKey[0] as string).startsWith("git:"),
        });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["app:state"] });
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["env"] });
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
        handleEvent("folder:opened", data);
      },
      // Fired by the main process once initializeState() completes and the
      // window state + extensionManager are fully ready.  Re-fetches queries
      // that may have received empty/error responses during the startup race.
      "state:ready": () => {
        queryClient.invalidateQueries({ queryKey: ["app:state"] });
        queryClient.invalidateQueries({ queryKey: ["extensions"] });
        queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["projects"] });
      },
      "git:changed": (data: any) => {
        // Debounce: git:changed fires repeatedly during checkout/clone
        if (gitChangedDebounceRef.current) clearTimeout(gitChangedDebounceRef.current);
        gitChangedDebounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["files:tree"] });
          queryClient.invalidateQueries({ queryKey: ["git:branches"] });
          queryClient.invalidateQueries({ queryKey: ["git:status"] });
          queryClient.invalidateQueries({ queryKey: ["git:log"] });
          handleEvent("git:changed", data);
        }, 400);
      },
      "env:changed": (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["env"] });
        queryClient.invalidateQueries({ queryKey: ["environments"] });
        queryClient.invalidateQueries({ queryKey: ["environment-keys"] });
        handleEvent("env:changed", data);
      },
      "apy:changed": (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent", data.path], exact: false });
        handleEvent("apy:changed", data);
      },
      "directory:delete": (_event: any, data: any) => {
        handleEvent("directory:delete", data);
        // Debounce — may arrive alongside many file:delete events for each child
        if (dirDeleteDebounceRef.current) clearTimeout(dirDeleteDebounceRef.current);
        dirDeleteDebounceRef.current = setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: ["files:tree"] });
          queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
          queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"], exact: false });
          queryClient.invalidateQueries({ queryKey: ["env"] });
        }, 400);
      },
      "file-menu-command": (event: any, data: any) => {
        if (data && data.command === "save-file") {
          // Use the global save function to handle saving for all editor types
          globalSaveFile().catch(console.error);
        }

        handleEvent("file-menu-command", data || {});
      },
      "menu:open-settings": (event: any, data: any) => {
        handleEvent("menu:open-settings", data || {});
      },
      "menu:check-updates": (event: any, data: any) => {
        handleEvent("menu:check-updates", data || {});
      },
      "menu:toggle-explorer": (event: any, data: any) => {
        handleEvent("menu:toggle-explorer", data || {});
      },
      "menu:toggle-terminal": (event: any, data: any) => {
        handleEvent("menu:toggle-terminal", data || {});
      },
      "menu:find": (event: any, data: any) => {
        handleEvent("menu:find", data || {});
      },
      "menu:clear-recent": (event: any, data: any) => {
        handleEvent("menu:clear-recent", data || {});
      },
      "menu:show-about": (event: any, data: any) => {
        handleEvent("menu:show-about", data || {});
      },
      "menu:open-welcome": (event: any, data: any) => {
        handleEvent("menu:open-welcome", data || {});
      },
      "menu:open-changelog": (event: any, data: any) => {
        handleEvent("menu:open-changelog", data || {});
      },
      "menu:open-logs": (event: any, data: any) => {
        handleEvent("menu:open-logs", data || {});
      },
      "window:changed": () => {
        queryClient.invalidateQueries({ queryKey: ["environments"] });
        queryClient.invalidateQueries({ queryKey: ["env"] });
        queryClient.invalidateQueries({ queryKey: ["environment-keys"] });
        queryClient.invalidateQueries({ queryKey: ["void-variable-keys"] });
        queryClient.invalidateQueries({ queryKey: ["void-variable-data"] });
      },
      "settings:changed": () => {
        handleEvent('settings:changed', {});
      },
      "toast:show": (event: any, data: any) => {
        toast(data.title, { description: data.description || undefined,duration: data.duration || 4000 ,closeButton:true});
      },
      "toast:error": (event: any, data: any) => {
        toast.error(data.title, { description: data.description || undefined,duration: data.duration || 4000 ,closeButton:true});
      },
      "toast:warning": (event: any, data: any) => {
        toast.warning(data.title, { description: data.description || undefined,duration: data.duration || 4000 ,closeButton:true});
      },
      "toast:success": (event: any, data: any) => {
        toast.success(data.title, { description: data.description || undefined,duration: data.duration || 4000,closeButton:true });
      },
      "toast:info": (event: any, data: any) => {
        toast.info(data.title, { description: data.description || undefined,duration: data.duration || 4000 ,closeButton:true} );
      },
      "files:saveUnsavedForPaths": async (_event: any, requestId: string, paths: string[]) => {
        const panelTabs = queryClient.getQueryData<{ tabs: { id: string; source: string | null }[]; activeTabId: string }>(["panel:tabs", "main"]);
        const tabs = panelTabs?.tabs ?? [];
        const matchingTabs = tabs.filter((t) => t.source && paths.includes(t.source));
        await Promise.all(matchingTabs.map((t) => saveTabById(t.id, { silent: true })));
        window.electron?.files.acknowledgeUnsavedSaved(requestId);
      },
    };

    // Only attach listeners if not already attached (handles React Strict Mode)
    let didAttach = false;
    if (window.electron?.ipc && !listenersAttachedRef.current) {
      Object.entries(listeners).forEach(([channel, listener]) => {
        window.electron.ipc.on(channel, listener);
      });
      listenersAttachedRef.current = true;
      didAttach = true;
    }

    return () => {
      // Only remove listeners if we attached them in this effect run
      if (window.electron?.ipc && didAttach) {
        Object.entries(listeners).forEach(([channel, listener]) => {
          window.electron.ipc.removeListener(channel, listener);
        });
        listenersAttachedRef.current = false;
      }
    };
  }, [queryClient, setActiveEnv]);

  // You can subscribe to more Electron channels here in the same way.
  // For example:
  // useEffect(() => { ... subscribe to "another:event" ... }, []);

  return <ElectronEventContext.Provider value={{ emitter: emitterRef.current! }}>{children}</ElectronEventContext.Provider>;
};

// A helper hook for components to access the provider.
export function useElectronEventEmitter(): ElectronEventContextType {
  const context = useContext(ElectronEventContext);
  if (!context) {
    throw new Error("useElectronEventEmitter must be used within an ElectronEventProvider");
  }
  return context;
}

export function useElectronEvent<T>(channel: string, handler: (data: T) => void) {
  const { emitter } = useElectronEventEmitter();

  // Store the handler in a ref so we always call the latest version
  const handlerRef = React.useRef(handler);

  // Update the ref when handler changes
  React.useEffect(() => {
    handlerRef.current = handler;
  }, [handler]);

  useEffect(() => {
    // Create a stable wrapper function that calls the latest handler
    const eventListener = (data: T) => handlerRef.current(data);

    emitter.on(channel, eventListener);

    return () => {
      emitter.off(channel, eventListener);
    };
  }, [channel, emitter]); // Only re-run if channel or emitter changes, not handler
}
