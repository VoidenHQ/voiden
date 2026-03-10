import type { ResponseChildNodeType } from "@/core/extensions/hooks/useParentResponseDoc";

declare module "@voiden/sdk/ui" {
  interface RequestHooks {
    useParentResponseDoc: (
      editor: any,
      getPos: () => number
    ) => {
      openNodes: ResponseChildNodeType[];
      parentPos: number | null;
    };
  }
}
