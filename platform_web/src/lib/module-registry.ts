export type ModuleDefinition = {
  id: "purchasing" | "servicing";
  engineKey: "order_forms" | "service_operations";
  name: string;
  shortName: string;
  description: string;
  route: string;
  statusRoute: string;
  permissions: string[];
  dashboardMetrics: string[];
  workflow: string[];
  reports: string[];
  statusOptions: string[];
  navigationVisibility: "forms";
};

export const MODULE_REGISTRY: ModuleDefinition[] = [
  {
    id: "purchasing", engineKey: "order_forms", name: "Purchasing", shortName: "Purchase",
    description: "Orders, purchasing, dispatch, payment, suppliers, accounts and final approval.",
    route: "/forms/purchasing", statusRoute: "/tasks?source=purchasing", permissions: ["Marketing","Dispatch","Payment","Supplier","Accounts","Approver","Admin"],
    dashboardMetrics: ["Active orders","Waiting stages","Completed orders","Order value","Outstanding","Pipeline"],
    workflow: ["Marketing","Dispatch","Payment","Supplier","Accounts","Final Approval"],
    reports: ["Order report","Paper form","PDF","Excel"], statusOptions: ["Draft","In Progress","Waiting","Completed"], navigationVisibility: "forms"
  },
  {
    id: "servicing", engineKey: "service_operations", name: "Servicing", shortName: "Service",
    description: "Service jobs, AI form intake, inspection, estimate, repair, testing, payment and delivery.",
    route: "/forms/servicing", statusRoute: "/tasks?source=servicing", permissions: ["Service","Technician","Accounts","Admin"],
    dashboardMetrics: ["Open jobs","Waiting jobs","Ready jobs","Completed jobs","Estimate value","Status distribution"],
    workflow: ["Receive","Inspection","Estimate","Approval","Repair","Testing / Ready","Dispatch","Completed"],
    reports: ["Service report","PDF","Excel","Job ZIP"], statusOptions: ["DRAFT","RECEIVED","ESTIMATE_PENDING","APPROVAL_PENDING","REPAIRING","READY","DISPATCHED","CLOSED"], navigationVisibility: "forms"
  }
];
