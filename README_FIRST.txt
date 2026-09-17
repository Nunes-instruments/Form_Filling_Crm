NUNES COMPANY PLATFORM V6.3.9 - NEXT.JS ARCHITECTURE
==================================================

WHAT CHANGED
------------
V6 is not a launcher redesign. The main company product is now a Next.js platform.
The company platform has four clear areas:
  1. Owner Dashboard
  2. Forms
  3. Process Status
  4. Reports

FORMS
-----
Forms contains exactly two independent work systems:
  - Purchasing Form
  - Servicing Form
They are NOT merged and NOT compared. Opening either form starts/runs its existing workflow inside the company platform.

PURCHASING WORKFLOW
-------------------
Marketing -> Dispatch -> Payment -> Supplier -> Accounts -> Final Approval
The underlying Purchasing application and saved database remain intact.

SERVICING WORKFLOW
------------------
The updated Servicing V1.1.30 GEMINI VISION ONLY application remains intact.
Its receive/product/inspection/estimate/repair/testing/payment process remains its own workflow.

OWNER DASHBOARD
---------------
The owner sees real saved output from both form systems, in separate sections:
- Purchasing totals, collections, outstanding, workflow completion, monthly value, latest report output
- Servicing job totals, open/ready work, estimates, status distribution, latest report output
- Report drill-down shows the actual saved details and the people recorded in the process

PROCESS STATUS
--------------
This is the operational control screen.
Purchasing shows current department, completion %, status, staff involved, latest person and last update.
Servicing shows current service stage, completion %, status, staff involved, latest person and last update.

WINDOWS QUICK START
-------------------
1. Extract the whole ZIP to a normal folder.
2. Double-click START_NUNES_COMPANY.bat.
3. First run prepares Python and Node.js automatically if required, installs the Next.js packages and builds the platform.
4. The main platform opens in the browser.
5. Other devices on the same network use the URL written to OPEN_ON_OTHER_DEVICES.txt.

The first run requires internet if Python/Node/npm dependencies are not already available. Later runs reuse the prepared build.

CLOUD
-----
For 24x7 use with the office PC OFF, install this package on Ubuntu/Debian cloud using:
  sudo bash cloud/INSTALL_CLOUD_SERVER.sh
If upgrading an existing V4 cloud install, use:
  sudo bash cloud/UPDATE_CLOUD_APP.sh
V6 updater preserves Purchasing and Servicing data and converts the main platform service to Next.js.
