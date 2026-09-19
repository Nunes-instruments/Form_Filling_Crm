import { NextResponse } from 'next/server';
import { startUsbPhoneCapture } from '@/lib/usb-phone';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function POST(){
  try{
    const result=await startUsbPhoneCapture();
    return NextResponse.json(result,{status:result.ok?200:409});
  }catch(error){
    return NextResponse.json({
      ok:false,code:'USB_PHONE_START_FAILED',
      error:error instanceof Error?error.message:String(error)
    },{status:500});
  }
}
