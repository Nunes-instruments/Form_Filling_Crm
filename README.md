# NUNES Operations Workspace

This repository is the **single source of truth** for the NUNES Operations workspace.

## Main server
- Main dashboard: `http://100.97.196.17:8785`
- Port `8765` is intentionally left for another project.
- The main server PC is the only PC that runs the server code.

## Normal development workflow
1. Open `NUNES.code-workspace` on the main server PC.
2. Edit and save code in this same repository folder.
3. Run `F_APPLY_VSCODE_CHANGES_LIVE.bat` (or VS Code build task) to apply changes live.
4. Verify the application.
5. Run `G_SAVE_TO_GITHUB.bat` to commit and push the working version to `main`.

## Staff / owner PCs
Staff and owner PCs do **not** keep a copy of the application code. They connect to the main server through Tailscale and use the NUNES Operations desktop shortcut.

## Data and secrets
Persistent company data, OAuth credentials, token files, `.env*`, databases, runtime folders, and backups are excluded from Git. Do not commit these files.

See `ONE_FOLDER_VSCODE_GITHUB_README.txt` for full setup notes.
