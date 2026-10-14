import { RouterProvider, createBrowserHistory, createHashHistory, createRouter } from "@tanstack/react-router";
import React from "react";
// Expose React globally so that plugins can access it
import * as TiptapCore from "@tiptap/core";
import * as TiptapReact from "@tiptap/react";

// Import all Tiptap PM modules
import * as PMChangeset from "@tiptap/pm/changeset";
import * as PMCommands from "@tiptap/pm/commands";
import * as PMDropcursor from "@tiptap/pm/dropcursor";
import * as PMGapcursor from "@tiptap/pm/gapcursor";
import * as PMHistory from "@tiptap/pm/history";
import * as PMInputrules from "@tiptap/pm/inputrules";
import * as PMKeymap from "@tiptap/pm/keymap";
// @tiptap/pm/markdown was removed in Tiptap 3; the underlying package is still installed
import * as PMMarkdown from "prosemirror-markdown";
import * as PMModel from "@tiptap/pm/model";
import * as PMSchemaList from "@tiptap/pm/schema-list";
import * as PMState from "@tiptap/pm/state";
import * as PMTables from "@tiptap/pm/tables";
import * as PMTransform from "@tiptap/pm/transform";
import * as PMView from "@tiptap/pm/view";

(window as any).React = React;
(window as any).Tiptap = {
  Core: TiptapCore,
  React: TiptapReact,
  PM: {
    changeset: PMChangeset,
    commands: PMCommands,
    dropcursor: PMDropcursor,
    gapcursor: PMGapcursor,
    history: PMHistory,
    inputrules: PMInputrules,
    keymap: PMKeymap,
    markdown: PMMarkdown,
    model: PMModel,
    schemaList: PMSchemaList,
    state: PMState,
    tables: PMTables,
    transform: PMTransform,
    view: PMView,
  },
};

import ReactDOM from "react-dom/client";
import "./styles.css";
import { initializeTheme } from "./utils/themeLoader";

// import * as Sentry from "@sentry/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// import Plausible from "plausible-tracker";
import { Toaster } from "@/core/components/ui/sonner";
import { routeTree } from "./routeTree.gen";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { AppErrorBoundary } from "@/core/components/ErrorBoundary";

// Sentry.init({
//   dsn: "https://38410ad032435e444cf5386f83b0a868@o4506625827864576.ingest.sentry.io/4506625829502976",
//   integrations: [
//     new Sentry.BrowserTracing({
//       // Set 'tracePropagationTargets' to control for which URLs distributed tracing should be enabled
//       tracePropagationTargets: ["localhost", /^https:\/\/yourserver\.io\/api/],
//     }),
//     new Sentry.Replay({
//       maskAllText: false,
//       blockAllMedia: false,
//     }),
//   ],
//   // Performance Monitoring
//   tracesSampleRate: 1.0, //  Capture 100% of the transactions
//   // Session Replay
//   replaysSessionSampleRate: 0.1, // This sets the sample rate at 10%. You may want to change it to 100% while in development and then sample at a lower rate in production.
//   replaysOnErrorSampleRate: 1.0, // If you're not already sampling the entire session, change the sample rate to 100% when sampling sessions where errors occur.
// });

// export const plausible = Plausible({
//   domain: "apyhub.com",
//   hashMode: window.electron?.isApp ? true : false,
//   trackLocalhost: false,
// });

const history = window.electron?.isApp ? createHashHistory() : createBrowserHistory();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retryOnMount: false,
      refetchInterval: 30000,
      networkMode: 'always'
    },
    mutations: {
      networkMode: 'always'
    }
  },
});

export const getQueryClient = () => queryClient;
export const router = createRouter({
  routeTree,
  history,
  basepath: import.meta.env.VITE_BASE_PATH,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  // Since we're using React Query, we don't want loader calls to ever be stale
  // This will ensure that the loader is always called when the route is preloaded or visited
  defaultPreloadStaleTime: 0,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

let container: HTMLElement | null = null;

function setupExtensionListener() {
  const messageHandler = (message: MessageEvent) => {
    if (message.data.event === "__EXTENSION_HOOK__") {
      window.__EXTENSION_HOOK__ = message.data.eventData;
    } else if (message.data.event === "__EXTENSION_UN_HOOK__") {
      delete window.__EXTENSION_HOOK__;
    }
  };

  window.addEventListener("message", messageHandler);

  return () => {
    window.removeEventListener("message", messageHandler);
  };
}

document.addEventListener("DOMContentLoaded", async function () {
  // Initialize theme first
  await initializeTheme();

  setupExtensionListener();
  if (!container) {
    container = document.getElementById("app") as HTMLElement;
    const root = ReactDOM.createRoot(container);
    root.render(
      <React.StrictMode>
        <AppErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <RouterProvider router={router} />
            {/* <ReactQueryDevtools /> */}
          </QueryClientProvider>
          <Toaster position="bottom-right" />
        </AppErrorBoundary>
      </React.StrictMode>,
    );
  }
});
