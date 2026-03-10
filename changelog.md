# Changelog

<<<<<<< HEAD
## v1.3.0-beta.1 — 05/03/2026

Beta release introducing community plugin support with install-from-zip and registry browser, OAuth2 authorization code flow improvements, tooltip previews for environment and runtime variables, and terminal reliability fixes.

### Added
- Community extension support — install third-party plugins from a zip file or directly from the extension registry
- Extension browser with community, verified, and core extension categories
- Tooltip preview for environment and runtime variables — hover over any `{{variable}}` to see its resolved value inline
- OAuth2 Authorization Code flow improvements — fixed duplicate code exchange that caused `invalid_grant` errors on some providers
- OAuth2 detailed error logging for easier debugging of token exchange failures

### Fixed
- Terminal double paste — characters were being sent twice in some terminal sessions
- OAuth2 `invalid_grant` error caused by the browser sending duplicate requests to the loopback callback server
- Extension detail page not updating after disabling or uninstalling a plugin
- Community plugin install errors being silently swallowed with no user feedback

---

=======
>>>>>>> origin/main
## v1.2.0-beta.1 — 24/02/2026

Beta release introducing pre/post request scripting, YAML environment configuration, improved file explorer navigation, drag-and-drop file management, YAML content-type support, and response preview improvements.

### Added
- Pre & Post Script support on Request blocks for setup and teardown logic
- YAML-based environment configuration support for easier management of complex environment variables
- Keyboard navigation in the sidebar file explorer
- Expand All and Collapse All buttons in the file explorer for convenience
- Drag and drop files into folders directly inside Voiden
- Drag and drop folders from the file explorer into Voiden
- Content-Type `application/yaml` support for request and response handling
- Faker.js parameter support and usage guidance for dynamic test data generation
- Response preview toggle on the response body sidebar

### Fixed
- Selected file indicator sometimes showing multiple files highlighted simultaneously in the navigation pane
- "Close Project" option incorrectly appearing on subfolders — it now only appears on root project folders
- Postman collection import crashing with "Cannot read property of undefined" when variables are absent
- Command Palette reliability issues
- Fixed cURL copy to use current in-memory content instead of requiring a saved file, enabling quick sharing and debugging of unsaved requests
- Fixed settings panel unexpectedly scrolling to top when a setting is changed

---

## v1.1.22 — 24/02/2026

Patch release adding timeout configuration and streamlining the startup process to prevent race conditions.

### Added
- Timeout setting for requests
- Streamlined startup process to prevent race conditions

---

## v1.1.21 — 23/02/2026

Stable patch release focusing on cookie handling, environment variable merging, import accuracy, and developer workflow improvements.

### Improved
- Improved cookie support and handling across requests
- Automatically quote URLs by default when importing collections
- Environment hierarchy merging — base, production, and nested environments now merge correctly, with proper override order consistently enforced across complex setups
- Support for importing the Runtime Variables block, making it easier to reuse runtime configurations across projects
- Copy any request as a cURL command for easier debugging, sharing, and reproducing requests outside the client

### Fixed
- Fixed OpenAPI imports incorrectly referencing absolute file paths instead of relative paths, eliminating portability issues across machines and environments

---

## v1.1.1 — 06/02/2026

Bug fix release addressing multi-window state management, CLI improvements for Windows and Linux, and update flow enhancements.

### Fixed
- Fixed multi-window instance pile-up where closing a window did not properly clean up its state, causing accumulated orphan states
- Fixed CLI to display the correct version information
- Fixed `voiden` command not working on Windows and Linux to open projects or files
- Fixed right-click context menu not appearing on Linux Fedora
- Fixed code block content not wrapping properly in the Markdown preview plugin

### Changed
- Improved update flow logic with error messages displayed as toast notifications in the bottom right
- Added download progress indicator in the UI during updates
- Smooth transition animations when switching between update channels

---

## v1.1.0 — 23/01/2026

Major release introducing multi-window support, GraphQL protocol support, CLI automation, and significant performance improvements for large OpenAPI specifications.

### Added
- Multi-window support to work on multiple files or projects simultaneously
- CLI support for automating API workflows and integrating with CI pipelines
- OpenAPI validation to ensure requests match API specifications and catch issues early
- WebSocket support for testing and documenting WebSocket APIs
- gRPC support for testing and documenting gRPC APIs
- GraphQL support alongside REST, gRPC, and WSS using the same file-based, version-controlled workflow
- Support for uninstalling projects and setting a default directory for project creation
- Editable `.env` files directly within Voiden
- Added shortcut key (Ctrl + .) to open the drag/context menu (Copy, Cut, Delete, etc.)
- Added separate actions for inserting blocks: Add block above (Cmd + Shift + ↑) and Add block below (Cmd + Shift + ↓)

### Fixed
- Resolved performance lag when opening large OpenAPI files caused by unnecessary UI updates
- Resolved issues with importing Postman legacy collections that do not include variables when generating Voiden files
- Fixed Authentication Plugin issues where Basic Auth and OAuth1 encryption failed with environment and runtime variables
- Enabled scrolling on the Changelog and Welcome pages

### Changed
- Optimized rendering performance for large OpenAPI specifications by eliminating inefficient re-renders using React hooks
- Improved handling of imperfect or non-strict API specifications
- Improved text contrast for error messages
- Replaced the single "Add block" action with two focused options for adding blocks above or below

---

## v1.0.0 — 11/11/2025

The foundation is complete. Voiden is now production-ready with comprehensive API testing capabilities, project management, CLI integration, native menus, and extensibility.

### Added
- Project Support — open, close, and manage multiple projects seamlessly
- Code Block with language selection, syntax highlighting, and inline commenting
- XML Block with full commenting capabilities
- Commenting support for JSON blocks
- JSON element overriding — override specific keys while inheriting the rest of the structure
- Overriding support for headers, query parameters, and form parameters
- Response Body Preview for PDFs, images, videos, and audio files
- Request/Response Summary panel for quick inspection
- Custom Voiden User Agent for outgoing requests
- Comprehensive Settings Panel with theme selection, font selection (with Nerd Font support), adjustable font sizes, proxy configuration, tiered environment variables, update channel selection (Beta/Stable), TLS verification toggle, and auto-save functionality
- Request Execution Pipeline for better control and extensibility
- PowerShell paste support for improved command handling
- Voiden Faker Plugin to generate dynamic test data in requests
- Advanced Auth Plugin with Basic Auth, Token, OAuth 1.0, and OAuth 2.0 support
- Enhanced Voiden REST API plugin for greater reliability and performance
- Refined imported and linked blocks to improve synchronization and consistency
- Improved Markdown Preview extension for smoother rendering
- Redesigned Response Panel for a cleaner, more intuitive layout
- Enhanced Linked Block management for improved editing and referencing
- Added display of Request Headers Sent for better request transparency
- Improved Postman Import Plugin — now supports Postman v2.0 and v2.1 collections
- Secured Environment variable replacement, now handled safely within the Electron process
- Native Menu System — native macOS menu bar with full keyboard shortcut support
- Hamburger menu for Windows/Linux with clean, modern design and auto-hiding menu bar (press Alt to show)
- Custom About Dialog — styled modal with centered logo, branding, and app information
- Windows CMD cURL Support — automatic detection and conversion of Windows CMD vs bash-style cURL with proper escape handling
- Link Block Feature — copy references to blocks and paste them as linked blocks in other documents with cross-file synchronization
- Singleton Block Validation — prevents duplicate singleton blocks (endpoint, JSON, XML, etc.) with user confirmation dialog to replace existing blocks while preserving UIDs
- Cut Block Functionality — cut entire blocks to clipboard and paste them anywhere
- Block Auto-Rendering — automatic rendering of pasted Voiden blocks (with block:// prefix)
- Auto-Save for Unsaved Files — unsaved files (created with Cmd+N) now persist across app restarts, stored in AppData directory
- Command Palette Enhancement — Cmd+Shift+P opens command palette with various productivity commands
- Create Voiden File Command — create new .void files with terminal-like folder autocomplete (Tab key)
- Create File Command — create any file type with extension validation and folder autocomplete
- Create Folder Command — create new folders with path autocomplete
- New Terminal Command — open new terminal tabs via command palette with automatic bottom panel expansion
- Voiden CLI Binary — launch Voiden from terminal with "voiden" command to open files and folders
- CLI Installation via Settings — one-click CLI installation with automatic symlink creation to /usr/local/bin
- CLI Installation Status Detection — settings automatically detect if CLI is installed on system startup
- CLI Uninstall Option — remove CLI integration from settings when installed
- Git Branch UI Redesign — modern modal dialog with icons, search, and visual feedback matching app design
- Git Branch Creation — create new branches directly from search input with Plus icon indicator
- Git Error Notifications — toast notifications for git checkout/create failures with user-friendly messages
- Git Success Notifications — confirmation toasts when switching or creating branches successfully
- Create Branch Visibility — "Create branch" option now always visible when typing new branch names
- Enhanced Empty State — clickable create button in git branch dialog when no matches found

### Fixed
- Fixed copy-paste issues in the Voiden editor
- Fixed keyboard shortcut inconsistencies on Windows and Linux systems
- Fixed Cmd+W/Ctrl+W not working when focused inside CodeMirror blocks (CustomCodeBlock, JSON, XML)
- Fixed keyboard shortcuts not working on Windows/Linux after menu implementation
- Fixed case-insensitive header matching in request pipeline
- Fixed backticks rendering issue in editor
- Fixed window update handling for better stability
- Fixed menu bar visibility on different platforms
- Fixed text selection being lost when clicking menu items
- Fixed FileLink (@file.void) deletion with backspace
- Fixed drag-and-drop grip menu click consistency and styling
- Fixed singleton blocks being duplicated via copy/paste
- Fixed Cmd+W not closing terminal tabs in bottom panel
- Fixed bottom panel collapsing when last terminal tab is closed
- Fixed bottom panel not being resizable when opened via command palette
- Fixed autosaved content displaying as raw JSON instead of rendering properly
- Fixed orphaned autosave files cleanup on app startup
- Fixed CLI not opening folders when app is already running — second-instance handler now processes file/folder arguments
- Fixed CLI path resolution — improved absolute/relative path handling in bash launcher script
- Fixed git branch search input focus — auto-focus on dialog open for immediate typing
- Fixed git errors failing silently — all git operations now show error messages to users
- Fixed create branch option being filtered out — moved to Command.Group with proper keywords
- Fixed search box scroll position — corrected positioning for better visibility
- Fixed duplicate request handling — improved request deduplication logic
- Fixed JSON content type handling — better detection of various JSON content-type formats
- Fixed slash command popup on dash input — prevented unwanted command triggers
- Fixed scrolling to active tab on file creation and first load
- Fixed auto-update logic for better reliability

### Changed
- Enhanced grip menu with improved styling, borders, shadows, and separators
- Improved paste validation — validation now happens at paste time instead of copy time
- Linked blocks now use relative paths from project root for better portability
- Menu items properly trigger actions with comprehensive IPC handlers
- Hamburger menu styled to match native system menus with blue selection highlight
- Better keyboard shortcut display in menu items with proper icons
- Keyboard shortcuts (Cmd+W, Cmd+R) now work in both main and bottom panels
- Bottom panel default size changed from 0% to 30% for better resize handle functionality
- Improved folder autocomplete with accent color suggestions for better visibility
- Git branch dialog now matches Command Palette design — dark overlay, rounded corners, shadow, icons
- Git branch items show GitBranch icon — consistent visual language throughout dialog
- Active branch indicator redesigned — green checkmark icon with "Active" label
- Create branch shows descriptive subtitle — "Press Enter to create new branch" for clarity
- Error messages are user-friendly — git errors translated to readable messages (e.g., "uncommitted changes")
- CLI installation auto-syncs settings — actual system state updates settings automatically
- Improved hover states — left border accent on selection for better feedback
- Better keyboard navigation — ESC closes dialog, arrow keys navigate, Enter selects
- Enhanced CLI documentation — better installation instructions for Windows/Linux/macOS

---

## Previous Releases

- improved search (ignoring git folders, and showing matching terms in the results)
- improved copy paste logic (process curl, markdown and other type of content properly)
- refactored for legacy, core and community extensions
- removed lot of deprecated code - reduce the build size.
- added support for settings
- disable tls verification
- auto save
- appearance settings - fonts, size, themes!!
