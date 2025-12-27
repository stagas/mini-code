import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { FunctionParameter, FunctionSignature } from './function-signature.ts'
import { defaultTheme, type Theme } from './syntax.ts'

interface FunctionSignaturePopupProps {
  signature: FunctionSignature
  currentArgumentIndex: number
  currentParameterName?: string
  position: { x: number; y: number }
  visible: boolean
  theme?: Theme
  onDimensionsChange?: (width: number, height: number) => void
}

const FunctionSignaturePopup = ({
  signature,
  currentArgumentIndex,
  currentParameterName,
  position,
  visible,
  theme = defaultTheme,
  onDimensionsChange,
}: FunctionSignaturePopupProps) => {
  const containerRef = useRef<HTMLElement | null>(null)
  const anchorRef = useRef<HTMLDivElement>(null)
  const candidateRefs = useRef(new Map<string, HTMLDivElement | null>())
  const [positionOffset, setPositionOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number }>({
    width: window.innerWidth,
    height: window.innerHeight,
  })
  const [layoutTick, setLayoutTick] = useState(0)
  const [selected, setSelected] = useState<{
    id: string
    left: number
    top: number
    maxWidth: number
    boxShadow: string
    measured: { width: number; height: number }
  } | null>(null)
  const onDimensionsChangeRef = useRef(onDimensionsChange)
  const layoutPassRef = useRef(0)
  const lastPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 })

  useEffect(() => {
    onDimensionsChangeRef.current = onDimensionsChange
  }, [onDimensionsChange])

  const margin = 0
  const lineHeight = 20
  const caretGap = 1

  const computeContainer = useCallback((): {
    offset: { x: number; y: number }
    viewport: { width: number; height: number }
  } => {
    const start = anchorRef.current?.parentElement
    if (!start) {
      containerRef.current = null
      return {
        offset: { x: 0, y: 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }
    }

    // Find the nearest ancestor with transforms that creates a containing block for fixed positioning
    let element: HTMLElement | null = start
    let transformAncestor: HTMLElement | null = null

    while (element) {
      const style = window.getComputedStyle(element)
      const transform = style.transform
      const willChange = style.willChange
      const filter = style.filter
      const perspective = style.perspective
      if (
        transform !== 'none'
        || (willChange && (willChange.includes('transform') || willChange.includes('filter')))
        || filter !== 'none'
        || (perspective !== 'none' && perspective !== '')
      ) {
        transformAncestor = element
        break
      }
      element = element.parentElement
    }

    containerRef.current = transformAncestor
    if (!transformAncestor) {
      return {
        offset: { x: 0, y: 0 },
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }
    }

    const rect = transformAncestor.getBoundingClientRect()
    const style = window.getComputedStyle(transformAncestor)
    const borderLeft = Number.parseFloat(style.borderLeftWidth) || 0
    const borderRight = Number.parseFloat(style.borderRightWidth) || 0
    const borderTop = Number.parseFloat(style.borderTopWidth) || 0
    const borderBottom = Number.parseFloat(style.borderBottomWidth) || 0
    const paddingLeft = Number.parseFloat(style.paddingLeft) || 0
    const paddingRight = Number.parseFloat(style.paddingRight) || 0
    const paddingTop = Number.parseFloat(style.paddingTop) || 0
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0

    // For transformed ancestors, fixed positioning is relative to the padding box.
    const offsetX = rect.left + borderLeft + paddingLeft
    const offsetY = rect.top + borderTop + paddingTop
    const viewportWidth = Math.max(0, rect.width - borderLeft - borderRight - paddingLeft - paddingRight)
    const viewportHeight = Math.max(0, rect.height - borderTop - borderBottom - paddingTop - paddingBottom)
    return {
      offset: { x: offsetX, y: offsetY },
      viewport: { width: viewportWidth, height: viewportHeight },
    }
  }, [])

  useEffect(() => {
    if (!visible) return
    const onWindowChange = () => setLayoutTick(t => t + 1)
    window.addEventListener('resize', onWindowChange, { passive: true })
    window.addEventListener('scroll', onWindowChange, { passive: true, capture: true })
    return () => {
      window.removeEventListener('resize', onWindowChange)
      window.removeEventListener('scroll', onWindowChange, true)
    }
  }, [visible])

  const effective = useMemo(() => {
    const adjustedX = position.x - positionOffset.x
    const adjustedY = position.y - positionOffset.y
    // CanvasEditor draws caret at (lastCaretContentY - 2) with height (lineHeight - 1).
    const caretLineTop = adjustedY - 2
    const caretLineBottom = adjustedY + lineHeight - 1

    return {
      adjustedX,
      caretLineTop,
      caretLineBottom,
      viewportWidth: viewportSize.width,
      viewportHeight: viewportSize.height,
    }
  }, [position.x, position.y, positionOffset.x, positionOffset.y, viewportSize.width, viewportSize.height])

  type Quadrant = 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight'
  const fractions = useMemo(() => [0.25, 0.5, 0.75, 1] as const, [])

  const candidates = useMemo(() => {
    if (!visible) return []

    const leftW = Math.max(0, effective.adjustedX - margin)
    const rightW = Math.max(0, effective.viewportWidth - margin - effective.adjustedX)
    const topH = Math.max(0, effective.caretLineTop - margin)
    const bottomH = Math.max(0, effective.viewportHeight - margin - effective.caretLineBottom)

    const defs: Array<{ quadrant: Quadrant; w: number; h: number }> = [
      { quadrant: 'bottomRight', w: rightW, h: bottomH },
      { quadrant: 'bottomLeft', w: leftW, h: bottomH },
      { quadrant: 'topRight', w: rightW, h: topH },
      { quadrant: 'topLeft', w: leftW, h: topH },
    ]

    const out: Array<{ id: string; quadrant: Quadrant; frac: number; maxWidth: number }> = []
    for (const d of defs) {
      if (d.w <= 0 || d.h <= 0) continue
      for (const frac of fractions) {
        const maxWidth = Math.max(1, Math.floor(d.w * frac))
        out.push({ id: `${d.quadrant}:${frac}`, quadrant: d.quadrant, frac, maxWidth })
      }
    }
    return out
  }, [
    visible,
    effective.adjustedX,
    effective.viewportWidth,
    effective.viewportHeight,
    effective.caretLineTop,
    effective.caretLineBottom,
    fractions,
    margin,
  ])

  const setCandidateRef = useCallback((id: string) => {
    return (el: HTMLDivElement | null) => {
      candidateRefs.current.set(id, el)
    }
  }, [])

  useLayoutEffect(() => {
    if (!visible) {
      containerRef.current = null
      layoutPassRef.current = 0
      lastPositionRef.current = { x: 0, y: 0 }
      setSelected(prev => (prev ? null : prev))
      setPositionOffset(prev => (prev.x === 0 && prev.y === 0 ? prev : { x: 0, y: 0 }))
      setViewportSize({ width: window.innerWidth, height: window.innerHeight })
      return
    }

    // Reset layout pass counter when position changes significantly
    const positionChanged = Math.abs(position.x - lastPositionRef.current.x) > 5
      || Math.abs(position.y - lastPositionRef.current.y) > 5
    if (positionChanged) {
      layoutPassRef.current = 0
      lastPositionRef.current = { x: position.x, y: position.y }
      setSelected(prev => (prev ? null : prev))
    }

    layoutPassRef.current += 1

    const { offset, viewport } = computeContainer()
    const offsetChanged = offset.x !== positionOffset.x || offset.y !== positionOffset.y
    const viewportChanged = viewport.width !== viewportSize.width || viewport.height !== viewportSize.height
    if (offsetChanged) setPositionOffset(offset)
    if (viewportChanged) setViewportSize(viewport)
    if (offsetChanged || viewportChanged) {
      setSelected(prev => (prev ? null : prev))
      return
    }

    // Skip first layout pass to let position/offset settle
    if (layoutPassRef.current < 2) {
      setLayoutTick(t => t + 1)
      return
    }

    if (candidates.length === 0) return

    const viewportLeft = margin
    const viewportRight = effective.viewportWidth - margin
    const viewportTop = margin
    const viewportBottom = effective.viewportHeight - margin

    const overlapCaret = (top: number, height: number) => {
      const bottom = top + height
      return bottom > effective.caretLineTop && top < effective.caretLineBottom
    }

    const place = (quadrant: Quadrant, measured: { width: number; height: number }) => {
      const isTop = quadrant.startsWith('top')
      const isLeft = quadrant.endsWith('Left')

      const top = isTop
        ? Math.floor(effective.caretLineTop - caretGap - measured.height)
        : Math.ceil(effective.caretLineBottom + caretGap)
      const left = isLeft
        ? Math.floor(effective.adjustedX - measured.width)
        : Math.ceil(effective.adjustedX)

      return { left, top }
    }

    const overflowAmount = (left: number, top: number, measured: { width: number; height: number }) => {
      const right = left + measured.width
      const bottom = top + measured.height
      const overLeft = Math.max(viewportLeft - left, 0)
      const overRight = Math.max(right - viewportRight, 0)
      const overTop = Math.max(viewportTop - top, 0)
      const overBottom = Math.max(bottom - viewportBottom, 0)
      return overLeft + overRight + overTop + overBottom
    }

    let best: {
      id: string
      left: number
      top: number
      maxWidth: number
      boxShadow: string
      measured: { width: number; height: number }
      overflow: number
      rightPref: number
      belowPref: number
    } | null = null

    for (const c of candidates) {
      const el = candidateRefs.current.get(c.id)
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.width <= 0 || rect.height <= 0) continue

      const measured = { width: Math.round(rect.width), height: Math.round(rect.height) }
      const { left, top } = place(c.quadrant, measured)
      if (overlapCaret(top, measured.height)) continue

      const overflow = overflowAmount(left, top, measured)
      const rightPref = c.quadrant.endsWith('Right') ? 0 : 1
      const belowPref = c.quadrant.startsWith('bottom') ? 0 : 1

      const boxShadow = c.quadrant.startsWith('top')
        ? '0 -12px 24px -8px rgba(0, 0, 0, 0.45)'
        : '0 12px 24px -8px rgba(0, 0, 0, 0.45)'

      const next = {
        id: c.id,
        left,
        top,
        maxWidth: c.maxWidth,
        boxShadow,
        measured,
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

      // Among fitting options: prefer right side, then lowest height.
      if (nextFits && next.rightPref !== best.rightPref) {
        if (next.rightPref < best.rightPref) best = next
        continue
      }

      if (next.measured.height !== best.measured.height) {
        if (next.measured.height < best.measured.height) best = next
        continue
      }

      if (next.measured.width !== best.measured.width) {
        if (next.measured.width < best.measured.width) best = next
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

    if (!best) return

    setSelected(prev => {
      if (!prev) {
        return {
          id: best.id,
          left: best.left,
          top: best.top,
          maxWidth: best.maxWidth,
          boxShadow: best.boxShadow,
          measured: best.measured,
        }
      }
      const same = prev.id === best.id
        && prev.left === best.left
        && prev.top === best.top
        && prev.maxWidth === best.maxWidth
        && prev.measured.width === best.measured.width
        && prev.measured.height === best.measured.height
      return same
        ? prev
        : {
          id: best.id,
          left: best.left,
          top: best.top,
          maxWidth: best.maxWidth,
          boxShadow: best.boxShadow,
          measured: best.measured,
        }
    })
  }, [
    visible,
    layoutTick,
    computeContainer,
    signature,
    currentArgumentIndex,
    currentParameterName,
    theme,
    candidates,
    effective.adjustedX,
    effective.caretLineTop,
    effective.caretLineBottom,
    effective.viewportWidth,
    effective.viewportHeight,
    caretGap,
    margin,
    position.x,
    position.y,
    positionOffset.x,
    positionOffset.y,
    viewportSize.width,
    viewportSize.height,
  ])

  // Notify parent of dimension changes in a separate effect
  useEffect(() => {
    if (selected) {
      onDimensionsChangeRef.current?.(selected.measured.width, selected.measured.height)
    }
  }, [selected])
  if (!visible) return null

  // Find the effective parameter index
  // If currentParameterName is provided, use it to find the matching parameter
  // Otherwise, use positional index and handle rest parameters
  const getEffectiveParameterIndex = (argIndex: number, paramName?: string): number => {
    // If we have a named parameter, find it by name
    if (paramName) {
      const paramIndex = signature.parameters.findIndex(
        param => param.name === paramName || param.name === `...${paramName}`,
      )
      if (paramIndex >= 0) {
        return paramIndex
      }
    }

    // Fall back to positional index with rest parameter handling
    for (let i = signature.parameters.length - 1; i >= 0; i--) {
      const param = signature.parameters[i]
      if (param.name.startsWith('...') && i <= argIndex) {
        return i
      }
    }
    return argIndex
  }

  const effectiveParameterIndex = getEffectiveParameterIndex(currentArgumentIndex, currentParameterName)

  const renderParameter = (param: FunctionParameter, index: number, isLast: boolean) => {
    const isActive = index === effectiveParameterIndex
    const paramText = (
      <span>
        <span style={{ color: theme.functionSignaturePopup.parameterName }}>
          {param.name}
          {param.optional ? '?' : ''}
        </span>
        {param.type
          ? (
            <>
              <span style={{ color: theme.functionSignaturePopup.separator }}>:</span>
              <span style={{ color: theme.functionSignaturePopup.parameterType }}>{param.type}</span>
            </>
          )
          : ''}
      </span>
    )

    return (
      <span key={index}>
        <span
          className={isActive ? 'px-1 rounded' : ''}
          style={{
            backgroundColor: isActive ? theme.functionSignaturePopup.activeParameterBackground : 'transparent',
            color: isActive ? theme.functionSignaturePopup.activeParameterText : theme.functionSignaturePopup.text,
          }}
          title={param.description}
        >
          {paramText}
        </span>
        {!isLast && <span style={{ color: theme.functionSignaturePopup.separator }}>,{' '}</span>}
      </span>
    )
  }

  const frameStyleBase: CSSProperties = {
    backgroundColor: theme.functionSignaturePopup.background,
    borderColor: theme.functionSignaturePopup.border,
    borderWidth: '1px',
    borderStyle: 'solid',
  }

  const content = (
    <div className="p-3">
      <div className="text-sm">
        <div className="break-words" style={{ color: theme.functionSignaturePopup.text, font: theme.font }}>
          <span style={{ color: theme.functionSignaturePopup.functionName }} className="font-semibold">
            {signature.name}
          </span>
          <span style={{ color: theme.functionSignaturePopup.separator }}>(</span>
          {signature.parameters.map((param, index) =>
            renderParameter(param, index, index === signature.parameters.length - 1)
          )}
          <span style={{ color: theme.functionSignaturePopup.separator }}>)</span>
          {signature.returnType && (
            <>
              <span style={{ color: theme.functionSignaturePopup.separator }}>:</span>
              <span style={{ color: theme.functionSignaturePopup.returnType }} className="break-all">
                {signature.returnType}
              </span>
            </>
          )}
        </div>

        {signature.description && (
          <div className="text-sm font-semibold mt-2 leading-relaxed break-words"
            style={{ color: theme.functionSignaturePopup.description }}
          >
            {signature.description}
          </div>
        )}

        {/* Current parameter details */}
        {signature.parameters[effectiveParameterIndex] && (
          <div className="mt-2 pt-2"
            style={{ borderTopColor: theme.functionSignaturePopup.border, borderTopWidth: '1px',
              borderTopStyle: 'solid' }}
          >
            <div className="text-sm font-semibold break-words" style={{ font: theme.font }}>
              <span style={{ color: theme.functionSignaturePopup.parameterName }} className="font-semibold">
                {signature.parameters[effectiveParameterIndex].name}
                {signature.parameters[effectiveParameterIndex].optional ? '?' : ''}
              </span>
              {signature.parameters[effectiveParameterIndex].type && (
                <>
                  <span style={{ color: theme.functionSignaturePopup.separator }}>:</span>
                  <span style={{ color: theme.functionSignaturePopup.parameterType }} className="break-all">
                    {signature.parameters[effectiveParameterIndex].type}
                  </span>
                </>
              )}
              {signature.parameters[effectiveParameterIndex].optional && (
                <span style={{ color: theme.functionSignaturePopup.separator }} className="ml-1">(optional)</span>
              )}
            </div>
            {signature.parameters[effectiveParameterIndex].description && (
              <div className="text-sm mt-1 leading-relaxed break-words"
                style={{ color: theme.functionSignaturePopup.description }}
              >
                {signature.parameters[effectiveParameterIndex].description}
              </div>
            )}
          </div>
        )}

        {/* Examples */}
        {signature.examples && signature.examples.length > 0 && (
          <div className="mt-3 pt-3"
            style={{ borderTopColor: theme.functionSignaturePopup.border, borderTopWidth: '1px',
              borderTopStyle: 'solid' }}
          >
            <div className="text-xs font-semibold mb-2 uppercase tracking-wide"
              style={{ color: theme.functionSignaturePopup.separator }}
            >
              Examples
            </div>
            <div className="space-y-2">
              {signature.examples.map((example, index) => (
                <div
                  key={index}
                  className="rounded px-2 py-1.5 break-words font-mono"
                  style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.2)',
                    borderColor: theme.functionSignaturePopup.border,
                    borderWidth: '1px',
                    borderStyle: 'solid',
                    color: theme.functionSignaturePopup.text,
                    font: theme.font,
                    fontSize: '0.85rem',
                  }}
                >
                  {example}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <>
      <div ref={anchorRef} className="fixed" style={{ left: 0, top: 0, width: 0, height: 0 }} />

      {/* Offscreen measured candidates (4 quadrants × 1/4..4/4 of that quadrant width) */}
      {candidates.map(c => (
        <div
          key={c.id}
          ref={setCandidateRef(c.id)}
          className="fixed rounded-lg pointer-events-none"
          style={{
            left: '-9999px',
            top: '-9999px',
            visibility: 'hidden',
            maxWidth: `${c.maxWidth}px`,
            ...frameStyleBase,
          }}
        >
          {content}
        </div>
      ))}

      {/* Selected visible popup */}
      {selected && (
        <div
          className="fixed z-[9999] rounded-lg pointer-events-none"
          style={{
            left: `${selected.left}px`,
            top: `${selected.top}px`,
            boxShadow: selected.boxShadow,
            maxWidth: `${selected.maxWidth}px`,
            ...frameStyleBase,
          }}
        >
          {content}
        </div>
      )}
    </>
  )
}

export default FunctionSignaturePopup
