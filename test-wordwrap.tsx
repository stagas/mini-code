import { CodeEditor } from './CodeEditor.tsx'

export default function TestWordWrap() {
  return (
    <div className="h-screen flex flex-col">
      <h1 className="text-white p-4 bg-gray-900">Word Wrap Test</h1>
      <div className="flex-1 flex gap-4 p-4 bg-gray-800">
        <div className="flex-1 flex flex-col">
          <h2 className="text-white mb-2">Without Word Wrap</h2>
          <CodeEditor wordWrap={false} />
        </div>
        <div className="flex-1 flex flex-col">
          <h2 className="text-white mb-2">With Word Wrap</h2>
          <CodeEditor wordWrap={true} />
        </div>
      </div>
    </div>
  )
}
