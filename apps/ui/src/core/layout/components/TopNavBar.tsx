import { Copy, Minus, Settings, Square, X } from "lucide-react";
import { RecentProjectsSelector } from "@/core/projects/components/RecentProjectsSelector";
import { EnvSelector } from "./EnvSelector";
import { useGetPanelTabs, useAddPanelTab, useActivateTab } from "@/core/layout/hooks";
import { HamburgerMenu } from "./HamburgerMenu";
import { useEffect, useState } from "react";
import logo from "@/assets/logo-dark.png";
import { usePluginStore } from "@/plugins";

interface TopNavBarProps {
  onShowAbout?: () => void;
}

export const TopNavBar = ({ onShowAbout }: TopNavBarProps) => {
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: mainTabs } = useGetPanelTabs("main");
  const topBarItems = usePluginStore((state) => state.topBarItems);

  const isMac = !!(navigator && navigator.platform && navigator.platform.toUpperCase().includes('MAC'));


  const handleOpenSettings = () => {
    const existing = mainTabs?.tabs?.find((t) => t.type === "settings");
    if (existing) {
      // Focus the existing Settings tab
      activateTab({ panelId: "main", tabId: existing.id });
      return;
    }

    // Tab not open - open it now
    addPanelTab({
      panelId: "main",
      tab: { id: crypto.randomUUID(), type: "settings", title: "Settings", source: null },
    });
  };
  const [isMaximized,setIsMaximized] = useState(false);

  useEffect(()=>{
    const checkIsMaximize = async ()=>{
      const val = await window.electron?.mainwindow.isMaximized()||false;
      if(isMaximized!==val){
        setIsMaximized(val);
      }
    }
    checkIsMaximize();
  })
  const handleMinimize= async ()=>{
    await window.electron?.mainwindow.minimize();
  }
  const handleMaximize = async ()=>{
    await window.electron?.mainwindow.maximize();
    setIsMaximized(!isMaximized);
  }
  const handleClose =async ()=>{
    await window.electron?.mainwindow.close();
  }

  return (
    <div className="flex-none border-b border-border h-8 flex items-center w-full justify-between drag bg-panel">
      {/* Left Navigation Items */}
      <div className="flex items-center h-full">
        {/* Show hamburger menu only on Windows/Linux */}
        {!isMac && (<img src={logo} alt="Voiden" className="h-8 w-8 ml-2 mr-2" />)}
        {!isMac && (
          <div className="h-full ml-1">
            <HamburgerMenu onShowAbout={onShowAbout} />
          </div>
        )}
        {/* Spacer for macOS (72px = traffic lights area) */}
        {isMac && <div className="w-[72px]"></div>}
        <div></div>
        <RecentProjectsSelector />
        <EnvSelector />
        {topBarItems
          .filter((item) => (item.position ?? 'right') === 'left')
          .map((item) => (
            <button key={item.id} onClick={item.onClick} title={item.tooltip} className="h-full px-2 no-drag hover:bg-active flex items-center justify-center">
              <item.icon size={14} />
            </button>
          ))}
      </div>

      {/* Settings Button */}
      <div className={`h-full ml-auto flex items-center`}>
        {topBarItems
          .filter((item) => (item.position ?? 'right') === 'right')
          .map((item) => (
            <button key={item.id} onClick={item.onClick} title={item.tooltip} className="h-full px-2 no-drag hover:bg-active flex items-center justify-center">
              <item.icon size={14} />
            </button>
          ))}
        <button className={`h-full px-2 no-drag hover:bg-active w-8 ${isMac?'':'mr-[10px]'}`} onClick={handleOpenSettings}>
          <Settings size={14} />
        </button>
        {
          !isMac && (
            <>
              <button className="h-full px-2 no-drag hover:bg-active w-8 mx-1" onClick={handleMinimize}>
                <Minus size={14} />
              </button>
              <button className="h-full px-2 no-drag hover:bg-active w-8 mx-1" onClick={handleMaximize}>
                {!isMaximized?<Square size={14} />:<Copy size={14} style={{transform:'rotateX(180deg)'}}/>}
              </button>
              <button className="h-full px-2 no-drag hover:bg-red-500 hover:text-white w-8 mx-1" onClick={handleClose}>
                <X size={14} />
              </button></>
          )
        }
      </div>
    </div>
  );
};
