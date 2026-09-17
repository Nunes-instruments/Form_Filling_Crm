import "./globals.css";
import Shell from "@/components/Shell";
import ModulePrewarmer from "@/components/ModulePrewarmer";
import AutoRolloutRefresh from "@/components/AutoRolloutRefresh";

export const metadata={title:"NUNES Operations Workspace",description:"NUNES company dashboard, forms, tasks, reports, activity and team operations"};

export default function RootLayout({children}:{children:React.ReactNode}){
 const cloud=Boolean(process.env.VERCEL);
 return <html lang="en"><body><AutoRolloutRefresh/>{cloud?null:<ModulePrewarmer/>}<Shell>{children}</Shell></body></html>
}
