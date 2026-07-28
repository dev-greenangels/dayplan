'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  applyEnterNumbering,
  ensureEmptyFocusPrefix,
} from '@/lib/soft-numbering'

const KEYBOARD_GAP = 16

function viewportBottom(): number {
  const vv = window.visualViewport
  if (vv) return vv.offsetTop + vv.height
  return window.innerHeight
}

function viewportTop(): number {
  return window.visualViewport?.offsetTop ?? 0
}

/** Grow to full content — no internal scroll; keep page scroll stable while height changes. */
function growToContent(el: HTMLTextAreaElement, minHeight: number) {
  const scroller = document.scrollingElement || document.documentElement
  const beforeScroll = scroller.scrollTop
  const beforeTop = el.getBoundingClientRect().top

  el.style.maxHeight = 'none'
  el.style.overflowY = 'hidden'
  el.style.height = 'auto'
  const next = Math.max(minHeight, el.scrollHeight)
  el.style.height = `${next}px`

  const afterTop = el.getBoundingClientRect().top
  const dy = afterTop - beforeTop
  if (dy !== 0) scroller.scrollTop = beforeScroll + dy
}

/** Keep the caret / bottom of the field above the soft keyboard. */
function keepAboveKeyboard(el: HTMLTextAreaElement) {
  const topLimit = viewportTop() + 8
  const bottomLimit = viewportBottom() - KEYBOARD_GAP
  const rect = el.getBoundingClientRect()

  if (rect.bottom > bottomLimit) {
    window.scrollBy(0, rect.bottom - bottomLimit)
  } else if (rect.top < topLimit) {
    window.scrollBy(0, rect.top - topLimit)
  }

  // If still taller than visible area, pin bottom to keyboard so typing stays visible
  const rect2 = el.getBoundingClientRect()
  if (rect2.height > bottomLimit - topLimit && rect2.bottom > bottomLimit) {
    window.scrollBy(0, rect2.bottom - bottomLimit)
  }
}

/**
 * Mobile-friendly textarea: grows with content (everything visible on the page),
 * preserves scroll on grow, and keeps the focused area above the keyboard.
 */
export default function AutoGrowTextarea({
  value,
  disabled,
  onChange,
  onBlur,
  onFocus,
  className,
  placeholder,
  minHeight = 44,
  id,
  softNumbering,
  'aria-invalid': ariaInvalid,
}: {
  value: string
  disabled?: boolean
  onChange: (v: string) => void
  onBlur?: (v: string) => void
  onFocus?: () => void
  className?: string
  placeholder?: string
  minHeight?: number
  id?: string
  softNumbering?: boolean
  'aria-invalid'?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  const focusedRef = useRef(false)
  const rafRef = useRef(0)

  const layout = useCallback(
    (opts?: { pinKeyboard?: boolean }) => {
      const el = ref.current
      if (!el) return
      growToContent(el, minHeight)
      if (opts?.pinKeyboard !== false && focusedRef.current) {
        keepAboveKeyboard(el)
      }
    },
    [minHeight]
  )

  const scheduleLayout = useCallback(
    (opts?: { pinKeyboard?: boolean }) => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => layout(opts))
    },
    [layout]
  )

  useEffect(() => {
    layout({ pinKeyboard: focusedRef.current })
  }, [value, layout])

  useEffect(() => {
    const onVv = () => {
      if (focusedRef.current) scheduleLayout()
    }
    const vv = window.visualViewport
    vv?.addEventListener('resize', onVv)
    vv?.addEventListener('scroll', onVv)
    window.addEventListener('orientationchange', onVv)
    return () => {
      vv?.removeEventListener('resize', onVv)
      vv?.removeEventListener('scroll', onVv)
      window.removeEventListener('orientationchange', onVv)
      cancelAnimationFrame(rafRef.current)
    }
  }, [scheduleLayout])

  function setCaret(pos: number) {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => {
      el.setSelectionRange(pos, pos)
      layout()
    })
  }

  return (
    <textarea
      ref={ref}
      id={id}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={ariaInvalid}
      rows={1}
      enterKeyHint={softNumbering ? 'enter' : 'done'}
      autoCapitalize="sentences"
      autoCorrect="on"
      onChange={e => {
        onChange(e.target.value)
        scheduleLayout()
      }}
      onInput={() => scheduleLayout()}
      onKeyDown={e => {
        if (!softNumbering || disabled) return
        if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
        e.preventDefault()
        const el = e.currentTarget
        const { text, caret } = applyEnterNumbering(
          el.value,
          el.selectionStart,
          el.selectionEnd
        )
        onChange(text)
        setCaret(caret)
      }}
      onBlur={e => {
        focusedRef.current = false
        growToContent(e.currentTarget, minHeight)
        onBlur?.(e.target.value)
      }}
      onFocus={e => {
        focusedRef.current = true
        if (softNumbering && !disabled) {
          const starter = ensureEmptyFocusPrefix(e.currentTarget.value)
          if (starter) {
            onChange(starter)
            setCaret(starter.length)
            return
          }
        }
        onFocus?.()
        // Delay so iOS keyboard / visualViewport settle
        scheduleLayout()
        window.setTimeout(() => scheduleLayout(), 50)
        window.setTimeout(() => scheduleLayout(), 300)
      }}
      className={`${className ?? ''} touch-manipulation [overflow-anchor:none]`}
      style={{ overflowY: 'hidden', maxHeight: 'none' }}
    />
  )
}
