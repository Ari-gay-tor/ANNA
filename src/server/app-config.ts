// Settings for running ANNA as a desktop app (Slice 6). Plain functions so tests can pass their own env.

/** An environment: process.env, or a plain object in tests. */
export type Env = Record<string, string | undefined>;

export const DEFAULT_PORT = 3737;

/** ANNA_PORT when it is a whole number from 1 to 65535, otherwise 3737. */
export function resolvePort(env: Env = process.env): number {
  const raw = env.ANNA_PORT?.trim();
  if (!raw || !/^\d+$/.test(raw)) return DEFAULT_PORT;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : DEFAULT_PORT;
}

/** Where a clicked toast sends the user. */
export function appUrl(env: Env = process.env): string {
  return `http://127.0.0.1:${resolvePort(env)}/`;
}

/** Windows toasts for reminders: on by default on Windows, off elsewhere, and off when ANNA_DESKTOP_NOTIFICATIONS=off. */
export function desktopToastsEnabled(platform: string = process.platform, env: Env = process.env): boolean {
  if (platform !== "win32") return false;
  return env.ANNA_DESKTOP_NOTIFICATIONS?.trim().toLowerCase() !== "off";
}
