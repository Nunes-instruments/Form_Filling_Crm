import { NextResponse } from 'next/server';
import { completeUsbPhoneSession } from '@/lib/usb-phone';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(request:Request){
  try{
    const form=await request.formData();
    const session=String(form.get('session')||'').trim();
    const file=form.get('file');
    if(!session)return NextResponse.json({error:'USB phone session is missing.'},{status:400});
    if(!(file instanceof File))return NextResponse.json({error:'Captured phone photo is missing.'},{status:400});
    const updated=await completeUsbPhoneSession(session,file);
    return NextResponse.json({ok:true,session:updated});
  }catch(error){
    return NextResponse.json({error:error instanceof Error?error.message:String(error)},{status:400});
  }
}
