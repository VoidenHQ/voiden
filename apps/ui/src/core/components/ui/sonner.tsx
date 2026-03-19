import { useTheme } from "next-themes"
import { isValidElement, useState, type ReactNode } from "react"
import { Check, Copy } from "lucide-react"
import { Toaster as Sonner, toast as sonnerToast, type ExternalToast } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>
type ToastOptions = ExternalToast

function getText(node: ReactNode | (() => ReactNode)): string {
  if (typeof node === "function") return ""
  if (node == null || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(getText).join("")
  if (isValidElement(node)) {
    return getText(node.props?.children)
  }
  return ""
}

function toPayload(type: string, message: ReactNode, options?: ToastOptions): string {
  return JSON.stringify(
    {
      type,
      title: getText(message),
      description: getText(options?.description),
    },
    null,
    2,
  )
}

const CopyJsonAction = ({ payload }: { payload: string }) => {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    try {
      await navigator.clipboard?.writeText(payload)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // Ignore clipboard errors; keep toast functional.
    }
  }

  return (
    <button
      type="button"
      onClick={onCopy}
      className="inline-flex items-center gap-1.5 rounded-md bg-bg px-2.5 py-1.5 text-text transition-transform duration-150 hover:scale-[1.02] active:scale-95"
      aria-label="Copy toast JSON"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 animate-in zoom-in-50 duration-150" />
      ) : (
        <Copy className="h-3.5 w-3.5 animate-in zoom-in-50 duration-150" />
      )}
    </button>
  )
}

function withCopyAction(type: string, message: ReactNode, options?: ToastOptions): ToastOptions {
  if (options?.action) return options

  const payload = toPayload(type, message, options)
  return {
    ...(options ?? {}),
    action: <CopyJsonAction payload={payload} />,
  }
}

export const toast = Object.assign(
  (message: ReactNode, options?: ToastOptions) => sonnerToast(message, withCopyAction("default", message, options)),
  {
    // Success: pass options through (description shown), but no copy button
    success: (message: ReactNode, options?: ToastOptions) =>
      sonnerToast.success(message, options),
    // Error, warning, info: include copy button
    error: (message: ReactNode, options?: ToastOptions) =>
      sonnerToast.error(message, withCopyAction("error", message, options)),
    warning: (message: ReactNode, options?: ToastOptions) =>
      sonnerToast.warning(message, withCopyAction("warning", message, options)),
    info: (message: ReactNode, options?: ToastOptions) =>
      sonnerToast.info(message, withCopyAction("info", message, options)),
    dismiss: sonnerToast.dismiss,
    custom: sonnerToast.custom,
    promise: sonnerToast.promise,
    loading: (message: ReactNode, options?: ToastOptions) =>
      sonnerToast.loading(message, options),
  },
)

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-panel group-[.toaster]:text-text group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          title: "group-[.toast]:text-text select-text",
          description: "group-[.toast]:text-comment select-text",
          actionButton:
            "group-[.toast]:bg-active group-[.toast]:text-text transition-transform duration-150 hover:scale-[1.02] active:scale-95",
          cancelButton:
            "group-[.toast]:bg-active group-[.toast]:text-comment",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
