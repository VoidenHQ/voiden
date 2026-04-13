import { describe, it, expect, vi, beforeAll } from "vitest";
import { createRef, createElement } from "react";
import { render, act } from "@testing-library/react";
import VariableList, {
  VariableListHandle,
} from "@/core/editors/voiden/extensions/VariableList";

// jsdom does not implement scrollIntoView; VariableList's effect calls it
// when the selection changes, so stub it for the duration of the suite.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

/**
 * VariableList is the popup component used by TableCellAutocomplete. Its
 * onKeyDown is forwarded to Tiptap's Suggestion plugin via useImperativeHandle
 * and its return value decides whether the key event is consumed. When there
 * are no items (e.g. inside a runtime-variables cell where no suggestions
 * are registered), it must NOT consume keys — otherwise Enter is swallowed
 * before CustomTableRow's Enter shortcut can advance the cursor
 * https://github.com/VoidenHQ/voiden/issues/270.
 */

type Item = { label: string; description?: string };

const renderWithItems = (items: Item[]) => {
  const ref = createRef<VariableListHandle>();
  const command = vi.fn();
  render(createElement(VariableList, { items, command, ref }));
  return { ref, command };
};

const keydown = (key: string) =>
  ({ event: new KeyboardEvent("keydown", { key }) }) as {
    event: KeyboardEvent;
  };

describe("VariableList.onKeyDown", () => {
  describe("when items is empty", () => {
    it("voiden test : returns false for Enter so it falls through to table row shortcuts", () => {
      const { ref, command } = renderWithItems([]);
      expect(ref.current).not.toBeNull();

      const handled = ref.current!.onKeyDown(keydown("Enter"));

      expect(handled).toBe(false);
      expect(command).not.toHaveBeenCalled();
    });

    it("voiden test : returns false for ArrowUp and ArrowDown", () => {
      const { ref } = renderWithItems([]);

      expect(ref.current!.onKeyDown(keydown("ArrowUp"))).toBe(false);
      expect(ref.current!.onKeyDown(keydown("ArrowDown"))).toBe(false);
    });

    it("voiden test : returns false for unrelated keys when items is empty", () => {
      const { ref } = renderWithItems([]);

      expect(ref.current!.onKeyDown(keydown("a"))).toBe(false);
      expect(ref.current!.onKeyDown(keydown("Tab"))).toBe(false);
    });
  });

  describe("when items is populated", () => {
    const items: Item[] = [
      { label: "Accept" },
      { label: "Authorization" },
      { label: "Content-Type" },
    ];

    it("voiden test : selects the highlighted item on Enter and returns true", () => {
      const { ref, command } = renderWithItems(items);

      const handled = ref.current!.onKeyDown(keydown("Enter"));

      expect(handled).toBe(true);
      expect(command).toHaveBeenCalledTimes(1);
      expect(command).toHaveBeenCalledWith(items[0]);
    });

    it("voiden test : consumes ArrowDown and advances the selection", () => {
      const { ref, command } = renderWithItems(items);

      let handled = false;
      act(() => {
        handled = ref.current!.onKeyDown(keydown("ArrowDown"));
      });
      expect(handled).toBe(true);
      ref.current!.onKeyDown(keydown("Enter"));

      expect(command).toHaveBeenCalledWith(items[1]);
    });

    it("voiden test : consumes ArrowUp and wraps to the last item from index 0", () => {
      const { ref, command } = renderWithItems(items);

      let handled = false;
      act(() => {
        handled = ref.current!.onKeyDown(keydown("ArrowUp"));
      });
      expect(handled).toBe(true);
      ref.current!.onKeyDown(keydown("Enter"));

      expect(command).toHaveBeenCalledWith(items[items.length - 1]);
    });

    it("voiden test : returns false for unrelated keys when items is populated", () => {
      const { ref } = renderWithItems(items);

      expect(ref.current!.onKeyDown(keydown("Tab"))).toBe(false);
      expect(ref.current!.onKeyDown(keydown("Escape"))).toBe(false);
    });
  });
});
