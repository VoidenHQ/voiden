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
  }
}
