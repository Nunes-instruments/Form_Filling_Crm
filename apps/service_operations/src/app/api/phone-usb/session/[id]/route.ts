import { NextResponse } from 'next/server';
import { readUsbPhoneSession } from '@/lib/usb-phone';

export const runtime='nodejs';
export const dynamic='force-dynamic';

type Ctx={params:Promise<{id:string}>};

export async function GET(_request:Request,{params}:Ctx){
  const {id}=await params;
  const session=await readUsbPhoneSession(id);
  if(!session)return NextResponse.json({error:'USB phone capture session not found.'},{status:404});
  return NextResponse.json({
    ...session,
    ready:session.status==='ready',
    fileUrl:session.status==='ready'?`/api/phone-usb/session/${encodeURIComponent(id)}/file`:''
  });
}
