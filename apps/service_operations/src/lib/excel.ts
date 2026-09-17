import ExcelJS from 'exceljs';
import type { ServiceJob } from '@/types/service-job';

export async function createJobExcel(job: ServiceJob) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Service Job Web App';
  const ws = wb.addWorksheet('Job Card');
  ws.columns = [{ width: 24 }, { width: 34 }, { width: 24 }, { width: 34 }];
  ws.addRow(['Service Job Card', job.jobNo, 'Date', job.jobDate]);
  ws.addRow(['Service Region', 'India', 'Status', job.status]);
  ws.addRow(['Office', job.officeType, 'Branch', job.branchName]);
  ws.addRow([]);
  ws.addRow(['Customer', job.customer.name, 'Contact Person', job.customer.contactPerson]);
  ws.addRow(['Phone', job.customer.phone, 'Email', job.customer.email]);
  ws.addRow(['Address', job.customer.address, 'City', job.customer.city]);
  ws.addRow(['State', job.customer.state, 'Country', 'India']);
  ws.addRow(['GSTIN', job.customer.gstin, 'Currency', 'INR']);
  ws.addRow([]);
  ws.addRow(['MR No', job.receipt.mrNo, 'MR Date', job.receipt.mrDate]);
  ws.addRow(['Receipt Mode', job.receipt.mode, 'Receipt Reference', job.receipt.reference]);
  ws.addRow([]);

  const products = wb.addWorksheet('Products');
  products.columns = [
    { header: 'Product Name', key: 'productName', width: 28 },
    { header: 'Make / Model', key: 'makeModel', width: 28 },
    { header: 'Serial No', key: 'serialNo', width: 20 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Product Status', key: 'status', width: 20 },
    { header: 'Complaint', key: 'complaint', width: 34 },
    { header: 'Repair Work', key: 'repairWork', width: 34 },
    { header: 'Confirmed Online Price', key: 'onlinePrice', width: 22 },
    { header: 'Online Price Confirmed', key: 'onlinePriceConfirmed', width: 22 },
    { header: 'Price Source', key: 'onlinePriceSource', width: 30 },
    { header: 'Price Checked At', key: 'onlinePriceCheckedAt', width: 24 },
    { header: 'Repair Category', key: 'repairCategory', width: 22 },
    { header: 'Repair %', key: 'repairPercent', width: 12 },
    { header: 'Repair Estimate', key: 'repairEstimate', width: 18 },
    { header: 'Estimate Status', key: 'estimateStatus', width: 22 }
  ];
  job.products.forEach((p) => products.addRow(p));

  const proof = wb.addWorksheet('Proof Attachments');
  proof.columns = [
    { header: 'Category', key: 'category', width: 22 },
    { header: 'Type', key: 'kind', width: 12 },
    { header: 'File Name', key: 'fileName', width: 46 },
    { header: 'Size Bytes', key: 'size', width: 16 },
    { header: 'Uploaded At', key: 'uploadedAt', width: 24 }
  ];
  job.attachments.forEach((a) => proof.addRow(a));

  ws.addRow(['Confirmed Product Value', job.totals.productValue, 'Repair Estimate', job.totals.repairEstimate]);
  ws.addRow(['Discount', job.totals.discount, 'Final Estimate', job.totals.totalEstimate]);
  ws.addRow([]);
  ws.addRow(['Tested By', job.dispatch.testedBy, 'DC No', job.dispatch.dcNo]);
  ws.addRow(['DC Date', job.dispatch.dcDate, 'Dispatch Mode', job.dispatch.mode]);
  ws.addRow(['Dispatch Reference', job.dispatch.reference, 'Invoice No', job.payment.invoiceNo]);
  ws.addRow(['Invoice Date', job.payment.invoiceDate, 'Payment Mode', job.payment.mode]);
  ws.addRow(['Payment Reference', job.payment.reference, 'Payment Received By', job.payment.receivedBy]);
  ws.addRow([]);
  ws.addRow(['Received By', job.signoff.receivedBy, 'Inspected By', job.signoff.inspectedBy]);
  ws.addRow(['Estimate Confirmed By', job.signoff.estimateConfirmedBy, 'Repaired By', job.signoff.repairedBy]);
  ws.addRow(['Notes', job.notes]);

  for (const sheet of wb.worksheets) {
    sheet.getRow(1).font = { bold: true, size: 12 };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  }
  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
