import { FunctionParameter, FunctionSignature } from './function-signature.ts'

interface FunctionSignaturePopupProps {
  signature: FunctionSignature
  currentArgumentIndex: number
  position: { x: number; y: number; showBelow: boolean }
  visible: boolean
}

const FunctionSignaturePopup = ({
  signature,
  currentArgumentIndex,
  position,
  visible,
}: FunctionSignaturePopupProps) => {
  if (!visible) return null

  // Find the effective parameter index for rest parameters
  const getEffectiveParameterIndex = (argIndex: number): number => {
    // Find the last rest parameter before or at the current argument index
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
    const paramText = `${param.name}${param.optional ? '?' : ''}${param.type ? `: ${param.type}` : ''}`

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
      className="fixed z-50 bg-gray-900 border border-gray-700 rounded-lg shadow-xl max-w-lg pointer-events-none"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        transform: position.showBelow ? 'translateY(0%)' : 'translateY(-100%)',
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
          {signature.parameters[effectiveParameterIndex] && (
            <div className="mt-2 pt-2 border-t border-gray-700">
              <div className="text-xs">
                <span className="text-blue-400 font-semibold">
                  {signature.parameters[effectiveParameterIndex].name}
                  {signature.parameters[effectiveParameterIndex].optional ? '?' : ''}
                </span>
                {signature.parameters[effectiveParameterIndex].type && (
                  <>
                    <span className="text-gray-500">:</span>
                    <span className="text-yellow-400">
                      {signature.parameters[effectiveParameterIndex].type}
                    </span>
                  </>
                )}
                {signature.parameters[effectiveParameterIndex].optional && (
                  <span className="text-gray-500 ml-1">(optional)</span>
                )}
              </div>
              {signature.parameters[effectiveParameterIndex].description && (
                <div className="text-gray-400 text-xs mt-1 leading-relaxed">
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
