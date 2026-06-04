import { createFileFromS3Url, getSignedUrl } from "@/apis/files";
import { JSONContent } from "@tiptap/core";
import { yXmlFragmentToProsemirrorJSON } from "y-prosemirror";
import * as Y from "yjs";
import { parse as losslessParse, stringify as losslessStringify } from "lossless-json";

export function prettifyJSON(json: string) {
  try {
    const parsed = losslessParse(json);
    return losslessStringify(parsed, null, 2) ?? json;
  } catch (error) {
    return json;
  }
}

export const getFileIfNotExist = async (docId: string, fileId: string, fileName: string): Promise<File | null> => {
  const url = await getSignedUrl(docId || "", fileId);
  if (url) {
    const file = await createFileFromS3Url(url, fileName);
    return file || null;
  }
  return null;
};

export const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const now = new Date();
  const diffMinutes = Math.floor((now.getTime() - date.getTime()) / 1000 / 60);

  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.floor(diffMinutes / 60)}h ago`;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date);
};

export const getTimeDiff = (date1: string, date2: string) => {
  const diff = Math.abs(new Date(date1).getTime() - new Date(date2).getTime());
  const minutes = Math.floor(diff / 1000 / 60);
  if (minutes < 60) return `${minutes} minutes`;
  return `${Math.floor(minutes / 60)} hours`;
};

export const defaultJson = {
  type: "doc",
  content: [
    {
      type: "title",
    },
    {
      type: "method",
      attrs: {
        method: "GET",
        importedFrom: "",
        visible: true,
      },
    },
    {
      type: "url",
      attrs: {
        importedFrom: "",
        visible: true,
        isEditable: true,
      },
    },
    {
      type: "paragraph",
    },
  ],
};

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

export const isEmptyYdoc = (ydoc: Y.Doc, docId: string) => ydoc.getText(docId).toJSON() === "";

export const setYDocText = (ydoc: Y.Doc, docId: string, text: string) => {
  const sharedText = ydoc.getText(docId);
  sharedText.delete(0, sharedText.length);
  sharedText.insert(0, text);
};
