# NUNES Operations Workspace V6.4.1 — Vercel-safe deployment

## Non-negotiable data rule

The Purchasing application stores live records in `apps/order_forms/data/nunes_forms.db` and the Servicing application stores jobs/settings/uploads under `apps/service_operations/data/`.

Those files are persistent business data. They must never be treated as Vercel deployment files. Vercel deployments are for application code; the production web app must read records from a persistent NUNES data service through `NUNES_API_INTERNAL_URL` (or `NUNES_API_URL`).

V6.4.1 therefore:

- keeps the existing local/cloud VM storage format unchanged, so existing records remain compatible;
- excludes database/data/secrets from Git and Vercel upload;
- refuses to silently use `localhost` as the data API when running on Vercel;
- exposes `data_backend_configured` in `/api/health` for deployment verification;
- supports GET/POST/PUT/PATCH/DELETE through the secure server-side data proxy;
- includes a Windows backup command before local/cloud upgrades;
- includes GitHub Actions production deployment so a push to `main` can update the same Vercel production project/domain.

## Vercel project settings

Use `platform_web` as the Root Directory. Set the production environment variable:

`NUNES_API_INTERNAL_URL=https://<persistent-data-api-host>`

Do not put Vercel tokens, database files, Gmail credentials, Gemini keys, OAuth refresh tokens, or WhatsApp session files in the repository.

## Same production link

Keep one Vercel project and its production domain/alias. New production deployments replace the code behind that production alias; the company records remain in the persistent data service and are not recreated by the deployment.

## Automatic code updates

Connect the repository to Vercel's Git integration, or use `.github/workflows/vercel-production.yml`. The workflow expects these GitHub repository secrets:

- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`

The token must be stored only as a secret. Never commit it to this ZIP/repository.

## Existing records

This uploaded source package contains placeholder data folders only (`.keep` / `.gitkeep`). It does not contain the office's real `nunes_forms.db`, `jobs.json`, settings, uploads, or WhatsApp session. Existing production records therefore cannot be migrated from this ZIP itself. Point Vercel at the already-running persistent NUNES data service, or migrate those live data files to that service first.

## Protected live data gateway

V6.4.1 cloud install/update generates `NUNES_DATA_API_TOKEN` and protects all company-data endpoints with bearer authentication. In HTTPS domain mode, the persistent backend exposes the data service under:

`https://<your-domain>/company-data`

The server writes the two Vercel environment values to `/root/NUNES_VERCEL_DATA_API_SECRET.txt` with root-only permissions. Copy those values into the Vercel project's encrypted Production environment variables; do not commit them.

## Automatic form/backend updates

`.github/workflows/nunes-persistent-backend.yml` can safely deploy Purchasing, Servicing, the data API, and cloud scripts to the persistent Linux backend. It explicitly excludes both live data directories before upload, then uses the existing safe updater which backs up/preserves those directories.

Required GitHub repository secrets:

- `NUNES_BACKEND_HOST`
- `NUNES_BACKEND_USER`
- `NUNES_BACKEND_SSH_KEY`

This gives the requested behavior: dashboard code can auto-update on Vercel; form/backend code can auto-update on the persistent server; both continue using the same live records and the same production entry URL.
