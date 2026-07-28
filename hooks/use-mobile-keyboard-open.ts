'use client'

import { useEffect, useState } from 'react'

/**
 * True when the virtual keyboard likely covers a large part of the layout viewport.
 * Used to hide fixed bottom chrome so it doesn't jump/blink while typing.
 */
export function useMobileKeyboardOpen(thresholdPx = 120) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return

    const check = () => {
      const covered = window.innerHeight - vv.height > thresholdPx
      setOpen(covered)
    }

    check()
    vv.addEventListener('resize', check)
    vv.addEventListener('scroll', check)
    window.addEventListener('focusout', check)
    return () => {
      vv.removeEventListener('resize', check)
      vv.removeEventListener('scroll', check)
      window.removeEventListener('focusout', check)
    }
  }, [thresholdPx])

  return open
}
