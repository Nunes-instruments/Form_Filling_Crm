import { notFound } from "next/navigation";
import ModuleWorkspace from "@/components/ModuleWorkspace";
export default async function Page({params}:{params:Promise<{module:string}>}){const {module}=await params;if(module!=="purchasing"&&module!=="servicing")notFound();return <ModuleWorkspace kind={module as "purchasing"|"servicing"}/>}
