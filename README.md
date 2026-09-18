# NUNES Operations V6.6.0 — GitHub Single Source

This release simplifies the deployment model to **one GitHub source + one main server + permanent owner/staff desktop icons**.

## One-time setup

Run `0_NUNES_ALL_IN_ONE_SETUP.bat` on each computer and choose that computer's role:

- **MAIN SERVER**: connects the full source folder to `Nunes-instruments/Form_Filling_Crm` on `main`, runs the live server on TCP **8795**, creates the main-server Desktop icon, and installs `NUNES GitHub Auto Update` to check GitHub every minute.
- **OWNER**: checks Tailscale/main-server connectivity and creates a permanent `NUNES Operations` Desktop URL icon to `http://100.97.196.17:8795`.
- **STAFF**: same thin-client setup as Owner. No source code, Node, npm, Git, VS Code, Gmail OAuth JSON, WhatsApp session, or server install is needed on staff PCs.

## Update flow

After changing code in the main source folder, run `1_PUSH_GITHUB_AND_GO_LIVE.bat`. The verified version is applied live and pushed to GitHub `main`.

If `main` is pushed from any other authorized computer, the main server detects the new commit within about one minute, fast-forwards, applies/builds it, verifies `/api/health`, and rolls back source/runtime if live verification fails.

Owner/staff Desktop icons do not need to be replaced for normal application updates. They point to the main server, so the next open receives the latest app. Pages that are already open poll the rollout ID and reload after the main server has applied a new version.

## Fixed ports

- Dashboard: **8795**
- Purchasing: **8770**
- Servicing: **5055**
- WhatsApp: **5056**
- **8765 is not used or modified by this NUNES release.**

## Data and secret safety

Persistent Purchasing/Servicing data and local Gmail/WhatsApp/OAuth state remain local and are excluded from Git. The auto updater refuses remote updates containing protected data/credential paths and refuses to overwrite uncommitted local source edits.
