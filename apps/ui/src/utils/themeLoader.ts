interface ThemeMetadata {
  id: string;
  name: string;
  type: string;
}

interface Theme {
  id: string;
  name: string;
  type: string;
  colors: Record<string, string>;
}

// List of all possible theme variable names (for cleanup)
const ALL_THEME_VARIABLES = [
  // Base colors
  '--bg-primary', '--bg-surface', '--bg-secondary', '--fg-primary', '--fg-secondary', '--border', '--selection', '--hover',
  // Old base colors (legacy)
  '--editor-bg', '--editor-fg', '--editor-selection', '--editor-findMatch', '--editor-gutter-active', '--editor-gutter-normal',
  '--ui-bg', '--ui-fg', '--ui-panel-bg', '--ui-line', '--ui-selection-normal',
  '--ui-overlay-bg', '--ui-shadow', '--ui-border-subtle', '--ui-border-subtle-light',
  '--code-bg', '--code-fg', '--code-selection', '--code-line-highlight', '--code-gutter',
  '--modal-bg', '--modal-header-bg', '--titlebar-bg', '--titlebar-fg',
  '--block-header-bg', '--blockquote-border', '--blockquote-bg', '--blockquote-fg',
  '--menu-bg', '--menu-hover-bg', '--menu-separator',
  '--placeholder-border', '--placeholder-bg', '--placeholder-fg',
  // Semantic colors
  '--success', '--success-bg', '--error', '--error-bg', '--warning', '--info',
  '--accent', '--accent-alt', '--accent-rgb', '--accent-alt-rgb',
  '--faker', '--faker-bg', '--table-cell-selection',
  // Old semantic (legacy)
  '--icon-primary', '--icon-secondary', '--icon-success', '--icon-error', '--icon-warning', '--icon-info',
  '--status-success', '--status-error', '--status-warning', '--status-info',
  '--vcs-added', '--vcs-modified', '--vcs-removed', '--vcs-ignored',
  '--http-get', '--http-post', '--http-put', '--http-patch', '--http-delete', '--http-head', '--http-options',
  '--button-primary-bg', '--button-primary-hover', '--button-secondary-bg', '--button-secondary-fg',
  '--button-danger-bg', '--button-danger-hover', '--button-secondary',
  '--test-passed-bg', '--test-passed-fg', '--test-failed-bg', '--test-failed-fg',
  '--highlight-search', '--highlight-search-current',
  // Badge colors
  '--badge-core-bg', '--badge-core-border', '--badge-core-fg',
  '--badge-official-bg', '--badge-official-border', '--badge-official-fg',
  '--badge-community-bg', '--badge-community-border', '--badge-community-fg',
  // Git branch colors
  '--git-branch-1', '--git-branch-2', '--git-branch-3', '--git-branch-4',
  '--git-branch-5', '--git-branch-6', '--git-branch-7', '--git-branch-8',
  // Syntax colors
  '--syntax-tag', '--syntax-func', '--syntax-entity', '--syntax-string',
  '--syntax-regexp', '--syntax-markup', '--syntax-keyword', '--syntax-special',
  '--syntax-comment', '--syntax-constant', '--syntax-operator',
  // ANSI colors
  '--ansi-black', '--ansi-red', '--ansi-green', '--ansi-yellow',
  '--ansi-blue', '--ansi-magenta', '--ansi-cyan', '--ansi-white',
  '--ansi-bright-black', '--ansi-bright-red', '--ansi-bright-green', '--ansi-bright-yellow',
  '--ansi-bright-blue', '--ansi-bright-magenta', '--ansi-bright-cyan', '--ansi-bright-white',
  // Variable highlighting
  '--variable-valid-bg', '--variable-valid-fg', '--variable-invalid-bg', '--variable-invalid-fg',
  '--variable-faker-bg', '--variable-faker-fg',
  // Common
  '--common-accent', '--common-alt',
];

// Apply theme by setting CSS custom properties
export function loadTheme(theme: Theme) {
  const root = document.documentElement;

  // IMPORTANT: Clear all theme variables first to prevent stale values
  // This fixes the issue where switching themes leaves old variable values
  ALL_THEME_VARIABLES.forEach(variable => {
    root.style.removeProperty(variable);
  });

  // Apply all CSS variables from the theme
  Object.entries(theme.colors).forEach(([property, value]) => {
    // Skip comment properties (start with _)
    if (!property.startsWith('_')) {
      root.style.setProperty(property, value);
    }
  });
}

// Get available themes from Electron
export async function getAvailableThemes(): Promise<ThemeMetadata[]> {
  if (window.electron?.themes) {
    try {
      return await window.electron.themes.list();
    } catch (error) {
      // console.error('Failed to load theme list:', error);
      return [];
    }
  }
  return [];
}

// Load theme by ID
export async function loadThemeById(themeId: string = 'voiden') {
  if (window.electron?.themes) {
    try {
      const theme = await window.electron.themes.load(themeId);
      if (theme) {
        loadTheme(theme);
      } else {
        // console.warn(`Theme '${themeId}' not found, falling back to voiden`);
        // Try to load voiden as fallback
        const fallback = await window.electron.themes.load('voiden');
        if (fallback) {
          loadTheme(fallback);
        }
      }
    } catch (error) {
      // console.error('Failed to load theme:', error);
    }
  }
}

// Get theme from settings
export async function getThemeFromSettings(): Promise<string> {
  if (window.electron?.userSettings) {
    try {
      const settings = await window.electron.userSettings.get();
      return settings?.appearance?.theme || 'voiden';
    } catch (error) {
      // console.error('Failed to load theme from settings:', error);
      return 'voiden';
    }
  }
  return 'voiden';
}

// Initialize theme on app start
export async function initializeTheme() {
  const themeId = await getThemeFromSettings();
  loadThemeById(themeId);
}
