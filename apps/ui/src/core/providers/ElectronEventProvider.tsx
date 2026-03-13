// src/providers/ElectronEventProvider.tsx
import React, { createContext, useContext, useEffect, useRef } from "react";
import { EventEmitter } from "events";
import { useQueryClient } from "@tanstack/react-query";

import { globalSaveFile } from "@/core/file-system/hooks";
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
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["env"] });
        handleEvent("file:new", data);
      },
      "file:duplicate": (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({queryKey:['environments']});
        queryClient.invalidateQueries({ queryKey: ["env"] });
      },
      "file:delete": (event: any, data: any) => {
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["env"] });
        // If the deleted file is .env, trigger a refetch of envs
        if (data.path.replace(/\\/g, "/").split("/").pop()?.startsWith(".env")) {
          setActiveEnv(null);
        }
        handleEvent("file:delete", data);
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
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ['env'] });
      },
      "folder:opened": (data: any) => {
        // Invalidate queries related to projects or app state.
        queryClient.invalidateQueries({ queryKey: ["projects"] });
        queryClient.invalidateQueries({ queryKey: ["app:state"] });
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["sidebar:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["env"] });

        // Optionally, you can also invalidate other queries that depend on the active project.
        handleEvent("folder:opened", data);
      },
      "git:changed": async (data: any) => {
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["git:branches"] });
        queryClient.invalidateQueries({ queryKey: ["git:status"] });
        queryClient.invalidateQueries({ queryKey: ["git:log"] });

        handleEvent("git:changed", data);
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
      "directory:delete": (event: any) => {
        // console.debug("directory:delete", event);
        // Invalidate the same queries as with file:delete
        queryClient.invalidateQueries({ queryKey: ["files:tree"] });
        queryClient.invalidateQueries({ queryKey: ["panel:tabs"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["tab:content"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["voiden-wrapper:blockContent"], exact: false });
        queryClient.invalidateQueries({ queryKey: ["env"] });
        handleEvent("directory:delete", event.data);
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
      }
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
