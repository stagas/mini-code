import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  const popupRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null)
  const [positionOffset, setPositionOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const onDimensionsChangeRef = useRef(onDimensionsChange)

  useEffect(() => {
    onDimensionsChangeRef.current = onDimensionsChange
  }, [onDimensionsChange])

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

    if (transformAncestor) {
      // Get the container's bounding rect (accounts for transforms)
      const containerRect = transformAncestor.getBoundingClientRect()
      // The position passed in is viewport coordinates, but if there's a transform ancestor,
      // fixed positioning is relative to that ancestor, so we need to adjust
      setPositionOffset({
        x: containerRect.left,
        y: containerRect.top,
      })
    }
    else {
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
  }, [visible, position.x, position.y])

  // Measure popup dimensions
  useEffect(() => {
    if (visible && popupRef.current) {
      // Use RAF to ensure layout is complete before measuring
      const rafId = requestAnimationFrame(() => {
        if (!popupRef.current) return
        const rect = popupRef.current.getBoundingClientRect()
        if (rect.width > 0 && rect.height > 0) {
          setMeasuredSize(prev => {
            const next = { width: rect.width, height: rect.height }
            const changed = !prev || prev.width !== next.width || prev.height !== next.height
            return changed ? next : prev
          })
        }
      })

      return () => cancelAnimationFrame(rafId)
    }
    else if (!visible) {
      setMeasuredSize(prev => prev ? null : prev)
    }
  }, [visible, signature, currentArgumentIndex, position.x, position.y])

  // Recalculate offset after measurement to ensure accurate positioning
  useEffect(() => {
    if (visible && measuredSize && popupRef.current) {
      const rafId = requestAnimationFrame(() => {
        calculateOffset()
      })
      return () => cancelAnimationFrame(rafId)
    }
  }, [visible, measuredSize, calculateOffset])

  // Notify parent of dimension changes in a separate effect
  useEffect(() => {
    if (measuredSize) {
      onDimensionsChangeRef.current?.(measuredSize.width, measuredSize.height)
    }
  }, [measuredSize])
  if (!visible) return null

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const margin = 10
  const lineHeight = 20
  const spacing = 5

  // Adjust position if container has transforms (fixed positioning becomes relative to transformed ancestor)
  const adjustedX = position.x - positionOffset.x
  const adjustedY = position.y - positionOffset.y

  let finalX = adjustedX
  let finalY = adjustedY
  let maxWidthStyle: number | undefined = undefined

  if (!measuredSize) {
    // First render: position off-screen to allow measurement without constraint
    finalX = -9999
    finalY = -9999
  }
  else {
    const popupWidth = measuredSize.width
    const popupHeight = measuredSize.height

    // If container has transforms, use container-relative viewport
    const containerRect = containerRef.current?.getBoundingClientRect()
    const effectiveViewportWidth = containerRect ? containerRect.width : viewportWidth
    const effectiveViewportHeight = containerRect ? containerRect.height : viewportHeight
    const effectiveMargin = margin
    const availableWidth = Math.max(effectiveViewportWidth - 2 * effectiveMargin, 0)
    maxWidthStyle = availableWidth > 0 ? availableWidth : undefined

    // HORIZONTAL: Try to fit at natural width, shift left if needed
    const rightEdge = adjustedX + popupWidth

    if (rightEdge <= effectiveViewportWidth - effectiveMargin) {
      // Fits at cursor position
      finalX = adjustedX
    }
    else {
      // Would overflow right edge - try shifting left
      const shiftedX = effectiveViewportWidth - popupWidth - effectiveMargin

      if (shiftedX >= effectiveMargin) {
        // Can fit by shifting left
        finalX = shiftedX
      }
      else {
        // Too wide even when shifted - constrain width
        finalX = effectiveMargin
      }
    }

    // VERTICAL: Prefer below, fallback to above, ensure cursor is never covered
    const cursorTop = adjustedY
    const cursorBottom = adjustedY + lineHeight
    const spaceAbove = cursorTop - effectiveMargin
    const spaceBelow = effectiveViewportHeight - cursorBottom - effectiveMargin

    if (spaceBelow >= popupHeight + spacing) {
      // Show below cursor with spacing
      finalY = cursorBottom
    }
    else if (spaceAbove >= popupHeight + spacing) {
      // Show above cursor with spacing
      finalY = cursorTop - popupHeight - spacing
    }
    else {
      // Doesn't fit either way - choose side with more space and clamp
      if (spaceBelow >= spaceAbove) {
        // Below: start after cursor line
        finalY = cursorBottom
        if (finalY + popupHeight > effectiveViewportHeight - effectiveMargin) {
          finalY = Math.max(cursorBottom + spacing, effectiveViewportHeight - popupHeight - effectiveMargin)
        }
      }
      else {
        // Above: ensure bottom edge doesn't overlap cursor
        finalY = Math.max(effectiveMargin, cursorTop - popupHeight - spacing)
        if (finalY + popupHeight > cursorTop - spacing) {
          finalY = Math.max(effectiveMargin, cursorTop - popupHeight - spacing)
        }
      }
    }
  }

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

  return (
    <div
      ref={popupRef}
      className="fixed z-[9999] rounded-lg shadow-2xl pointer-events-none"
      style={{
        left: `${finalX}px`,
        top: `${finalY - 2}px`,
        backgroundColor: theme.functionSignaturePopup.background,
        borderColor: theme.functionSignaturePopup.border,
        borderWidth: '1px',
        borderStyle: 'solid',
        ...(maxWidthStyle ? { maxWidth: `${maxWidthStyle}px` } : {}),
      }}
    >
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
              <div className="text-sm font-semibold break-words">
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
    </div>
  )
}

export default FunctionSignaturePopup
