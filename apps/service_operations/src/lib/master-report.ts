import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { ServiceJob } from '@/types/service-job';

function money(value: number) { return Number(value || 0).toFixed(2); }
function safe(value: unknown) { return String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim(); }
function delivery(job: ServiceJob, channel: 'email'|'whatsapp') {
  const value = channel === 'email' ? job.communication?.emailStatus : job.communication?.whatsappStatus;
  return safe(value || 'NOT SENT').replaceAll('_',' ');
}

export type MasterRow = {
  jobNo:string; jobDate:string; branch:string; company:string; contact:string; phone:string; email:string;
  product:string; model:string; serialNo:string; qty:number; problem:string; jobStatus:string; productStatus:string;
  marketPrice:number; source:string; margin:number; repairingCost:number; totalCost:number; emailStatus:string; whatsappStatus:string;
};

export function masterRows(jobs: ServiceJob[]): MasterRow[] {
  return jobs.flatMap(job => job.products.map(product => ({
    jobNo:job.jobNo,
    jobDate:job.jobDate,
    branch:job.branchName,
    company:job.customer.name,
    contact:job.customer.contactPerson,
    phone:job.customer.phone,
    email:job.customer.email,
    product:product.productName,
    model:product.makeModel,
    serialNo:product.serialNo,
    qty:Number(product.qty || 0),
    problem:product.complaint || product.repairWork,
    jobStatus:job.status,
    productStatus:product.status,
    marketPrice:Number(product.onlinePrice || product.productValue || 0),
    source:product.onlineProductUrl || product.onlinePriceSource || '',
    margin:Number(product.repairPercent || 0),
    repairingCost:Number(product.repairEstimate || 0) * Number(product.qty || 0),
    totalCost:Number(job.totals.totalEstimate || 0),
    emailStatus:delivery(job,'email'),
    whatsappStatus:delivery(job,'whatsapp')
  })));
}

export async function createMasterExcel(jobs: ServiceJob[], reportTitle: string) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'ServiceFlow';
  wb.created = new Date();
  const ws = wb.addWorksheet('Master Data', { views:[{ state:'frozen', ySplit:3 }] });
  ws.mergeCells('A1:V1');
  ws.getCell('A1').value = reportTitle;
  ws.getCell('A1').font = { bold:true, size:16 };
  ws.getCell('A1').alignment = { vertical:'middle', horizontal:'left' };
  ws.getRow(1).height = 26;
  ws.mergeCells('A2:V2');
  ws.getCell('A2').value = `Generated: ${new Date().toLocaleString('en-IN')} | Records: ${jobs.length} jobs / ${masterRows(jobs).length} product rows`;
  ws.getCell('A2').font = { italic:true, size:10 };

  const headers = ['Job No','Date','Branch','Company / Customer','Contact Person','Phone','Email','Product','Make / Model','Serial No','Qty','Problem','Job Status','Product Status','Market Price (INR)','Price Source','Repair Margin %','Repairing Cost (INR)','Job Total (INR)','Email Status','WhatsApp Status','Last Updated'];
  ws.addRow(headers);
  const header = ws.getRow(3);
  header.font = { bold:true };
  header.alignment = { vertical:'middle', horizontal:'center', wrapText:true };
  header.height = 32;

  for (const job of jobs) {
    for (const p of job.products) {
      ws.addRow([
        job.jobNo, job.jobDate, job.branchName, job.customer.name, job.customer.contactPerson, job.customer.phone, job.customer.email,
        p.productName, p.makeModel, p.serialNo, Number(p.qty || 0), p.complaint || p.repairWork, job.status, p.status,
        Number(p.onlinePrice || p.productValue || 0), p.onlineProductUrl || p.onlinePriceSource || '', Number(p.repairPercent || 0),
        Number(p.repairEstimate || 0) * Number(p.qty || 0), Number(job.totals.totalEstimate || 0), delivery(job,'email'), delivery(job,'whatsapp'), job.updatedAt
      ]);
    }
  }
  ws.autoFilter = { from:{row:3,column:1}, to:{row:Math.max(3,ws.rowCount),column:22} };
  const widths = [18,13,18,26,20,16,28,26,22,18,8,34,18,18,18,42,16,20,18,16,18,22];
  widths.forEach((width,i)=>ws.getColumn(i+1).width=width);
  ws.getColumn(15).numFmt = '#,##0.00';
  ws.getColumn(17).numFmt = '0.00';
  ws.getColumn(18).numFmt = '#,##0.00';
  ws.getColumn(19).numFmt = '#,##0.00';
  ws.eachRow((row, rowNumber) => {
    row.alignment = { vertical:'top', wrapText:true };
    if (rowNumber >= 4) row.height = 30;
    row.eachCell(cell => { cell.border = { bottom:{ style:'hair' } }; });
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function clip(text:string, max:number) { const v=safe(text).replace(/[^\x20-\x7E]/g, '?'); return v.length > max ? `${v.slice(0,Math.max(1,max-3))}...` : v; }

export async function createMasterPdf(jobs: ServiceJob[], reportTitle: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const rows = masterRows(jobs);
  const width = 841.89, height = 595.28; // A4 landscape
  const margin = 22;
  const columns = [
    ['Job',68],['Date',58],['Branch',72],['Company',105],['Product / Model',125],['Market INR',65],['Margin',45],['Repair INR',65],['Email',55],['WhatsApp',60]
  ] as const;
  const rowHeight = 24;
  const headerHeight = 28;
  const titleHeight = 42;

  const addPage = () => {
    const page = pdf.addPage([width,height]);
    page.drawText(clip(reportTitle,100), { x:margin, y:height-margin-12, size:14, font:bold });
    page.drawText(`Generated ${new Date().toLocaleString('en-IN')} | ${jobs.length} jobs | ${rows.length} product rows`, { x:margin, y:height-margin-28, size:8, font });
    let x=margin; const y=height-margin-titleHeight-headerHeight;
    for (const [name,w] of columns) {
      page.drawRectangle({ x, y, width:w, height:headerHeight, color:rgb(0.93,0.93,0.93), borderColor:rgb(0.7,0.7,0.7), borderWidth:0.5 });
      page.drawText(name, { x:x+3, y:y+10, size:7.5, font:bold }); x += w;
    }
    return { page, y:y-rowHeight };
  };

  let { page, y } = addPage();
  for (const r of rows) {
    if (y < margin + 8) ({ page, y } = addPage());
    const values = [
      clip(r.jobNo,15), clip(r.jobDate,10), clip(r.branch,14), clip(r.company,23), clip(`${r.product}${r.model ? ` / ${r.model}`:''}`,28),
      money(r.marketPrice), `${money(r.margin)}%`, money(r.repairingCost), clip(r.emailStatus,12), clip(r.whatsappStatus,14)
    ];
    let x=margin;
    values.forEach((value,i)=>{
      const w=columns[i][1];
      page.drawRectangle({ x, y, width:w, height:rowHeight, borderColor:rgb(0.82,0.82,0.82), borderWidth:0.4 });
      page.drawText(value, { x:x+3, y:y+8, size:6.7, font, maxWidth:w-6 }); x+=w;
    });
    y -= rowHeight;
  }
  if (!rows.length) page.drawText('No records match the selected filters.', { x:margin, y:height/2, size:12, font });
  return Buffer.from(await pdf.save());
}
