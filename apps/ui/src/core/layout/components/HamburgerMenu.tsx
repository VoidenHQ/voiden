import {
  Menu,
  ChevronRight,
  FolderOpen,
  Save,
  X,
  Settings as SettingsIcon,
  FilePlus,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize,
  Terminal,
  FolderTree,
  HelpCircle,
  ExternalLink,
  Info,
  Scaling,
  SquareCode,
  CheckSquare,
  FileText,
  View,
  ScrollText,
  AppWindow,
} from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useGetPanelTabs, useAddPanelTab, useActivateTab } from "@/core/layout/hooks";
import type { Tab } from "../../../../../electron/src/shared/types";
import { useSettings } from "@/core/settings/hooks/useSettings";

interface MenuItem {
  label?: string;
  accelerator?: string;
  type?: "separator" | "normal" | "submenu";
  submenu?: MenuItem[];
  click?: () => void;
  icon?: any;
}

interface HamburgerMenuProps {
  onShowAbout?: () => void;
}

export const HamburgerMenu = ({ onShowAbout }: HamburgerMenuProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { mutate: addPanelTab } = useAddPanelTab();
  const { mutate: activateTab } = useActivateTab();
  const { data: mainTabs } = useGetPanelTabs("main");
  const { settings } = useSettings();

  // Close menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setOpenSubmenu(null);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleOpenSettings = () => {
    const existing = mainTabs?.tabs?.find((t: Tab) => t.type === "settings");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
    } else {
      addPanelTab({
        panelId: "main",
        tab: { id: crypto.randomUUID(), type: "settings", title: "Settings", source: null },
      });
    }
    setIsOpen(false);
  };

  const handleNewFile = async () => {
    await window.electron?.menuNewFile();
    setIsOpen(false);
  };

  const handleOpenFolder = async () => {
    await window.electron?.menuOpenFolder();
    setIsOpen(false);
  };

  const handleSave = async () => {
    await window.electron?.menuSave();
    setIsOpen(false);
  };

  const handleCloseProject = async () => {
    await window.electron?.menuCloseProject();
    setIsOpen(false);
  };

  const handleCloseWindow = async () => {
    await window.electron?.mainwindow.closeAndDeleteState();
    setIsOpen(false);
  };

  const handleToggleExplorer = async () => {
    await window.electron?.menuToggleExplorer();
    setIsOpen(false);
  };

  const handleToggleTerminal = async () => {
    await window.electron?.menuToggleTerminal();
    setIsOpen(false);
  };

  const handleCheckUpdates = async () => {
    const channel = settings?.updates?.channel || "stable";
    await window.electron?.checkForUpdates(channel);
    setIsOpen(false);
  };

  const handleAbout = () => {
    onShowAbout?.();
    setIsOpen(false);
  };

  const handleOpenExternal = (url: string) => {
    window.electron?.openExternal(url);
    setIsOpen(false);
  };

  const handleOpenWelcome = () => {
    const existing = mainTabs?.tabs?.find((t: Tab) => t.type === "welcome");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
    } else {
      addPanelTab({
        panelId: "main",
        tab: { id: crypto.randomUUID(), type: "welcome", title: "Welcome", source: null },
      });
    }
    setIsOpen(false);
  };

  const handleOpenChangelog = () => {
    const existing = mainTabs?.tabs?.find((t: Tab) => t.type === "changelog");
    if (existing) {
      activateTab({ panelId: "main", tabId: existing.id });
    } else {
      addPanelTab({
        panelId: "main",
        tab: { id: crypto.randomUUID(), type: "changelog", title: "Changelog", source: null },
      });
    }
    setIsOpen(false);
  };

  const handleReload = async () => {
    await window.electron?.menuReload();
    setIsOpen(false);
  };

  const handleForceReload = async () => {
    await window.electron?.menuForceReload();
    setIsOpen(false);
  };

  const handleResetZoom = async () => {
    await window.electron?.menuResetZoom();
    setIsOpen(false);
  };

  const handleZoomIn = async () => {
    await window.electron?.menuZoomIn();
    setIsOpen(false);
  };

  const handleZoomOut = async () => {
    await window.electron?.menuZoomOut();
    setIsOpen(false);
  };

  const handleToggleFullScreen = async () => {
    await window.electron?.menuToggleFullScreen();
    setIsOpen(false);
  };

  const handleToggleDevTools = async () => {
    await window.electron?.menuToggleDevTools();
    setIsOpen(false);
  };

  const menuItems: MenuItem[] = [
    {
      label: "File",
      type: "submenu",
      icon: FolderOpen,
      submenu: [
        { label: "New File", accelerator: "Ctrl+N", click: handleNewFile, icon: FilePlus },
        { type: "separator" },
        { label: "Open Folder...", accelerator: "Ctrl+O", click: handleOpenFolder, icon: FolderOpen },
        { type: "separator" },
        { label: "Save", accelerator: "Ctrl+S", click: handleSave, icon: Save },
        { type: "separator" },
        { label: "Close Project", click: handleCloseProject, icon: X },
        { label: "Close and Forget Window", click: handleCloseWindow, icon: AppWindow },
        { type: "separator" },
        { label: "Settings...", accelerator: "Ctrl+,", click: handleOpenSettings, icon: SettingsIcon },
        { type: "separator" },
        { label: "Exit", accelerator: "Alt+F4", click: async () => await window.electron?.menuQuit(), icon: X },
      ],
    },
    {
      label: "View",
      type: "submenu",
      icon:View,
      submenu: [
        { label: "Toggle File Explorer", accelerator: "Ctrl+Shift+E", click: handleToggleExplorer, icon: FolderTree },
        { label: "Toggle Terminal", accelerator: "Ctrl+J", click: handleToggleTerminal, icon: Terminal },
        { type: "separator",label:"separator" },
        { label: "Reload", accelerator: "Ctrl+R", click: handleReload, icon: RefreshCw },
        { label: "Force Reload", accelerator: "Ctrl+Shift+R", click: handleForceReload, icon: RefreshCw },
        { type: "separator",label:"separator" },
        { label: "Actual Size", accelerator: "Ctrl+0", click: handleResetZoom,icon:Scaling},
        { label: "Zoom In", accelerator: "Ctrl++", click: handleZoomIn, icon: ZoomIn },
        { label: "Zoom Out", accelerator: "Ctrl+-", click: handleZoomOut, icon: ZoomOut },
        { type: "separator",label:"separator" },
        { label: "Toggle Full Screen", accelerator: "F11", click: handleToggleFullScreen, icon: Maximize },
        { type: "separator",label:"separator" },
        { label: "Toggle Developer Tools", accelerator: "F12", click: handleToggleDevTools,icon:SquareCode },
      ],
    },
    {
      label: "Help",
      type: "submenu",
      icon: HelpCircle,
      submenu: [
        { label: "Welcome", click: handleOpenWelcome, icon: FileText },
        { label: "Changelog", click: handleOpenChangelog, icon: ScrollText },
        { type: "separator",label:"separator" },
        { label: "Documentation", click: () => handleOpenExternal("https://docs.voiden.md"), icon: ExternalLink },
        { label: "Report an Issue", click: () => handleOpenExternal("https://github.com/voidenhq/voiden/issues"), icon: ExternalLink },
        { type: "separator",label:"separator" },
        { label: "Visit Voiden Website", click: () => handleOpenExternal("https://voiden.md"), icon: ExternalLink },
        { type: "separator",label:"separator" },
        { label: "Check for Updates...", click: handleCheckUpdates, icon: CheckSquare },
        { type: "separator",label:"separator" },
        { label: "About", click: handleAbout, icon: Info },
      ],
    },
  ];

  const renderMenuItem = (item: MenuItem, index: number) => {
    if (item.type === "separator") {
      return <div key={`separator-${index}`} className="h-px bg-bg my-1" />;
    }

    const hasSubmenu = item.submenu && item.submenu.length > 0;
    const isSubmenuOpen = openSubmenu === item.label;
    const Icon = item.icon;

    return (
      <div key={item.label} className="relative">
        <button
          className="w-full px-3 py-1 text-left text-sm hover:bg-active text-text  flex items-center justify-between no-drag transition-colors"
          onClick={() => {
            if (hasSubmenu && !isSubmenuOpen) {
              setOpenSubmenu(isSubmenuOpen ? null : item.label);
            } else if (item.click) {
              item.click();
            }
          }}
          onMouseEnter={()=>{
             if (hasSubmenu) {
              setOpenSubmenu(isSubmenuOpen ? null : item.label);
            } 
          }}

        >
          <div className="flex items-center gap-3">
            {Icon && <Icon size={14} className="opacity-70" />}
            <span className="font-normal">{item.label}</span>
          </div>
          <div className="flex items-center gap-3 ml-8">
            {item.accelerator && <span className="text-xs opacity-60 font-normal">{item.accelerator}</span>}
            {hasSubmenu && <ChevronRight size={14} className="opacity-70" />}
          </div>
        </button>

        {hasSubmenu && isSubmenuOpen && (
          <div className="absolute left-full top-0 w-72 bg-panel border border-border rounded shadow-xl py-1 z-50">
            {item.submenu!.map((subItem, subIndex) => renderMenuItem(subItem, subIndex))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        className={`h-8 w-8 flex items-center justify-center hover:bg-active no-drag ${isOpen&&'bg-active'}`}
        onClick={() => setIsOpen(!isOpen)}
        onMouseDown={(e) => e.preventDefault()} // Prevent focus loss
        aria-label="Menu"
      >
        <Menu size={16} />
      </button>

      {isOpen && (
        <div
          className="absolute top-full left-0  w-72 bg-panel border border-border rounded shadow-2xl z-50 max-h-[80vh] "
          onMouseDown={(e) => e.preventDefault()} // Prevent focus loss when clicking menu items
        >
          {menuItems.map((item, index) => renderMenuItem(item, index))}
        </div>
      )}
    </div>
  );
};
