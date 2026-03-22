import { useState, useEffect, useRef, forwardRef, useImperativeHandle, ReactElement } from 'react'

interface SuggestionItem {
    label: string
    description?: string
    [key: string]: any
}

interface VariableListProps {
    items: SuggestionItem[]
    command: (item: SuggestionItem) => void
}

export interface VariableListHandle {
    onKeyDown: (props: { event: KeyboardEvent }) => boolean
}

const VariableList = forwardRef<VariableListHandle, VariableListProps>(
    ({ items, command }, ref): ReactElement | null => {
        const [selectedIndex, setSelectedIndex] = useState<number>(0)
        const listRef = useRef<HTMLDivElement>(null)

        const selectItem = (index: number): void => {
            const item = items[index]
            if (item) {
                command(item)
            }
        }

        useEffect(() => {
            setSelectedIndex(0)
        }, [items])

        useEffect(() => {
            if (listRef.current) {
                const selectedElement = listRef.current.children[selectedIndex] as HTMLElement
                if (selectedElement) {
                    selectedElement.scrollIntoView({
                        block: 'nearest',
                    })
                }
            }
        }, [selectedIndex])

        const onKeyDown = ({ event }: { event: KeyboardEvent }): boolean => {
            if (event.key === 'ArrowUp') {
                setSelectedIndex((selectedIndex + items.length - 1) % items.length)
                return true
            }

            if (event.key === 'ArrowDown') {
                setSelectedIndex((selectedIndex + 1) % items.length)
                return true
            }

            if (event.key === 'Enter') {
                selectItem(selectedIndex)
                return true
            }

            return false
        }

        // Expose the onKeyDown method to parent via ref
        useImperativeHandle(ref, () => ({
            onKeyDown,
        }), [selectedIndex, items])

        if (!items || items.length === 0) return null

        return (
            <div
                ref={listRef}
                className="suggestion-list text-xs z-50 min-w-80 max-h-80 overflow-auto rounded-md border border-border bg-panel shadow-lg"
            >
                {items.map((item: SuggestionItem, index: number) => (
                    <button
                        key={index}
                        type="button"
                        className={`${index === selectedIndex ? 'bg-active ring-1 ring-border' : ''
                            } relative flex w-full cursor-pointer select-none items-center rounded px-3 py-2 text-text outline-none transition-all hover:bg-active group`}
                        onClick={() => selectItem(index)}
                    >
                        <div className="font-mono">{item.label}</div>
                        {item.description && (
                            <div className="text-comment text-[11px] ml-auto pl-4 truncate">{item.description}</div>
                        )}
                    </button>
                ))}
            </div>
        )
    }
)

VariableList.displayName = 'VariableList'

export default VariableList