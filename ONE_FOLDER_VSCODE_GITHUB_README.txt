NUNES OPERATIONS - ONE MASTER FOLDER SYSTEM
===========================================

GOAL
----
Keep ONE code folder on the MAIN SERVER PC. Edit only that folder in VS Code.
Staff/owner PCs never receive code ZIPs. They only open the live main server.

FIRST TIME ON MAIN SERVER PC
----------------------------
1. Extract this folder to a permanent local location, for example:
   C:\NUNES\NUNES_OPERATIONS_WORKSPACE
2. Run: 0_FIRST_TIME_VSCODE_MAIN_SERVER.bat
3. Open: NUNES.code-workspace in VS Code.
4. GitHub source/version history is fixed to:
   https://github.com/Nunes-instruments/Form_Filling_Crm.git
   Run 1_CONNECT_GITHUB_PRIVATE_REPO.bat only if the remote needs repair.

NORMAL UPDATE FROM VS CODE
--------------------------
1. Edit/save code in the SAME master folder.
2. Run F_APPLY_VSCODE_CHANGES_LIVE.bat
   - backs up persistent company data
   - builds/restarts the main server
   - keeps port 8765 untouched
   - creates a new rollout ID
   - open staff/owner dashboards auto-refresh
3. After you confirm it works, run G_SAVE_TO_GITHUB.bat to save the version.

STAFF / OWNER PCs - ONE TIME ONLY
---------------------------------
1. Install Tailscale and connect to the company tailnet.
2. Run 3_CONNECT_THIS_PC_TO_SHARED_SERVER.bat once.
3. Main server URL is http://100.97.196.17:8785
4. Use the NUNES Operations desktop shortcut after that.

IMPORTANT
---------
- Never run the main-server BAT files on staff PCs.
- Gmail/WhatsApp linking is done on the MAIN SERVER PC only.
- Private Google OAuth JSON is copied to LOCALAPPDATA and excluded from GitHub.
- Persistent Purchasing/Servicing company data is outside normal Git commits.
- Port 8765 remains for your other project.

GITHUB SINGLE SOURCE
--------------------
Permanent repository: https://github.com/Nunes-instruments/Form_Filling_Crm.git

GITHUB / OTHER PC
-----------------
If code is changed on another authorized development PC and pushed to GitHub,
on the MAIN SERVER PC run H_PULL_GITHUB_AND_APPLY.bat.
