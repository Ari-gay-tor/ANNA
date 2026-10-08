import { describe, expect, it } from "vitest";
import { isNewChatShortcut } from "../src/components/shortcuts";

const key = (over: Partial<Parameters<typeof isNewChatShortcut>[0]>) => ({
  key: "o",
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...over,
});

describe("isNewChatShortcut", () => {
  it("is Ctrl+Shift+O, or Cmd+Shift+O on Mac", () => {
    expect(isNewChatShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(isNewChatShortcut(key({ metaKey: true, shiftKey: true }))).toBe(true);
    expect(isNewChatShortcut(key({ ctrlKey: true, shiftKey: true, key: "O" }))).toBe(true); // Shift makes the key uppercase
  });

  it("is not Ctrl+N (the browser's), not plain Ctrl+O, and not with other modifiers", () => {
    expect(isNewChatShortcut(key({ ctrlKey: true, key: "n" }))).toBe(false);
    expect(isNewChatShortcut(key({ ctrlKey: true, shiftKey: true, key: "n" }))).toBe(false);
    expect(isNewChatShortcut(key({ ctrlKey: true }))).toBe(false);
    expect(isNewChatShortcut(key({ shiftKey: true }))).toBe(false);
    expect(isNewChatShortcut(key({ ctrlKey: true, metaKey: true, shiftKey: true }))).toBe(false);
    expect(isNewChatShortcut(key({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
  });
});
