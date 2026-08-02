import { ProvidersWorkbench } from "./providers-workbench";

export const metadata = { title: "Providers" };
export const dynamic = "force-dynamic";

export default function ProvidersPage() {
  return <ProvidersWorkbench />;
}
