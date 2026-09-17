NUNES FORM WORKFLOW V1.0.12
===========================

V1.0.12 FAST WINDOWS STARTUP / COMPATIBILITY

V1.0.12 SEQUENTIAL TEAM WORKFLOW
- The order form now shows a six-step team bar across the top.
- Only the current team section is shown for faster, cleaner data entry.
- Complete Marketing -> Dispatch -> Payment -> Supplier -> Accounts -> Final Approval.
- Save Draft stays on the same team. Save & Complete automatically opens the next team.
- Completed steps show a green check and remain available for review.
- Future steps are locked until the previous team is completed.
- When Final Approval is complete, the order shows a clear Completed screen.
- PDF / Paper Form output is unchanged from the exact company paper layout.
----------------------------------------------
- Workflow, branch logic, global Order ID sequence, IND/EXPORT filter and exact paper/PDF layouts are unchanged.
- Removed the copied .venv startup dependency completely; therefore "No pyvenv.cfg file" cannot block startup anymore.
- Uses an existing Python 3.10-3.13 installation directly and stores app packages in .nunes_runtime\site-packages.
- Supports normal 32-bit and 64-bit Windows Python installations.
- If Python is missing and Windows Package Manager (winget) exists, START_SERVER.bat attempts a silent per-user Python 3.12 install automatically.
- First startup installs only Flask/Werkzeug/openpyxl/reportlab. The large Google API package set is deferred until Google Drive/Sheets sync is actually enabled/used.
- Later starts perform import checks and skip downloads completely.
- Package downloads use a local pip cache, binary packages where available, and no bytecode compilation for faster setup/repair.
- Added REPAIR_RUNTIME.bat. The old REPAIR_PYTHON_ENVIRONMENT.bat remains as a compatibility shortcut.
- Added INSTALL_GOOGLE_SUPPORT.bat for optional advance installation; normal Google sync can install it automatically on first use.
- Updated backup timestamp logic to PowerShell so it works on current Windows versions where WMIC may be absent.

IMPORTANT WINDOWS NOTE
----------------------
The target is standard office Windows PCs (Windows 10/11, 32-bit or 64-bit) with Python 3.10-3.13. Very old unsupported Windows releases cannot be guaranteed because current Python/web libraries no longer support every historic Windows version.

FAST START
----------
1. Extract to a writable local folder such as C:\NUNES_FORM_WORKFLOW.
2. Double-click START_SERVER.bat.
3. On a PC that already has Python, only the small core dependency set is downloaded on the first start.
4. After that, package installation is skipped and the server starts immediately.
5. Client PCs still install nothing; they only open the LAN URL from data\CLIENT_ACCESS.txt.

V1.0.10 IND / EXPORT REPORT SHORTLIST
--------------------------------------
- Added IND / EXPORT selection to the digital order form.
- Reports now have quick All / IND / EXPORT buttons for easy shortlisting.
- Reports show IND / EXPORT as a separate column.
- Branch, date and status filters work together with the IND / EXPORT filter.
- Complete Details, Master Excel, individual Excel and Google Sheets include the selected type.
- Existing orders are preserved and default to IND until changed in Marketing Details.
- PDF and Paper Form layouts are unchanged. Global order-number logic is unchanged.


THIS UPDATE CHANGES ONLY TWO THINGS
-----------------------------------
1. LOGIN REMOVED
   - There is no username/password page.
   - START_SERVER.bat opens the Task Board directly.
   - All office teams use the same shared Task Board URL.

2. OUTPUT FORMAT MATCHES THE ORIGINAL COMPANY PAPER FORMS
   - Page 1: Marketing Details, Dispatch Details, Payment Details, Supplier Details,
     Order Place To, Remarks, Sign, Date and Approved By.
   - Page 2: Accounts Details, Purchase/PO details, Accounts item table,
     supplier Payment Details, Profile Margin, Remarks and Signature.
   - The PDF and Paper Form View use the same fixed A4 form layout as the images supplied.

NO OTHER WORKFLOW CHANGE WAS INTENDED.
Excel, Google Drive/Sheets, calculations, local database, server/client access,
section completion and the existing workflow remain in place.

SERVER PC
---------
1. Extract the ZIP to a normal local folder, for example:
   C:\NUNES_FORM_WORKFLOW
2. Double-click START_SERVER.bat.
3. The browser opens directly to the Task Board. No login is required.
4. Keep the server PC ON while other team PCs are using the system.

OTHER TEAM / CLIENT PCS
-----------------------
1. On the server PC open:
   data\CLIENT_ACCESS.txt
2. Copy the Office/LAN URL to Marketing, Dispatch, Payments, Supplier and Accounts PCs.
3. Open that URL in Chrome/Edge.
4. Client PCs do not install Python or this ZIP.

If a client says "refused to connect", run ENABLE_LAN_ACCESS.bat once on the SERVER PC
and approve the Windows Administrator/UAC prompt.

IMPORTANT: Do not give another computer http://127.0.0.1:8770.
127.0.0.1 always means the computer that is currently opening the browser.

OUTPUT / DOWNLOAD
-----------------
For any order:
- PDF download: fixed two-page A4 layout matching the supplied paper forms.
- Paper Form View: same form layout for browser print / Save as PDF.
- Excel: existing order workbook export is unchanged.

MASTER EXCEL
------------
The system continues to update:
   data\NUNES_MASTER.xlsx

GOOGLE DRIVE / GOOGLE SHEETS
----------------------------
The existing integration remains unchanged.
Use Integrations on the Task Board to configure the service-account JSON,
Spreadsheet ID, worksheet name and Drive folder ID.

DATA / BACKUP
-------------
Main database:
   data\nunes_forms.db

Back up the entire data folder regularly.
BACKUP_DATA_NOW.bat is included.

DEFAULT PORT
------------
8770

V1.0.4 EXACT PAPER / PDF LAYOUT UPDATE
- PDF Page 1 was rebuilt to follow the photographed Marketing / Dispatch / Payment / Supplier paper form line-for-line.
- PDF Page 2 was rebuilt to follow the photographed Accounts / Payment / Profile Margin paper form line-for-line.
- Table widths now stay inside the original paper border; no columns extend beyond the form.
- Customer payment Balance now uses the same separate balance box as the paper form.
- Accounts payment uses the original boxed header + three dotted writing rows + double balance underline.
- Profile Margin is compact like the original paper form instead of leaving a large blank box.
- Browser Paper Form View uses the same fixed A4 measurements and section positions as the PDF.
- No workflow, no-login Task Board, Excel, Drive, calculations, database, or server/client behavior was changed.


V1.0.5 STARTUP / PYVENV REPAIR
--------------------------------
- Fixed the Windows startup failure: "No pyvenv.cfg file".
- START_SERVER.bat now detects a copied, incomplete or corrupted .venv and rebuilds it automatically.
- It verifies that the private Python interpreter actually launches before installing packages.
- Packages are skipped on later starts when already installed, making startup faster.
- Added REPAIR_PYTHON_ENVIRONMENT.bat as a manual one-click repair helper.
- No form layout, PDF layout, Paper Form, workflow, database, Excel, Drive/Sheets, or Task Board behavior was changed.


V1.0.8 BRANCH REPORT / ORDER NUMBER UPDATE
-------------------------------------------
- Added three branch/company choices:
  1. Nunes Instrumentation Main (Rathinapuri)
  2. Gandhipuram
  3. Gopalapuram
- New records require a branch selection.
- Order IDs are generated automatically as BRANCH PREFIX + MONTH LETTER + SHARED RUNNING NUMBER.
- The number is one global first-come sequence shared by all three branches.
  Example: NMS1, NGS2, NGOS3, NMS4.
- The number never resets when the branch or month changes.
- Reports now have All / Main / Gandhipuram / Gopalapuram branch buttons.
- Selecting a branch shows only records created for that branch; All shows all records.
- Order ID and Branch are included in Reports, Task Board/Orders display, Master Excel, individual Excel and Google Sheets sync.
- Existing records are preserved and automatically assigned to Main when upgrading from V1.0.5 or older.
- The exact PDF and Paper Form layout from V1.0.5 is not changed.


FINAL ORDER ID RULE (V1.0.8)
------------------------------
Branches:
  1. Nunes Instrumentation - Rathinapuri (Main)
  2. Nunes Instrumentation - Gandhipuram
  3. Nunes Instrumentation - Gopalapuram

ID prefixes:
  Rathinapuri Main = NM
  Gandhipuram      = NG
  Gopalapuram      = NGO

Format: PREFIX + MONTH FIRST LETTER + ONE GLOBAL CONTINUOUS NUMBER
The numeric count is shared across all branches in first-created order.
September example: 1st Main = NMS1, 2nd Gandhipuram = NGS2, 3rd Gopalapuram = NGOS3, 4th Main = NMS4.
The sequence never resets when the branch or month changes.
Example: if the last September order in any branch is number 25, the first October order in whichever branch comes next uses number 26.
A fresh database creates no demo order, so the first real order starts at 1.

V1.0.8 update: Task Board branch selector and Complete Details report view added. Existing PDF/paper layout and order-ID logic are unchanged.


V1.0.9 GLOBAL ORDER NUMBER UPDATE
-----------------------------------
- Only the numeric Order ID sequence changed. All other workflow/UI/PDF/report behavior stays unchanged.
- Main, Gandhipuram and Gopalapuram now share ONE first-come running number.
- Branch prefix and month letter still identify the branch/month.
- Example in September: 1st Main = NMS1, 2nd Gandhipuram = NGS2, 3rd Gopalapuram = NGOS3, 4th Main = NMS4.
- The running number never resets when branch or month changes.
- Existing records are migrated once in original creation order so their numeric sequence is also global.
