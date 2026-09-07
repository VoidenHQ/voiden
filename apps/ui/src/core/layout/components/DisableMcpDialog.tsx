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

export const DisableMcpDialog: React.FC<Props> = ({ open, onConfirm, onCancel }) => (
  <AlertDialog open={open} onOpenChange={(next: boolean) => { if (!next) onCancel(); }}>
    <AlertDialogContent className="max-w-sm">
      <AlertDialogHeader>
        <AlertDialogTitle className="flex items-center gap-2 text-base">
          <AlertTriangle size={15} className="text-yellow-400 shrink-0" />
          Disable MCP for this project?
        </AlertDialogTitle>
      </AlertDialogHeader>

      <div className="text-sm text-comment mb-1">
        This removes Claude Code&apos;s MCP registration for this project only — its entry in
        this project&apos;s <span className="font-mono text-text/80">.mcp.json</span>. Codex and
        any installed skills aren&apos;t project-specific and are left untouched.
      </div>

      <AlertDialogFooter>
        <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={onConfirm}>Disable</AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
);
