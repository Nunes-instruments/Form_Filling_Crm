NUNES OPERATIONS WORKSPACE V6.5.0 - FAST DESKTOP + SHARED DATA
===============================================================

SERVER PC - ONE TIME
1. Extract this ZIP to a normal local folder.
2. Double-click: 1_SETUP_ALWAYS_ON_SERVER.bat
3. Approve the Windows Administrator prompt.
4. Keep this server PC signed in and ON.

DAILY USE ON SERVER PC
- Double-click the desktop icon: NUNES Operations
- Or run: 2_OPEN_NUNES_DESKTOP.bat
- If the server is already running, it opens without reinstalling/building.

OTHER OFFICE PCS - ONE TIME
1. On the server PC, open OPEN_ON_OTHER_DEVICES.txt.
2. On the other PC, run: 3_CONNECT_THIS_PC_TO_SHARED_SERVER.bat
3. Paste the "PC-name link" first choice, or "Other devices" link.
4. After that, use the NUNES Operations desktop icon.

SHARED DATA
- One server PC stores the live Purchasing and Servicing data.
- All connected office devices see the same dashboard/forms/data.
- Purchasing data is now persistent across extracted NUNES ZIP updates.
- Servicing data remains persistent in the existing shared ServiceData location.

SERVICING SPEED
- Servicing starts before the main dashboard finishes preparing.
- The actual new Service Job form (/jobs/new) is preloaded in the background.
- Opening Servicing no longer waits through the old long polling loop.
- If Servicing is still starting, the frame refreshes itself as soon as ready.

DO NOT copy data manually into a new ZIP unless instructed.
V6.5.0 automatically connects the persistent data folders.

ONE-CLICK DESKTOP FIX
---------------------
If the Desktop icon does not open, run 4_REPAIR_DESKTOP_SHORTCUT.bat once from this package.
After that, double-click NUNES Operations. A small launcher window will show server startup progress and close automatically when the dashboard opens.

V6.5.0 DASHBOARD STANDALONE START FIX
-------------------------------------
If an earlier V6.5.0 reached [5/6] and said "NUNES workspace did not start",
use this package. It starts the existing standalone Next.js build directly and
reuses the same persistent data/cache.
