import { Editor, Extension } from "@tiptap/core";
import { ReactRenderer } from "@tiptap/react";
import Suggestion, { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import { PluginKey } from "@tiptap/pm/state";
import tippy from "tippy.js";

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/core/lib/utils";
import { icons } from "lucide-react";

import { useEditorEnhancementStore } from "@/plugins";

const GROUPS: Group[] = [
  {
    name: "format",
    title: "Basic blocks",
    commands: [
      {
        name: "heading1",
        label: "Heading 1",
        iconName: "Heading1",
        description: "High priority section title",
        slash: "/h1",
        aliases: ["h1"],
        action: (editor) => {
          editor.chain().focus().setHeading({ level: 1 }).run();
        },
      },
      {
        name: "heading2",
        label: "Heading 2",
        iconName: "Heading2",
        slash: "/h2",
        description: "Medium priority section title",
        aliases: ["h2"],
        action: (editor) => {
          editor.chain().focus().setHeading({ level: 2 }).run();
        },
      },
      {
        name: "heading3",
        label: "Heading 3",
        iconName: "Heading3",
        slash: "/h3",
        description: "Low priority section title",
        aliases: ["h3"],
        action: (editor) => {
          editor.chain().focus().setHeading({ level: 3 }).run();
        },
      },
      {
        name: "bulletList",
        label: "Bullet List",
        iconName: "List",
        slash: "/ul",
        description: "Unordered list of items",
        aliases: ["ul"],
        action: (editor) => {
          editor.chain().focus().toggleBulletList().run();
        },
      },
      {
        name: "numberedList",
        label: "Numbered List",
        iconName: "ListOrdered",
        slash: "/ol",
        description: "Ordered list of items",
        aliases: ["ol"],
        action: (editor) => {
          editor.chain().focus().toggleOrderedList().run();
        },
      },
      {
        name: "codeBlock",
        label: "Code Block",
        iconName: "SquareCode",
        description: "Code block with syntax highlighting",
        slash: "/code",
        shouldBeHidden: (editor) => editor.isActive("columns"),
        action: (editor) => {
          editor.chain().focus().insertContent({
            type: "codeBlock",
            attrs: {
              language: "plaintext",
              body: "",
            },
          }).run();
        },
      },
      {
        name: "table",
        label: "Table",
        iconName: "Table",
        description: "Insert a table",
        slash: "/table",
        shouldBeHidden: (editor) => editor.isActive("columns"),
        action: (editor) => {
          editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run();
        },
      },
      {
        name: "blockquote",
        label: "Quote",
        iconName: "Quote",
        description: "Insert a quote block",
        slash: "/quote",
        aliases: ["quote"],
        action: (editor) => {
          editor.chain().focus().toggleBlockquote().run();
        },
      },
      {
        name: "runtime-variables",
        label: "Runtime Variables",
        iconName: "Quote",
        aliases: [],
        slash: "/runtime-variables",
        description: "Insert runtime variables block",
        action: (editor) => {
          const range = {
            from: editor.state.selection.$from.pos,
            to: editor.state.selection.$to.pos,
          };
          const tableType="runtime-variables";
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertTable({
              type: tableType,
              rows: 1,
              cols: 2,
              withHeaderRow: false,
            })
            .focus(editor.state.doc.resolve(range.from + 1).pos)
            .run();
        },
      }
    ],
  },
];

export interface Group {
  name: string;
  title: string;
  commands: Command[];
}

export interface MenuListProps {
  editor: Editor;
  items: Group[];
  command: (command: Command) => void;
}

export interface Command {
  name: string;
  label: string;
  singleton?: boolean;
  compareKeys?: string[];
  description: string;
  slash: string;
  aliases?: string[];
  iconName: keyof typeof icons;
  action: (editor: Editor) => void;
  shouldBeHidden?: (editor: Editor) => boolean;
  isEnabled?: boolean;
}

export type IconProps = {
  name: keyof typeof icons;
  className?: string;
  strokeWidth?: number;
};

export const Icon = memo(({ name, className, strokeWidth }: IconProps) => {
  const IconComponent = icons[name];

  if (!IconComponent) {
    return null;
  }

  return <IconComponent className={cn("w-4 h-4", className)} strokeWidth={strokeWidth || 2.5} />;
});

Icon.displayName = "Icon";

export const DropdownButton = React.forwardRef<
  HTMLButtonElement,
  {
    children: React.ReactNode;
    isActive?: boolean;
    onClick?: () => void;
    disabled?: boolean;
    className?: string;
  }
>(function DropdownButtonInner({ children, isActive, onClick, disabled, className }, ref) {
  const buttonClass = cn(
    "flex items-center gap-2 p-1.5 text-left bg-transparent w-full",
    !isActive && !disabled,
    "hover:bg-active",
    isActive && !disabled && "bg-active text-text",
    disabled && "cursor-not-allowed",
    className,
  );

  return (
    <button className={buttonClass} disabled={disabled} onClick={onClick} ref={ref}>
      {children}
    </button>
  );
});

export const MenuList = React.forwardRef((props: MenuListProps, ref) => {
  const scrollContainer = useRef<HTMLDivElement>(null);
  const activeItem = useRef<HTMLButtonElement>(null);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState(0);
  const [selectedCommandIndex, setSelectedCommandIndex] = useState(0);

  // Anytime the groups change, i.e. the user types to narrow it down, we want to
  // reset the current selection to the first menu item
  useEffect(() => {
    setSelectedGroupIndex(0);
    setSelectedCommandIndex(0);
  }, [props.items]);

  const selectItem = useCallback(
    (groupIndex: number, commandIndex: number) => {
      const command = props.items[groupIndex].commands[commandIndex];
      props.command(command);
    },
    [props],
  );

  React.useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }: { event: React.KeyboardEvent }) => {
      if (event.key === "ArrowDown") {
        if (!props.items.length) {
          return false;
        }

        const commands = props.items[selectedGroupIndex].commands;

        let newCommandIndex = selectedCommandIndex + 1;
        let newGroupIndex = selectedGroupIndex;

        if (commands.length - 1 < newCommandIndex) {
          newCommandIndex = 0;
          newGroupIndex = selectedGroupIndex + 1;
        }

        if (props.items.length - 1 < newGroupIndex) {
          newGroupIndex = 0;
        }

        setSelectedCommandIndex(newCommandIndex);
        setSelectedGroupIndex(newGroupIndex);

        return true;
      }

      if (event.key === "ArrowUp") {
        if (!props.items.length) {
          return false;
        }

        let newCommandIndex = selectedCommandIndex - 1;
        let newGroupIndex = selectedGroupIndex;

        if (newCommandIndex < 0) {
          newGroupIndex = selectedGroupIndex - 1;
          newCommandIndex = props.items[newGroupIndex]?.commands.length - 1 || 0;
        }

        if (newGroupIndex < 0) {
          newGroupIndex = props.items.length - 1;
          newCommandIndex = props.items[newGroupIndex].commands.length - 1;
        }

        setSelectedCommandIndex(newCommandIndex);
        setSelectedGroupIndex(newGroupIndex);

        return true;
      }

      if (event.key === "Enter") {
        if (
          !props.items.length ||
          selectedGroupIndex === -1 ||
          selectedCommandIndex === -1 ||
          !props.items[selectedGroupIndex].commands[selectedCommandIndex].isEnabled
        ) {
          return false;
        }

        selectItem(selectedGroupIndex, selectedCommandIndex);

        return true;
      }

      return false;
    },
  }));

  useEffect(() => {
    if (activeItem.current && scrollContainer.current) {
      const offsetTop = activeItem.current.offsetTop;
      const offsetHeight = activeItem.current.offsetHeight;

      scrollContainer.current.scrollTop = offsetTop - offsetHeight;
    }
  }, [selectedCommandIndex, selectedGroupIndex]);

  const createCommandClickHandler = useCallback(
    (groupIndex: number, commandIndex: number) => {
      return () => {
        selectItem(groupIndex, commandIndex);
      };
    },
    [selectItem],
  );

  if (!props.items.length) {
    return null;
  }

  return (
    <div
      ref={scrollContainer}
      className="text-sm max-h-[40vh] min-w-96 overflow-auto shadow-md flex-wrap mb-8 border border-border bg-panel text-comment"
    >
      <div className="grid grid-cols-1">
        {props.items.map((group, groupIndex: number) => (
          <React.Fragment key={`${group.title}-wrapper`}>
            <div className="px-2 py-1.5  font-medium text-text bg-bg border-b border-border" key={`${group.title}`}>
              {group.title}
            </div>
            {group.commands.map((command: Command, commandIndex: number) => (
              <DropdownButton
                key={`${command.label}`}
                ref={selectedGroupIndex === groupIndex && selectedCommandIndex === commandIndex ? activeItem : null}
                isActive={selectedGroupIndex === groupIndex && selectedCommandIndex === commandIndex}
                onClick={createCommandClickHandler(groupIndex, commandIndex)}
                disabled={!command.isEnabled}
              >
                {/* <Icon name={command.iconName} className="mr-1" /> */}

                <div className="flex items-center gap-2 w-full">
                  <span className={cn("flex-1 text-text", !command.isEnabled && "text-comment")}>{command.label}</span>

                  <span className=" ">{command.slash}</span>
                </div>
              </DropdownButton>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
});

MenuList.displayName = "MenuList";

const extensionName = "slashCommand";

let popup: any;

export const hideSlashMenu = () => {
  popup?.[0]?.hide();
};

export const SlashCommand = Extension.create({
  name: extensionName,

  priority: 200,

  onCreate() {
    popup = tippy("body", {
      interactive: true,
      trigger: "manual",
      placement: "bottom-start",
      theme: "slash-command",
      maxWidth: "16rem",
      offset: [16, 8],
      popperOptions: {
        strategy: "fixed",
        modifiers: [
          {
            name: "flip",
            enabled: false,
          },
        ],
      },
    });
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        char: "/",
        allowSpaces: true,
        startOfLine: true,
        pluginKey: new PluginKey(extensionName),
        allow: ({ state, range }) => {
          const $from = state.doc.resolve(range.from);
          const isRootDepth = $from.depth === 1;
          const isParagraph = $from.parent.type.name === "paragraph";
          const isStartOfNode = $from.parent.textContent?.charAt(0) === "/";
          // TODO
          const isInColumn = this.editor.isActive("column");

          const afterContent = $from.parent.textContent?.substring($from.parent.textContent?.indexOf("/"));
          const isValidAfterContent = !afterContent?.endsWith("  ");

          return ((isRootDepth && isParagraph && isStartOfNode) || (isInColumn && isParagraph && isStartOfNode)) && isValidAfterContent;
        },
        command: ({ editor, props }: { editor: Editor; props: any }) => {
          const { view, state } = editor;
          const { $head, $from } = view.state.selection;

          const end = $from.pos;
          const from = $head?.nodeBefore ? end - ($head.nodeBefore.text?.substring($head.nodeBefore.text?.indexOf("/")).length ?? 0) : $from.start();

          const tr = state.tr.deleteRange(from, end);
          view.dispatch(tr);

          props.action(editor);
          view.focus();
        },
        items: ({ query }: { query: string }) => {
          const defaultGroups = GROUPS;
          const extraGroups = useEditorEnhancementStore.getState().voidenSlashGroups;
          const allGroups = [...defaultGroups, ...extraGroups];

          const withFilteredCommands = allGroups.map((group) => ({
            ...group,
            commands: group.commands.filter((item) => {
              const labelNormalized = item.label.toLowerCase().trim();
              const queryNormalized = query.toLowerCase().trim();

              if (item.aliases) {
                const aliases = item.aliases.map((alias) => alias.toLowerCase().trim());

                return labelNormalized.includes(queryNormalized) || aliases.some(item => item.includes(queryNormalized));
              }

              return labelNormalized.includes(queryNormalized);
            }),
            // .filter((command) => (command.shouldBeHidden ? !command.shouldBeHidden(this.editor) : true)),
          }));

          const withoutEmptyGroups = withFilteredCommands.filter((group) => {
            if (group.commands.length > 0) {
              return true;
            }

            return false;
          });

          const editorJSON = this.editor.getJSON();
          function shouldBeEnabled(command: Command) {
            if (!editorJSON.content|| !command.singleton) return true;
            for (const node of editorJSON.content) {
              if(command.compareKeys?.includes(node.type||"")){
                return false;
              }
            }

            return true;
          }

          const withEnabledSettings = withoutEmptyGroups.map((group) => ({
            ...group,
            commands: group.commands.map((command) => ({
              ...command,
              isEnabled: shouldBeEnabled(command),
            })),
          }));
          return withEnabledSettings;
        },
        render: () => {
          let component: any;

          let scrollHandler: (() => void) | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(MenuList, {
                props,
                editor: props.editor,
              });

              const { view } = props.editor;

              const editorNode = view.dom as HTMLElement;

              const getReferenceClientRect = () => {
                if (!props.clientRect) {
                  return props.editor.storage[extensionName].rect;
                }

                const rect = props.clientRect();

                if (!rect) {
                  return props.editor.storage[extensionName].rect;
                }

                let yPos = rect.y;

                if (rect.top + component.element.offsetHeight + 40 > window.innerHeight) {
                  const diff = rect.top + component.element.offsetHeight - window.innerHeight + 40;
                  yPos = rect.y - diff;
                }

                return new DOMRect(rect.x, yPos, rect.width, rect.height);
              };

              scrollHandler = () => {
                popup?.[0].setProps({
                  getReferenceClientRect,
                });
              };

              view.dom.parentElement?.addEventListener("scroll", scrollHandler);

              popup?.[0].setProps({
                getReferenceClientRect,
                appendTo: () => document.body,
                content: component.element,
              });

              popup?.[0].show();
            },

            onUpdate(props: SuggestionProps) {
              component.updateProps(props);

              const { view } = props.editor;

              const editorNode = view.dom as HTMLElement;

              const getReferenceClientRect = () => {
                if (!props.clientRect) {
                  return props.editor.storage[extensionName].rect;
                }

                const rect = props.clientRect();

                if (!rect) {
                  return props.editor.storage[extensionName].rect;
                }

                let yPos = rect.y;

                if (rect.top + component.element.offsetHeight + 40 > window.innerHeight) {
                  const diff = rect.top + component.element.offsetHeight - window.innerHeight + 40;
                  yPos = rect.y - diff;
                }

                return new DOMRect(rect.x, yPos, rect.width, rect.height);
              };

              const scrollHandler = () => {
                popup?.[0].setProps({
                  getReferenceClientRect,
                });
              };

              view.dom.parentElement?.addEventListener("scroll", scrollHandler);

              props.editor.storage[extensionName].rect = props.clientRect
                ? getReferenceClientRect()
                : {
                  width: 0,
                  height: 0,
                  left: 0,
                  top: 0,
                  right: 0,
                  bottom: 0,
                };
              popup?.[0].setProps({
                getReferenceClientRect,
              });
            },

            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === "Escape") {
                popup?.[0].hide();

                return true;
              }

              if (!popup?.[0].state.isShown) {
                popup?.[0].show();
              }

              return component.ref?.onKeyDown(props);
            },

            onExit(props) {
              popup?.[0].hide();
              if (scrollHandler) {
                const { view } = props.editor;
                view.dom.parentElement?.removeEventListener("scroll", scrollHandler);
              }
              component.destroy();
            },
          };
        },
      }),
    ];
  },

  addStorage() {
    return {
      rect: {
        width: 0,
        height: 0,
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
      },
    };
  },
});

export default SlashCommand;
