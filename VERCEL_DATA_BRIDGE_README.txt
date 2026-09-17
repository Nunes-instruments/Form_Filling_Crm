NUNES OPERATIONS WORKSPACE V6.4.7 - VERCEL DATA BRIDGE
======================================================

WHY V6.4.4 SHOWED 503
---------------------
The Vercel web application was deployed correctly, but Vercel had no value for
NUNES_API_INTERNAL_URL. Vercel serverless functions cannot directly access the
SQLite/jobs.json files stored on your Windows PC.

V6.4.7 HAS THREE DATA MODES
---------------------------
1. CLOUD DATA (best for access from anywhere)
   Configure NUNES_API_INTERNAL_URL + NUNES_DATA_API_TOKEN in Vercel.

2. LOCAL DATA BRIDGE (easy for this office PC)
   Double-click START_VERCEL_DATA_BRIDGE.bat.
   Then open https://nunes-operations-workspace.vercel.app
   The Vercel page automatically finds the NUNES Data API on ports 8865-8875.
   Your old Purchasing SQLite and Servicing jobs stay exactly where they are.

3. SAVED VIEW
   If neither cloud nor local bridge is available, the dashboard opens using the
   last successful browser snapshot instead of replacing the whole screen with a
   red 503 error. This does NOT mean old data was deleted.

IMPORTANT
---------
The local bridge works for the browser running on the SAME Windows PC as the
NUNES data files. For Vercel access from phones/other PCs/the internet while the
main PC is off, use a persistent cloud database/server.

Chrome may ask for permission to access devices/services on your local network.
Choose Allow so the Vercel page can talk to the NUNES bridge on this PC.


V6.4.7 CHROME 153 CONNECTION FIX
--------------------------------
Chrome 142+ requires permission before a public HTTPS website can read a
server on this PC / local network. Older NUNES builds aborted the bridge
probe after only 300-550 ms, often before Chrome could grant permission.

V6.4.7 changes this:
1. START_VERCEL_DATA_BRIDGE.bat opens the production URL with the exact port.
2. The page tries that exact bridge first.
3. The connection request waits long enough for Chrome permission.
4. If automatic permission is blocked, click CONNECT THIS PC in the amber banner.
5. In Chrome site controls, set Local network access = Allow if requested.

The bridge remains local-only. Purchasing SQLite and Servicing job data are
not uploaded into Vercel and are not overwritten by web deployments.
