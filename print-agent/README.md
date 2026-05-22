# OverSeek Print Agent

Minimal local print agent for Shipping Hub label printing.

## Purpose

Browsers cannot silently print without a print dialog. This agent runs on the dispatch computer connected to the label printer, polls OverSeek for assigned print jobs, securely downloads label PDFs through the print-agent API, prints locally, and reports success or failure back to OverSeek.

## Windows App Install

The intended user-facing install is the Electron desktop app. It gives the user a normal Windows app, a system tray icon for monitoring, auto-start on login, and a standard installer/uninstaller.

Build the installer from `print-agent/`:

```bash
npm install
npm run build:win
```

The installer is written to `print-agent/dist/`.

After installing, the app opens a setup window. The user enters:

- OverSeek address, for example `https://overseek.example.com`
- OverSeek email
- OverSeek password
- 2FA code, if enabled

The app then loads the user's accounts, lets them choose the account, names this computer as a print station, and lets them select the local label printer. The password is not saved. The app stores only the generated print station token, encrypted with Electron `safeStorage` where the OS supports it.

Tray menu actions:

- Open OverSeek Print Agent
- Open Logs Folder
- Disconnect Station
- Quit

Monitor actions:

- Print Test Label
- Refresh
- Open Logs
- Disconnect

The diagnostics panel shows config/log paths, encryption availability, current station status, recent errors, and recent logs. Tokens are not displayed.

The app downloads labels from `GET /api/shipping/print-agent/jobs/:id/label` using the station token. It does not require direct access to server filesystem paths.

The installer creates Start Menu and desktop shortcuts. Windows uninstall is handled through Apps & Features. The uninstall keeps app data by default so accidental uninstall/reinstall does not lose the station token.

## Script Install

The script install remains available as a fallback. It installs the Node script as a Windows Scheduled Task. This starts it automatically when the dispatch user logs in, keeps config under `%LOCALAPPDATA%\OverSeek\PrintAgent`, writes logs to `agent.log`, and serves a local setup UI at `http://localhost:8787`.

Requirements:

- Windows 10/11 or Windows Server.
- Node.js 22+ installed.
- Label printer installed and printable from the same Windows user.

From PowerShell in this folder:

```powershell
.\scripts\install-windows.ps1 `
  -ApiBase "https://your-overseek-url"
```

The installer opens the local UI. From there you can log in to OverSeek, choose the account, name this print station, pick a printer, and assign the computer. The agent stores only the generated print station credentials after setup, not the user's login password.

You can also open the UI manually:

```powershell
Start-Process http://localhost:8787
```

Manage it:

```powershell
.\scripts\manage-windows.ps1 status
.\scripts\manage-windows.ps1 restart
.\scripts\manage-windows.ps1 logs
```

Uninstall it:

```powershell
.\scripts\uninstall-windows.ps1
```

Remove installed config, logs, and downloaded labels too:

```powershell
.\scripts\uninstall-windows.ps1 -RemoveData
```

## Manual Configuration

Copy `.env.example` to `.env`, start the agent, then open `http://localhost:8787` to assign it through the UI. You can still set `PRINT_STATION_ID` and `PRINT_STATION_TOKEN` manually if you generated credentials from `Shipping > Settings`.

```bash
cp .env.example .env
node agent.js
```

## Notes

- This MVP uses OS print commands.
- Windows uses PowerShell `Start-Process -Verb Print`.
- macOS/Linux script mode uses `lp`.
- The Electron app is the intended Windows packaging path.
- Production distribution should sign the Windows installer before release.
- Server-side station health enforces `minimumSupportedVersion` when configured on a print station. Unsupported agents stop receiving jobs and surface the required version in Operations.
