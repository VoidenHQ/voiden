import type { ResponseChildNodeType } from "@/core/extensions/hooks/useParentResponseDoc";
import type { SlashCommandGroup } from "@voiden/sdk/ui";

declare module "@voiden/sdk/ui" {
  interface PluginContext {
    files: {
      read: (path: string) => Promise<string>;
      write: (path: string, content: string) => Promise<void>;
      listDir: (path: string) => Promise<string[]>;
      ensureDir: (path: string) => Promise<void>;
      removeFile: (path: string) => Promise<void>;
      joinPath: (...parts: string[]) => Promise<string | undefined>;
    };
    getVoidenSlashGroups: () => SlashCommandGroup[];
  }

  interface RequestHooks {
    useParentResponseDoc: (
      editor: any,
      getPos: () => number
    ) => {
      openNodes: ResponseChildNodeType[];
      parentPos: number | null;
    };
    useResponseBodyHeight: () => {
      height: number | null;
      setHeight: (h: number) => void;
    };
  }
}
