# Creating Themes

This guide explains how to create custom themes for Voiden.

## Overview

Voiden uses a CSS custom property system with 45 variables organized into 5 categories. Themes are defined as JSON files and applied instantly without page reload.

## Theme Structure

Create a JSON file in `apps/electron/themes/`:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "type": "dark",
  "colors": {
    "--bg-primary": "#1a1a2e",
    "--bg-secondary": "#16213e",
    "--fg-primary": "#eaeaea",
    "--fg-secondary": "#a0a0a0",
    "--border": "#2a2a4a",
    "--selection": "#3a3a5a66",
    ...
  }
}
```

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (filename without .json) |
| `name` | Display name in settings |
| `type` | `"dark"` or `"light"` |
| `colors` | CSS custom properties |

## CSS Variables

### Base Colors (6 variables)

Foundation colors used throughout the app.

| Variable | Usage |
|----------|-------|
| `--bg-primary` | Main background (editors, panels) |
| `--bg-secondary` | Secondary panels, headers |
| `--fg-primary` | Primary text color |
| `--fg-secondary` | Secondary/muted text |
| `--border` | Borders and dividers |
| `--selection` | Selection highlight |

### Semantic Colors (13 variables)

Intent-based colors for consistent UI.

| Variable | Usage |
|----------|-------|
| `--success` | Success states, GET requests |
| `--success-bg` | Success background |
| `--error` | Error states, DELETE requests |
| `--error-bg` | Error background |
| `--warning` | Warning states, PUT/PATCH requests |
| `--info` | Info states, POST requests |
| `--accent` | Primary accent color |
| `--accent-alt` | Secondary accent color |
| `--accent-rgb` | Accent in RGB format (for opacity) |
| `--accent-alt-rgb` | Alt accent in RGB format |
| `--http-head` | HEAD request color |
| `--http-options` | OPTIONS request color |
| `--http-query` | QUERY request color |
| `--table-cell-selection` | Table cell highlight |

### Syntax Highlighting (11 variables)

Code editor syntax colors.

| Variable | Usage |
|----------|-------|
| `--syntax-tag` | HTML/XML tags |
| `--syntax-func` | Function names |
| `--syntax-entity` | Classes/types |
| `--syntax-string` | String literals |
| `--syntax-regexp` | Regular expressions |
| `--syntax-markup` | Markdown formatting |
| `--syntax-keyword` | Language keywords |
| `--syntax-special` | Special characters |
| `--syntax-comment` | Code comments |
| `--syntax-constant` | Constants |
| `--syntax-operator` | Operators |

### Terminal Colors (16 variables)

Standard ANSI terminal colors.

| Variable | Variable (Bright) |
|----------|-------------------|
| `--ansi-black` | `--ansi-bright-black` |
| `--ansi-red` | `--ansi-bright-red` |
| `--ansi-green` | `--ansi-bright-green` |
| `--ansi-yellow` | `--ansi-bright-yellow` |
| `--ansi-blue` | `--ansi-bright-blue` |
| `--ansi-magenta` | `--ansi-bright-magenta` |
| `--ansi-cyan` | `--ansi-bright-cyan` |
| `--ansi-white` | `--ansi-bright-white` |

### Variable Highlighting (6 variables)

Dynamic variable highlighting in requests.

| Variable | Usage |
|----------|-------|
| `--variable-valid-bg` | Valid variable background |
| `--variable-valid-fg` | Valid variable text |
| `--variable-invalid-bg` | Invalid variable background |
| `--variable-invalid-fg` | Invalid variable text |
| `--variable-faker-bg` | Faker variable background |
| `--variable-faker-fg` | Faker variable text |

## Creating a Theme

### 1. Create the JSON file

Create `apps/electron/themes/my-theme.json`:

```json
{
  "id": "my-theme",
  "name": "My Theme",
  "type": "dark",
  "colors": {
    "--bg-primary": "#1a1a2e",
    "--bg-secondary": "#16213e",
    "--fg-primary": "#eaeaea",
    "--fg-secondary": "#a0a0a0",
    "--border": "#2a2a4a",
    "--selection": "rgba(100, 100, 200, 0.4)",

    "--success": "#4ade80",
    "--success-bg": "rgba(74, 222, 128, 0.2)",
    "--error": "#f87171",
    "--error-bg": "rgba(248, 113, 113, 0.2)",
    "--warning": "#fbbf24",
    "--info": "#60a5fa",
    "--accent": "#818cf8",
    "--accent-alt": "#a78bfa",
    "--accent-rgb": "129 140 248",
    "--accent-alt-rgb": "167 139 250",
    "--http-head": "#a855f7",
    "--http-options": "#6b7280",
    "--http-query": "#99f1fd",
    "--table-cell-selection": "rgba(129, 140, 248, 0.35)",

    "--syntax-tag": "#f472b6",
    "--syntax-func": "#60a5fa",
    "--syntax-entity": "#fbbf24",
    "--syntax-string": "#4ade80",
    "--syntax-regexp": "#fb923c",
    "--syntax-markup": "#818cf8",
    "--syntax-keyword": "#f472b6",
    "--syntax-special": "#94a3b8",
    "--syntax-comment": "#64748b",
    "--syntax-constant": "#fb923c",
    "--syntax-operator": "#94a3b8",

    "--ansi-black": "#1a1a2e",
    "--ansi-red": "#f87171",
    "--ansi-green": "#4ade80",
    "--ansi-yellow": "#fbbf24",
    "--ansi-blue": "#60a5fa",
    "--ansi-magenta": "#f472b6",
    "--ansi-cyan": "#22d3d8",
    "--ansi-white": "#e2e8f0",
    "--ansi-bright-black": "#475569",
    "--ansi-bright-red": "#fca5a5",
    "--ansi-bright-green": "#86efac",
    "--ansi-bright-yellow": "#fde047",
    "--ansi-bright-blue": "#93c5fd",
    "--ansi-bright-magenta": "#f9a8d4",
    "--ansi-bright-cyan": "#67e8f9",
    "--ansi-bright-white": "#f8fafc",

    "--variable-valid-bg": "rgba(74, 222, 128, 0.2)",
    "--variable-valid-fg": "#4ade80",
    "--variable-invalid-bg": "rgba(248, 113, 113, 0.2)",
    "--variable-invalid-fg": "#f87171",
    "--variable-faker-bg": "rgba(251, 191, 36, 0.2)",
    "--variable-faker-fg": "#fbbf24"
  }
}
```

### 2. Test the theme

1. Start the app in development mode
2. Go to Settings → Appearance
3. Your theme should appear in the dropdown
4. Select it to apply

### 3. Verify all colors

Check these areas:
- Editor background and text
- Sidebar and panels
- HTTP method colors (GET, POST, PUT, DELETE)
- Code syntax highlighting
- Terminal output
- Variable highlighting in URLs

## Bundled Themes

Voiden includes these themes:

| Theme | Type | Description |
|-------|------|-------------|
| Voiden | Dark | Default theme |
| Voiden Light | Light | Light variant |
| Dracula | Dark | Popular Dracula palette |
| Nord | Dark | Arctic, north-bluish |
| Tokyo Night | Dark | Modern Tokyo night |

Use these as references when creating your own theme.

## Tips

### Color Format

- Use hex (`#1a1a2e`) for solid colors
- Use rgba (`rgba(100, 100, 200, 0.4)`) for transparency
- Use space-separated RGB (`129 140 248`) for `--accent-rgb` variables

### HTTP Method Colors

Standard conventions:
- **GET** → `--success` (green)
- **QUERY** → `--http-query` (light cyan)
- **POST** → `--info` (blue)
- **PUT/PATCH** → `--warning` (yellow/orange)
- **DELETE** → `--error` (red)
- **HEAD** → `--http-head` (purple)
- **OPTIONS** → `--http-options` (gray)

### Testing Syntax Highlighting

Create a request with various code blocks to test:
- JSON bodies
- JavaScript snippets
- GraphQL queries

### Contrast

Ensure sufficient contrast between:
- `--fg-primary` and `--bg-primary`
- `--fg-secondary` and `--bg-secondary`
- Syntax colors and `--bg-primary`

## Theme Location

| Environment | Path |
|-------------|------|
| Development | `apps/electron/themes/` |
| Production | `{app}/resources/themes/` |
| User themes | `~/.voiden/themes/` (synced on startup) |

Themes in the app bundle are synced to the user directory on startup.
