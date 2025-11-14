import { useEffect, useRef } from 'react'
import { type Theme, defaultTheme } from './syntax.ts'

interface AutocompletePopupProps {
  suggestions: string[]
  selectedIndex: number
  position: { x: number; y: number }
  visible: boolean
  theme?: Theme
  onSelect?: (index: number) => void
  onHover?: (index: number) => void
}

const AutocompletePopup = ({
  suggestions,
  selectedIndex,
  position,
  visible,
  theme = defaultTheme,
  onSelect,
  onHover,
}: AutocompletePopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null)
  const selectedItemRef = useRef<HTMLDivElement>(null)

  // Keep selected item in view as selection changes
  useEffect(() => {
    if (visible && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [visible, selectedIndex])

  // Minimal guard: don't render until we have a non-zero position
  if (!visible || suggestions.length === 0) return null
  if (position.x === 0 && position.y === 0) return null

  // Simple placement: below the caret with slight spacing
  const lineHeight = 20
  const spacing = -2
  const left = position.x
  const top = position.y + lineHeight + spacing

  return (
    <div
      ref={popupRef}
      className="fixed z-[9999] rounded-lg shadow-2xl overflow-auto cursor-default"
      style={{
        left: `${left}px`,
        top: `${top}px`,
        backgroundColor: theme.autocompletePopup.background,
        borderColor: theme.autocompletePopup.border,
        borderWidth: '1px',
        borderStyle: 'solid',
      }}
      onMouseDown={e => {
        // Keep editor focus stable while interacting with the popup
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <div className="py-1">
        {suggestions.map((suggestion, index) => {
          const isSelected = index === selectedIndex
          return (
            <div
              key={suggestion}
              ref={isSelected ? selectedItemRef : undefined}
              className="px-3 py-1 font-mono text-sm cursor-default"
              style={{
                backgroundColor: isSelected
                  ? theme.autocompletePopup.selectedBackground
                  : 'transparent',
                color: isSelected ? theme.autocompletePopup.selectedText : theme.autocompletePopup.text,
              }}
              onMouseEnter={e => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = theme.autocompletePopup.hoverBackground
                }
                onHover?.(index)
              }}
              onMouseLeave={e => {
                if (!isSelected) {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }
              }}
              onMouseDown={e => {
                e.preventDefault()
                e.stopPropagation()
                onSelect?.(index)
              }}
            >
              {suggestion}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default AutocompletePopup
