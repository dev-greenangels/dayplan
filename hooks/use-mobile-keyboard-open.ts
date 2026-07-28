'use client'

import { useEffect, useState } from 'react'

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'TEXTAREA' || tag === 'INPUT' || el.isContentEditable
}

/**
 * True while a text field is focused, or the soft keyboard covers the screen.
 * Android often shrinks innerHeight with the keyboard, so we also compare to screen height.
 */
export function useMobileKeyboardOpen(thresholdPx = 120) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const vv = window.visualViewport

    const sync = () => {
      const focused = isEditable(document.activeElement)
      const vvH = vv?.height ?? window.innerHeight
      const coveredByScreen = screen.height - vvH > thresholdPx
      const coveredByInner = window.innerHeight - vvH > thresholdPx
      setOpen(focused || coveredByScreen || coveredByInner)
    }

    const onFocusOut = () => {
      window.setTimeout(sync, 50)
    }

    sync()
    vv?.addEventListener('resize', sync)
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      vv?.removeEventListener('resize', sync)
      document.removeEventListener('focusin', sync)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [thresholdPx])

  return open
}
