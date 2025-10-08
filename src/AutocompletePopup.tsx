import { useEffect, useRef, useState } from 'react'

interface AutocompletePopupProps {
  suggestions: string[]
  selectedIndex: number
  position: { x: number; y: number }
  visible: boolean
}

const AutocompletePopup = ({
  suggestions,
  selectedIndex,
  position,
  visible,
}: AutocompletePopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null)
  const selectedItemRef = useRef<HTMLDivElement>(null)
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null)

  // Measure popup dimensions after render
  useEffect(() => {
    if (visible && popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredSize({ width: rect.width, height: rect.height })
      }
    } else if (!visible) {
      setMeasuredSize(null)
    }
  }, [visible, suggestions, selectedIndex])

  // Scroll selected item into view
  useEffect(() => {
    if (visible && selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ block: 'nearest' })
    }
  }, [visible, selectedIndex])

  if (!visible || suggestions.length === 0) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = 10
  const lineHeight = 20
  const spacing = 0

  let finalX = position.x
  let finalY = position.y
  let maxWidth: number | undefined = undefined
  let maxHeight: number | undefined = undefined

  if (!measuredSize) {
    // First render: position off-screen to allow measurement
    finalX = -9999
    finalY = -9999
  } else {
    const popupWidth = measuredSize.width
    const popupHeight = measuredSize.height

    // HORIZONTAL: Try to fit at natural width, shift left if needed
    const rightEdge = position.x + popupWidth

    if (rightEdge <= viewportWidth - margin) {
      finalX = position.x
      maxWidth = undefined
    } else {
      const shiftedX = viewportWidth - popupWidth - margin

      if (shiftedX >= margin) {
        finalX = shiftedX
        maxWidth = undefined
      } else {
        finalX = margin
        maxWidth = viewportWidth - 2 * margin
      }
    }

    // VERTICAL: Prefer below, fallback to above
    const spaceAbove = position.y - margin
    const spaceBelow = viewportHeight - (position.y + lineHeight) - margin

    if (spaceBelow >= popupHeight) {
      // Show below
      finalY = position.y + lineHeight + spacing
    } else if (spaceAbove >= popupHeight) {
      // Show above
      finalY = position.y - popupHeight - spacing
    } else {
      // Doesn't fit either way - use side with more space and constrain height
      if (spaceBelow > spaceAbove) {
        finalY = position.y + lineHeight + spacing
        maxHeight = spaceBelow
      } else {
        finalY = margin
        maxHeight = spaceAbove
      }
    }
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-[9999] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl pointer-events-none overflow-auto"
      style={{
        left: `${finalX}px`,
        top: `${finalY}px`,
        ...(maxWidth ? { maxWidth: `${maxWidth}px` } : {}),
        ...(maxHeight ? { maxHeight: `${maxHeight}px` } : {}),
      }}
    >
      <div className="py-1">
        {suggestions.map((suggestion, index) => (
          <div
            key={suggestion}
            ref={index === selectedIndex ? selectedItemRef : undefined}
            className={`px-3 py-1 font-mono text-sm ${
              index === selectedIndex ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-800'
            }`}
          >
            {suggestion}
          </div>
        ))}
      </div>
    </div>
  )
}

export default AutocompletePopup
