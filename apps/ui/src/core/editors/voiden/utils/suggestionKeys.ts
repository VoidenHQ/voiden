/**
 * Keys that accept the highlighted item in an autocomplete popup (slash menu,
 * file links, variables, table cell suggestions, mentions). Tab accepts like
 * Enter, as in most editors; Shift+Tab and other modified Tabs are left alone.
 */
export const isSuggestionAcceptKey = (event: KeyboardEvent): boolean =>
  event.key === "Enter" ||
  (event.key === "Tab" && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey);
