import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "@radix-ui/react-icons";

import { cn } from "@/core/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      // border-primary/bg-primary/text-primary-foreground are shadcn defaults
      // that were never wired up to this app's theme tokens (no --primary
      // exists in any theme), so the checked state rendered as an invisible
      // fill with a near-transparent checkmark. accent contrasts against
      // every theme's background by construction (each theme picks it for
      // that purpose) — but in cursor-dark, accent itself is a near-white
      // gray, so a translucent accent *fill* behind an accent checkmark read
      // as two near-identical pale tones stacked on each other. No fill: the
      // box stays transparent in both states, so the only contrast pair is
      // checkmark-vs-page-background, which every theme's accent guarantees.
      "peer h-4 w-4 shrink-0 rounded-sm border border-line shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-accent data-[state=checked]:text-accent",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <CheckIcon className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
