import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/core/components/ui/alert-dialog";
import { cn } from "@/core/lib/utils";
import { resolveUnsavedChangesDialog, useUnsavedChangesDialogStore } from "@/core/stores/unsavedChangesDialogStore";

// AlertDialogContent/Action/Cancel's default classNames (button.tsx's
// buttonVariants, alert-dialog.tsx's bg-background/bg-primary/text-muted-
// foreground) reference shadcn's default color tokens, which this app's
// tailwind.config.js never defines — it uses its own theme tokens instead
// (bg-panel, text-text, text-comment, border-border, bg-button-primary, ...,
// see e.g. ExternalFile.tsx's popups or curlPaste.ts's dialog). Overriding
// every className below to those real tokens is what actually makes this
// dialog follow the app's light/dark theme instead of rendering unstyled.
const cancelClass = "rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-text hover:bg-active/50 mt-2 sm:mt-0";
const secondaryClass = "rounded-md bg-button-secondary px-3 py-1.5 text-sm text-button-secondary-fg hover:opacity-90";
const primaryClass = "rounded-md bg-button-primary px-3 py-1.5 text-sm font-medium text-bg hover:bg-button-primary-hover";

export const UnsavedChangesDialog = () => {
  const request = useUnsavedChangesDialogStore((s) => s.request);
  if (!request) return null;

  const { title, locked } = request;

  return (
    <AlertDialog open onOpenChange={(open) => { if (!open) resolveUnsavedChangesDialog("cancel"); }}>
      {/* AlertDialogContent's built-in overlay uses the same unwired bg-primary/20
          token, so render our own backdrop explicitly (same workaround AboutModal
          uses for the equivalent DialogOverlay issue). */}
      <div className="fixed inset-0 z-50 bg-black/50" />
      <AlertDialogContent className="max-w-sm bg-panel border border-border rounded-lg shadow-lg text-text">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-text">{locked ? "Project Locked" : "Unsaved Changes"}</AlertDialogTitle>
          <AlertDialogDescription className="text-text">
            {locked
              ? `Discard unsaved changes to ${title}?`
              : `Do you want to save changes made to ${title}?`}
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="text-sm text-comment">
          {locked
            ? "The project is locked, so these changes can't be saved. Closing the tab will discard them."
            : "Your changes will be lost if you don't save them."}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className={cancelClass} onClick={() => resolveUnsavedChangesDialog("cancel")}>
            Cancel
          </AlertDialogCancel>
          {locked ? (
            <AlertDialogAction className={primaryClass} onClick={() => resolveUnsavedChangesDialog("discard")}>
              Discard
            </AlertDialogAction>
          ) : (
            <>
              <button className={cn(secondaryClass)} onClick={() => resolveUnsavedChangesDialog("discard")}>
                Don't Save
              </button>
              <AlertDialogAction className={primaryClass} onClick={() => resolveUnsavedChangesDialog("save")}>
                Save
              </AlertDialogAction>
            </>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
