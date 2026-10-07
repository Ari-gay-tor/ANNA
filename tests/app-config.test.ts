import { describe, expect, it } from "vitest";
import { appUrl, DEFAULT_PORT, desktopToastsEnabled, resolvePort } from "../src/server/app-config";

describe("resolvePort", () => {
  it("defaults to 3737", () => {
    expect(DEFAULT_PORT).toBe(3737);
    expect(resolvePort({})).toBe(3737);
  });

  it("uses ANNA_PORT when it is a valid port", () => {
    expect(resolvePort({ ANNA_PORT: "4100" })).toBe(4100);
    expect(resolvePort({ ANNA_PORT: " 80 " })).toBe(80);
    expect(resolvePort({ ANNA_PORT: "65535" })).toBe(65535);
  });

  it.each(["", "abc", "0", "65536", "-1", "12.5", "3737; calc"])("falls back to 3737 for %j", (value) => {
    expect(resolvePort({ ANNA_PORT: value })).toBe(3737);
  });

  it("builds the loopback URL a clicked toast opens", () => {
    expect(appUrl({})).toBe("http://127.0.0.1:3737/");
    expect(appUrl({ ANNA_PORT: "4100" })).toBe("http://127.0.0.1:4100/");
  });
});

describe("desktopToastsEnabled", () => {
  it("is on by default on Windows", () => {
    expect(desktopToastsEnabled("win32", {})).toBe(true);
    expect(desktopToastsEnabled("win32", { ANNA_DESKTOP_NOTIFICATIONS: "on" })).toBe(true);
    expect(desktopToastsEnabled("win32", { ANNA_DESKTOP_NOTIFICATIONS: "" })).toBe(true);
  });

  it("is off when ANNA_DESKTOP_NOTIFICATIONS=off, in any case", () => {
    expect(desktopToastsEnabled("win32", { ANNA_DESKTOP_NOTIFICATIONS: "off" })).toBe(false);
    expect(desktopToastsEnabled("win32", { ANNA_DESKTOP_NOTIFICATIONS: " OFF " })).toBe(false);
  });

  it("is off on every other platform, whatever the setting", () => {
    expect(desktopToastsEnabled("linux", {})).toBe(false);
    expect(desktopToastsEnabled("darwin", { ANNA_DESKTOP_NOTIFICATIONS: "on" })).toBe(false);
  });
});
