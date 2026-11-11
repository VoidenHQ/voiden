import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { useGettingStartedStore } from "@/core/onboarding/gettingStartedStore";

export const Tip = ({
  children,
  label,
  side = "top",
  align = "start",
}: {
  children: ReactNode;
  label: ReactNode;
  side?: "top" | "bottom" | "right";
  align?: "start" | "center" | "end";
}) => {
  // A tour tip is already pointing at something: hover hints would stack on top of it.
  const tourTipOpen = useGettingStartedStore((s) => s.tipStep !== null);
  return (
    <Tooltip.Root disableHoverableContent open={tourTipOpen ? false : undefined}>
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
};
