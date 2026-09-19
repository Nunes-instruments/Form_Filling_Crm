import { NextResponse } from 'next/server';
import { getUsbPhoneStatus } from '@/lib/usb-phone';

export const runtime='nodejs';
export const dynamic='force-dynamic';

export async function GET(){
  const status=await getUsbPhoneStatus();
  return NextResponse.json(status,{status:status.adbInstalled?200:503});
}
