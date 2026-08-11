import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NodeViewProps } from "@tiptap/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tiptap/react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tiptap/react")>();

  return {
    ...actual,
    NodeViewWrapper: ({ children }: { children: React.ReactNode }) =>
      React.createElement("div", null, children),
  };
});

vi.mock("@/core/settings/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: { appearance: { separator_alignment: "center" } },
  }),
}));

vi.mock("@/core/editors/voiden/extensions/sectionIndicator", () => ({
  getSectionLineColor: () => "#999",
  SECTION_LABEL_COLOR: "#999",
}));

import { RequestSeparatorView } from "../nodes/RequestSeparatorNode";

const createProps = (label: string): NodeViewProps =>
  ({
    node: { attrs: { uid: "request-1", colorIndex: 0, label } },
    editor: { isEditable: true },
    updateAttributes: vi.fn(),
  }) as unknown as NodeViewProps;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("RequestSeparatorView", () => {
  it("sizes the rename input to its content without shrinking below the default width", async () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const width =
          this.getAttribute("aria-hidden") === "true"
            ? (this.textContent?.length ?? 0) * 10 + 18
            : 0;

        return {
          x: 0,
          y: 0,
          width,
          height: 0,
          top: 0,
          right: width,
          bottom: 0,
          left: 0,
          toJSON: () => {},
        };
      },
    );

    const label = "CleanupDeleteCalendarEntryNotificationsUser1";
    render(React.createElement(RequestSeparatorView, createProps(label)));

    fireEvent.doubleClick(screen.getByText(label));

    const input = await screen.findByRole("textbox");
    await waitFor(() =>
      expect(input.style.width).toBe(`${label.length * 10 + 18}px`),
    );

    fireEvent.change(input, { target: { value: "GET" } });
    await waitFor(() => expect(input.style.width).toBe("80px"));
  });
});
