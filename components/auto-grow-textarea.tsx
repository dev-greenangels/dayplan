'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  applyEnterNumbering,
  ensureEmptyFocusPrefix,
} from '@/lib/soft-numbering'

const KEYBOARD_GAP = 10

function viewportBottom(): number {
  const vv = window.visualViewport
  if (vv) return vv.offsetTop + vv.height
  return window.innerHeight
}

function viewportHeight(): number {
  const vv = window.visualViewport
  return vv?.height ?? window.innerHeight
}

function applyHeight(el: HTMLTextAreaElement, minHeight: number) {
  el.style.height = 'auto'
  el.style.maxHeight = 'none'
  const natural = Math.max(minHeight, el.scrollHeight)
  const top = el.getBoundingClientRect().top
  const room = Math.max(minHeight, viewportBottom() - top - KEYBOARD_GAP)
  const maxH = Math.max(minHeight, Math.min(room, viewportHeight() - KEYBOARD_GAP))
  const next = Math.min(natural, maxH)
  el.style.height = `${next}px`
  el.style.maxHeight = `${maxH}px`
  el.style.overflowY = natural > maxH + 1 ? 'auto' : 'hidden'
  return { natural, maxH }
}

function scrollCaretIntoTextarea(el: HTMLTextAreaElement) {
  if (el.scrollHeight <= el.clientHeight + 1) return
  try {
    const pos = el.selectionEnd
    const cs = window.getComputedStyle(el)
    const line =
      parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.4 || 22
    const padTop = parseFloat(cs.paddingTop) || 0
    const lineIndex = el.value.slice(0, pos).split('\n').length - 1
    const caretY = padTop + lineIndex * line
    const viewTop = el.scrollTop
    const viewBottom = viewTop + el.clientHeight - line * 1.5
    if (caretY < viewTop) el.scrollTop = Math.max(0, caretY - line)
    else if (caretY > viewBottom) el.scrollTop = caretY - el.clientHeight + line * 2
  } catch {
    el.scrollTop = el.scrollHeight
  }
}

/**
 * Grows downward toward the keyboard. Extra lines push older text upward
 * (off-screen / internal scroll) so the caret stays near the keyboard.
 */
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
  const focusedRef = useRef(false)
  const rafRef = useRef(0)

  const layout = useCallback(() => {
    const el = ref.current
    if (!el) return

    applyHeight(el, minHeight)

    if (!focusedRef.current) return

    const bottomLimit = viewportBottom() - KEYBOARD_GAP
    const delta = el.getBoundingClientRect().bottom - bottomLimit
    if (Math.abs(delta) > 2) {
      window.scrollBy(0, delta)
      // After scroll, more room above keyboard — grow again so bottom stays pinned
      applyHeight(el, minHeight)
      const delta2 = el.getBoundingClientRect().bottom - bottomLimit
      if (Math.abs(delta2) > 2) window.scrollBy(0, delta2)
    }

    scrollCaretIntoTextarea(el)
  }, [minHeight])

  const scheduleLayout = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(layout)
  }, [layout])

  useEffect(() => {
    layout()
  }, [value, layout])

  useEffect(() => {
    const onVv = () => {
      if (focusedRef.current) scheduleLayout()
    }
    const vv = window.visualViewport
    vv?.addEventListener('resize', onVv)
    vv?.addEventListener('scroll', onVv)
    return () => {
      vv?.removeEventListener('resize', onVv)
      vv?.removeEventListener('scroll', onVv)
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
      onChange={e => {
        onChange(e.target.value)
        layout()
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
      }}
      onBlur={e => {
        focusedRef.current = false
        const el = ref.current
        if (el) {
          el.style.maxHeight = ''
          el.style.height = 'auto'
          el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
          el.style.overflowY = 'hidden'
        }
        onBlur?.(e.target.value)
      }}
      onFocus={e => {
        focusedRef.current = true
        if (softNumbering && !disabled) {
          const starter = ensureEmptyFocusPrefix(e.currentTarget.value)
          if (starter) {
            onChange(starter)
            setCaret(starter.length)
          }
        }
        onFocus?.()
        scheduleLayout()
      }}
      className={`${className ?? ''} [overflow-anchor:none]`}
    />
  )
}
