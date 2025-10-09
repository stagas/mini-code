import { useEffect, useRef, useState } from 'react'

export interface EditorError {
  line: number
  startColumn: number
  endColumn: number
  message: string
}

interface ErrorPopupProps {
  error: EditorError
  position: { x: number; y: number }
  visible: boolean
  onDimensionsChange?: (width: number, height: number) => void
}

const ErrorPopup = ({ error, position, visible, onDimensionsChange }: ErrorPopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null)
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (visible && popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredSize({ width: rect.width, height: rect.height })
        onDimensionsChange?.(rect.width, rect.height)
      }
    } else if (!visible) {
      setMeasuredSize(null)
    }
  }, [visible, error, onDimensionsChange])

  if (!visible) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = 10
  const lineHeight = 20
  const spacing = 5

  let finalX = position.x
  let finalY = position.y
  let maxWidth: number | undefined = undefined

  if (!measuredSize) {
    finalX = -9999
    finalY = -9999
  } else {
    const popupWidth = measuredSize.width
    const popupHeight = measuredSize.height

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

    const spaceAbove = position.y - margin
    const spaceBelow = viewportHeight - (position.y + lineHeight) - margin

    if (spaceBelow >= popupHeight) {
      finalY = position.y + lineHeight + spacing
    } else if (spaceAbove >= popupHeight) {
      finalY = position.y - popupHeight - spacing
    } else {
      if (spaceAbove > spaceBelow) {
        finalY = margin
      } else {
        finalY = position.y + lineHeight + spacing
      }
    }
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-[9999] bg-red-900 border border-red-700 rounded-lg shadow-2xl pointer-events-none"
      style={{
        left: `${finalX}px`,
        top: `${finalY}px`,
        ...(maxWidth ? { maxWidth: `${maxWidth}px` } : {}),
      }}
    >
      <div className="p-3">
        <div className="text-sm">
          <div className="text-red-300 break-words leading-relaxed">{error.message}</div>
        </div>
      </div>
    </div>
  )
}

export default ErrorPopup
