NUNES OPERATIONS WORKSPACE V6.4.2
================================

START ON WINDOWS
1. Extract this ZIP completely.
2. Double-click START_NUNES_COMPANY.bat.
3. The company workspace opens in the browser.
4. Forms -> Purchasing or Servicing opens the existing source workflow.

MAIN PLATFORM
- Dashboard: owner/management live view
- Forms: Purchasing + Servicing only
- Tasks: active/waiting/attention work queue
- Reports: centralized filters, source preserved
- Activity: real Purchasing audit + latest Servicing saved activity
- Team: names actually recorded by the source applications
- Settings: module registry + runtime status

DATA INTEGRITY
Purchasing and Servicing remain separate applications. V6 does not merge their business logic or compare them as one process. The files inside apps/order_forms and apps/service_operations are unchanged from V5.0.

CLOUD UPDATE
If an earlier NUNES cloud version is installed:
  sudo bash cloud/UPDATE_CLOUD_APP.sh
The updater preserves apps/order_forms/data and apps/service_operations/data.

NEW INSTALL
  sudo bash cloud/INSTALL_CLOUD_SERVER.sh

DEPENDENCIES
The platform uses Next.js 15, React 19, TypeScript, Tailwind CSS 4, local shadcn-style UI primitives, Lucide icons and Recharts. The installer runs npm install/build on the target machine.
