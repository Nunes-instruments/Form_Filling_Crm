import { readUsbPhoneCaptureFile } from '@/lib/usb-phone';

export const runtime='nodejs';
export const dynamic='force-dynamic';

type Ctx={params:Promise<{id:string}>};

export async function GET(_request:Request,{params}:Ctx){
  const {id}=await params;
  const result=await readUsbPhoneCaptureFile(id);
  if(!result)return new Response('USB phone capture is not ready.',{status:404});
  const body=result.bytes.buffer.slice(result.bytes.byteOffset,result.bytes.byteOffset+result.bytes.byteLength) as ArrayBuffer;
  return new Response(body,{
    status:200,
    headers:{
      'Content-Type':result.session.mimeType||'image/jpeg',
      'Content-Disposition':`inline; filename="${result.session.fileName||'phone-capture.jpg'}"`,
      'Cache-Control':'no-store'
    }
  });
}
