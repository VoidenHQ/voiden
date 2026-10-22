import { useEffect, useRef, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Tip } from "@/core/components/ui/Tip";

export interface CliResultMessage {
  message: string;
  /** A command the user has to run themselves, shown in a copyable box. */
  command?: string;
}

/** Feedback from installing or uninstalling the CLI, with any command to run in its own copyable box. */
export const CliCommandMessage = ({ message, command }: CliResultMessage) => {
  const [copied, setCopied] = useState(false);
  const commandRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyCommand = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      // Clipboard blocked: select the command so Cmd/Ctrl+C still works.
      const selection = window.getSelection();
      if (!commandRef.current || !selection) return;
      const range = document.createRange();
      range.selectNodeContents(commandRef.current);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  };

  return (
    <div
      className="mt-2.5 p-2.5 rounded text-xs space-y-2"
      style={{
        backgroundColor: "color-mix(in srgb, var(--icon-primary) 10%, transparent)",
        borderColor: "color-mix(in srgb, var(--icon-primary) 30%, transparent)",
        borderWidth: "1px",
      }}
    >
      <p className="whitespace-pre-wrap leading-relaxed select-text" style={{ color: "var(--icon-primary)" }}>
        {message}
      </p>
      {command && (
        <div className="flex items-start gap-2 rounded border border-border bg-editor p-2">
          <pre
            ref={commandRef}
            // Long paths wrap inside the box instead of scrolling sideways; copying still gives the one-line command.
            className="flex-1 min-w-0 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-text select-text cursor-text"
          >
            {command}
          </pre>
          <Tip label={copied ? "Copied" : "Copy command"} side="top" align="end">
            <button
              type="button"
              onClick={copyCommand}
              aria-label="Copy command"
              className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border-subtle text-comment hover:text-text hover:bg-active/50 transition-colors"
            >
              {copied ? <Check className="w-3 h-3" style={{ color: "var(--icon-success)" }} /> : <Copy className="w-3 h-3" />}
              {/* Both labels share one grid cell, so the button keeps the width of the longer one. */}
              <span className="grid">
                <span className="col-start-1 row-start-1 invisible" aria-hidden>Copied</span>
                <span className="col-start-1 row-start-1">{copied ? "Copied" : "Copy"}</span>
              </span>
            </button>
          </Tip>
        </div>
      )}
    </div>
  );
};
