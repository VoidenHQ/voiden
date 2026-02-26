import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const Tip = ({ children, label }: { children: ReactNode; label: string }) => (
  <Tooltip.Root disableHoverableContent>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Content
      side="top"
      sideOffset={4}
      className="border bg-panel border-border px-2 py-1 text-xs z-50 text-comment rounded"
    >
      {label}
    </Tooltip.Content>
  </Tooltip.Root>
);
