import type { EditorError } from './editor-error.ts'
import { type FunctionParameter, type FunctionSignature } from './function-signature.ts'
import { drawTokensWithCustomLigatures, extractTokensForSegment, type MonoLigatureCache } from './mono-text.ts'
import { type PopupCanvasHitRegion, popupCanvasThemeFallback, popupCanvasUiFont } from './popup-canvas.ts'
import { fillRoundedRectWithShadow, fontWithWeight, maxLineWidth, roundedRectPath, strokeRoundedRect,
  wrapText } from './popup-drawing.ts'
import { defaultTokenizer, highlightCode, type Theme, type Token, type Tokenizer } from './syntax.ts'

export type FunctionSignaturePopupCache = {
  exampleLigatureCache: MonoLigatureCache
  lastDimensions: { width: number; height: number } | null
}

export const drawFunctionSignaturePopup = (
  input: {
    context: CanvasRenderingContext2D
    width: number
    height: number
    position: { x: number; y: number }
    signature: FunctionSignature
    currentArgumentIndex: number
    currentParameterName?: string
    theme?: Theme
    tokenizer?: Tokenizer
    cache: FunctionSignaturePopupCache
    onDimensionsChange?: (width: number, height: number) => void
  },
) => {
  const {
    context,
    width,
    height,
    position,
    signature,
    currentArgumentIndex,
    currentParameterName,
    theme,
    tokenizer,
    cache,
    onDimensionsChange,
  } = input

  const effectiveTheme = popupCanvasThemeFallback(theme)

  const getEffectiveParameterIndex = (argIndex: number, paramName?: string): number => {
    if (paramName) {
      const paramIndex = signature.parameters.findIndex(
        param => param.name === paramName || param.name === `...${paramName}`,
      )
      if (paramIndex >= 0) return paramIndex
    }

    for (let i = signature.parameters.length - 1; i >= 0; i--) {
      const param = signature.parameters[i]
      if (param.name.startsWith('...') && i <= argIndex) return i
    }
    return argIndex
  }

  const effectiveParameterIndex = getEffectiveParameterIndex(currentArgumentIndex, currentParameterName)

  const padding = 12
  const radius = 8
  const lineHeight = 20
  const caretGap = 1
  const margin = 0

  const monoFont = effectiveTheme.font
  const monoBoldFont = fontWithWeight(monoFont, 600)
  const uiFont = popupCanvasUiFont(14, 20, 400)
  const uiBoldFont = popupCanvasUiFont(14, 20, 600)
  const uiXsBoldFont = popupCanvasUiFont(12, 16, 600)

  context.textBaseline = 'alphabetic'

  const caretLineTop = position.y - 2
  const caretLineBottom = position.y + lineHeight - 1
  const leftW = Math.max(0, position.x - margin)
  const rightW = Math.max(0, width - margin - position.x)
  const topH = Math.max(0, caretLineTop - margin)
  const bottomH = Math.max(0, height - margin - caretLineBottom)

  type Quadrant = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  const fractions = [0.25, 0.5, 0.75, 1] as const
  const defs: Array<{ quadrant: Quadrant; w: number; h: number }> = [
    { quadrant: 'bottomRight', w: rightW, h: bottomH },
    { quadrant: 'bottomLeft', w: leftW, h: bottomH },
    { quadrant: 'topRight', w: rightW, h: topH },
    { quadrant: 'topLeft', w: leftW, h: topH },
  ]

  const overlapCaret = (top: number, popupHeight: number) => {
    const bottom = top + popupHeight
    return bottom > caretLineTop && top < caretLineBottom
  }

  const place = (quadrant: Quadrant, popupWidth: number, popupHeight: number) => {
    const isTop = quadrant.startsWith('top')
    const isLeft = quadrant.endsWith('Left')
    const top = isTop
      ? Math.floor(caretLineTop - caretGap - popupHeight)
      : Math.ceil(caretLineBottom + caretGap)
    const left = isLeft
      ? Math.floor(position.x - popupWidth)
      : Math.ceil(position.x)
    return { left, top }
  }

  const overflowAmount = (left: number, top: number, popupWidth: number, popupHeight: number) => {
    const right = left + popupWidth
    const bottom = top + popupHeight
    const overLeft = Math.max(margin - left, 0)
    const overRight = Math.max(right - (width - margin), 0)
    const overTop = Math.max(margin - top, 0)
    const overBottom = Math.max(bottom - (height - margin), 0)
    return overLeft + overRight + overTop + overBottom
  }

  const layout = (frameWidth: number, left: number, top: number, paint: boolean) => {
    const contentLeft = left + padding
    const contentTop = top + padding
    const contentWidth = Math.max(1, frameWidth - padding * 2)
    const contentRight = contentLeft + contentWidth

    const fontNormal = monoFont
    const fontBold = monoBoldFont

    const fontMetrics = new Map<string, { ascent: number; descent: number; baselineOffset: number }>()
    const getFontMetrics = (font: string) => {
      const cached = fontMetrics.get(font)
      if (cached) return cached
      const prev = context.font
      context.font = font
      const metrics = context.measureText('Mg')
      context.font = prev
      const ascent = metrics.actualBoundingBoxAscent || 12
      const descent = metrics.actualBoundingBoxDescent || 4
      const next = { ascent, descent, baselineOffset: ascent }
      fontMetrics.set(font, next)
      return next
    }

    context.font = fontNormal
    const { ascent, descent } = getFontMetrics(fontNormal)
    const textHeight = ascent + descent
    const highlightPadX = 4
    const highlightPadY = 1
    const highlightTopOffset = Math.floor((lineHeight - textHeight) / 2) - highlightPadY
    const highlightHeight = Math.ceil(textHeight + highlightPadY * 2)

    let x = contentLeft
    let y = contentTop
    let usedWidth = 0

    const fitPrefixLength = (font: string, text: string, maxWidth: number) => {
      if (text.length === 0) return 0
      const prev = context.font
      context.font = font
      const limit = Math.max(1, maxWidth)
      if (context.measureText(text).width <= limit) {
        context.font = prev
        return text.length
      }
      let lo = 1
      let hi = text.length
      let bestEnd = 1
      while (lo <= hi) {
        const mid = Math.floor((lo + hi) / 2)
        const piece = text.substring(0, mid)
        if (context.measureText(piece).width <= limit) {
          bestEnd = mid
          lo = mid + 1
        }
        else {
          hi = mid - 1
        }
      }
      context.font = prev
      return bestEnd
    }

    const ensureFits = (w: number) => {
      if (x !== contentLeft && x + w > contentRight) {
        x = contentLeft
        y += lineHeight
      }
    }

    const drawText = (font: string, color: string, text: string, left: number, top: number) => {
      const { baselineOffset } = getFontMetrics(font)
      context.font = font
      context.fillStyle = color
      context.fillText(text, left, top + baselineOffset)
    }

    const addText = (font: string, color: string, text: string) => {
      let rest = text
      while (rest.length > 0) {
        context.font = font
        const available = contentRight - x
        const firstCharWidth = context.measureText(rest[0] ?? '').width
        if (x !== contentLeft && firstCharWidth > available) {
          x = contentLeft
          y += lineHeight
          continue
        }

        const end = fitPrefixLength(font, rest, available)
        const piece = rest.substring(0, end)
        const w = context.measureText(piece).width
        if (paint) drawText(font, color, piece, x, y)
        x += w
        usedWidth = Math.max(usedWidth, x - contentLeft)
        rest = rest.substring(end)
        if (rest.length > 0) {
          x = contentLeft
          y += lineHeight
        }
      }
    }

    const addParam = (param: FunctionParameter, index: number, isLast: boolean) => {
      const isActive = index === effectiveParameterIndex
      const segments: Array<{ font: string; color: string; text: string }> = [
        {
          font: fontNormal,
          color: effectiveTheme.functionSignaturePopup.parameterName,
          text: `${param.name}${param.optional ? '?' : ''}`,
        },
      ]
      if (param.type) {
        segments.push({ font: fontNormal, color: effectiveTheme.functionSignaturePopup.separator, text: ':' })
        segments.push({
          font: fontNormal,
          color: effectiveTheme.functionSignaturePopup.parameterType,
          text: param.type,
        })
      }
      const separatorText = isLast ? '' : ', '
      const separatorSegment = separatorText
        ? { font: fontNormal, color: effectiveTheme.functionSignaturePopup.separator, text: separatorText }
        : null

      const run = (paintRun: boolean) => {
        let rectLeft = x
        let rectTop = y
        const rects: Array<{ left: number; top: number; width: number }> = []
        const items: Array<{ font: string; color: string; text: string; left: number; top: number }> = []

        const newLine = () => {
          usedWidth = Math.max(usedWidth, x - contentLeft)
          if (isActive) {
            const rw = x - rectLeft
            if (rw > 0) rects.push({ left: rectLeft, top: rectTop, width: rw })
          }
          x = contentLeft
          y += lineHeight
          if (isActive) {
            rectLeft = x
            rectTop = y
          }
        }

        const write = (seg: { font: string; color: string; text: string }, allowBreak: boolean) => {
          context.font = seg.font
          const w = context.measureText(seg.text).width
          if (!allowBreak) {
            if (x !== contentLeft && x + w > contentRight) newLine()
            items.push({ ...seg, left: x, top: y })
            x += w
            usedWidth = Math.max(usedWidth, x - contentLeft)
            return
          }

          let rest = seg.text
          while (rest.length > 0) {
            context.font = seg.font
            const available = contentRight - x
            const firstCharWidth = context.measureText(rest[0] ?? '').width
            if (x !== contentLeft && firstCharWidth > available) {
              newLine()
              continue
            }

            const end = fitPrefixLength(seg.font, rest, available)
            const piece = rest.substring(0, end)
            const pw = context.measureText(piece).width
            items.push({ font: seg.font, color: seg.color, text: piece, left: x, top: y })
            x += pw
            usedWidth = Math.max(usedWidth, x - contentLeft)
            rest = rest.substring(end)
            if (rest.length > 0) newLine()
          }
        }

        for (let i = 0; i < segments.length; i++) {
          const seg = segments[i]!
          const next = segments[i + 1]
          if (seg.text === ':' && next) {
            context.font = seg.font
            const w1 = context.measureText(seg.text).width
            context.font = next.font
            const w2 = context.measureText(next.text).width
            if (x !== contentLeft && x + w1 + w2 > contentRight) newLine()
            write(seg, false)
            continue
          }
          write(seg, seg.text !== ':' && seg.text !== ', ')
        }

        if (isActive) {
          const rw = x - rectLeft
          if (rw > 0) rects.push({ left: rectLeft, top: rectTop, width: rw })
        }

        if (separatorSegment) write(separatorSegment, false)

        if (paintRun) {
          if (isActive) {
            for (const r of rects) {
              fillRoundedRectWithShadow(
                context,
                r.left - highlightPadX,
                r.top + highlightTopOffset - 5,
                r.width + highlightPadX * 1.5,
                highlightHeight + 4,
                5,
                effectiveTheme.functionSignaturePopup.activeParameterBackground,
                null,
              )
            }
          }
          for (const item of items) {
            drawText(
              item.font,
              isActive ? effectiveTheme.functionSignaturePopup.activeParameterText : item.color,
              item.text,
              item.left,
              item.top,
            )
          }
        }

        usedWidth = Math.max(usedWidth, x - contentLeft)
      }

      run(paint)
    }

    // Signature line
    addText(fontBold, effectiveTheme.functionSignaturePopup.functionName, signature.name)
    if (signature.type !== 'variable') {
      addText(fontNormal, effectiveTheme.functionSignaturePopup.separator, '(')
      signature.parameters.forEach((param, index) => addParam(param, index, index === signature.parameters.length - 1))
      addText(fontNormal, effectiveTheme.functionSignaturePopup.separator, ')')
    }
    if (signature.returnType) {
      addText(fontNormal, effectiveTheme.functionSignaturePopup.separator, ': ')
      addText(fontNormal, effectiveTheme.functionSignaturePopup.returnType, signature.returnType)
    }

    x = contentLeft
    y += lineHeight

    if (signature.description) {
      y += 8
      const lines = wrapText(context, uiBoldFont, signature.description, contentWidth)
      for (const line of lines) {
        if (paint) {
          drawText(uiBoldFont, effectiveTheme.functionSignaturePopup.description, line, contentLeft, y)
        }
        usedWidth = Math.max(usedWidth, maxLineWidth(context, uiBoldFont, [line]))
        y += lineHeight
      }
    }

    // Only show parameter details for functions, not variables
    if (signature.type !== 'variable') {
      const param = signature.parameters[effectiveParameterIndex]
      if (param) {
        y += 8
        if (paint) {
          context.strokeStyle = effectiveTheme.functionSignaturePopup.border
          context.lineWidth = 1
          context.beginPath()
          context.moveTo(contentLeft, y + 0.5)
          context.lineTo(left + frameWidth - padding, y + 0.5)
          context.stroke()
        }
        y += 8

        x = contentLeft
        const titleSegments: Array<{ font: string; color: string; text: string }> = [
          {
            font: fontBold,
            color: effectiveTheme.functionSignaturePopup.parameterName,
            text: `${param.name}${param.optional ? '?' : ''}`,
          },
        ]
        if (param.type) {
          titleSegments.push({ font: fontNormal, color: effectiveTheme.functionSignaturePopup.separator, text: ':' })
          titleSegments.push({
            font: fontNormal,
            color: effectiveTheme.functionSignaturePopup.parameterType,
            text: param.type,
          })
        }

        for (const s of titleSegments) addText(s.font, s.color, s.text)
        x = contentLeft
        y += lineHeight

        if (param.description) {
          y += 4
          const lines = wrapText(context, uiFont, param.description, contentWidth)
          usedWidth = Math.max(usedWidth, maxLineWidth(context, uiFont, lines))
          for (const line of lines) {
            if (paint) {
              drawText(uiFont, effectiveTheme.functionSignaturePopup.description, line, contentLeft, y)
            }
            y += lineHeight
          }
        }
      }
    }

    if (signature.examples && signature.examples.length > 0) {
      y += 12
      if (paint) {
        context.strokeStyle = effectiveTheme.functionSignaturePopup.border
        context.lineWidth = 1
        context.beginPath()
        context.moveTo(contentLeft, y + 0.5)
        context.lineTo(left + frameWidth - padding, y + 0.5)
        context.stroke()
      }
      y += 12

      if (paint) {
        drawText(uiXsBoldFont, effectiveTheme.functionSignaturePopup.separator, 'EXAMPLES', contentLeft, y)
      }
      y += 18

      const boxPaddingX = 8
      const boxPaddingY = 6
      const boxRadius = 6
      for (let exampleIndex = 0; exampleIndex < signature.examples.length; exampleIndex++) {
        const example = signature.examples[exampleIndex]
        const exampleFont = `11pt ${monoFont.split(' ').slice(1).join(' ')}`
        const availableWidth = contentWidth - boxPaddingX * 2
        const highlighted = highlightCode(example, tokenizer ?? defaultTokenizer, effectiveTheme)
        usedWidth = Math.max(
          usedWidth,
          Math.min(
            contentWidth,
            boxPaddingX * 2 + maxLineWidth(context, exampleFont, highlighted.map(l => l.text)),
          ),
        )

        const wrapHighlightedLine = (
          lineText: string,
          lineTokens: Token[],
        ) => {
          const segments: Array<{ start: number; end: number; text: string }> = []
          if (lineText.length === 0) return segments

          const tokenBoundaries: number[] = []
          const spacePositions: number[] = []
          let currentColumn = 0
          for (const token of lineTokens) {
            const tokenEnd = currentColumn + token.content.length
            tokenBoundaries.push(tokenEnd)

            let spaceIndex = token.content.indexOf(' ')
            while (spaceIndex >= 0) {
              spacePositions.push(currentColumn + spaceIndex + 1)
              spaceIndex = token.content.indexOf(' ', spaceIndex + 1)
            }

            currentColumn = tokenEnd
          }

          let startColumn = 0
          while (startColumn < lineText.length) {
            const fullText = lineText.substring(startColumn)
            if (context.measureText(fullText).width <= availableWidth) {
              segments.push({ start: startColumn, end: lineText.length, text: fullText })
              break
            }

            let lo = startColumn + 1
            let hi = lineText.length
            let bestEnd = startColumn + 1
            while (lo <= hi) {
              const mid = Math.floor((lo + hi) / 2)
              const testText = lineText.substring(startColumn, mid)
              if (context.measureText(testText).width <= availableWidth) {
                bestEnd = mid
                lo = mid + 1
              }
              else {
                hi = mid - 1
              }
            }

            let lastTokenBoundary = -1
            for (let i = tokenBoundaries.length - 1; i >= 0; i--) {
              const boundary = tokenBoundaries[i]
              if (boundary <= bestEnd && boundary > startColumn) {
                lastTokenBoundary = boundary
                break
              }
            }

            let lastSpaceBoundary = -1
            for (let i = spacePositions.length - 1; i >= 0; i--) {
              const spacePos = spacePositions[i]
              if (spacePos <= bestEnd && spacePos > startColumn) {
                lastSpaceBoundary = spacePos
                break
              }
            }

            const candidateEnd = (lastSpaceBoundary > startColumn)
              ? lastSpaceBoundary
              : (lastTokenBoundary > startColumn ? lastTokenBoundary : bestEnd)

            const endColumn = Math.max(startColumn + 1, candidateEnd)
            segments.push({
              start: startColumn,
              end: endColumn,
              text: lineText.substring(startColumn, endColumn),
            })
            startColumn = endColumn
          }

          return segments
        }

        context.save()
        context.font = exampleFont
        context.textBaseline = 'top'

        const wrapped: Array<{ tokens: Token[]; text: string }> = []
        for (const line of highlighted) {
          const segs = wrapHighlightedLine(line.text, line.tokens)
          if (segs.length === 0) {
            wrapped.push({ tokens: [], text: '' })
            continue
          }
          for (const seg of segs) {
            wrapped.push({
              tokens: extractTokensForSegment(line.tokens, seg.start, seg.end),
              text: seg.text,
            })
          }
        }

        const boxHeight = boxPaddingY * 2 + Math.max(1, wrapped.length) * lineHeight

        if (paint) {
          fillRoundedRectWithShadow(
            context,
            contentLeft,
            y,
            contentWidth,
            boxHeight,
            boxRadius,
            'rgba(0, 0, 0, 0.2)',
            null,
          )
          strokeRoundedRect(
            context,
            contentLeft,
            y,
            contentWidth,
            boxHeight,
            boxRadius,
            { color: effectiveTheme.functionSignaturePopup.border, width: 1 },
          )
          for (let i = 0; i < wrapped.length; i++) {
            const row = wrapped[i]
            if (!row.text) continue
            drawTokensWithCustomLigatures(
              context,
              row.tokens,
              contentLeft + boxPaddingX,
              y + boxPaddingY + i * lineHeight + boxPaddingY / 2,
              effectiveTheme,
              { lineHeight, cache: cache.exampleLigatureCache },
            )
          }
        }
        context.restore()

        y += boxHeight
        if (exampleIndex !== signature.examples.length - 1) y += 8
      }
    }

    const totalHeight = y - top + padding
    return { usedWidth, height: Math.max(1, totalHeight) }
  }

  let best: {
    quadrant: Quadrant
    maxWidth: number
    width: number
    height: number
    left: number
    top: number
    overflow: number
    rightPref: number
    belowPref: number
  } | null = null

  for (const d of defs) {
    if (d.w <= 0 || d.h <= 0) continue
    for (const frac of fractions) {
      const maxWidth = Math.max(220, Math.floor(d.w * frac))
      const measuredAtMaxWidth = layout(maxWidth, 0, 0, false)
      const frameWidth = Math.min(maxWidth, Math.ceil(measuredAtMaxWidth.usedWidth + padding * 2))
      const measuredAtFrameWidth = (frameWidth === maxWidth)
        ? measuredAtMaxWidth
        : layout(frameWidth, 0, 0, false)
      const frameHeight = measuredAtFrameWidth.height

      const placed = place(d.quadrant, frameWidth, frameHeight)
      if (overlapCaret(placed.top, frameHeight)) continue

      const overflow = overflowAmount(placed.left, placed.top, frameWidth, frameHeight)
      const rightPref = d.quadrant.endsWith('Right') ? 0 : 1
      const belowPref = d.quadrant.startsWith('bottom') ? 0 : 1

      const next = {
        quadrant: d.quadrant,
        maxWidth,
        width: frameWidth,
        height: frameHeight,
        left: placed.left,
        top: placed.top,
        overflow,
        rightPref,
        belowPref,
      }

      if (!best) {
        best = next
        continue
      }

      const bestFits = best.overflow === 0
      const nextFits = next.overflow === 0
      if (bestFits !== nextFits) {
        if (nextFits) best = next
        continue
      }
      if (!bestFits && next.overflow !== best.overflow) {
        if (next.overflow < best.overflow) best = next
        continue
      }
      if (next.height !== best.height) {
        if (next.height < best.height) best = next
        continue
      }
      if (nextFits && next.rightPref !== best.rightPref) {
        if (next.rightPref < best.rightPref) best = next
        continue
      }
      if (next.width !== best.width) {
        if (next.width < best.width) best = next
        continue
      }
      if (next.maxWidth !== best.maxWidth) {
        if (next.maxWidth < best.maxWidth) best = next
        continue
      }
      if (next.belowPref !== best.belowPref) {
        if (next.belowPref < best.belowPref) best = next
      }
    }
  }

  if (!best) return

  const shadow = best.quadrant.startsWith('top')
    ? { color: 'rgba(0, 0, 0, 0.45)', blur: 24, offsetX: 0, offsetY: -12 }
    : { color: 'rgba(0, 0, 0, 0.45)', blur: 24, offsetX: 0, offsetY: 12 }

  fillRoundedRectWithShadow(
    context,
    best.left,
    best.top,
    best.width,
    best.height,
    radius,
    effectiveTheme.functionSignaturePopup.background,
    shadow,
  )
  strokeRoundedRect(
    context,
    best.left,
    best.top,
    best.width,
    best.height,
    radius,
    { color: effectiveTheme.functionSignaturePopup.border, width: 1 },
  )

  context.save()
  roundedRectPath(context, best.left, best.top, best.width, best.height, radius)
  context.clip()
  layout(best.width, best.left, best.top, true)
  context.restore()

  const last = cache.lastDimensions
  const next = { width: best.width, height: best.height }
  if (!last || last.width !== next.width || last.height !== next.height) {
    cache.lastDimensions = next
    onDimensionsChange?.(next.width, next.height)
  }
}

export type ErrorPopupCache = {
  lastDimensions: { width: number; height: number } | null
}

export const drawErrorPopup = (input: {
  context: CanvasRenderingContext2D
  width: number
  height: number
  position: { x: number; y: number }
  error: EditorError
  theme?: Theme
  cache: ErrorPopupCache
  onDimensionsChange?: (width: number, height: number) => void
}) => {
  const { context, width, height, position, error, theme, cache, onDimensionsChange } = input
  const effectiveTheme = popupCanvasThemeFallback(theme)

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

  const last = cache.lastDimensions
  const next = { width: popupWidth, height: popupHeight }
  if (!last || last.width !== next.width || last.height !== next.height) {
    cache.lastDimensions = next
    onDimensionsChange?.(next.width, next.height)
  }
}

export const drawAutocompletePopup = (input: {
  context: CanvasRenderingContext2D
  width: number
  height: number
  position: { x: number; y: number }
  suggestions: string[]
  selectedIndex: number
  theme?: Theme
  onSelect?: (index: number) => void
  onHover?: (index: number) => void
}): PopupCanvasHitRegion[] => {
  const { context, width, height, position, suggestions, selectedIndex, theme, onSelect, onHover } = input
  const effectiveTheme = popupCanvasThemeFallback(theme)

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
  const top = fitsBelow
    ? belowTop
    : (fitsAbove ? aboveTop : Math.max(margin, Math.min(belowTop, height - margin - popupHeight)))

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
      onHover: () => onHover?.(index),
      onSelect: () => onSelect?.(index),
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
}
