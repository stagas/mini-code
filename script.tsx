import { createRoot } from 'react-dom/client'
import { CodeEditor } from './src/CodeEditor.tsx'

const App = () => {
  return (
    <div className="flex flex-row gap-[1px] w-[100dvw] h-[100dvh]">
      <CodeEditor wordWrap gutter />
      <CodeEditor />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
