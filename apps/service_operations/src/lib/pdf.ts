import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { ServiceJob } from '@/types/service-job';

const A4: [number, number] = [595.28, 841.89];
const ink = rgb(0.28, 0.30, 0.34);
const lineColor = rgb(0.16, 0.34, 0.58);
const headingFill = rgb(0.08, 0.31, 0.62);

function safe(value: unknown) {
  return String(value ?? '').replace(/[^\x20-\x7E]/g, '?').replace(/\s+/g, ' ').trim();
}

function clip(value: unknown, max: number) {
  const s = safe(value);
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 3))}...`;
}

function pretty(value: string) {
  return safe(value).replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function date(value: string) {
  const parts = String(value || '').split('-');
  return parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : safe(value);
}

function money(value: number, currency: string) {
  return `${safe(currency)} ${Number(value || 0).toFixed(2)}`.trim();
}

function drawText(page: PDFPage, font: PDFFont, bold: PDFFont, value: unknown, x: number, y: number, size = 8.2, isBold = false, max?: number) {
  const s = max ? clip(value, max) : safe(value);
  if (!s) return;
  page.drawText(s, { x, y, size, font: isBold ? bold : font, color: ink });
}

function drawSectionTitle(page: PDFPage, bold: PDFFont, title: string, x: number, y: number, width: number) {
  page.drawRectangle({ x, y, width, height: 18, color: headingFill });
  page.drawText(title, { x: x + 6, y: y + 4.2, size: 9.4, font: bold, color: rgb(0.96, 0.96, 0.97) });
}

function drawCheck(page: PDFPage, font: PDFFont, x: number, y: number, checked: boolean) {
  page.drawRectangle({ x, y, width: 16, height: 14, borderWidth: 0.9, borderColor: lineColor });
  if (checked) page.drawText('X', { x: x + 4, y: y + 2.2, size: 8.2, font, color: ink });
}

function field(page: PDFPage, font: PDFFont, bold: PDFFont, label: string, value: unknown, x: number, y: number, width: number, labelWidth: number, max = 42) {
  drawText(page, font, bold, label, x, y, 7.8, true);
  const vx = x + labelWidth;
  page.drawLine({ start: { x: vx, y: y - 1.5 }, end: { x: x + width, y: y - 1.5 }, thickness: 0.55, color: lineColor });
  drawText(page, font, bold, value, vx + 2, y + 0.8, 7.8, false, max);
}

function cellText(page: PDFPage, font: PDFFont, bold: PDFFont, value: unknown, x: number, y: number, width: number, size = 6.8, isBold = false, centered = false, max = 35) {
  const s = clip(value, max);
  if (!s) return;
  let tx = x + 3;
  if (centered) {
    const tw = (isBold ? bold : font).widthOfTextAtSize(s, size);
    tx = x + Math.max(2, (width - tw) / 2);
  }
  page.drawText(s, { x: tx, y, size, font: isBold ? bold : font, color: ink });
}

export async function createJobPdf(job: ServiceJob, _companyName: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const page = pdf.addPage(A4);
  pdf.setTitle(`Service Job Card ${job.jobNo}`);
  pdf.setSubject(`Enquiry branch: ${safe(job.branchName)} | India service | Status: ${safe(job.status)}`);
  pdf.setKeywords(['service job card', safe(job.branchName), 'India service', safe(job.status)]);

  const left = 44;
  const right = 551;
  const width = right - left;

  // Top identity area
  drawText(page, font, bold, 'S.NO:', left + 4, 796, 8.5, true);
  drawText(page, font, bold, job.legacySerialNo || job.jobNo, left + 42, 794.5, 12, true, 20);

  page.drawRectangle({ x: 230, y: 782, width: 145, height: 25, color: headingFill });
  page.drawText('SERVICE JOB CARD', { x: 242, y: 789, size: 11.4, font: bold, color: rgb(0.97, 0.97, 0.98) });
  field(page, font, bold, 'Date:', date(job.jobDate), 435, 795, 112, 27, 18);

  drawText(page, font, bold, 'Head Office', 385, 767, 7.8, true);
  drawCheck(page, font, 432, 762, job.officeType === 'HEAD_OFFICE');
  drawText(page, font, bold, 'Branch Office', 457, 767, 7.8, true);
  drawCheck(page, font, 526, 762, job.officeType === 'BRANCH_OFFICE');
  // Customer details
  drawSectionTitle(page, bold, 'Customer Details', left + 4, 716, 100);
  field(page, font, bold, 'Name:', job.customer.name, left + 4, 688, 168, 32, 34);
  field(page, font, bold, 'Phone:', job.customer.phone, left + 176, 688, 166, 36, 25);
  field(page, font, bold, 'City:', job.customer.city, left + 346, 688, 157, 24, 22);
  field(page, font, bold, 'Address:', job.customer.address, left + 4, 663, 499, 42, 92);
  field(page, font, bold, 'Email:', job.customer.email, left + 4, 638, 330, 32, 55);

  // Receipt details
  drawSectionTitle(page, bold, 'Receipt Details', left + 4, 604, 100);
  field(page, font, bold, 'MR.NO:', job.receipt.mrNo, left + 4, 577, 194, 38, 30);
  field(page, font, bold, 'MR. Date:', date(job.receipt.mrDate), left + 203, 577, 155, 48, 20);
  drawText(page, font, bold, 'Mode of Receipt', 385, 577, 7.5, true);
  drawCheck(page, font, 474, 570, job.receipt.mode === 'COURIER');
  drawText(page, font, bold, 'Courier', 492, 575, 7.3);
  drawCheck(page, font, 525, 570, job.receipt.mode === 'DIRECT');
  drawText(page, font, bold, 'Direct', 543, 575, 7.3);
  field(page, font, bold, 'Receipt Reference:', job.receipt.reference, left + 4, 551, 334, 91, 44);

  // Product details title
  drawSectionTitle(page, bold, 'Product Details', left + 4, 517, 95);

  // Product table
  const tableTop = 500;
  const rowH = 27;
  const headerH = 34;
  const cols = [left, left + 202, left + 232, left + 330, left + 418, right];
  const tableBottom = tableTop - headerH - (rowH * 4);
  for (let i = 0; i < cols.length; i++) {
    page.drawLine({ start: { x: cols[i], y: tableTop }, end: { x: cols[i], y: tableBottom }, thickness: 0.75, color: lineColor });
  }
  page.drawLine({ start: { x: left, y: tableTop }, end: { x: right, y: tableTop }, thickness: 0.75, color: lineColor });
  page.drawLine({ start: { x: left, y: tableTop - headerH }, end: { x: right, y: tableTop - headerH }, thickness: 0.75, color: lineColor });
  for (let r = 1; r <= 4; r++) {
    const yy = tableTop - headerH - (r * rowH);
    page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.65, color: lineColor });
  }

  cellText(page, font, bold, 'Product Name & Make/ Model/ Sl.No', cols[0], 477, cols[1] - cols[0], 7.2, true, true, 42);
  cellText(page, font, bold, 'Qty', cols[1], 477, cols[2] - cols[1], 7.2, true, true, 6);
  cellText(page, font, bold, 'Repair', cols[2], 477, cols[3] - cols[2], 7.2, true, true, 15);
  cellText(page, font, bold, 'Product Value', cols[3], 482, cols[4] - cols[3], 6.8, true, true, 16);
  cellText(page, font, bold, '(incl.of GST)', cols[3], 471, cols[4] - cols[3], 6.2, true, true, 14);
  cellText(page, font, bold, 'Repair Cost', cols[4], 482, cols[5] - cols[4], 6.8, true, true, 16);
  cellText(page, font, bold, 'Estimate', cols[4], 471, cols[5] - cols[4], 6.2, true, true, 12);

  const products = job.products.slice(0, 4);
  products.forEach((p, i) => {
    const cy = tableTop - headerH - (i * rowH) - 16;
    const pLabel = [p.productName, p.makeModel, p.serialNo].filter(Boolean).join(' / ');
    cellText(page, font, bold, pLabel, cols[0], cy, cols[1] - cols[0], 6.6, false, false, 44);
    cellText(page, font, bold, p.qty, cols[1], cy, cols[2] - cols[1], 7, false, true, 4);
    const repair = p.repairWork || p.complaint || '';
    cellText(page, font, bold, repair, cols[2], cy, cols[3] - cols[2], 6.0, false, false, 31);
    cellText(page, font, bold, money(Number(p.productValue || 0) * Number(p.qty || 0), job.customer.currency), cols[3], cy, cols[4] - cols[3], 5.8, false, false, 16);
    cellText(page, font, bold, money(Number(p.repairEstimate || 0) * Number(p.qty || 0), job.customer.currency), cols[4], cy, cols[5] - cols[4], 5.8, false, false, 16);
  });

  // Totals aligned to right, as in the paper card
  const totalsX = cols[3];
  const totalsW = right - totalsX;
  const totalRowH = 25;
  const totalsTop = tableBottom;
  const split = totalsX + 88;
  page.drawLine({ start: { x: totalsX, y: totalsTop }, end: { x: right, y: totalsTop }, thickness: 0.75, color: lineColor });
  page.drawLine({ start: { x: totalsX, y: totalsTop - totalRowH * 3 }, end: { x: right, y: totalsTop - totalRowH * 3 }, thickness: 0.75, color: lineColor });
  page.drawLine({ start: { x: totalsX, y: totalsTop }, end: { x: totalsX, y: totalsTop - totalRowH * 3 }, thickness: 0.75, color: lineColor });
  page.drawLine({ start: { x: split, y: totalsTop }, end: { x: split, y: totalsTop - totalRowH * 3 }, thickness: 0.75, color: lineColor });
  page.drawLine({ start: { x: right, y: totalsTop }, end: { x: right, y: totalsTop - totalRowH * 3 }, thickness: 0.75, color: lineColor });
  page.drawLine({ start: { x: totalsX, y: totalsTop - totalRowH }, end: { x: right, y: totalsTop - totalRowH }, thickness: 0.65, color: lineColor });
  page.drawLine({ start: { x: totalsX, y: totalsTop - totalRowH * 2 }, end: { x: right, y: totalsTop - totalRowH * 2 }, thickness: 0.65, color: lineColor });
  const repairTotal = Number(job.totals.repairEstimate || 0);
  const discount = Number(job.totals.discount || 0);
  const finalTotal = Number(job.totals.totalEstimate || Math.max(0, repairTotal - discount));
  cellText(page, font, bold, 'Total', totalsX, totalsTop - 17, 88, 7.6, true, false, 14);
  cellText(page, font, bold, money(repairTotal, job.customer.currency), split, totalsTop - 17, totalsW - 88, 6.5, false, false, 18);
  cellText(page, font, bold, 'Discount', totalsX, totalsTop - 42, 88, 7.6, true, false, 14);
  cellText(page, font, bold, money(discount, job.customer.currency), split, totalsTop - 42, totalsW - 88, 6.5, false, false, 18);
  cellText(page, font, bold, 'Total Estimate', totalsX, totalsTop - 67, 88, 7.3, true, false, 18);
  cellText(page, font, bold, money(finalTotal, job.customer.currency), split, totalsTop - 67, totalsW - 88, 6.5, false, false, 18);

  // Dispatch + payment sections
  const lowerTitleY = tableBottom - 38;
  drawSectionTitle(page, bold, 'Dispatch Details', left + 4, lowerTitleY, 93);
  drawSectionTitle(page, bold, 'Payment Details', left + 214, lowerTitleY, 94);

  const dispatchX = left;
  const dispatchYTop = lowerTitleY - 15;
  const dispatchW = 170;
  const dispatchLabelW = 96;
  const dispatchRows = [
    ['Tested by', job.dispatch.testedBy],
    ['DC.NO', job.dispatch.dcNo],
    ['DC.Date', date(job.dispatch.dcDate)],
    ['Mode of Despatch', job.dispatch.mode],
    ['Despatch Reference', job.dispatch.reference],
  ];
  for (let r = 0; r <= dispatchRows.length; r++) {
    const yy = dispatchYTop - (r * 25);
    page.drawLine({ start: { x: dispatchX, y: yy }, end: { x: dispatchX + dispatchW, y: yy }, thickness: 0.65, color: lineColor });
  }
  page.drawLine({ start: { x: dispatchX, y: dispatchYTop }, end: { x: dispatchX, y: dispatchYTop - 125 }, thickness: 0.65, color: lineColor });
  page.drawLine({ start: { x: dispatchX + dispatchLabelW, y: dispatchYTop }, end: { x: dispatchX + dispatchLabelW, y: dispatchYTop - 125 }, thickness: 0.65, color: lineColor });
  page.drawLine({ start: { x: dispatchX + dispatchW, y: dispatchYTop }, end: { x: dispatchX + dispatchW, y: dispatchYTop - 125 }, thickness: 0.65, color: lineColor });
  dispatchRows.forEach(([lab, val], i) => {
    const yy = dispatchYTop - (i * 25) - 16;
    cellText(page, font, bold, lab, dispatchX, yy, dispatchLabelW, 7.2, true, false, 22);
    cellText(page, font, bold, val, dispatchX + dispatchLabelW, yy, dispatchW - dispatchLabelW, 6.8, false, false, 18);
  });

  const payX = left + 214;
  field(page, font, bold, 'Invoice NO:', job.payment.invoiceNo, payX, lowerTitleY - 26, 180, 61, 25);
  field(page, font, bold, 'Invoice Date:', date(job.payment.invoiceDate), payX, lowerTitleY - 55, 180, 67, 20);
  field(page, font, bold, 'Payment Mode:', job.payment.mode, payX, lowerTitleY - 84, 218, 76, 30);
  field(page, font, bold, 'Payment Reference:', job.payment.reference, payX, lowerTitleY - 113, 218, 93, 30);
  field(page, font, bold, 'Payment Received by:', job.payment.receivedBy, payX, lowerTitleY - 142, 218, 109, 26);

  // Signature area
  const sigX = left;
  const sigY = 35;
  const sigW = width;
  const sigH = 98;
  page.drawRectangle({ x: sigX, y: sigY, width: sigW, height: sigH, borderWidth: 1.4, borderColor: lineColor });
  const each = sigW / 4;
  for (let i = 1; i < 4; i++) page.drawLine({ start: { x: sigX + each * i, y: sigY }, end: { x: sigX + each * i, y: sigY + sigH }, thickness: 1.1, color: lineColor });
  const sigLabels = ['Received by', 'Inspected by', 'Estimate Confirmed by', 'Repaired by'];
  const sigValues = [job.signoff.receivedBy, job.signoff.inspectedBy, job.signoff.estimateConfirmedBy, job.signoff.repairedBy];
  sigLabels.forEach((lab, i) => {
    const sx = sigX + each * i;
    cellText(page, font, bold, sigValues[i], sx, sigY + sigH - 16, each, 6.4, false, true, 22);
    cellText(page, font, bold, lab, sx, sigY + 12, each, 8.2, true, true, 24);
  });

  return Buffer.from(await pdf.save());
}
