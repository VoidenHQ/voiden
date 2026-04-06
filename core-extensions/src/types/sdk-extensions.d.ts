export {};

declare module "@voiden/sdk/ui" {
  interface RequestHooks {
    useParentResponseDoc: (
      editor: any,
      getPos: () => number
    ) => {
      openNodes: string[];
      parentPos: number | null;
    };
    useResponseBodyHeight: () => {
      height: number | null;
      setHeight: (h: number) => void;
    };
  }

  interface UIComponents {
    Tip: React.ComponentType<{
      children: React.ReactNode;
      label: React.ReactNode;
      side?: "top" | "bottom";
      align?: "start" | "center" | "end";
    }>;
  }
}
