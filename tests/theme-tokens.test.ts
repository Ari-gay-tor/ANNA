import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isThemeChoice, THEME_INIT_SCRIPT, THEME_KEY } from "../src/components/theme";

const css = readFileSync(join(process.cwd(), "src", "app", "globals.css"), "utf8");

/** The declarations between `start` and the next closing brace. */
function block(start: string): Record<string, string> {
  const from = css.indexOf(start);
  if (from < 0) throw new Error(`globals.css has no "${start}" block`);
  const body = css.slice(from + start.length, css.indexOf("}", from));
  return Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
}

const light = block(":root {");
const darkPinned = block(':root[data-theme="dark"] {');
const darkSystem = block(':root:not([data-theme="light"]) {');

function luminance(hex: string): number {
  const channel = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function color(set: Record<string, string>, name: string): string {
  const value = set[name];
  if (!value) throw new Error("missing token --" + name);
  return value;
}

// Every text-on-background pair the UI uses.
const TEXT_PAIRS: Array<[string, string]> = [
  ["ink", "bg"], ["ink", "surface"], ["ink", "surface-2"], ["ink", "accent-soft"], ["ink", "hover"], ["ink", "danger-soft"],
  ["muted", "bg"], ["muted", "surface"], ["muted", "surface-2"], ["muted", "hover"], ["muted", "accent-soft"], ["muted", "danger-soft"],
  ["on-accent", "accent"], ["on-accent", "accent-hover"],
  ["accent-ink", "bg"], ["accent-ink", "surface"], ["accent-ink", "surface-2"], ["accent-ink", "accent-soft"],
  ["danger", "bg"], ["danger", "surface"], ["danger", "danger-soft"], ["surface", "danger"],
];

describe("theme tokens", () => {
  it("define the same names in light and dark", () => {
    expect(Object.keys(darkPinned).sort()).toEqual(Object.keys(darkSystem).sort());
    for (const name of Object.keys(darkPinned)) expect(light, `light is missing --${name}`).toHaveProperty(name);
  });

  it("are identical in the system-dark block and the pinned-dark block", () => {
    expect(darkSystem).toEqual(darkPinned);
  });

  for (const [theme, set] of [["light", light], ["dark", darkPinned]] as const) {
    it(`meet WCAG AA (4.5:1) for every text pair in ${theme}`, () => {
      for (const [fg, bg] of TEXT_PAIRS) {
        expect(contrast(color(set, fg), color(set, bg)), `${fg} on ${bg} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`give the focus ring at least 3:1 against the page and card backgrounds in ${theme}`, () => {
      for (const bg of ["bg", "surface", "surface-2"]) expect(contrast(color(set, "focus"), color(set, bg)), `focus on ${bg}`).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("theme switch", () => {
  it("accepts only system, light and dark", () => {
    expect(["system", "light", "dark"].every(isThemeChoice)).toBe(true);
    expect(isThemeChoice("sepia")).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
  });

  it("the inline script sets data-theme only for a saved light or dark, and never throws", () => {
    const run = (stored: string | null | "throws") => {
      const attrs: Record<string, string> = {};
      const localStorage = {
        getItem: (key: string) => {
          if (stored === "throws") throw new Error("blocked");
          return key === THEME_KEY ? stored : null;
        },
      };
      const document = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
      new Function("localStorage", "document", THEME_INIT_SCRIPT)(localStorage, document);
      return attrs;
    };
    expect(run("dark")).toEqual({ "data-theme": "dark" });
    expect(run("light")).toEqual({ "data-theme": "light" });
    expect(run("system")).toEqual({});
    expect(run("garbage")).toEqual({});
    expect(run(null)).toEqual({});
    expect(run("throws")).toEqual({});
  });
});
