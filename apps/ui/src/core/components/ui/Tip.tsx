import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

export const Tip = ({
  children,
  label,
  side = "top",
  align = "start",
}: {
  children: ReactNode;
  label: ReactNode;
  side?: "top" | "bottom";
  align?: "start" | "center" | "end";
}) => (
  <Tooltip.Root disableHoverableContent>
    <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
    <Tooltip.Content
      side={side}
      align={align}
      sideOffset={4}
      alignOffset={4}
      className="border bg-panel border-border px-2 py-1 text-xs z-50 text-comment rounded"
    >
      {label}
    </Tooltip.Content>
  </Tooltip.Root>
);
