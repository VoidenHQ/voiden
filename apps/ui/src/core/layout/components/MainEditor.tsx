import { Plus } from "lucide-react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { PanelTabs } from "./PanelTabs";
import { PanelContent } from "./PanelContent";
import { SidePanelTabs } from "./SidePanelTabs";
import { SidePanelContent } from "./SidePanelContent";
import { ResizeHandle } from "./ResizeHandle";
import { useAddPanelTab, useGetPanelTabs } from "@/core/layout/hooks";
import { useNewTerminalTab } from "@/core/terminal/hooks";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";

interface MainEditorProps {
  bottomPanelProps: any;
  rightPanelProps: any;
}

export const MainEditor = ({ bottomPanelProps, rightPanelProps }: MainEditorProps) => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: newTerminalTab } = useNewTerminalTab();
  const { data: panelData } = useGetPanelTabs("main");

  const createNewTabWithIncrement = () => {
    const files = panelData.tabs || [];
    const untitledFiles = files
      .map((file: any) => file.title)
      .filter((title: string) => title.startsWith("untitled"));

    const indexes = untitledFiles.map((name: string) => {
      if (name === "untitled.void") return 0;
      const match = name.match(/untitled-(\d+)\.void$/);
      return match ? parseInt(match[1], 10) : -1;
    }).filter(index => index !== -1); // Remove invalid matches

    const indexSet = new Set(indexes);
    let nextIndex = 1;
    while (indexSet.has(nextIndex)) {
      nextIndex++;
    }
    let fileName: string;
    if (!indexSet.has(0)) {
      fileName = "untitled.void";
    } else {
      fileName = `untitled-${nextIndex}.void`;
    }
    const newTab = {
      id: crypto.randomUUID(),
      type: "document",
      title: fileName,
      source: null,
    };
    return newTab;
  };
  const handleNewDocument = () => {
    const newTab = createNewTabWithIncrement();
    addPanelTab({
      panelId: "main",
      tab: newTab,
    });
  };


  return (
    <Panel defaultSize={80} minSize={5} className="min-w-96">
      <PanelGroup direction="horizontal" autoSaveId="per">
        {/* Main Editor Area */}
        <Panel defaultSize={50} minSize={30}>
          <PanelGroup direction="vertical" autoSaveId="persist-3">
            <Panel defaultSize={70}>
              <div className="h-full flex flex-col">
                {/* Editor Toolbar */}
                <div className="h-8 flex justify-between bg-bg">
                  <div className="flex flex-none"></div>

                  {/* Open Tabs */}
                  <PanelTabs panel="main" />

                  {/* Editor Actions */}
                  <div className=" flex border-l border-b border-border">
                    <Tip label={<span className="flex items-center gap-2"><span>New Voiden File</span><Kbd keys="⌘N" size="sm" /></span>} side="bottom">
                      <button className="px-2 hover:bg-active text-comment" onClick={handleNewDocument}>
                        <Plus size={14} />
                      </button>
                    </Tip>
                  </div>
                </div>

                {/* File Content */}
                <div id="main-editor" className="relative flex-1 bg-editor">
                  <div className="absolute inset-0 ">
                    <PanelContent panelId="main" />
                  </div>
                </div>
              </div>
            </Panel>

            <ResizeHandle orientation="horizontal" />

            {/* Terminal Panel */}
            <Panel {...bottomPanelProps}>
              <div className="h-full border-t border-border">
                <div className="h-8 flex justify-between bg-panel">
                  <PanelTabs panel="bottom" />
                  <div className="flex border-l border-b border-border">
                    <button className="px-2 hover:bg-active text-comment" onClick={() => newTerminalTab("bottom")}>
                      <Plus size={14} />
                    </button>
                  </div>
                </div>
                <PanelContent panelId="bottom" />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        <ResizeHandle orientation="vertical" />

        {/* Right Panel - Response Preview */}
        <Panel {...rightPanelProps}>
          <div className="h-full border-border bg-panel">
            <SidePanelTabs side="right" />
            <div className="h-[calc(100%-2rem)]">
              <SidePanelContent side="right" />
            </div>
          </div>
        </Panel>
      </PanelGroup>
    </Panel>
  );
};
