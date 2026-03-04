import React from "react";
import { Terminal } from "./Terminal";

interface TerminalData {
  tabId: string;
  cwd: string;
}

interface TerminalManagerProps {
  terminalTabs: TerminalData[];
  activeTabId: string;
  panelId: string;
}

export const TerminalManager = ({ terminalTabs, activeTabId, panelId }: TerminalManagerProps) => {
  return (
    <div className="h-full w-full pb-8 ">
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
        }}
      >
        {terminalTabs.map((tab) => (
          <div
            key={tab.tabId}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              visibility: tab.tabId === activeTabId ? "visible" : "hidden",
              pointerEvents: tab.tabId === activeTabId ? "auto" : "none",
            }}
          >
            <Terminal tabId={tab.tabId} cwd={tab.cwd} panelId={panelId} />
          </div>
        ))}
      </div>
    </div>
  );
};
