NUNES OPERATIONS V6.5.3 - ONE MASTER FOLDER + AUTOMATIC GITHUB ROLLOUT
======================================================================

FIXED REPOSITORY
  https://github.com/Nunes-instruments/Form_Filling_Crm.git
  Branch: main

ONE-TIME ON MAIN SERVER
  1) Keep this folder in one permanent local location.
  2) Run I_ENABLE_GITHUB_AUTO_UPDATE.bat as Administrator once.
  3) Run J_PUBLISH_LIVE_AND_GITHUB.bat once to publish this V6.5.3 update.

NORMAL LOCAL VS CODE CHANGE
  Edit/save in this SAME master folder.
  Press Ctrl+Shift+B in NUNES.code-workspace
  OR run J_PUBLISH_LIVE_AND_GITHUB.bat.

WHAT HAPPENS
  - code is built/applied on the main server first
  - live health/rollout is verified
  - only then the source is committed/pushed to GitHub
  - staff/owner browser pages detect the rollout and refresh automatically
  - staff/owner PCs do not need source code, Git, VS Code, ZIPs, or update BAT files

CHANGE MADE SOMEWHERE ELSE / ON GITHUB
  The main server checks origin/main every 1 minute.
  If a newer safe fast-forward commit exists and the local VS Code folder is clean:
    - it fetches the commit
    - blocks secret/data paths
    - applies/builds/verifies the update
    - staff/owner pages refresh automatically
    - if live verification fails, source is rolled back and the previous version is reapplied

LOCAL UNSAVED WORK SAFETY
  If local VS Code changes exist, automatic GitHub pull stops and waits.
  It never overwrites local uncommitted work.

DATA/SECRET SAFETY
  Persistent company data and OAuth/token files remain outside Git tracking.
  The watcher blocks remote updates that attempt to add protected data/credential paths.

CHECK STATUS
  Run CHECK_GITHUB_AUTO_UPDATE.bat on the MAIN SERVER PC.

STAFF / OWNER
  One-time only: Tailscale + NUNES Operations shortcut.
  Main URL: http://100.97.196.17:8795
  After that no code update work is required on staff/owner PCs.

PORTS
  Dashboard 8795
  Servicing 5055
  WhatsApp 5056
  Purchasing 8770
  Port 8765 is intentionally untouched for the other project.
