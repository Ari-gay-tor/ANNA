// Keyboard shortcut helpers. Ctrl+N is not used: the browser reserves it (and Edge's app window opens a new window).

export const NEW_CHAT_HINT = { windows: "Ctrl+Shift+O", mac: "⌘⇧O" } as const;

/** True for Ctrl+Shift+O, or Cmd+Shift+O on Mac. Alt and the other modifier must not be held. */
export function isNewChatShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey">): boolean {
  if (!event.shiftKey || event.altKey) return false;
  if (event.ctrlKey === event.metaKey) return false; // exactly one of Ctrl / Cmd
  return event.key.toLowerCase() === "o";
}

export function isMac(): boolean {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}
