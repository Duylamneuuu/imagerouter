import { ActivityWorkbench } from "./activity-workbench";

export const metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

export default function ActivityPage() {
  return <ActivityWorkbench />;
}
