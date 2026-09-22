import React from 'react';
import { AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/core/components/ui/alert-dialog';

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

// alert-dialog.tsx's own default classNames (bg-background, bg-primary/20,
// buttonVariants()) reference shadcn's default color tokens, which this
// app's tailwind.config.js never defines — see
// UnsavedChangesDialog.tsx's identical comment, the one other real
// consumer of AlertDialog, which patches around the exact same gap. This
// mirrors that established pattern (real theme tokens: bg-panel, text-text,
// border-border, bg-button-danger, ...) rather than inheriting the unwired
// defaults, plus backdrop-blur on the overlay, which neither this app's
// AlertDialog nor Dialog primitive has had until now.
const cancelClass = "rounded-md border border-border bg-transparent px-3 py-1.5 text-sm text-text hover:bg-active/50 mt-2 sm:mt-0";
const dangerClass = "rounded-md bg-button-danger px-3 py-1.5 text-sm font-medium text-bg hover:bg-button-danger-hover";

export const DisableMcpDialog: React.FC<Props> = ({ open, onConfirm, onCancel }) => (
  <AlertDialog open={open} onOpenChange={(next: boolean) => { if (!next) onCancel(); }}>
    {open && <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />}
    <AlertDialogContent className="max-w-sm bg-panel border border-border rounded-lg shadow-lg text-text">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-base text-text">
          <AlertTriangle size={15} style={{ color: 'var(--icon-warning)' }} className="shrink-0" />
          Disable MCP for this project?
        </AlertDialogTitle>
      </AlertDialogHeader>

      <div className="text-sm text-comment mb-1">
        This removes Claude Code&apos;s MCP registration for this project only — its entry in
        this project&apos;s <span className="font-mono text-text">.mcp.json</span>. Codex and
        any installed skills aren&apos;t project-specific and are left untouched.
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel className={cancelClass} onClick={onCancel}>Cancel</AlertDialogCancel>
        <AlertDialogAction className={dangerClass} onClick={onConfirm}>Disable</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
