import * as React from "react";import {cn} from "@/lib/utils";
export function Badge({className,...props}:React.HTMLAttributes<HTMLSpanElement>){return <span className={cn("inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-600",className)} {...props}/>};
