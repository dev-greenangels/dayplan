'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  applyEnterNumbering,
  ensureEmptyFocusPrefix,
} from '@/lib/soft-numbering'

/** Textarea that grows with content and keeps caret visible (no jump under keyboard). */
export default function AutoGrowTextarea({
  value,
  disabled,
  onChange,
  onBlur,
  onFocus,
  className,
  placeholder,
  minHeight = 40,
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

  const resize = useCallback(() => {
    const el = ref.current
    if (!el) return
    const scroller = document.scrollingElement || document.documentElement
    const beforeScroll = scroller.scrollTop
    const beforeTop = el.getBoundingClientRect().top

    el.style.height = 'auto'
    el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`

    const afterTop = el.getBoundingClientRect().top
    const dy = afterTop - beforeTop
    if (dy !== 0) scroller.scrollTop = beforeScroll + dy
  }, [minHeight])

  useEffect(() => {
    resize()
  }, [value, resize])

  function ensureVisible() {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => {
      const vv = window.visualViewport
      const bottomLimit = vv ? vv.offsetTop + vv.height - 24 : window.innerHeight - 24
      const rect = el.getBoundingClientRect()
      if (rect.bottom > bottomLimit) {
        const delta = rect.bottom - bottomLimit
        window.scrollBy({ top: delta, behavior: 'smooth' })
      }
    })
  }

  function setCaret(pos: number) {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => {
      el.setSelectionRange(pos, pos)
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
      onChange={e => {
        onChange(e.target.value)
        requestAnimationFrame(resize)
      }}
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
        requestAnimationFrame(resize)
      }}
      onBlur={e => onBlur?.(e.target.value)}
      onFocus={e => {
        if (softNumbering && !disabled) {
          const starter = ensureEmptyFocusPrefix(e.currentTarget.value)
          if (starter) {
            onChange(starter)
            setCaret(starter.length)
          }
        }
        onFocus?.()
        ensureVisible()
      }}
      className={`${className ?? ''} [overflow-anchor:none]`}
    />
  )
}
