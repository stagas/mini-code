import React from 'react'
import { FunctionParameter, FunctionSignature } from './function-signature'

interface FunctionSignaturePopupProps {
  signature: FunctionSignature
  currentArgumentIndex: number
  position: { x: number; y: number }
  visible: boolean
}

const FunctionSignaturePopup: React.FC<FunctionSignaturePopupProps> = ({
  signature,
  currentArgumentIndex,
  position,
  visible,
}) => {
  if (!visible) return null

  const renderParameter = (param: FunctionParameter, index: number, isLast: boolean) => {
    const isActive = index === currentArgumentIndex
    const paramText = `${param.name}${param.type ? `: ${param.type}` : ''}`

    return (
      <span key={index}>
        <span
          className={`${
            isActive
              ? 'bg-blue-600 text-white px-1 rounded font-semibold'
              : 'text-gray-300'
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
      className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-lg"
      style={{
        left: position.x,
        top: position.y,
        transform: 'translateY(-100%)', // Position above the cursor
      }}
    >
      <div className="p-3">
        <div className="text-sm">
          <div className="text-white font-mono">
            <span className="text-green-400 font-semibold">{signature.name}</span>
            <span className="text-gray-400">(</span>
            {signature.parameters.map((param, index) =>
              renderParameter(param, index, index === signature.parameters.length - 1)
            )}
            <span className="text-gray-400">)</span>
            {signature.returnType && (
              <>
                <span className="text-gray-500">:</span>
                <span className="text-blue-400">{signature.returnType}</span>
              </>
            )}
          </div>

          {signature.description && (
            <div className="text-gray-400 text-xs mt-2 leading-relaxed">
              {signature.description}
            </div>
          )}

          {/* Current parameter details */}
          {signature.parameters[currentArgumentIndex] && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <div className="text-xs">
                <span className="text-blue-400 font-semibold">
                  {signature.parameters[currentArgumentIndex].name}
                </span>
                {signature.parameters[currentArgumentIndex].type && (
                  <>
                    <span className="text-gray-500">:</span>
                    <span className="text-yellow-400">
                      {signature.parameters[currentArgumentIndex].type}
                    </span>
                  </>
                )}
                {signature.parameters[currentArgumentIndex].optional && (
                  <span className="text-gray-500 ml-1">(optional)</span>
                )}
              </div>
              {signature.parameters[currentArgumentIndex].description && (
                <div className="text-gray-400 text-xs mt-1 leading-relaxed">
                  {signature.parameters[currentArgumentIndex].description}
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
