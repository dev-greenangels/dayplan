'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  applyEnterNumbering,
  ensureEmptyFocusPrefix,
} from '@/lib/soft-numbering'

function vvHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function scroller() {
  return document.scrollingElement || document.documentElement
}

/** Blurred: full content visible on the page (no internal scroll). */
function expandFull(el: HTMLTextAreaElement, minHeight: number) {
  const s = scroller()
  const y0 = s.scrollTop
  const top0 = el.getBoundingClientRect().top
  el.style.maxHeight = ''
  el.style.overflowY = 'hidden'
  el.style.height = 'auto'
  el.style.height = `${Math.max(minHeight, el.scrollHeight)}px`
  const dy = el.getBoundingClientRect().top - top0
  if (dy) s.scrollTop = y0 + dy
}

/**
 * Focused: cap height to ~40% of visible viewport. Grow within that,
 * then scroll inside so the caret stays visible.
 * No window.scrollBy on keystrokes — that caused Android jerking.
 */
function layoutFocused(el: HTMLTextAreaElement, minHeight: number) {
  const maxH = Math.max(minHeight, Math.floor(vvHeight() * 0.4))
  el.style.maxHeight = `${maxH}px`
  el.style.height = 'auto'
  const natural = Math.max(minHeight, el.scrollHeight)
  const next = Math.min(natural, maxH)
  el.style.height = `${next}px`
  el.style.overflowY = natural > maxH + 1 ? 'auto' : 'hidden'

  if (natural > maxH) {
    const atEnd = (el.selectionEnd ?? 0) >= el.value.length - 1
    if (atEnd) el.scrollTop = el.scrollHeight
    else scrollCaretLine(el)
  }
}

function scrollCaretLine(el: HTMLTextAreaElement) {
  try {
    const pos = el.selectionEnd ?? el.value.length
    const cs = window.getComputedStyle(el)
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45 || 22
    const padTop = parseFloat(cs.paddingTop) || 0
    const lines = el.value.slice(0, pos).split('\n').length
    const caretY = padTop + (lines - 1) * line
    const viewBottom = el.scrollTop + el.clientHeight - line
    if (caretY > viewBottom) el.scrollTop = caretY - el.clientHeight + line * 1.5
    else if (caretY < el.scrollTop) el.scrollTop = Math.max(0, caretY - line)
  } catch {
    /* ignore */
  }
}

/** One-shot: place field in the upper-middle of the visible viewport. */
function scrollFieldIntoView(el: HTMLTextAreaElement) {
  const vv = window.visualViewport
  const viewTop = vv?.offsetTop ?? 0
  const viewH = vv?.height ?? window.innerHeight
  const mid = viewTop + viewH * 0.32
  const rect = el.getBoundingClientRect()
  const target = mid - Math.min(rect.height, viewH * 0.3) / 2
  const delta = rect.top - target
  if (Math.abs(delta) > 20) window.scrollBy(0, delta)
}

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
  const focusTimerRef = useRef(0)
  const lastVvHRef = useRef(0)

  const layout = useCallback(() => {
    const el = ref.current
    if (!el) return
    if (focusedRef.current) layoutFocused(el, minHeight)
    else expandFull(el, minHeight)
  }, [minHeight])

  const scheduleLayout = useCallback(() => {
    cancelAnimationFrame(rafRef.current)
    rafRef.current = requestAnimationFrame(layout)
  }, [layout])

  useEffect(() => {
    layout()
  }, [value, layout])

  useEffect(() => {
    const onVvResize = () => {
      if (!focusedRef.current || !ref.current) return
      const h = vvHeight()
      if (Math.abs(h - lastVvHRef.current) < 40) return
      lastVvHRef.current = h
      layout()
      scrollFieldIntoView(ref.current)
    }
    window.visualViewport?.addEventListener('resize', onVvResize)
    return () => {
      window.visualViewport?.removeEventListener('resize', onVvResize)
      cancelAnimationFrame(rafRef.current)
      window.clearTimeout(focusTimerRef.current)
      document.documentElement.classList.remove('dp-field-focused')
    }
  }, [layout])

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
        window.clearTimeout(focusTimerRef.current)
        document.documentElement.classList.remove('dp-field-focused')
        expandFull(e.currentTarget, minHeight)
        onBlur?.(e.target.value)
      }}
      onFocus={e => {
        focusedRef.current = true
        lastVvHRef.current = vvHeight()
        document.documentElement.classList.add('dp-field-focused')
        if (softNumbering && !disabled) {
          const starter = ensureEmptyFocusPrefix(e.currentTarget.value)
          if (starter) {
            onChange(starter)
            setCaret(starter.length)
          }
        }
        onFocus?.()
        layout()
        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = window.setTimeout(() => {
          if (!focusedRef.current || !ref.current) return
          lastVvHRef.current = vvHeight()
          layout()
          scrollFieldIntoView(ref.current)
        }, 320)
      }}
      className={`${className ?? ''} touch-manipulation [overflow-anchor:none]`}
    />
  )
}
