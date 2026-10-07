import type { ExtensionWidgetItem } from "@/lib/types";
import type { ExtensionWidgetPresentation } from "@/lib/extension-widget-model";
import { decodeSubagentAsyncWidget } from "./subagent-async";

type WidgetAdapter = (
  widget: ExtensionWidgetItem,
) => ExtensionWidgetPresentation | null;

const adapters: WidgetAdapter[] = [
  (widget) => {
    const model = decodeSubagentAsyncWidget(widget);
    return model ? { kind: "task-tree", model } : null;
  },
];

export function resolveExtensionWidgetPresentation(
  widget: ExtensionWidgetItem,
): ExtensionWidgetPresentation {
  for (const adapter of adapters) {
    const presentation = adapter(widget);
    if (presentation) return presentation;
  }
  return { kind: "text" };
}
