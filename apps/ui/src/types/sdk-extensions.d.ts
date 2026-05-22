import type { ResponseChildNodeType } from "@/core/extensions/hooks/useParentResponseDoc";
import type { SlashCommandGroup } from "@voiden/sdk/ui";

declare module "@voiden/sdk/ui" {
  interface PluginContext {
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
