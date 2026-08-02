import { SettingsWorkbench } from "./settings-workbench";

export const metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

export default function SettingsPage() {
  return <SettingsWorkbench />;
}
