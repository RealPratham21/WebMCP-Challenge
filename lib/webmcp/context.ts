import type { ModelContext } from '@mcp-b/webmcp-types'

export function getModelContext(): ModelContext | null {
  if (typeof document === 'undefined') return null

  const fromDocument = 'modelContext' in document ? document.modelContext : undefined
  const fromNavigator =
    typeof navigator !== 'undefined' && 'modelContext' in navigator
      ? navigator.modelContext
      : undefined
  const context = fromDocument ?? fromNavigator

  if (!context || typeof context.registerTool !== 'function') return null
  return context
}
