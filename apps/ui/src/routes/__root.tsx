import { PluginProvider } from "@/plugins";
import { QueryClient } from "@tanstack/react-query";

import { Outlet, createRootRouteWithContext } from "@tanstack/react-router";
import { TooltipProvider } from "@radix-ui/react-tooltip";
import { AppProvider } from "@/core/providers/AppProvider";
import { ElectronEventProvider } from "@/core/providers";
import { useState, useEffect } from "react";
import { CommandPalette } from "@/core/components/CommandPalette";
import { HelpModal } from "@/core/help/HelpModal";

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient;
}>()({
  component: () => {
    const [isCommandPaletteFocused, setIsCommandPaletteFocused] = useState(false);
    const [paletteMode, setPaletteMode] = useState<'files' | 'commands'>('files');

    // Help modal state - lifted to root so it persists when command palette closes
    const [helpModalOpen, setHelpModalOpen] = useState(false);
    const [helpModalTitle, setHelpModalTitle] = useState('');
    const [helpModalContent, setHelpModalContent] = useState<React.ReactNode>(null);

    useEffect(() => {
      const handleKeyDown = (e: KeyboardEvent) => {
        // Cmd+P or Ctrl+P - check for both with and without shift
        if ((e.metaKey || e.ctrlKey) && (e.key === 'p' || e.key === 'P')) {
          e.preventDefault();

          // Close help modal if it's open
          if (helpModalOpen) {
            setHelpModalOpen(false);
          }

          if (e.shiftKey) {
            // Cmd+Shift+P - Command mode
            setPaletteMode('commands');
          } else {
            // Cmd+P - File search mode
            setPaletteMode('files');
          }

          setIsCommandPaletteFocused(true);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [helpModalOpen]);

    return (
      <ElectronEventProvider>
        <AppProvider>
          <PluginProvider>
            <TooltipProvider delayDuration={300} skipDelayDuration={1000}>
              <div className="cursor-dark flex flex-col h-screen">
                <Outlet />
                <CommandPalette
                  isFocused={isCommandPaletteFocused}
                  mode={paletteMode}
                  onFocus={() => setIsCommandPaletteFocused(true)}
                  onBlur={() => setIsCommandPaletteFocused(false)}
                  onShowHelp={(title, content) => {
                    setHelpModalTitle(title);
                    setHelpModalContent(content);
                    setHelpModalOpen(true);
                  }}
                />
                {/* Help Modal - persists even when CommandPalette closes */}
                <HelpModal
                  isOpen={helpModalOpen}
                  onClose={() => setHelpModalOpen(false)}
                  title={helpModalTitle}
                  content={helpModalContent}
                />
              </div>
            </TooltipProvider>
          </PluginProvider>
        </AppProvider>
      </ElectronEventProvider>
    );
  },
});
