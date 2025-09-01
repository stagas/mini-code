export type ActiveEditorListener = (id: string | null) => void

let currentActiveId: string | null = null
const listeners = new Set<ActiveEditorListener>()

export const setActiveEditor = (id: string | null) => {
  if (currentActiveId === id) return
  currentActiveId = id
  for (const listener of listeners) listener(currentActiveId)
}

export const getActiveEditor = (): string | null => currentActiveId

export const subscribeActiveEditor = (listener: ActiveEditorListener): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
