import { Plus, Terminal, X, PanelRight } from "lucide-react";
import { Panel, PanelGroup } from "react-resizable-panels";
import { PanelTabs } from "./PanelTabs";
import { PanelContent } from "./PanelContent";
import { SidePanelTabs } from "./SidePanelTabs";
import { SidePanelContent } from "./SidePanelContent";
import { ResizeHandle } from "./ResizeHandle";
import { useAddPanelTab, useGetPanelTabs, useActivateTab, useClosePanelTab } from "@/core/layout/hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useNewTerminalTab } from "@/core/terminal/hooks";
import { Kbd } from "@/core/components/ui/kbd";
import { Tip } from "@/core/components/ui/Tip";
import { usePanelStore } from "@/core/stores/panelStore";
import { useResponsePanelPosition } from "@/core/stores/responsePanelPosition";
import { cn } from "@/core/lib/utils";
import { useEffect, useRef } from "react";

interface MainEditorProps {
  bottomPanelProps: any;
  rightPanelProps: any;
}

export const MainEditor = ({ bottomPanelProps, rightPanelProps }: MainEditorProps) => {
  const queryClient = useQueryClient();
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: newTerminalTab } = useNewTerminalTab();
  const { data: panelData } = useGetPanelTabs("main");
  const { data: bottomPanelData } = useGetPanelTabs("bottom");
  const { mutate: activateTab } = useActivateTab();
  const { mutate: closeTab } = useClosePanelTab();
  const { position: responsePanelPosition, togglePosition } = useResponsePanelPosition();
  const bottomActiveView = usePanelStore((state) => state.bottomActiveView);
  const setBottomActiveView = usePanelStore((state) => state.setBottomActiveView);
  const bottomPanelRef = usePanelStore((state) => state.bottomPanelRef);
  const openBottomPanel = usePanelStore((state) => state.openBottomPanel);
  const closeBottomPanel = usePanelStore((state) => state.closeBottomPanel);
  const rightPanelRef = usePanelStore((state) => state.rightPanelRef);
  const rightPanelOpen = usePanelStore((state) => state.rightPanelOpen);

  // When switching bottom → right the horizontal PanelGroup re-mounts and
  // restores its persisted size (which may be 0 / tiny). After the layout
  // settles we force the right panel to a sensible default width.
  const prevPosition = useRef(responsePanelPosition);
  useEffect(() => {
    if (prevPosition.current === "bottom" && responsePanelPosition === "right") {
      if (rightPanelOpen && rightPanelRef?.current) {
        rightPanelRef.current.resize(30);
      }
    }
    prevPosition.current = responsePanelPosition;
  }, [responsePanelPosition]);

  const createNewTabWithIncrement = () => {
    const files = panelData.tabs || [];
    const untitledFiles = files
      .map((file: any) => file.title)
      .filter((title: string) => title.startsWith("untitled"));

    const indexes = untitledFiles.map((name: string) => {
      if (name === "untitled.void") return 0;
      const match = name.match(/untitled-(\d+)\.void$/);
      return match ? parseInt(match[1], 10) : -1;
    }).filter((index: number) => index !== -1);

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
    if (bottomPanelRef?.current?.isCollapsed()) {
      bottomPanelRef.current.expand();
      openBottomPanel();
    }
    const tabs = bottomPanelData?.tabs ?? [];
    if (tabs.length === 0) {
      newTerminalTab("bottom");
    } else {
      const targetTabId = bottomPanelData?.activeTabId ?? tabs[0].id;
      // Optimistically update so the terminal view highlights immediately
      queryClient.setQueryData(["panel:tabs", "bottom"], (old: any) =>
        old ? { ...old, activeTabId: targetTabId } : old
      );
      if (!bottomPanelData?.activeTabId) {
        activateTab({ panelId: "bottom", tabId: targetTabId });
      }
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
                  onTabClick={() => {
                    setBottomActiveView("sidebar");
                    openBottomPanel();
                    if (bottomPanelRef?.current) {
                      bottomPanelRef.current.expand();
                    }
                  }}
                  forceInactive={bottomActiveView === "terminal"}
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

                <div className="flex-1" />

                {/* Layout toggle — move response panel between bottom and right */}
                <Tip label={responsePanelPosition === "bottom" ? "Move to right" : "Move to bottom"} side="bottom">
                  <button
                    className="px-2 h-full flex items-center justify-center hover:bg-active text-comment border-l border-border"
                    onClick={togglePosition}
                  >
                    <PanelRight size={14} />
                  </button>
                </Tip>
              </div>

              {/* Content — both mounted, toggled via display */}
              <div className="h-[calc(100%-2rem)] flex">
                {/* Hidden PanelTabs keeps keyboard shortcuts (Cmd+W etc.) alive */}
                <div className="hidden">
                  <PanelTabs panel="bottom" />
                </div>

                <div className="flex-1 h-full min-w-0" style={{ display: bottomActiveView === "terminal" ? undefined : "none" }}>
                  <PanelContent panelId="bottom" />
                </div>

                {/* Terminal tabs sidebar — shows name, activate on row click, close via X button */}
                {bottomActiveView === "terminal" && (
                  <div className="flex flex-col w-32 border-l border-border bg-bg flex-shrink-0 overflow-y-auto">
                    {bottomPanelData?.tabs?.map((tab: any, index: number) => (
                      <div
                        key={tab.id}
                        onClick={() => activateTab({ panelId: "bottom", tabId: tab.id })}
                        className={cn(
                          "group relative flex items-center gap-1.5 w-full h-8 px-2 cursor-pointer border-b border-border hover:bg-active",
                          tab.id === bottomPanelData.activeTabId
                            ? "bg-editor text-fg before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-0.5 before:bg-accent"
                            : "text-comment"
                        )}
                      >
                        <Terminal size={11} className="flex-shrink-0" />
                        <span className="text-xs truncate flex-1 min-w-0">
                          {tab.title || `Terminal ${index + 1}`}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            const isLast = bottomPanelData.tabs.length === 1;
                            closeTab({ panelId: "bottom", tabId: tab.id });
                            if (isLast && bottomPanelRef?.current) {
                              bottomPanelRef.current.collapse();
                              closeBottomPanel();
                            }
                          }}
                          className="flex-shrink-0 opacity-0 group-hover:opacity-100 hover:text-fg transition-opacity"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={() => newTerminalTab("bottom")}
                      className="flex items-center gap-1.5 w-full h-8 px-2 text-comment hover:bg-active hover:text-fg border-b border-border"
                    >
                      <Plus size={11} className="flex-shrink-0" />
                      <span className="text-xs">New terminal</span>
                    </button>
                  </div>
                )}

                <div className="flex-1 h-full bg-bg" style={{ display: bottomActiveView === "sidebar" ? undefined : "none" }}>
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
      <PanelGroup direction="horizontal" autoSaveId="persist-3-h">
        {/* Left: Editor + Terminal stacked vertically */}
        <Panel defaultSize={60} minSize={20}>
          <PanelGroup direction="vertical" autoSaveId="persist-3-v">
            <Panel defaultSize={70} minSize={20}>
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

        {/* Right Panel - Response Preview — full height */}
        <Panel {...rightPanelProps}>
          <div className="h-full border-l border-border bg-panel">
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
