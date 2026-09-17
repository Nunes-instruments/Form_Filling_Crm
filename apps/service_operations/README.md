# ServiceFlow V1.1.30 — Gemini Vision Form Reader + Smart Suggestions

## V1.1.30 updates

- OpenCV alignment has a short timeout so a slow external script cannot hold the form reader for many seconds.
- Existing phone/date/price/checkbox validation is retained, and uncertain values remain for review instead of being guessed.
- Saved ServiceFlow data continues to power smart suggestions for customers, products, models, complaints, repair actions and staff fields.
- Existing Gmail OAuth, WhatsApp login, product lookup, blank-zero pricing and editable total behavior are retained.


ServiceFlow is the local Service Job Card application for Nunes Instrumentation Service.

## Start
1. Extract this ZIP into a new folder.
2. Run `START_SERVICE_JOB_APP.bat`.
3. Open `http://127.0.0.1:5055` if the browser does not open automatically.

## Gmail — Google login only
SMTP and Gmail App Password authentication remain removed. Gmail uses Google OAuth only.

One-time setup:
1. Enable Gmail API in a Google Cloud project.
2. Configure the Google Auth Platform / consent screen. If the app is in Testing, add the Gmail sender account as a test user.
3. Create an OAuth Client ID with application type **Desktop app**.
4. Download the OAuth client JSON.
5. In ServiceFlow open **Settings → Google Gmail Connection**.
6. Upload the downloaded OAuth client JSON.
7. Click **Sign in with Google**, select the Gmail account that will send customer mail, and approve the requested Gmail send permission.
8. ServiceFlow returns to Settings and shows the connected Gmail account.

ServiceFlow requests `openid`, `email`, and `https://www.googleapis.com/auth/gmail.send`. The refresh token is stored locally in `data/settings.json`; SMTP passwords are not used.

The local OAuth callback is `http://127.0.0.1:5055`. Perform the Google sign-in on the ServiceFlow server PC.

## WhatsApp
WhatsApp uses a persistent WhatsApp Web browser profile on the owner/server PC. Open **Settings → WhatsApp Web Login** and click **Open WhatsApp Web Login** once. Complete the normal login in WhatsApp's official page (scan its page QR or use **Link with phone number**), then NUNES saves that browser session and reconnects silently on future starts. If the session needs to be recreated, use `RESET_WHATSAPP_LOGIN.bat` or **Disconnect / Relink** in Settings.

## Automatic customer delivery
After **Save & Preview**, Email and WhatsApp are attempted independently. A missing email, missing WhatsApp number, or an unregistered WhatsApp number does not block the job from being saved.

Customer Gmail now uses the approved Nunes branded billing format with the supplied header/footer banners. The dynamic billing table includes:
- Customer name
- Date / Service No
- Product Name
- Qty
- Repair / Problem
- Product Value
- Repair Cost
- Line Total
- Grand Total

WhatsApp remains the compact text format.

## Product lookup
Product Name + Make/Model triggers the strict online product lookup. IndiaMART is prioritized, then verified web fallbacks are used. The exact matched online listing price populates **Current Market Price Used (INR)** and the selected repair margin recalculates automatically.

## Handwritten Service Form import
**Upload Service Form** now uses Gemini Vision only. The selected image/PDF is read once by Gemini, returned as structured fields, validated locally, and filled into the existing service form for staff review before Save & Preview.

## Reports
The dashboard supports branch, company/customer, status, and date filtering, with Excel and PDF master exports.

## Local data
Service records, OAuth credentials/tokens, and settings stay in the local `data` folder. Back up that folder and keep it private.


## Branded Gmail images
The exact supplied Nunes company graphics are stored in `assets/email/nunes-header.png` and `assets/email/nunes-footer.png`. They are embedded into Gmail as inline CID images, so no external image hosting is required.
