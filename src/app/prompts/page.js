import { PromptsWorkbench } from "./prompts-workbench";

export const metadata = { title: "Prompts" };
export const dynamic = "force-dynamic";

export default function PromptsPage() {
  return <PromptsWorkbench />;
}
