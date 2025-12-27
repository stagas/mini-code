export const roundedRectPath = (
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
) => {
  const right = left + width
  const bottom = top + height
  const r = Math.max(0, Math.min(radius, width / 2, height / 2))
  context.beginPath()
  context.moveTo(left + r, top)
  context.lineTo(right - r, top)
  context.quadraticCurveTo(right, top, right, top + r)
  context.lineTo(right, bottom - r)
  context.quadraticCurveTo(right, bottom, right - r, bottom)
  context.lineTo(left + r, bottom)
  context.quadraticCurveTo(left, bottom, left, bottom - r)
  context.lineTo(left, top + r)
  context.quadraticCurveTo(left, top, left + r, top)
  context.closePath()
}

export const fillRoundedRectWithShadow = (
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
  background: string,
  shadow: { color: string; blur: number; offsetX: number; offsetY: number } | null,
) => {
  context.save()
  if (shadow) {
    context.shadowColor = shadow.color
    context.shadowBlur = shadow.blur
    context.shadowOffsetX = shadow.offsetX
    context.shadowOffsetY = shadow.offsetY
  }
  context.fillStyle = background
  roundedRectPath(context, left, top, width, height, radius)
  context.fill()
  context.restore()
}

export const strokeRoundedRect = (
  context: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
  radius: number,
  border: { color: string; width: number },
) => {
  context.save()
  context.strokeStyle = border.color
  context.lineWidth = border.width
  roundedRectPath(context, left + 0.5, top + 0.5, width - 1, height - 1, radius)
  context.stroke()
  context.restore()
}

export const fontWithWeight = (font: string, weight: number | string) => {
  return `${weight} ${font}`
}

const measureWithFont = (context: CanvasRenderingContext2D, font: string, text: string) => {
  const prev = context.font
  context.font = font
  const width = context.measureText(text).width
  context.font = prev
  return width
}

const breakWord = (context: CanvasRenderingContext2D, font: string, word: string, maxWidth: number) => {
  const parts: string[] = []
  let line = ''
  for (const ch of word) {
    const next = line + ch
    if (measureWithFont(context, font, next) <= maxWidth || line.length === 0) {
      line = next
      continue
    }
    parts.push(line)
    line = ch
  }
  if (line) parts.push(line)
  return parts
}

export const wrapText = (
  context: CanvasRenderingContext2D,
  font: string,
  text: string,
  maxWidth: number,
) => {
  const lines: string[] = []
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return lines

  let line = ''
  for (const word of cleaned.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (measureWithFont(context, font, next) <= maxWidth) {
      line = next
      continue
    }
    if (line) lines.push(line)

    if (measureWithFont(context, font, word) <= maxWidth) {
      line = word
      continue
    }

    const parts = breakWord(context, font, word, maxWidth)
    for (let i = 0; i < parts.length - 1; i++) lines.push(parts[i])
    line = parts[parts.length - 1] ?? ''
  }
  if (line) lines.push(line)
  return lines
}

export const maxLineWidth = (context: CanvasRenderingContext2D, font: string, lines: string[]) => {
  let max = 0
  for (const line of lines) {
    const w = measureWithFont(context, font, line)
    if (w > max) max = w
  }
  return max
}


