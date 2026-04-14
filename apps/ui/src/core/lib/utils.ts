import { JSONContent } from "@tiptap/core";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function openExternalLink(url: string) {
  const isElectron = window.electron?.isApp;
  if (isElectron) {
    window.electron?.openExternal(url);
  } else {
    window.open(url, "_blank");
  }
}

export const getDocumentJSONFromBinary = (data: ArrayBuffer): JSONContent => {
  try {
    const uint8Array = new Uint8Array(data);
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, uint8Array);

    return yXmlFragmentToProsemirrorJSON(ydoc.getXmlFragment("default"));
  } catch (error) {
    return {};
  }
};

export const isMac = window.electron?.platform === "darwin";
