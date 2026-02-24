import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { generateCurlFromJson } from '../lib/curlGenerator';
import { PluginContext } from '@voiden/sdk';


interface CopyCurlButtonProps {
    tab?: {
        title?: string;
        content?: string;
        tabId?: string;
        [key: string]: any;
    };
    context:PluginContext
}

export const CopyCurlButton: React.FC<CopyCurlButtonProps> = ({ tab, context }) => {
    const [copied, setCopied] = useState(false);


    const readActiveEditorJSON = async () => {
        try {
            // Prefer the in-memory unsaved content so curl reflects edits
            // without requiring a save first.
            if (tab?.tabId) {
                // @ts-ignore - resolved at runtime in app context
                const { useEditorStore } = await import(/* @vite-ignore */ '@/core/editors/voiden/VoidenEditor');
                const unsaved = useEditorStore.getState().unsaved[tab.tabId];
                if (unsaved) {
                    return JSON.parse(unsaved);
                }
            }
            // Fall back to live editor instance
            const voiden = context.project.getActiveEditor?.("voiden");
            return (voiden && typeof voiden.getJSON === "function" && voiden.getJSON()) || [];
        } catch {
            return [];
        }
    };
    const handleCopyCurl = async () => {
        try {
            const jsonContent = await readActiveEditorJSON();

            if (!jsonContent || jsonContent.length === 0) {
                console.warn('No content available to copy');
                return;
            }

            // Generate cURL command
            const curlCommand = await generateCurlFromJson(jsonContent);

            if (!curlCommand) {
                console.warn('Failed to generate cURL command');
                return;
            }

            // Copy to clipboard
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(curlCommand);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = curlCommand;
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
            console.error('Error copying cURL command:', error);
        }
    };

    return (
        <button
            onClick={handleCopyCurl}
            className="w-full flex items-center gap-1 px-2 py-1 rounded hover:bg-button-primary text-text transition-colors"
            title="Copy as cURL"
        >
            {copied ? (
                <>
                    <Check className="w-4 h-4" />
                    <span className="text-xs">Copied</span>
                </>
            ) : (
                <>
                    <Copy className="w-4 h-4" />
                    <span className="text-xs">cURL</span>
                </>
            )}
        </button>
    );
};
