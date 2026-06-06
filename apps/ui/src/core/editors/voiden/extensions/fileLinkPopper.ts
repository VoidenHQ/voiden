/** Viewport padding used by the file-link suggestion popper. */
export const FILE_LINK_POPPER_PADDING = 8;

/**
 * Compute max popper height so the menu (including the pinned "Add new file"
 * button) stays within the viewport for the active placement.
 */
export function computeFileLinkPopperMaxHeight(
  placement: string,
  referenceTop: number,
  referenceHeight: number,
  viewportHeight: number,
  padding = FILE_LINK_POPPER_PADDING,
): number | undefined {
  const side = placement.split("-")[0];
  if (side === "bottom") {
    const maxH = viewportHeight - referenceTop - referenceHeight - padding;
    return maxH > 0 ? maxH : undefined;
  }
  if (side === "top") {
    const maxH = referenceTop - padding;
    return maxH > 0 ? maxH : undefined;
  }
  // right / left: popper top aligns with reference top
  if (side === "right" || side === "left") {
    const maxH = viewportHeight - referenceTop - padding;
    return maxH > 0 ? maxH : undefined;
  }
  return undefined;
}

/** Popper modifier: constrain popper height to available viewport space. */
export function fileLinkConstrainHeightModifierFn({
  state,
}: {
  state: {
    placement: string;
    rects: { reference: { y: number; height: number } };
    elements: { popper: HTMLElement };
  };
}) {
  const maxH = computeFileLinkPopperMaxHeight(
    state.placement,
    state.rects.reference.y,
    state.rects.reference.height,
    window.innerHeight,
  );
  if (maxH !== undefined) {
    state.elements.popper.style.maxHeight = `${maxH}px`;
    state.elements.popper.style.setProperty("--popper-max-height", `${maxH}px`);
  }
}

/**
 * Scroll a list container so the selected item stays visible.
 * Uses getBoundingClientRect so nested editor scroll offsets are handled.
 */
export function scrollSelectedItemIntoView(
  container: HTMLElement,
  item: HTMLElement,
): void {
  const itemRect = item.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  if (itemRect.bottom > containerRect.bottom) {
    container.scrollTop += itemRect.bottom - containerRect.bottom;
  } else if (itemRect.top < containerRect.top) {
    container.scrollTop -= containerRect.top - itemRect.top;
  }
}
