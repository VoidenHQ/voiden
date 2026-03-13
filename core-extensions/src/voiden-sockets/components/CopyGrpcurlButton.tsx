import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { generateGrpcurlFromJson } from '../lib/grpcurlGenerator';
import { PluginContext } from '@voiden/sdk';


interface CopyGrpcurlButtonProps {
    tab?: {
        title?: string;
        content?: string;
        tabId?: string;
        [key: string]: any;
    };
    context: PluginContext
}

export const CopyGrpcurlButton: React.FC<CopyGrpcurlButtonProps> = ({ tab, context }) => {
    const [copied, setCopied] = useState(false);


    const readActiveEditorJSON = async () => {
        try {
            if (tab?.tabId) {
                // @ts-ignore - resolved at runtime in app context
                const { useEditorStore } = await import(/* @vite-ignore */ '@/core/editors/voiden/VoidenEditor');
                const unsaved = useEditorStore.getState().unsaved[tab.tabId];
                if (unsaved) {
                    return JSON.parse(unsaved);
                }
            }
            const voiden = context.project.getActiveEditor?.("voiden");
            return (voiden && typeof voiden.getJSON === "function" && voiden.getJSON()) || [];
        } catch {
            return [];
        }
    };
    const handleCopyGrpcurl = async () => {
        try {
            const jsonContent = await readActiveEditorJSON();

            if (!jsonContent || jsonContent.length === 0) {
                console.warn('No content available to copy');
                return;
            }

            // Generate grpcurl command
            const rawGrpcurlCommand = await generateGrpcurlFromJson(jsonContent);

            if (!rawGrpcurlCommand) {
                console.warn('Failed to generate grpcurl command');
                return;
            }

            // Resolve {{VAR}} and {{process.xxx}} placeholders
            const grpcurlCommand = await (window as any).electron?.env?.replaceVariables(rawGrpcurlCommand) ?? rawGrpcurlCommand;

            // Copy to clipboard
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(grpcurlCommand);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = grpcurlCommand;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }

            // Show feedback
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (error) {
            console.error('Error copying grpcurl command:', error);
        }
    };

    return (
        <button
            onClick={handleCopyGrpcurl}
            className="w-full flex items-center gap-1 px-2 py-1 rounded hover:bg-button-primary text-text transition-colors"
            title="Copy as grpcurl"
        >
            {copied ? (
                <>
                    <Check className="w-4 h-4" />
                    <span className="text-xs">Copied</span>
                </>
            ) : (
                <>
                    <Copy className="w-4 h-4" />
                    <span className="text-xs">grpcurl</span>
                </>
            )}
        </button>
    );
};
