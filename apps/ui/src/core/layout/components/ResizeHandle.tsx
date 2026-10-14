import { PanelResizeHandle } from "react-resizable-panels";
import { cn } from "@/core/lib/utils";

interface ResizeHandleProps {
  orientation: "horizontal" | "vertical";
  /** Called with true when the user starts dragging the handle and false when they let go. */
  onDragging?: (isDragging: boolean) => void;
}

export const ResizeHandle = ({ orientation, onDragging }: ResizeHandleProps) => {
  return (
    <PanelResizeHandle
      onDragging={onDragging}
      className={cn(
        "relative before:absolute before:left-1/2 before:-translate-x-1/2 before:bg-line z-10",
        "before:transition-all before:duration-150 before:ease-out",
        orientation === "horizontal"
          ? [
              "before:w-full before:h-[1px]",
              "before:hover:h-1 before:hover:bg-line",
              "before:data-[resize-handle-state=hover]:h-1 before:data-[resize-handle-state=hover]:bg-accent",
              "before:data-[resize-handle-state=drag]:h-1 before:data-[resize-handle-state=drag]:bg-accent",
            ]
          : [
              "before:w-[1px] before:h-full",
              "before:hover:w-1 before:hover:bg-line",
              "before:data-[resize-handle-state=hover]:w-1 before:data-[resize-handle-state=hover]:bg-accent",
              "before:data-[resize-handle-state=drag]:w-1 before:data-[resize-handle-state=drag]:bg-accent",
            ],
      )}
    ></PanelResizeHandle>
  );
};
