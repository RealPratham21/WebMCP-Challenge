'use client'

import { useEffect } from 'react'
import { registerNetLabTools } from '@/lib/webmcp/registerTools'

export function WebMcpBridge() {
  useEffect(() => {
    let cancelled = false
    let unregister: (() => void) | undefined

    void registerNetLabTools().then((dispose) => {
      if (cancelled) {
        dispose()
        return
      }
      unregister = dispose
    })

    return () => {
      cancelled = true
      unregister?.()
    }
  }, [])

  return null
}
