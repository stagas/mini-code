import { useEffect, useRef, useState } from 'react'
import { FunctionParameter, FunctionSignature } from './function-signature.ts'
import { type Theme, defaultTheme } from './syntax.ts'

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
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null)
  const onDimensionsChangeRef = useRef(onDimensionsChange)

  useEffect(() => {
    onDimensionsChangeRef.current = onDimensionsChange
  }, [onDimensionsChange])

  // Measure popup dimensions
  useEffect(() => {
    if (visible && popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredSize(prev => {
          const next = { width: rect.width, height: rect.height }
          const changed = !prev || prev.width !== next.width || prev.height !== next.height
          return changed ? next : prev
        })
      }
    } else if (!visible) {
      setMeasuredSize(prev => prev ? null : prev)
    }
  }, [visible, signature, currentArgumentIndex, position.x, position.y])

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

  let finalX = position.x
  let finalY = position.y
  let maxWidth: number | undefined = undefined

  if (!measuredSize) {
    // First render: position off-screen to allow measurement without constraint
    finalX = -9999
    finalY = -9999
  } else {
    const popupWidth = measuredSize.width
    const popupHeight = measuredSize.height

    // HORIZONTAL: Try to fit at natural width, shift left if needed
    const rightEdge = position.x + popupWidth

    if (rightEdge <= viewportWidth - margin) {
      // Fits at cursor position
      finalX = position.x
      maxWidth = undefined
    } else {
      // Would overflow right edge - try shifting left
      const shiftedX = viewportWidth - popupWidth - margin

      if (shiftedX >= margin) {
        // Can fit by shifting left
        finalX = shiftedX
        maxWidth = undefined
      } else {
        // Too wide even when shifted - constrain width
        finalX = margin
        maxWidth = viewportWidth - 2 * margin
      }
    }

    // VERTICAL: Prefer below, fallback to above, ensure cursor is never covered
    const cursorTop = position.y
    const cursorBottom = position.y + lineHeight
    const spaceAbove = cursorTop - margin
    const spaceBelow = viewportHeight - cursorBottom - margin

    if (spaceBelow >= popupHeight + spacing) {
      // Show below cursor with spacing
      finalY = cursorBottom //+ spacing
    } else if (spaceAbove >= popupHeight + spacing) {
      // Show above cursor with spacing
      finalY = cursorTop - popupHeight - spacing
    } else {
      // Doesn't fit either way - choose side with more space and clamp
      if (spaceBelow >= spaceAbove) {
        // Below: start after cursor line
        finalY = cursorBottom //+ spacing
        if (finalY + popupHeight > viewportHeight - margin) {
          finalY = Math.max(cursorBottom + spacing, viewportHeight - popupHeight - margin)
        }
      } else {
        // Above: ensure bottom edge doesn't overlap cursor
        finalY = Math.max(margin, cursorTop - popupHeight - spacing)
        if (finalY + popupHeight > cursorTop - spacing) {
          finalY = Math.max(margin, cursorTop - popupHeight - spacing)
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
        param => param.name === paramName || param.name === `...${paramName}`
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
    const paramText = `${param.name}${param.optional ? '?' : ''}${
      param.type ? `: ${param.type}` : ''
    }`

    return (
      <span key={index}>
        <span
          className={isActive ? 'px-1 rounded font-semibold' : ''}
          style={{
            backgroundColor: isActive ? theme.functionSignaturePopup.activeParameterBackground : 'transparent',
            color: isActive ? theme.functionSignaturePopup.activeParameterText : theme.functionSignaturePopup.text,
          }}
          title={param.description}
        >
          {paramText}
        </span>
        {!isLast && <span style={{ color: theme.functionSignaturePopup.separator }}>,</span>}
      </span>
    )
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-[9999] rounded-lg shadow-2xl pointer-events-none"
      style={{
        left: `${finalX}px`,
        top: `${finalY}px`,
        backgroundColor: theme.functionSignaturePopup.background,
        borderColor: theme.functionSignaturePopup.border,
        borderWidth: '1px',
        borderStyle: 'solid',
        ...(maxWidth ? { maxWidth: `${maxWidth}px` } : {}),
      }}
    >
      <div className="p-3">
        <div className="text-sm">
          <div className="font-mono break-words overflow-hidden" style={{ color: theme.functionSignaturePopup.text }}>
            <span style={{ color: theme.functionSignaturePopup.functionName }} className="font-semibold">{signature.name}</span>
            <span style={{ color: theme.functionSignaturePopup.separator }}>(</span>
            {signature.parameters.map((param, index) =>
              renderParameter(param, index, index === signature.parameters.length - 1),
            )}
            <span style={{ color: theme.functionSignaturePopup.separator }}>)</span>
            {signature.returnType && (
              <>
                <span style={{ color: theme.functionSignaturePopup.separator }}>:</span>
                <span style={{ color: theme.functionSignaturePopup.returnType }} className="break-all">{signature.returnType}</span>
              </>
            )}
          </div>

          {signature.description && (
            <div className="text-xs mt-2 leading-relaxed break-words" style={{ color: theme.functionSignaturePopup.description }}>
              {signature.description}
            </div>
          )}

          {/* Current parameter details */}
          {signature.parameters[effectiveParameterIndex] && (
            <div className="mt-2 pt-2" style={{ borderTopColor: theme.functionSignaturePopup.border, borderTopWidth: '1px', borderTopStyle: 'solid' }}>
              <div className="text-xs break-words">
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
                <div className="text-xs mt-1 leading-relaxed break-words" style={{ color: theme.functionSignaturePopup.description }}>
                  {signature.parameters[effectiveParameterIndex].description}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default FunctionSignaturePopup
