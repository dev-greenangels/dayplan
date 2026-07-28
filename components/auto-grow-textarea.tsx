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

/** Blurred: show full text on the page. */
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
 * Focused on iOS/Android: keep a STABLE height (no grow/collapse per key).
 * Changing height while focused makes Safari jump the page to the top —
 * especially for the last field above the keyboard.
 */
function applyFocusedBox(el: HTMLTextAreaElement, minHeight: number) {
  const boxH = Math.max(minHeight, Math.floor(vvHeight() * 0.38))
  el.style.height = `${boxH}px`
  el.style.maxHeight = `${boxH}px`
  el.style.overflowY = 'auto'
}

function stickCaretVisible(el: HTMLTextAreaElement) {
  const atEnd = (el.selectionEnd ?? 0) >= el.value.length - 1
  if (atEnd) {
    el.scrollTop = el.scrollHeight
    return
  }
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

/** Place field in the visible area once (after keyboard opens). */
function placeOnce(el: HTMLTextAreaElement) {
  const vv = window.visualViewport
  const viewTop = vv?.offsetTop ?? 0
  const viewH = vv?.height ?? window.innerHeight
  const rect = el.getBoundingClientRect()
  // Keep field in the upper half of the visible viewport, above keyboard
  const desiredTop = viewTop + Math.min(72, viewH * 0.12)
  const delta = rect.top - desiredTop
  if (Math.abs(delta) > 16) {
    const s = scroller()
    s.scrollTop += delta
  }
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
  const placedRef = useRef(false)
  const lastVvHRef = useRef(0)

  const syncIdleHeight = useCallback(() => {
    const el = ref.current
    if (!el || focusedRef.current) return
    expandFull(el, minHeight)
  }, [minHeight])

  useEffect(() => {
    // Only resize when NOT focused — avoids iOS scroll jump on each key
    if (!focusedRef.current) syncIdleHeight()
    else {
      const el = ref.current
      if (el) stickCaretVisible(el)
    }
  }, [value, syncIdleHeight])

  useEffect(() => {
    const onVvResize = () => {
      if (!focusedRef.current || !ref.current) return
      const h = vvHeight()
      if (Math.abs(h - lastVvHRef.current) < 50) return
      lastVvHRef.current = h
      applyFocusedBox(ref.current, minHeight)
      stickCaretVisible(ref.current)
      if (!placedRef.current) {
        placeOnce(ref.current)
        placedRef.current = true
      }
    }
    window.visualViewport?.addEventListener('resize', onVvResize)
    return () => {
      window.visualViewport?.removeEventListener('resize', onVvResize)
      cancelAnimationFrame(rafRef.current)
      window.clearTimeout(focusTimerRef.current)
      document.documentElement.classList.remove('dp-field-focused')
    }
  }, [minHeight])

  function setCaret(pos: number) {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => {
      el.setSelectionRange(pos, pos)
      stickCaretVisible(el)
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
        // Keep caret visible inside the fixed box — do not touch page scroll
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(() => {
          if (ref.current && focusedRef.current) stickCaretVisible(ref.current)
        })
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
        placedRef.current = false
        window.clearTimeout(focusTimerRef.current)
        document.documentElement.classList.remove('dp-field-focused')
        expandFull(e.currentTarget, minHeight)
        onBlur?.(e.target.value)
      }}
      onFocus={e => {
        focusedRef.current = true
        placedRef.current = false
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

        // Lock height immediately so Safari won't reflow-jump while typing
        applyFocusedBox(e.currentTarget, minHeight)
        stickCaretVisible(e.currentTarget)

        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = window.setTimeout(() => {
          if (!focusedRef.current || !ref.current) return
          lastVvHRef.current = vvHeight()
          applyFocusedBox(ref.current, minHeight)
          stickCaretVisible(ref.current)
          placeOnce(ref.current)
          placedRef.current = true
        }, 350)
      }}
      className={`${className ?? ''} touch-manipulation [overflow-anchor:none]`}
    />
  )
}
