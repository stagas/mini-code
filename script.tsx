import { createRoot } from 'react-dom/client'
import { CodeEditor } from './CodeEditor.tsx'

const App = () => {
  return (
    <div className="flex flex-row gap-2 w-[100dvw] h-[100dvh] p-2">
      <CodeEditor wordWrap />
      <CodeEditor />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
