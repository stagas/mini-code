import { createRoot } from 'react-dom/client'

const App = () => {
  return (
    <div className="bg-neutral-800 text-white w-full h-full flex items-center justify-center">
      <h1 className="text-4xl font-bold">Hello World</h1>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
