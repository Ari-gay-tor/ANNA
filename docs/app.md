# Using ANNA as an app on Windows

This is the guide for running ANNA on your own PC, no terminal needed after the first install. Everything here is for Windows 11 with Node 22 or newer. Developer instructions (`npm run dev`) are in the [README](../README.md). Testers get a zip kit and [the tester guide](tester-guide.md) instead; this page is the reference behind it.

## Dev mode and tester mode

ANNA decides where your data lives by one thing: **does the ANNA folder have a `.env` file?**

| | Dev mode (the folder has a `.env`: Ari's repo) | Tester mode (no `.env`: the unzipped kit) |
|---|---|---|
| Database | `prisma\dev.db` (whatever `DATABASE_URL` in `.env` says) | `%LOCALAPPDATA%\ANNA\anna.db` |
| Settings and Gemini key | `.env` | `%LOCALAPPDATA%\ANNA\config.env` |
| Log | `logs\anna.log` in the ANNA folder | `%LOCALAPPDATA%\ANNA\logs\anna.log` |
| First run | uses the key in `.env` (if it is missing, the Setup screen asks for it and writes it to `.env`) | the Setup screen asks for the key and saves it to `config.env` |
| Updating | `git pull`, then `update-anna.cmd` | unzip the new version anywhere, run `install-anna.cmd` again; the data is outside the folder, so nothing is lost |

In tester mode the launcher reads `config.env`, passes it to the server as environment variables, and forces `DATABASE_URL` to point at `anna.db` in the data folder. A variable that is already set in the environment wins over `config.env` (the same rule `ANNA_PORT` always had). `install.ps1` creates the data folder and an empty `anna.db` the first time. On a re-install it runs `prisma migrate deploy` against the existing `anna.db`: missing tables are added and nothing is deleted.

**Override:** set the `ANNA_DATA_DIR` environment variable, or pass `-DataDir <folder>` to the scripts, to use another data folder. That always means tester mode, even if a `.env` exists. It is for trying the installer without touching your real data; shortcuts made that way remember the folder.

The Gemini key is entered on the Setup screen (first run) or under the gear icon, Settings. ANNA checks it with one tiny call to Google, saves it to the file above, and uses it at once, with no restart. Settings shows only the last 4 characters. Other providers (Groq, OpenAI-compatible, a local model) stay `.env`-only; see [providers.md](providers.md).

## Steps

### Install (once)

1. Dev mode: make sure `.env` exists in the ANNA folder with your Gemini key (copy `.env.example` to `.env` if not). Tester mode: nothing to prepare; ANNA asks for the key the first time she opens.
2. Double-click `install-anna.cmd` in the ANNA folder.
3. Wait. It prints Step 1/5 to Step 5/5: checks Node (and offers to install it with winget if it is missing or older than 22), removes the "downloaded from the internet" mark from the scripts, installs packages, sets up the database, builds ANNA (a few minutes the first time), adds the shortcuts, and then opens ANNA in her own window. It ends with a SUCCESS or FAILED line.

After that:

- There is an **ANNA** shortcut on your Desktop and in the Start menu.
- ANNA's server starts quietly in the background every time you log in to Windows.

Running `install-anna.cmd` again is safe. It rebuilds, overwrites the shortcuts, and never makes duplicates. If you ever move or rename the ANNA folder, run it again so the shortcuts point at the new place.

### Open ANNA (every day)

Click the **ANNA** shortcut (Desktop or Start menu). ANNA opens in her own window, with no browser tabs and no address bar. If her window is already open, the shortcut brings it to the front. If the server is not running yet, the shortcut starts it first, which takes a few seconds.

You can close the window any time. ANNA keeps running in the background, and reminders still pop up as Windows notifications.

### Update after pulling new code (dev mode)

1. Pull the new code (`git pull`).
2. Double-click `update-anna.cmd`. It stops ANNA, installs packages, applies database changes, rebuilds, and starts ANNA again.

### Update (tester mode)

Unzip the new version over the old folder or into a new one, then double-click `install-anna.cmd` again. If the old folder's ANNA is still running on the port, the installer stops it. The shortcuts are rewritten to point at the new folder, and the data in `%LOCALAPPDATA%\ANNA` is kept and migrated.

### Stop ANNA

Run this in PowerShell, from the ANNA folder:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\windows\stop-anna.ps1
```

It stops only ANNA's server (the process on ANNA's port that belongs to this folder), never other Node programs. Clicking the ANNA shortcut, or logging in again, starts her again.

### Uninstall

Double-click `uninstall-anna.cmd`. It stops ANNA and removes the Desktop shortcut, the Start menu shortcut, and the start-at-login entry. It does **not** delete your data (see below). To remove everything, delete the ANNA folder afterwards (and, in tester mode, `%LOCALAPPDATA%\ANNA`).

## Where things are

| What | Dev mode (inside the ANNA folder) | Tester mode (in `%LOCALAPPDATA%\ANNA`) |
|---|---|---|
| Conversations, memories, reminders, flagged feedback | `prisma\dev.db` | `anna.db` |
| Settings and your Gemini key | `.env` | `config.env` |
| Log (server output and start/stop messages) | `logs\anna.log` (the previous one is `logs\anna.log.1`) | `logs\anna.log` (and `.1`) |
| Shortcuts | Desktop `ANNA.lnk`, Start menu `ANNA.lnk`, Startup folder `ANNA server.lnk` | same |

Back up the database and the settings file if you ever move to another PC.

The log is started fresh (the old one moves to `anna.log.1`) at the next start after it passes 5 MB. If ANNA runs for weeks without a restart, the log can grow past that until then.

## Settings

Put these in `.env` (tester mode: `config.env` in the data folder), then restart ANNA (run the stop command above, then click the shortcut). See `.env.example`.

### Turn off Windows notifications for reminders

```
ANNA_DESKTOP_NOTIFICATIONS=off
```

With this set, no Windows notification is shown. The reminder still appears as a banner inside ANNA's window, and the browser-style notification (if you allowed it) takes over again.

### Change the port

ANNA listens on `127.0.0.1:3737` (this PC only; nothing on your network can reach it). To use another port:

```
ANNA_PORT=4100
```

Restart ANNA. The shortcut, the health check and the notification click all use the new port. Your data is not affected. Set it before the next install or start; if you change it while ANNA is running, stop ANNA first (the stop command looks on the port from `.env`).

## Troubleshooting

### Clicking the shortcut shows a message "ANNA could not start"

Open the log (`logs\anna.log`; in tester mode `%LOCALAPPDATA%\ANNA\logs\anna.log`; see "Reading the log" below). The last lines say why. Common reasons:

- **The port is in use.** The log says `Port 3737 is used by another program`. Close that program, or change the port (above). Find out what is using it: `Get-NetTCPConnection -LocalPort 3737 -State Listen` in PowerShell shows the process id.
- **ANNA is not built.** The log says it has not been built yet. Run `install-anna.cmd` (or `update-anna.cmd`).
- **Node is not found.** Install Node 22 or newer from nodejs.org, then run `install-anna.cmd` again.

### The window does not open and there is no message

- Wait about 10 seconds the first time after logging in; the server needs a few seconds.
- Run `scripts\windows\open-anna.ps1` from PowerShell to see any error text.
- If Microsoft Edge is not installed, ANNA opens in your default browser instead (with tabs and an address bar).

### Reading `logs\anna.log`

Open it in Notepad, or in PowerShell: `Get-Content logs\anna.log -Tail 40` (tester mode: `Get-Content $env:LOCALAPPDATA\ANNA\logs\anna.log -Tail 40`). Lines starting with `[anna]` are ANNA's own messages: when she started, `fired N reminder(s)`, `toast shown for reminder ... (exit 0)`, or `toast failed ...`. Everything else is the server's output. Never paste your `.env` into a bug report; the log itself does not contain your key.

### Reminder notifications do not show

First check the log. After a reminder fires you should see `toast shown for reminder <id> (exit 0)`.

- **That line is there, but you saw nothing.** Windows accepted the notification but did not show it as a pop-up. Open the notification area (click the date and time) and look for it. Then check:
  - **Focus assist / Do not disturb** is off, or allows notifications from Windows PowerShell. Settings, System, Notifications.
  - **Windows PowerShell** is allowed to send notifications: Settings, System, Notifications, find "Windows PowerShell" in the list and turn it on. ANNA's notifications are sent under PowerShell's identity, so the small header of the notification says "Windows PowerShell"; the title line says ANNA.
  - Notifications are held back while a full-screen app (a game, a full-screen video, some presentation modes) is in front.
- **The line says `toast failed` or `toast could not start`.** Send that line to whoever maintains ANNA.
- **There is no line at all.** Check that `ANNA_DESKTOP_NOTIFICATIONS` is not `off`, and that the reminder actually fired (it shows in the Reminders page and as a banner).

Clicking the notification opens ANNA's address in your default browser (a normal tab). To get the app window, use the ANNA shortcut instead.

## How it works (short)

- `install-anna.cmd`, `update-anna.cmd` and `uninstall-anna.cmd` run the PowerShell scripts in `scripts\windows\`.
- The shortcut runs `open-anna.ps1`, which runs `start-anna.ps1` (starts `next start` hidden if `GET /api/health` does not answer as ANNA) and then opens `msedge.exe --app=http://127.0.0.1:3737/`.
- The shortcut and the login entry start PowerShell minimized, so a console can be on screen for a fraction of a second (a taskbar flicker, no window).
- `npm run app:start` starts the same production server in the foreground, for developers.
