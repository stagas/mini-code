import { useEffect, useMemo, useRef } from 'react'
import { setPopupCanvasDrawable, type PopupCanvasHitRegion, popupCanvasThemeFallback } from './popup-canvas.ts'
import { fillRoundedRectWithShadow, fontWithWeight, strokeRoundedRect } from './popup-drawing.ts'
import { type Theme } from './syntax.ts'

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
  theme,
  onSelect,
  onHover,
}: AutocompletePopupProps) => {
  const idRef = useRef<string>(Math.random().toString(36).slice(2))
  const effectiveTheme = popupCanvasThemeFallback(theme)

  const onSelectRef = useRef(onSelect)
  const onHoverRef = useRef(onHover)
  useEffect(() => {
    onSelectRef.current = onSelect
    onHoverRef.current = onHover
  }, [onSelect, onHover])

  const stable = useMemo(() => {
    return {
      id: idRef.current,
    }
  }, [])

  useEffect(() => {
    const id = stable.id
    if (!visible || suggestions.length === 0 || (position.x === 0 && position.y === 0)) {
      setPopupCanvasDrawable(id, null)
      return
    }

    setPopupCanvasDrawable(id, {
      priority: 20,
      wantsPointer: true,
      draw: ({ context, width, height }) => {
        const paddingY = 4
        const paddingX = 12
        const rowHeight = 20
        const margin = 10
        const radius = 8
        const lineHeight = 20
        const spacing = -2

        context.font = effectiveTheme.font
        context.textBaseline = 'top'

        const maxTextWidth = Math.max(
          1,
          Math.min(520, width - 2 * margin - 2 * paddingX),
        )

        let textWidth = 0
        for (const s of suggestions) {
          const w = Math.ceil(context.measureText(s).width)
          if (w > textWidth) textWidth = w
          if (textWidth >= maxTextWidth) {
            textWidth = maxTextWidth
            break
          }
        }

        let popupWidth = Math.min(width - 2 * margin, textWidth + paddingX * 2)
        popupWidth = Math.max(140, popupWidth)

        const maxRowsByViewport = Math.max(
          1,
          Math.floor((height - 2 * margin - paddingY * 2) / rowHeight),
        )
        const visibleRows = Math.min(suggestions.length, Math.min(12, maxRowsByViewport))
        const popupHeight = paddingY * 2 + visibleRows * rowHeight

        let left = position.x
        left = Math.min(left, width - margin - popupWidth)
        left = Math.max(margin, left)

        const belowTop = position.y + lineHeight + spacing
        const aboveTop = position.y - spacing - popupHeight
        const fitsBelow = belowTop + popupHeight <= height - margin
        const fitsAbove = aboveTop >= margin
        const top = fitsBelow ? belowTop : (fitsAbove ? aboveTop : Math.max(margin, Math.min(belowTop, height - margin - popupHeight)))

        const canScroll = suggestions.length > visibleRows
        const startIndex = canScroll
          ? Math.max(0, Math.min(suggestions.length - visibleRows, selectedIndex - Math.floor(visibleRows / 2)))
          : 0

        fillRoundedRectWithShadow(
          context,
          left,
          top,
          popupWidth,
          popupHeight,
          radius,
          effectiveTheme.autocompletePopup.background,
          { color: 'rgba(0, 0, 0, 0.45)', blur: 24, offsetX: 0, offsetY: 12 },
        )
        strokeRoundedRect(
          context,
          left,
          top,
          popupWidth,
          popupHeight,
          radius,
          { color: effectiveTheme.autocompletePopup.border, width: 1 },
        )

        const regions: PopupCanvasHitRegion[] = []
        const listLeft = left
        const listTop = top + paddingY
        for (let i = 0; i < visibleRows; i++) {
          const index = startIndex + i
          const text = suggestions[index]
          const isSelected = index === selectedIndex
          const rowTop = listTop + i * rowHeight

          if (isSelected) {
            fillRoundedRectWithShadow(
              context,
              listLeft + 2,
              rowTop,
              popupWidth - 4,
              rowHeight,
              6,
              effectiveTheme.autocompletePopup.selectedBackground,
              null,
            )
          }

          context.font = isSelected
            ? fontWithWeight(effectiveTheme.font, 500)
            : effectiveTheme.font
          context.fillStyle = isSelected
            ? effectiveTheme.autocompletePopup.selectedText
            : effectiveTheme.autocompletePopup.text
          context.fillText(text, left + paddingX, rowTop + 4)

          regions.push({
            left: listLeft,
            top: rowTop,
            width: popupWidth,
            height: rowHeight,
            onHover: () => onHoverRef.current?.(index),
            onSelect: () => onSelectRef.current?.(index),
          })
        }

        if (canScroll) {
          const trackWidth = 6
          const trackLeft = left + popupWidth - trackWidth - 3
          const trackTop = top + paddingY + 2
          const trackHeight = popupHeight - paddingY * 2 - 4

          context.fillStyle = 'rgba(255, 255, 255, 0.08)'
          fillRoundedRectWithShadow(context, trackLeft, trackTop, trackWidth, trackHeight, 3, context.fillStyle, null)

          const thumbHeight = Math.max(18, Math.floor(trackHeight * (visibleRows / suggestions.length)))
          const maxThumbTop = trackTop + trackHeight - thumbHeight
          const t = startIndex / Math.max(1, suggestions.length - visibleRows)
          const thumbTop = Math.floor(trackTop + t * (maxThumbTop - trackTop))

          context.fillStyle = 'rgba(255, 255, 255, 0.22)'
          fillRoundedRectWithShadow(context, trackLeft, thumbTop, trackWidth, thumbHeight, 3, context.fillStyle, null)
        }

        return regions
      },
    })

    return () => setPopupCanvasDrawable(id, null)
  }, [
    stable,
    visible,
    suggestions,
    selectedIndex,
    position.x,
    position.y,
    effectiveTheme,
  ])

  return null
}

export default AutocompletePopup
