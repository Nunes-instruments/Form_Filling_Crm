NUNES MAIN SERVER SWITCHOVER - CONNECTION ONLY UPDATE
=====================================================

ONLY THESE ARE CHANGED:
1. Google Gmail + WhatsApp connection/relink flow.
2. Main server moves to this PC and the dashboard no longer uses port 8765.

NEW LOCAL PORTS
- Main NUNES dashboard: 8795
- Servicing / Google OAuth callback: 5055 (unchanged)
- WhatsApp resident: 5056 (unchanged)
- Purchasing: 8770 (unchanged)
- Internal Data API: 8865 (unchanged)

SAFE SWITCHOVER
OLD OWNER PC:
- Extract this folder there if needed.
- Run A_STOP_OLD_OWNER_AND_EXPORT_DATA.bat
- It disables old NUNES auto-start tasks and exports Purchasing + Servicing + Gmail settings/data.
- It does NOT delete source business data.

NEW MAIN-SERVER PC:
- Copy this entire folder, including MAIN_SERVER_TRANSFER_DATA created above.
- Run B_MAKE_THIS_PC_MAIN_SERVER.bat as administrator.
- The main server starts on 8795 and opens the Connections page.
- Google Sign in opens on the MAIN SERVER PC so the 127.0.0.1 OAuth callback works correctly.
- WhatsApp Web Login opens the official WhatsApp Web browser on the MAIN SERVER PC.
- WhatsApp is intentionally relinked once instead of copying the old browser session.

IMPORTANT
- Port 8765 is not stopped or used by the new NUNES server. Another project can keep using it.
- Existing NUNES UI, forms, reports, workflows and business logic were not intentionally changed.
