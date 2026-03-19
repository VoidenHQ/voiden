import { useSettings } from "@/core/settings/hooks";
import { useState, useEffect } from "react";

export const SettingsContent = () => {
  const { settings, save } = useSettings();
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [cliInstalling, setCliInstalling] = useState(false);
  const [cliMessage, setCliMessage] = useState<string | null>(null);
  const [cliActuallyInstalled, setCliActuallyInstalled] = useState<boolean | null>(null);
  const [skillsToggling, setSkillsToggling] = useState(false);

  // Check actual CLI installation status on mount and when settings change
  useEffect(() => {
    const checkCliInstallation = async () => {
      try {
        const isInstalled = await window.electron?.cli?.isInstalled();
        setCliActuallyInstalled(isInstalled ?? false);

        // If actual status differs from settings, update settings
        if (isInstalled !== undefined && isInstalled !== settings?.cli?.installed) {
          await save({
            cli: {
              installed: isInstalled,
            },
          });
        }
      } catch (error) {
        console.error("Failed to check CLI installation status:", error);
      }
    };

    if (settings) {
      checkCliInstallation();
    }
  }, [settings?.cli?.installed]);

  if (!settings) return null;

  // Use actual installation status if available, otherwise fall back to settings
  const isCliInstalled = cliActuallyInstalled ?? settings.cli?.installed ?? false;

  const handleNerdFontToggle = async (enabled: boolean) => {
    if (enabled) {
      // User wants to enable Nerd Font
      if (!settings.terminal.nerd_font_installed) {
        // Need to download first
        setIsDownloading(true);
        setDownloadError(null);

        try {
          const result = await window.electron?.fonts.install();
          if (result?.success) {
            // Update settings to enable and mark as installed
            await save({
              terminal: {
                use_nerd_font: true,
                nerd_font_installed: true,
              },
            });
          } else {
            setDownloadError(result?.error || "Failed to download font");
            // Don't enable if download failed
            await save({
              terminal: {
                ...settings.terminal,
                use_nerd_font: false,
              },
            });
          }
        } catch (error) {
          setDownloadError(error instanceof Error ? error.message : "Unknown error");
          await save({
            terminal: {
              ...settings.terminal,
              use_nerd_font: false,
            },
          });
        } finally {
          setIsDownloading(false);
        }
      } else {
        // Already downloaded, just enable
        await save({
          terminal: {
            ...settings.terminal,
            use_nerd_font: true,
          },
        });
      }
    } else {
      // User wants to disable (keep font, just don't use it)
      await save({
        terminal: {
          ...settings.terminal,
          use_nerd_font: false,
        },
      });
    }
  };

  const handleUninstallFont = async () => {
    try {
      const result = await window.electron?.fonts.uninstall();
      if (result?.success) {
        await save({
          terminal: {
            use_nerd_font: false,
            nerd_font_installed: false,
          },
        });
      }
    } catch (error) {
      // console.error("Failed to uninstall font:", error);
    }
  };

  const handleCliInstall = async () => {
    setCliInstalling(true);
    setCliMessage(null);

    try {
      const result = await window.electron?.cli?.install();
      if (result?.success) {
        setCliMessage(result.message);
        setCliActuallyInstalled(true);
        await save({
          cli: {
            installed: true,
          },
        });
      } else {
        setCliMessage(result?.message || "Installation failed");
      }
    } catch (error) {
      setCliMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setCliInstalling(false);
    }
  };

  const handleCliUninstall = async () => {
    setCliInstalling(true);
    setCliMessage(null);

    try {
      const result = await window.electron?.cli?.uninstall();
      if (result?.success) {
        setCliMessage(result.message);
        setCliActuallyInstalled(false);
        await save({
          cli: {
            installed: false,
          },
        });
      } else {
        setCliMessage(result?.message || "Uninstallation failed");
      }
    } catch (error) {
      setCliMessage(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setCliInstalling(false);
    }
  };

  const handleShowCliInstructions = async () => {
    await window.electron?.cli?.showInstructions();
  };

  const handleSkillsToggle = async (enabled: boolean) => {
    setSkillsToggling(true);
    try {
      await window.electron?.skills?.setEnabled(enabled);
      await save({ skills: { enabled } });
    } finally {
      setSkillsToggling(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Settings</h1>

      {/* Terminal Settings */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Terminal</h2>

        <div className="border border-border rounded-lg p-4 bg-surface">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <h3 className="font-medium">Use Nerd Font</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Download and use JetBrains Mono Nerd Font for better icon support in terminal.
                {settings.terminal.nerd_font_installed && !isDownloading && (
                  <span className="text-green-600 dark:text-green-400 ml-2">✓ Font installed</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.terminal.use_nerd_font}
                  onChange={(e) => handleNerdFontToggle(e.target.checked)}
                  disabled={isDownloading}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>

          {isDownloading && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-sm">
              <div className="flex items-center gap-2">
                <div className="animate-spin h-4 w-4 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                <span className="text-blue-700 dark:text-blue-300">Downloading font (~112MB)...</span>
              </div>
            </div>
          )}

          {downloadError && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded text-sm">
              <span className="text-red-700 dark:text-red-300">Error: {downloadError}</span>
            </div>
          )}

          {settings.terminal.nerd_font_installed && !isDownloading && (
            <div className="mt-3 pt-3 border-t border-border">
              <button
                onClick={handleUninstallFont}
                className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
              >
                Uninstall Font
              </button>
              <p className="text-xs text-muted-foreground mt-1">
                This will delete the downloaded font files.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* CLI Settings */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">Command Line Interface</h2>

        <div className="border border-border rounded-lg p-4 bg-surface">
          <div className="mb-4">
            <h3 className="font-medium">Voiden CLI</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Install the <code className="px-1 py-0.5 bg-muted rounded text-xs">voiden</code> command to launch Voiden from your terminal.
              {isCliInstalled && (
                <span className="text-green-600 dark:text-green-400 ml-2">✓ CLI installed</span>
              )}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {!isCliInstalled ? (
              <>
                <button
                  onClick={handleCliInstall}
                  disabled={cliInstalling}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {cliInstalling ? "Installing..." : "Install CLI"}
                </button>
                <button
                  onClick={handleShowCliInstructions}
                  className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 text-sm"
                >
                  Show Instructions
                </button>
              </>
            ) : (
              <button
                onClick={handleCliUninstall}
                disabled={cliInstalling}
                className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
              >
                {cliInstalling ? "Uninstalling..." : "Uninstall CLI"}
              </button>
            )}
          </div>

          {cliMessage && (
            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded text-sm">
              <pre className="text-blue-700 dark:text-blue-300 whitespace-pre-wrap text-xs font-mono">
                {cliMessage}
              </pre>
            </div>
          )}

          <div className="mt-4 p-3 bg-muted rounded text-xs">
            <p className="font-medium mb-1">Usage Examples:</p>
            <code className="block text-muted-foreground">voiden file.void</code>
            <code className="block text-muted-foreground">voiden /path/to/project</code>
            <code className="block text-muted-foreground">voiden --help</code>
          </div>
        </div>
      </section>

      {/* AI Skills */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold mb-4">AI Skills</h2>

        <div className="border border-border rounded-lg p-4 bg-surface">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h3 className="font-medium">Enable Voiden Skills</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Install Voiden skills into Claude Code and Codex so AI agents understand the .void file format and can create API tests.
                Skills are copied to <code className="px-1 py-0.5 bg-muted rounded text-xs">~/.claude/skills/</code> and <code className="px-1 py-0.5 bg-muted rounded text-xs">~/.codex/instructions.md</code>.
              </p>
            </div>
            <div className="flex items-center gap-3 ml-4">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.skills?.enabled ?? false}
                  onChange={(e) => handleSkillsToggle(e.target.checked)}
                  disabled={skillsToggling}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
              </label>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
