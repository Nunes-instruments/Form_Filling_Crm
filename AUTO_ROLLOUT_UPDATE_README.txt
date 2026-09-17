NUNES AUTO ROLLOUT UPDATE - FINAL SETUP
=======================================

ONE-TIME ON MAIN SERVER PC
- Run B_MAKE_THIS_PC_MAIN_SERVER.bat if this PC has not yet been made the main server.
- Run D_FIX_STAFF_TAILSCALE_ACCESS.bat once if staff/owner Tailscale access has not been enabled.

ONE-TIME ON EACH STAFF / OWNER CLIENT PC
- Run 3_CONNECT_THIS_PC_TO_SHARED_SERVER.bat.
- Default server: http://100.97.196.17:8785
- After this, use only the NUNES Operations desktop shortcut.

EVERY FUTURE UPDATE
1. Download/extract the NEW NUNES ZIP only on the MAIN SERVER PC.
2. Run E_UPDATE_MAIN_SERVER_AUTO_ROLLOUT.bat from that new folder.
3. Do not copy the update ZIP to staff or owner PCs.

WHAT HAPPENS AUTOMATICALLY
- Persistent Purchasing and Servicing data is backed up before update.
- Existing company data remains in the shared LocalAppData data stores.
- Gmail connection/settings remain with Servicing persistent data.
- WhatsApp resident/profile is retained on the main-server PC.
- Server runtime is rebuilt/restarted from the new code.
- Tailscale/LAN firewall access is re-confirmed.
- Open staff/owner dashboards poll the server update ID and reload when a new rollout is detected.
- Closed staff/owner PCs receive the newest version the next time NUNES Operations is opened.

PORTS
- Dashboard: 8785
- Servicing: 5055
- WhatsApp: 5056
- Purchasing: 8770
- 8765 is not assigned to this NUNES server.
