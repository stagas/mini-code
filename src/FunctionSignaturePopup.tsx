import { useEffect, useRef, useState } from 'react'
import { FunctionParameter, FunctionSignature } from './function-signature.ts'

interface FunctionSignaturePopupProps {
  signature: FunctionSignature
  currentArgumentIndex: number
  position: { x: number; y: number }
  visible: boolean
  onDimensionsChange?: (width: number, height: number) => void
}

const FunctionSignaturePopup = ({
  signature,
  currentArgumentIndex,
  position,
  visible,
  onDimensionsChange,
}: FunctionSignaturePopupProps) => {
  const popupRef = useRef<HTMLDivElement>(null)
  const [measuredSize, setMeasuredSize] = useState<{ width: number; height: number } | null>(null)

  // Measure popup dimensions after render
  useEffect(() => {
    if (visible && popupRef.current) {
      const rect = popupRef.current.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredSize({ width: rect.width, height: rect.height })
        onDimensionsChange?.(rect.width, rect.height)
      }
    } else if (!visible) {
      // Clear measured size when popup becomes invisible
      setMeasuredSize(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, signature, currentArgumentIndex])
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

    console.log('Positioning:', {
      cursorX: position.x,
      cursorY: position.y,
      popupWidth,
      popupHeight,
      viewportWidth,
      viewportHeight,
    })

    // HORIZONTAL: Try to fit at natural width, shift left if needed
    const rightEdge = position.x + popupWidth

    if (rightEdge <= viewportWidth - margin) {
      // Fits at cursor position
      finalX = position.x
      maxWidth = undefined
      console.log(`Fits at cursor (${position.x}), right edge: ${rightEdge}`)
    } else {
      // Would overflow right edge - try shifting left
      const shiftedX = viewportWidth - popupWidth - margin

      if (shiftedX >= margin) {
        // Can fit by shifting left
        finalX = shiftedX
        maxWidth = undefined
        console.log(`Shifted left to ${shiftedX} to fit`)
      } else {
        // Too wide even when shifted - constrain width
        finalX = margin
        maxWidth = viewportWidth - 2 * margin
        console.log(`Constrained to width ${maxWidth}`)
      }
    }

    // VERTICAL: Prefer above, fallback to below
    const spaceAbove = position.y - margin
    const spaceBelow = viewportHeight - (position.y + lineHeight) - margin

    console.log(`Space: above=${spaceAbove}, below=${spaceBelow}, need=${popupHeight}`)

    if (spaceAbove >= popupHeight) {
      // Show above
      finalY = position.y - popupHeight - spacing
      console.log(`Above at ${finalY}`)
    } else if (spaceBelow >= popupHeight) {
      // Show below
      finalY = position.y + lineHeight + spacing
      console.log(`Below at ${finalY}`)
    } else {
      // Doesn't fit either way - use side with more space
      if (spaceAbove > spaceBelow) {
        finalY = margin
        console.log(`Top-aligned at ${finalY}`)
      } else {
        finalY = position.y + lineHeight + spacing
        console.log(`Below (clipped) at ${finalY}`)
      }
    }
  }

  console.log('Final:', { finalX, finalY, maxWidth })

  // Find the effective parameter index for rest parameters
  const getEffectiveParameterIndex = (argIndex: number): number => {
    for (let i = signature.parameters.length - 1; i >= 0; i--) {
      const param = signature.parameters[i]
      if (param.name.startsWith('...') && i <= argIndex) {
        return i
      }
    }
    return argIndex
  }

  const effectiveParameterIndex = getEffectiveParameterIndex(currentArgumentIndex)

  const renderParameter = (param: FunctionParameter, index: number, isLast: boolean) => {
    const isActive = index === effectiveParameterIndex
    const paramText = `${param.name}${param.optional ? '?' : ''}${
      param.type ? `: ${param.type}` : ''
    }`

    return (
      <span key={index}>
        <span
          className={`${
            isActive ? 'bg-blue-600 text-white px-1 rounded font-semibold' : 'text-gray-300'
          }`}
          title={param.description}
        >
          {paramText}
        </span>
        {!isLast && <span className="text-gray-500">,</span>}
      </span>
    )
  }

  return (
    <div
      ref={popupRef}
      className="fixed z-[9999] bg-gray-900 border border-gray-700 rounded-lg shadow-2xl pointer-events-none"
      style={{
        left: `${finalX}px`,
        top: `${finalY}px`,
        ...(maxWidth ? { maxWidth: `${maxWidth}px` } : {}),
      }}
    >
      <div className="p-3">
        <div className="text-sm">
          <div className="text-white font-mono break-words overflow-hidden">
            <span className="text-green-400 font-semibold">{signature.name}</span>
            <span className="text-gray-400">(</span>
            {signature.parameters.map((param, index) =>
              renderParameter(param, index, index === signature.parameters.length - 1),
            )}
            <span className="text-gray-400">)</span>
            {signature.returnType && (
              <>
                <span className="text-gray-500">:</span>
                <span className="text-blue-400 break-all">{signature.returnType}</span>
              </>
            )}
          </div>

          {signature.description && (
            <div className="text-gray-400 text-xs mt-2 leading-relaxed break-words">
              {signature.description}
            </div>
          )}

          {/* Current parameter details */}
          {signature.parameters[effectiveParameterIndex] && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <div className="text-xs break-words">
                <span className="text-blue-400 font-semibold">
                  {signature.parameters[effectiveParameterIndex].name}
                  {signature.parameters[effectiveParameterIndex].optional ? '?' : ''}
                </span>
                {signature.parameters[effectiveParameterIndex].type && (
                  <>
                    <span className="text-gray-500">:</span>
                    <span className="text-yellow-400 break-all">
                      {signature.parameters[effectiveParameterIndex].type}
                    </span>
                  </>
                )}
                {signature.parameters[effectiveParameterIndex].optional && (
                  <span className="text-gray-500 ml-1">(optional)</span>
                )}
              </div>
              {signature.parameters[effectiveParameterIndex].description && (
                <div className="text-gray-400 text-xs mt-1 leading-relaxed break-words">
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
