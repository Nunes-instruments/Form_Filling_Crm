import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
const buttonVariants=cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30 disabled:pointer-events-none disabled:opacity-50",{variants:{variant:{default:"bg-blue-600 text-white hover:bg-blue-700",secondary:"border border-slate-200 bg-white text-slate-800 hover:bg-slate-50",ghost:"text-slate-600 hover:bg-slate-100 hover:text-slate-900",danger:"bg-red-600 text-white hover:bg-red-700"},size:{default:"h-10 px-4 py-2",sm:"h-8 rounded-lg px-3 text-xs",lg:"h-11 px-5 text-sm",icon:"h-10 w-10"}},defaultVariants:{variant:"default",size:"default"}});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>,VariantProps<typeof buttonVariants>{}
export const Button=React.forwardRef<HTMLButtonElement,ButtonProps>(({className,variant,size,...props},ref)=><button ref={ref} className={cn(buttonVariants({variant,size,className}))} {...props}/>);
Button.displayName="Button";
export {buttonVariants};
