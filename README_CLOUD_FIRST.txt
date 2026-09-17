NUNES COMPANY PLATFORM V6.4.1 - 24x7 CLOUD
=========================================

V6 MAIN ARCHITECTURE
--------------------
Main URL -> Next.js Company Platform
          -> Owner Dashboard
          -> Forms -> Purchasing Form / Servicing Form
          -> Process Status
          -> Reports

The main Next.js platform reads report/process data through a private local Company Data API. The data API reads the existing Purchasing SQLite data and Servicing jobs data directly. Purchasing and Servicing remain independent engines.

ONE-TIME NEW CLOUD INSTALL
--------------------------
1. Create Ubuntu 22.04/24.04 or Debian 12 VM.
2. Allow inbound TCP 22, 80, 443, 8770 and 5055 in your cloud firewall.
3. Upload/extract this ZIP.
4. Run:
      sudo bash cloud/INSTALL_CLOUD_SERVER.sh
5. Choose domain/HTTPS mode and enter your domain/DuckDNS name.
6. Give staff only the MAIN URL printed by the installer.

UPGRADE FROM V4
---------------
Upload/extract V6 and run:
      sudo bash cloud/UPDATE_CLOUD_APP.sh
The updater:
- backs up existing data first
- preserves apps/order_forms/data
- preserves apps/service_operations/data
- builds the new Next.js main platform
- keeps the updated Servicing V1.1.30 Gemini Vision application
- creates the private Company Data API service
- changes nunes-platform to Next.js
- restarts all services
- keeps your existing main URL

AUTOMATIC SERVICES
------------------
- nunes-platform: Next.js company platform
- nunes-data-api: private report/process data service
- nunes-order: Purchasing workflow
- nunes-service: Servicing workflow
- nunes-whatsapp: WhatsApp runtime
- nunes-backup.timer: daily data backup

STATUS
------
  sudo bash /opt/nunes-company/cloud/CHECK_CLOUD_STATUS.sh
