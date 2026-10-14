import { useAddNotification } from "@/features/notification/api/useAddNotification";
import { isSuggestionAcceptKey } from "@/core/editors/voiden/utils/suggestionKeys";
import { WorkspaceUser } from "@/features/workspace/api/getWorkspaceUsers";
import Mention from "@tiptap/extension-mention";
import { ReactRenderer } from "@tiptap/react";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import tippy, { Instance, Props } from "tippy.js";
import { User } from "@/features/adminSetting/api/useFetchAllUsers";
import { useActiveWorkspace } from "@/features/workspace/components/WorkspaceDropdown";
import { useParams } from "@tanstack/react-router";
import { useGetDocMeta } from "@/core/editors/voiden/api/useGetDocMeta";

type MentionListProps = {
  items: { user_email?: string; email?: string; username?: string }[];
  command: (item: { id: string }) => void;
  user: User;
};

interface MentionListRef {
  onKeyDown: ({ event }: { event: KeyboardEvent }) => boolean;
}

const MentionList = forwardRef<MentionListRef, MentionListProps>((props, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const { mutate } = useAddNotification();
  const params = useParams({ strict: false }) as { docId: string };
  const activeWorkspace = useActiveWorkspace();
  const { data: activeDoc } = useGetDocMeta(params.docId);

  const selectItem = (index: number) => {
    const item = props.items[index];
    if (item) {
      mutate(
        {
          user_email: item?.email || item?.user_email || "",
          doc_id: params.docId,
          title: "Mention new user",
          description: `You were mentioned in the document ${activeDoc?.title || "document"} by ${props.user.first_name}.`,
          workspace_domain: activeWorkspace?.domain || "",
          created_by_name: props.user.first_name,
        },
        {
          onSuccess: () => {},
        },
      );
      props.command({ id: item?.username || item?.email || item?.user_email || "" });
    }
  };

  const upHandler = () => {
    setSelectedIndex((selectedIndex + props.items.length - 1) % props.items.length);
  };

  const downHandler = () => {
    setSelectedIndex((selectedIndex + 1) % props.items.length);
  };

  const enterHandler = () => {
    selectItem(selectedIndex);
  };

  useEffect(() => setSelectedIndex(0), [props.items]);

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === "ArrowUp") {
        upHandler();
        return true;
      }

      if (event.key === "ArrowDown") {
        downHandler();
        return true;
      }

      if (isSuggestionAcceptKey(event)) {
        enterHandler();
        return true;
      }

      return false;
    },
  }));

  return (
    <div className="text-xs z-50 min-w-64 overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2">
      {props.items.length ? (
        props.items.map((item, index) => (
          <button
            className={`${
              index === selectedIndex && "bg-stone-100"
            } relative flex w-full cursor-default select-none items-center justify-between rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50`}
            key={index}
            onClick={() => selectItem(index)}
          >
            {item?.username || item?.email || item?.user_email}
          </button>
        ))
      ) : (
        <div className="item">No result</div>
      )}
    </div>
  );
});

MentionList.displayName = "MentionList";

const suggestion = (data: { user_email?: string; email?: string; username?: string }[] | undefined) => {
  // const { data: user } = useGetUser(); // Cloud auth disabled

  const users = useMemo(() => {
    if (user?.data && data) {
      return data?.filter((workspaceUser) => {
        return workspaceUser?.email !== user?.data?.email;
      });
    }
    return [];
  }, [user, data]);

  return {
    items: ({ query }: { query: string }) => {
      if (users.length > 0) {
        return users.filter(
          (item: any) =>
            item?.username?.toLowerCase().startsWith(query.toLowerCase()) ||
            item?.email?.toLowerCase().startsWith(query.toLowerCase()) ||
            item?.user_email?.toLowerCase().startsWith(query.toLowerCase()),
        );
      }
      return [];
    },

    render: () => {
      let component: ReactRenderer;
      let popup: Instance<Props>[];

      return {
        // @ts-expect-error
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props: { ...props, user: user?.data },
            editor: props.editor,
          });

          if (!props.clientRect) {
            return;
          }

          popup = tippy("body", {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: "manual",
            placement: "bottom-start",
          });
        },
        // @ts-expect-error
        onUpdate(props) {
          component.updateProps(props);

          if (!props.clientRect) {
            return;
          }

          popup[0].setProps({
            getReferenceClientRect: props.clientRect,
          });
        },
        // @ts-expect-error
        onKeyDown(props) {
          if (props.event.key === "Escape") {
            popup[0].hide();

            return true;
          }
          // @ts-expect-error
          return component.ref?.onKeyDown(props);
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  };
};

export const MentionExtension = (data: { user_email?: string; email?: string; username?: string }[] | undefined) =>
  Mention.configure({
    suggestion: suggestion(data),
    HTMLAttributes: {
      class: "font-medium text-sm rounded-lg border p-1 px-2 bg-stone-500 text-white",
    },
  });
