import * as React from "react";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ExtendedPluginContextExplicit } from '../plugin'

declare global {
    interface Window {
        //@ts-ignore
        electron?: {
            files?: {
                write: (path: string, content: string) => Promise<void>;
                createVoid: (projectPath: string, fileName: string) => Promise<{ path: string; name: string }>;
                createDirectory: (parentPath: string, dirName: string) => Promise<string>;
                getDirectoryExist: (parentPath: string, dirName: string) => Promise<boolean>;
                getFileExist: (parentPath: string, fileName: string) => Promise<boolean>;
            };
            state?: {
                get: () => Promise<{ activeProject?: string }>;
                getProjects?: () => Promise<any>;
            };
            ipc?: {
                invoke: (channel: string, ...args: any[]) => Promise<any>;
            };
        };
        jsyaml?: { load: (str: string) => any };
        __voidenHelpers__?: { [pluginName: string]: any };
    }
}

export interface FileLinkAttributes {
    filePath: string;
    filename: string;
    isExternal?: boolean;
}


// Factory function to create OpenApiSpecLink node with plugin context
export const createOpenApiSpecLink = (context: ExtendedPluginContextExplicit) => {
    // React Component for the node view
    const FileLinkNodeView = ({ node, editor }: {
        node: any,
        editor: any
    }) => {
        const { filePath, filename, isExternal } = node.attrs;

        const handleClick = async (e: React.MouseEvent) => {
            e.preventDefault();
            e.stopPropagation();

            if (!filePath) {
                console.warn("No file path provided");
                return;
            }

            try {
                // Use context to get active project
                let activeProject: string | undefined;

                // Try to get active project from context
                if (!context.project) {
                    console.log('[OpenAPI] : Could not find active project.');
                    return;
                }
                activeProject = await context.project.getActiveProject();

                // Resolve full path
                let fullPath = filePath;
                if (!isExternal && activeProject && !filePath.startsWith(activeProject)) {
                    const separator = filePath.startsWith('/') ? '' : '/';
                    fullPath = `${activeProject}${separator}${filePath}`;
                }

                await context.project.openFile(fullPath, true);

            } catch (error) {
                console.error("Failed to open file:", error);
            }
        };

        return (
            <NodeViewWrapper>
                <span className="text-sm font-medium p-1.5 rounded border-border border border-blue-500/20">
                    OpenAPI Spec
                </span>

                <span
                    onClick={handleClick}
                    className="
      inline-flex items-center px-1.5 py-0.5 rounded
      text-blue-600 dark:text-blue-400 
      cursor-pointer
    "
                    contentEditable={false}
                    data-type="openapispecLink"
                    data-file-path={filePath}
                    data-filename={filename}
                >
                    <span
                        className="
        text-sm font-medium
        underline decoration-transparent
        hover:decoration-current focus-visible:decoration-current
        transition-all
      "
                    >
                        {filename} ↗
                    </span>
                </span>
            </NodeViewWrapper>


        );
    };

    return Node.create({
        name: "openapispecLink",
        group: "inline",
        inline: true,
        selectable: false,
        atom: true,
        draggable: false,

        addOptions() {
            return {
                HTMLAttributes: {},
            };
        },

        addAttributes() {
            return {
                filePath: {
                    default: null,
                    parseHTML: (element) => element.getAttribute("data-file-path"),
                    renderHTML: (attributes) => ({
                        "data-file-path": attributes.filePath,
                    }),
                },
                filename: {
                    default: null,
                    parseHTML: (element) => element.getAttribute("data-filename"),
                    renderHTML: (attributes) => ({
                        "data-filename": attributes.filename,
                    }),
                },
                isExternal: {
                    default: false,
                    parseHTML: (element) => element.getAttribute("data-is-external") === "true",
                    renderHTML: (attributes) => ({
                        "data-is-external": attributes.isExternal ? "true" : "false",
                    }),
                },
            };
        },

        parseHTML() {
            return [
                {
                    tag: 'span[data-type="openapispecLink"]',
                },
            ];
        },

        renderHTML({ node, HTMLAttributes }) {
            return [
                "span",
                mergeAttributes(
                    {
                        "data-type": "openapispecLink",
                        "data-file-path": node.attrs.filePath,
                        "data-filename": node.attrs.filename,
                        "data-is-external": node.attrs.isExternal ? "true" : "false",
                    },
                    this.options.HTMLAttributes,
                    HTMLAttributes
                ),
                `${node.attrs.filename || ""}`,
            ];
        },

        renderText({ node }) {
            return `${node.attrs.filename || ""}`;
        },

        addNodeView() {
            return ReactNodeViewRenderer(FileLinkNodeView);
        },
    });
};

export default createOpenApiSpecLink;
