import { Plus, Terminal } from "lucide-react";
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
import { usePanelStore } from "@/core/stores/panelStore";
import { cn } from "@/core/lib/utils";

interface MainEditorProps {
  bottomPanelProps: any;
  rightPanelProps: any;
}

export const MainEditor = ({ bottomPanelProps, rightPanelProps }: MainEditorProps) => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: newTerminalTab } = useNewTerminalTab();
  const { data: panelData } = useGetPanelTabs("main");
  const { data: bottomPanelData } = useGetPanelTabs("bottom");
  const responsePanelPosition = usePanelStore((state) => state.responsePanelPosition);
  const bottomActiveView = usePanelStore((state) => state.bottomActiveView);
  const setBottomActiveView = usePanelStore((state) => state.setBottomActiveView);

  const createNewTabWithIncrement = () => {
    const files = panelData.tabs || [];
    const untitledFiles = files
      .map((file: any) => file.title)
      .filter((title: string) => title.startsWith("untitled"));

    const indexes = untitledFiles.map((name: string) => {
      if (name === "untitled.void") return 0;
      const match = name.match(/untitled-(\d+)\.void$/);
      return match ? parseInt(match[1], 10) : -1;
    }).filter(index => index !== -1);

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

  const editorToolbar = (
    <div className="h-8 flex justify-between bg-bg">
      <div className="flex flex-none"></div>
      <PanelTabs panel="main" />
      <div className=" flex border-l border-b border-border">
        <Tip label={<span className="flex items-center gap-2"><span>New Voiden File</span><Kbd keys="⌘N" size="sm" /></span>} side="bottom">
          <button className="px-2 hover:bg-active text-comment" onClick={handleNewDocument}>
            <Plus size={14} />
          </button>
        </Tip>
      </div>
    </div>
  );

  const editorContent = (
    <div id="main-editor" className="relative flex-1 bg-editor">
      <div className="absolute inset-0 ">
        <PanelContent panelId="main" />
      </div>
    </div>
  );

  const handleSwitchToTerminal = () => {
    setBottomActiveView("terminal");
    if (!bottomPanelData?.tabs?.length) {
      newTerminalTab("bottom");
    }
  };

  if (responsePanelPosition === "bottom") {
    return (
      <Panel defaultSize={80} minSize={5} className="min-w-96">
        <PanelGroup direction="vertical" autoSaveId="per-bottom">
          {/* Editor - full width */}
          <Panel defaultSize={50} minSize={20}>
            <div className="h-full flex flex-col">
              {editorToolbar}
              {editorContent}
            </div>
          </Panel>

          <ResizeHandle orientation="horizontal" />

          {/* Bottom panel — VS Code style: sidebar tabs + Terminal as peers */}
          <Panel {...bottomPanelProps}>
            <div className="h-full border-t border-border">
              <div className="h-8 flex bg-bg border-b border-border items-center">
                {/* Sidebar tabs (Response, ScriptLogs, History…) */}
                <SidePanelTabs
                  side="right"
                  wrapperClassName="flex items-center h-full"
                  onTabClick={() => setBottomActiveView("sidebar")}
                />

                {/* Terminal tab */}
                <Tip label="Terminal" side="bottom">
                  <button
                    className={cn(
                      "px-2 h-full flex items-center justify-center hover:bg-active",
                      bottomActiveView === "terminal" && "bg-active",
                    )}
                    onClick={handleSwitchToTerminal}
                  >
                    <Terminal size={14} />
                  </button>
                </Tip>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Terminal instance tabs on the right (when terminal is active) */}
                {bottomActiveView === "terminal" && (
                  <div className="flex items-center h-full">
                    <PanelTabs panel="bottom" />
                    <div className="flex border-l border-border h-full">
                      <button className="px-2 hover:bg-active text-comment flex items-center" onClick={() => newTerminalTab("bottom")}>
                        <Plus size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Content — both mounted, toggled via display */}
              <div className="h-[calc(100%-2rem)]">
                <div className="h-full" style={{ display: bottomActiveView === "terminal" ? undefined : "none" }}>
                  <PanelContent panelId="bottom" />
                </div>
                <div className="h-full bg-bg" style={{ display: bottomActiveView === "sidebar" ? undefined : "none" }}>
                  <SidePanelContent side="right" />
                </div>
              </div>
            </div>
          </Panel>
        </PanelGroup>
      </Panel>
    );
  }

  return (
    <Panel defaultSize={80} minSize={5} className="min-w-96">
      <PanelGroup direction="horizontal" autoSaveId="per">
        {/* Main Editor Area */}
        <Panel defaultSize={50} minSize={30}>
          <PanelGroup direction="vertical" autoSaveId="persist-3">
            <Panel defaultSize={70}>
              <div className="h-full flex flex-col">
                {editorToolbar}
                {editorContent}
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
