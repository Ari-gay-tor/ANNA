import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("app identity files", () => {
  const manifest = JSON.parse(readFileSync(join(root, "src", "app", "manifest.webmanifest"), "utf8"));

  it("the manifest names the app ANNA and asks for a standalone window", () => {
    expect(manifest).toMatchObject({ name: "ANNA", short_name: "ANNA", display: "standalone", start_url: "/", theme_color: "#2f5d50" });
  });

  it("every icon the manifest lists exists in public/ and is a PNG", () => {
    expect(manifest.icons.length).toBeGreaterThan(0);
    for (const icon of manifest.icons as { src: string }[]) {
      const file = join(root, "public", icon.src);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file).subarray(1, 4).toString("ascii")).toBe("PNG");
    }
  });

  it("the web favicon and the shortcut icon exist, and anna.ico is a real .ico", () => {
    expect(existsSync(join(root, "src", "app", "icon.png"))).toBe(true);
    const ico = readFileSync(join(root, "scripts", "windows", "anna.ico"));
    expect([ico.readUInt16LE(0), ico.readUInt16LE(2)]).toEqual([0, 1]); // reserved 0, type 1 = icon
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(3); // several sizes
  });

  it("the page title is ANNA", () => {
    expect(readFileSync(join(root, "src", "app", "layout.tsx"), "utf8")).toMatch(/title:\s*"ANNA"/);
  });
});
