import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const containerRef = useRef<HTMLElement | null>(null)
  const [positionOffset, setPositionOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Calculate position offset - runs after layout to ensure accurate measurements
  const calculateOffset = useCallback(() => {
    if (!popupRef.current) {
      setPositionOffset({ x: 0, y: 0 })
      containerRef.current = null
      return
    }

    // Find the nearest ancestor with transforms that creates a containing block for fixed positioning
    let element: HTMLElement | null = popupRef.current.parentElement
    let transformAncestor: HTMLElement | null = null

    while (element) {
      const style = window.getComputedStyle(element)
      const transform = style.transform
      const willChange = style.willChange
      const filter = style.filter
      const perspective = style.perspective
      if (
        transform !== 'none' ||
        (willChange && (willChange.includes('transform') || willChange.includes('filter'))) ||
        filter !== 'none' ||
        (perspective !== 'none' && perspective !== '')
      ) {
        transformAncestor = element
        break
      }
      element = element.parentElement
    }

    containerRef.current = transformAncestor

    if (transformAncestor) {
      // Get the container's bounding rect (accounts for transforms)
      const containerRect = transformAncestor.getBoundingClientRect()
      // The position passed in is viewport coordinates, but if there's a transform ancestor,
      // fixed positioning is relative to that ancestor, so we need to adjust
      setPositionOffset({
        x: containerRect.left,
        y: containerRect.top,
      })
    } else {
      setPositionOffset({ x: 0, y: 0 })
    }
  }, [])

  // Find the containing block for fixed positioning and calculate offset
  useLayoutEffect(() => {
    if (!visible) {
      setPositionOffset({ x: 0, y: 0 })
      containerRef.current = null
      return
    }

    // Use RAF to ensure DOM is fully laid out
    const rafId = requestAnimationFrame(() => {
      calculateOffset()
    })

    return () => cancelAnimationFrame(rafId)
  }, [visible, position.x, position.y, calculateOffset])

  // Keep selected item in view as selection changes
  useEffect(() => {
    if (visible && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [visible, selectedIndex])

  // Minimal guard: don't render until we have a non-zero position
  if (!visible || suggestions.length === 0) return null
  if (position.x === 0 && position.y === 0) return null

  // Adjust position if container has transforms (fixed positioning becomes relative to transformed ancestor)
  const adjustedX = position.x - positionOffset.x
  const adjustedY = position.y - positionOffset.y

  // Simple placement: below the caret with slight spacing
  const lineHeight = 20
  const spacing = -2
  const left = adjustedX
  const top = adjustedY + lineHeight + spacing

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
