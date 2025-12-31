import { getTokenColor, type Theme, type Token } from './syntax.ts'

export type MonoLigatureCache = {
  ligatureArrowWidth?: number
  ligatureLineArrowWidth?: number
}

type Mono2dCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

const drawArrowLigature = (
  ctx: Mono2dCtx,
  x: number,
  y: number,
  color: string,
  reservedWidth: number,
  lineHeight: number,
) => {
  const side = reservedWidth
  const height = (Math.sqrt(3) / 2) * side
  const centerY = y + lineHeight / 2 - 3.5
  const centerX = x + reservedWidth

  const tipX = centerX + side / 2
  const tipY = centerY
  const blX = centerX - side / 2
  const blY = centerY + height / 2
  const tlX = centerX - side / 2
  const tlY = centerY - height / 2

  ctx.strokeStyle = color
  ctx.lineWidth = 1.25
  ctx.lineJoin = 'miter'
  ctx.beginPath()
  ctx.moveTo(tipX, tipY)
  ctx.lineTo(blX, blY)
  ctx.lineTo(tlX, tlY)
  ctx.closePath()
  ctx.stroke()
}

const drawLineArrowLigature = (
  ctx: Mono2dCtx,
  x: number,
  y: number,
  color: string,
  reservedWidth: number,
  lineHeight: number,
) => {
  const centerY = y + lineHeight / 2 - 3.5
  const startX = x + reservedWidth * 0.15
  const endX = x + reservedWidth * 0.85

  ctx.strokeStyle = color
  ctx.lineWidth = 1.25

  ctx.beginPath()
  ctx.moveTo(startX, centerY)
  ctx.lineTo(endX, centerY)
  ctx.stroke()

  const head = Math.min(6, reservedWidth * 0.5)
  const upY = centerY - head * 0.6
  const downY = centerY + head * 0.6

  ctx.beginPath()
  ctx.moveTo(endX, centerY)
  ctx.lineTo(endX - head, upY)
  ctx.moveTo(endX, centerY)
  ctx.lineTo(endX - head, downY)
  ctx.stroke()
}

export const drawTokensWithCustomLigatures = (
  ctx: Mono2dCtx,
  tokens: Token[],
  startX: number,
  y: number,
  theme: Theme,
  opts: { lineHeight: number; cache?: MonoLigatureCache },
): number => {
  let currentX = startX
  let pendingSkipNextLeading = false
  let batchText = ''
  let batchColor = ''

  const cache = opts.cache
  let arrowWidth = cache?.ligatureArrowWidth
  if (arrowWidth === undefined) {
    arrowWidth = ctx.measureText('|>').width
    if (cache) cache.ligatureArrowWidth = arrowWidth
  }
  const arrowHalfWidth = arrowWidth / 2
  let lineArrowWidth = cache?.ligatureLineArrowWidth
  if (lineArrowWidth === undefined) {
    lineArrowWidth = ctx.measureText('->').width
    if (cache) cache.ligatureLineArrowWidth = lineArrowWidth
  }

  const flushBatch = () => {
    if (!batchText) return
    ctx.fillStyle = batchColor
    ctx.fillText(batchText, currentX, y)
    currentX += ctx.measureText(batchText).width
    batchText = ''
  }

  for (let ti = 0; ti < tokens.length; ti++) {
    const token = tokens[ti]
    const color = getTokenColor(token.type, theme, token)
    const text = token.content

    let i = pendingSkipNextLeading ? 1 : 0
    pendingSkipNextLeading = false

    const textLen = text.length
    const isLastToken = ti + 1 >= tokens.length
    const nextTokenFirstChar = !isLastToken ? tokens[ti + 1].content[0] : null

    for (; i < textLen; i++) {
      const ch = text[i]
      const isLastChar = i + 1 >= textLen
      const nextCharInSame = !isLastChar ? text[i + 1] : null
      const nextChar = nextCharInSame ?? nextTokenFirstChar

      let ligatureType: '|>' | '->' | null = null
      if (ch === '|' && nextChar === '>') ligatureType = '|>'
      else if (ch === '-' && nextChar === '>') ligatureType = '->'

      if (ligatureType) {
        flushBatch()
        if (ligatureType === '|>') {
          drawArrowLigature(ctx, currentX, y, color, arrowHalfWidth, opts.lineHeight)
          currentX += arrowWidth
        }
        else {
          drawLineArrowLigature(ctx, currentX, y, color, lineArrowWidth, opts.lineHeight)
          currentX += lineArrowWidth
        }

        if (nextCharInSame === '>') {
          i++
          continue
        }

        pendingSkipNextLeading = true
        break
      }

      if (batchColor !== color) {
        flushBatch()
        batchColor = color
      }

      batchText += ch
    }
  }

  flushBatch()
  return currentX
}

export const extractTokensForSegment = (
  tokens: Token[],
  startColumn: number,
  endColumn: number,
): Token[] => {
  const result: Token[] = []
  let currentColumn = 0

  for (const token of tokens) {
    const tokenStart = currentColumn
    const tokenEnd = currentColumn + token.content.length

    if (tokenEnd <= startColumn) {
      currentColumn = tokenEnd
      continue
    }

    if (tokenStart >= endColumn) {
      break
    }

    const segmentStart = Math.max(startColumn, tokenStart)
    const segmentEnd = Math.min(endColumn, tokenEnd)
    const segmentContent = token.content.substring(
      segmentStart - tokenStart,
      segmentEnd - tokenStart,
    )

    if (segmentContent.length > 0) {
      result.push({
        type: token.type,
        color: token.color,
        content: segmentContent,
        length: segmentContent.length,
      })
    }

    currentColumn = tokenEnd
  }

  return result
}
