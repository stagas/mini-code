import { useEffect, useMemo, useRef } from 'react'
import { popupCanvasThemeFallback, popupCanvasUiFont, setPopupCanvasDrawable } from './popup-canvas.ts'
import { fillRoundedRectWithShadow, strokeRoundedRect, wrapText } from './popup-drawing.ts'
import { type Theme } from './syntax.ts'

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
  theme?: Theme
  onDimensionsChange?: (width: number, height: number) => void
}

const ErrorPopup = ({ error, position, visible, theme, onDimensionsChange }: ErrorPopupProps) => {
  const idRef = useRef<string>(Math.random().toString(36).slice(2))
  const effectiveTheme = popupCanvasThemeFallback(theme)
  const onDimensionsChangeRef = useRef(onDimensionsChange)
  const lastDimensionsRef = useRef<{ width: number; height: number } | null>(null)

  useEffect(() => {
    onDimensionsChangeRef.current = onDimensionsChange
  }, [onDimensionsChange])

  const stable = useMemo(() => ({ id: idRef.current }), [])

  useEffect(() => {
    const id = stable.id
    if (!visible) {
      setPopupCanvasDrawable(id, null)
      return
    }

    setPopupCanvasDrawable(id, {
      priority: 30,
      wantsPointer: false,
      draw: ({ context, width, height }) => {
        const margin = 10
        const lineHeight = 20
        const spacing = 5
        const padding = 12
        const radius = 8
        const maxWidth = Math.max(160, Math.min(520, width - 2 * margin))

        const font = popupCanvasUiFont(14, 20, 400)
        context.textBaseline = 'alphabetic'
        context.font = font
        const metrics = context.measureText('Mg')
        const ascent = metrics.actualBoundingBoxAscent || 12
        const baselineOffset = ascent

        const lines = wrapText(context, font, error.message, maxWidth - padding * 2)
        const contentHeight = Math.max(1, lines.length) * lineHeight
        const popupWidth = Math.min(
          maxWidth,
          Math.ceil(Math.max(120, Math.max(...lines.map(l => context.measureText(l).width), 0) + padding * 2)),
        )
        const popupHeight = padding * 2 + contentHeight

        let left = position.x
        const rightEdge = left + popupWidth
        if (rightEdge > width - margin) {
          const shiftedX = width - popupWidth - margin
          left = shiftedX >= margin ? shiftedX : margin
        }

        const spaceAbove = position.y - margin
        const spaceBelow = height - (position.y + lineHeight) - margin

        let top = position.y + lineHeight + spacing
        if (spaceBelow < popupHeight && spaceAbove >= popupHeight) {
          top = position.y - popupHeight - spacing
        }
        else if (spaceBelow < popupHeight && spaceAbove < popupHeight) {
          top = spaceAbove > spaceBelow ? margin : position.y + lineHeight + spacing
        }

        fillRoundedRectWithShadow(
          context,
          left,
          top,
          popupWidth,
          popupHeight,
          radius,
          effectiveTheme.errorPopup.background,
          { color: 'rgba(0, 0, 0, 0.45)', blur: 24, offsetX: 0, offsetY: 12 },
        )
        strokeRoundedRect(
          context,
          left,
          top,
          popupWidth,
          popupHeight,
          radius,
          { color: effectiveTheme.errorPopup.border, width: 1 },
        )

        context.fillStyle = effectiveTheme.errorPopup.text
        for (let i = 0; i < lines.length; i++) {
          context.fillText(lines[i], left + padding, top + padding + i * lineHeight + baselineOffset)
        }

        const last = lastDimensionsRef.current
        const next = { width: popupWidth, height: popupHeight }
        if (!last || last.width !== next.width || last.height !== next.height) {
          lastDimensionsRef.current = next
          onDimensionsChangeRef.current?.(next.width, next.height)
        }

        return null
      },
    })

    return () => setPopupCanvasDrawable(id, null)
  }, [
    stable,
    visible,
    error.message,
    position.x,
    position.y,
    effectiveTheme,
  ])

  return null
}

export default ErrorPopup
