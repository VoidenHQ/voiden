import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { cn } from "@/core/lib/utils";

/**
 * Animated open/close for the Source Control sections. Nothing animates on
 * first render (initial={false}), so opening the panel stays instant; only a
 * click on a section header plays the short slide.
 */
export const Collapse = ({ open, children, className }: { open: boolean; children: ReactNode; className?: string }) => (
  <AnimatePresence initial={false}>
    {open && (
      <motion.div
        key="content"
        initial={{ height: 0, opacity: 0 }}
        animate={{ height: "auto", opacity: 1 }}
        exit={{ height: 0, opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className={cn("overflow-hidden", className)}
      >
        {children}
      </motion.div>
    )}
  </AnimatePresence>
);

/** Section chevron that turns instead of swapping icons. */
export const SectionChevron = ({ open }: { open: boolean }) => (
  <ChevronRight size={11} className={cn("text-comment transition-transform duration-200", open && "rotate-90")} />
);
