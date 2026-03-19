/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  safelist: [
    "text-http-get",
    "text-http-post",
    "text-http-put",
    "text-http-patch",
    "text-http-delete",
    "text-http-head",
    "text-http-options",
    "bg-httpbg-get",
    "bg-httpbg-post",
    "bg-httpbg-put",
    "bg-httpbg-patch",
    "bg-httpbg-delete",
    "bg-httpbg-head",
    "bg-httpbg-options",
  ],
  content: {
    relative: true,
    files: [
      "./src/**/*.{ts,tsx}", // Adjust this to include all relevant paths
    ],
  },
  theme: {
    container: {
      center: "true",
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    fontFamily: {
      sans: ["var(--font-family-ui)", "Geist", "sans-serif"],
      ui: ["var(--font-family-ui)", "Geist", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "system-ui", "sans-serif"],
      mono: ["var(--font-family-mono)", "var(--font-family-base)", "Inconsolata", "monospace"],
    },
    fontSize: {
      xs: "var(--font-size-xs)",
      sm: "var(--font-size-sm)",
      base: "var(--font-size-base)",
      lg: "var(--font-size-lg)",
      xl: "var(--font-size-xl)",
      "2xl": "var(--font-size-2xl)",
      "3xl": "var(--font-size-3xl)",
      "4xl": "var(--font-size-4xl)",
    },
    fontWeight: {
      light: "var(--font-weight-light)",
      normal: "var(--font-weight-normal)",
      medium: "var(--font-weight-medium)",
      semibold: "var(--font-weight-semibold)",
      bold: "var(--font-weight-bold)",
    },
    letterSpacing: {
      tight: "var(--letter-spacing-tight)",
      normal: "var(--letter-spacing-normal)",
      wide: "var(--letter-spacing-wide)",
      wider: "var(--letter-spacing-wider)",
    },
    extend: {
      colors: {
        // Base UI colors
        bg: "var(--ui-bg)",
        editor: "var(--editor-bg)",
        panel: "var(--ui-panel-bg)",
        active: "var(--ui-selection-normal)",
        hover: "var(--ui-hover)",
        comment: "var(--syntax-comment)",
        accent: "rgb(var(--common-accent))",
        alt: "rgb(var(--common-alt))",
        line: "var(--ui-line)",
        ["editor-fg"]: "var(--editor-fg)",
        ["ui-fg"]: "var(--ui-fg)",
        light: "var(--editor-gutter-normal)",
        overlay: "var(--ui-overlay-bg)",
        shadow: "var(--ui-shadow)",

        // Text colors
        text: {
          DEFAULT: "var(--editor-fg)",
          muted: "var(--syntax-comment)",
        },

        // Border colors
        border: {
          DEFAULT: "var(--ui-line)",
          light: "var(--editor-gutter-normal)",
          subtle: "var(--ui-border-subtle)",
          subtleLight: "var(--ui-border-subtle-light)",
        },

        // Version control colors
        vcs: {
          added: "var(--vcs-added)",
          modified: "var(--vcs-modified)",
          removed: "var(--vcs-removed)",
          ignored: "var(--vcs-ignored)",
        },

        // Git graph branch colors
        git: {
          branch1: "var(--git-branch-1)",
          branch2: "var(--git-branch-2)",
          branch3: "var(--git-branch-3)",
          branch4: "var(--git-branch-4)",
          branch5: "var(--git-branch-5)",
          branch6: "var(--git-branch-6)",
          branch7: "var(--git-branch-7)",
          branch8: "var(--git-branch-8)",
        },

        // HTTP method colors
        http: {
          get: "var(--http-get)",
          post: "var(--http-post)",
          put: "var(--http-put)",
          patch: "var(--http-patch)",
          delete: "var(--http-delete)",
          head: "var(--http-head)",
          options: "var(--http-options)",
        },
        httpbg: {
          get: "var(--http-get-bg)",
          post: "var(--http-post-bg)",
          put: "var(--http-put-bg)",
          patch: "var(--http-patch-bg)",
          delete: "var(--http-delete-bg)",
          head: "var(--http-head-bg)",
          options: "var(--http-options-bg)",
        },

        // Status indicator colors
        status: {
          success: "var(--status-success)",
          error: "var(--status-error)",
          warning: "var(--status-warning)",
          info: "var(--status-info)",
        },

        // Icon colors
        icon: {
          primary: "var(--icon-primary)",
          secondary: "var(--icon-secondary)",
          success: "var(--icon-success)",
          error: "var(--icon-error)",
          warning: "var(--icon-warning)",
          info: "var(--icon-info)",
        },

        // Search & highlight colors
        highlight: {
          search: "var(--highlight-search)",
          current: "var(--highlight-search-current)",
        },

        // Button colors
        button: {
          primary: {
            DEFAULT: "var(--button-primary-bg)",
            hover: "var(--button-primary-hover)",
          },
          secondary: {
            DEFAULT: "var(--button-secondary-bg)",
            fg: "var(--button-secondary-fg)",
          },
          danger: {
            DEFAULT: "var(--button-danger-bg)",
            hover: "var(--button-danger-hover)",
          },
        },

        // Menu colors
        menu: {
          bg: "var(--menu-bg)",
          hover: "var(--menu-hover-bg)",
          separator: "var(--menu-separator)",
        },

        // Code editor colors
        code: {
          bg: "var(--code-bg)",
          fg: "var(--code-fg)",
          selection: "var(--code-selection)",
          line: "var(--code-line-highlight)",
          gutter: "var(--code-gutter)",
        },

        // Blockquote colors
        blockquote: {
          border: "var(--blockquote-border)",
          bg: "var(--blockquote-bg)",
          fg: "var(--blockquote-fg)",
        },

        // Placeholder colors
        placeholder: {
          border: "var(--placeholder-border)",
          bg: "var(--placeholder-bg)",
          fg: "var(--placeholder-fg)",
        },

        // Extension badge colors
        badge: {
          core: {
            bg: "var(--badge-core-bg)",
            border: "var(--badge-core-border)",
            fg: "var(--badge-core-fg)",
          },
          official: {
            bg: "var(--badge-official-bg)",
            border: "var(--badge-official-border)",
            fg: "var(--badge-official-fg)",
          },
          community: {
            bg: "var(--badge-community-bg)",
            border: "var(--badge-community-border)",
            fg: "var(--badge-community-fg)",
          },
        },

        // Test & assertion colors
        test: {
          passed: {
            bg: "var(--test-passed-bg)",
            fg: "var(--test-passed-fg)",
          },
          failed: {
            bg: "var(--test-failed-bg)",
            fg: "var(--test-failed-fg)",
          },
        },

        // Modal colors
        modal: {
          bg: "var(--modal-bg)",
          header: "var(--modal-header-bg)",
        },

        // Titlebar colors
        titlebar: {
          bg: "var(--titlebar-bg)",
          fg: "var(--titlebar-fg)",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
};
