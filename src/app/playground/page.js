import { PlaygroundWorkbench } from "./playground-workbench";

export const metadata = { title: "Playground" };
export const dynamic = "force-dynamic";

export default function PlaygroundPage() {
  return <PlaygroundWorkbench />;
}
