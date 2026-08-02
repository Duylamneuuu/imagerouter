import { RoutingWorkbench } from "./routing-workbench";

export const metadata = { title: "Routing" };
export const dynamic = "force-dynamic";

export default function RoutingPage() {
  return <RoutingWorkbench />;
}
