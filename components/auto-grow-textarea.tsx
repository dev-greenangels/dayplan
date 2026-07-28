'use client'

import { useCallback, useEffect, useRef } from 'react'
import {
  applyEnterNumbering,
  ensureEmptyFocusPrefix,
} from '@/lib/soft-numbering'

const FOCUS_MAX_RATIO = 0.5

function vvHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight
}

function scroller() {
  return document.scrollingElement || document.documentElement
}

/**
 * iOS-safe content height after a constrained box.
 * Probe at max height with overflow hidden — scrollHeight then reflects full text
 * without collapsing to 0 (which jumps the page while focused).
 */
function measureContentHeight(
  el: HTMLTextAreaElement,
  minHeight: number,
  probeMax: number
): number {
  const prevH = el.style.height
  const prevMax = el.style.maxHeight
  const prevOv = el.style.overflowY
  el.style.overflowY = 'hidden'
  el.style.maxHeight = 'none'
  el.style.height = `${probeMax}px`
  const h = Math.max(minHeight, el.scrollHeight)
  el.style.height = prevH
  el.style.maxHeight = prevMax
  el.style.overflowY = prevOv
  return h
}

/** Blurred: full text visible — no max-height clip. */
function expandFull(el: HTMLTextAreaElement, minHeight: number) {
  const s = scroller()
  const y0 = s.scrollTop
  const top0 = el.getBoundingClientRect().top

  el.style.overflowY = 'hidden'
  el.style.maxHeight = 'none'
  // Force iOS to recompute full scrollHeight after focused constraint
  el.style.height = '0px'
  const next = Math.max(minHeight, el.scrollHeight)
  el.style.height = `${next}px`
  el.style.maxHeight = ''
  el.style.overflowY = 'hidden'

  const dy = el.getBoundingClientRect().top - top0
  if (dy) s.scrollTop = y0 + dy
}

/**
 * Focused: grow with content up to 50% of visible viewport, then internal scroll.
 * Short text → short box; long text → capped box + inner scroll.
 */
function applyFocusedSize(el: HTMLTextAreaElement, minHeight: number) {
  const maxH = Math.max(minHeight, Math.floor(vvHeight() * FOCUS_MAX_RATIO))
  const s = scroller()
  const y0 = s.scrollTop
  const top0 = el.getBoundingClientRect().top

  const natural = measureContentHeight(el, minHeight, maxH)
  const next = Math.min(natural, maxH)
  el.style.maxHeight = `${maxH}px`
  el.style.height = `${next}px`
  el.style.overflowY = natural > maxH + 1 ? 'auto' : 'hidden'

  const dy = el.getBoundingClientRect().top - top0
  if (dy) s.scrollTop = y0 + dy
  return { natural, maxH, next }
}

function lineMetrics(el: HTMLTextAreaElement) {
  const cs = window.getComputedStyle(el)
  const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45 || 22
  const padTop = parseFloat(cs.paddingTop) || 0
  return { line, padTop }
}

function caretOffsetY(el: HTMLTextAreaElement, pos: number) {
  const { line, padTop } = lineMetrics(el)
  const lines = el.value.slice(0, pos).split('\n').length
  return padTop + (lines - 1) * line
}

/** Scroll inside the box so `pos` is visible. */
function scrollPosIntoView(el: HTMLTextAreaElement, pos: number) {
  if (el.scrollHeight <= el.clientHeight + 1) return
  const { line } = lineMetrics(el)
  const caretY = caretOffsetY(el, pos)
  const viewTop = el.scrollTop
  const viewBottom = viewTop + el.clientHeight - line * 1.25
  if (caretY > viewBottom) el.scrollTop = caretY - el.clientHeight + line * 2
  else if (caretY < viewTop + line * 0.5) el.scrollTop = Math.max(0, caretY - line)
}

function scrollToEnd(el: HTMLTextAreaElement) {
  el.scrollTop = el.scrollHeight
}

/** Place field once in the visible area above the keyboard. */
function placeOnce(el: HTMLTextAreaElement) {
  const vv = window.visualViewport
  const viewTop = vv?.offsetTop ?? 0
  const viewH = vv?.height ?? window.innerHeight
  const rect = el.getBoundingClientRect()
  const desiredTop = viewTop + Math.min(64, viewH * 0.1)
  const delta = rect.top - desiredTop
  if (Math.abs(delta) > 16) scroller().scrollTop += delta
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
  const blurTimerRef = useRef(0)
  const placedRef = useRef(false)
  const lastVvHRef = useRef(0)
  /** After focus: prefer end vs caret location */
  const preferEndRef = useRef(false)

  const syncIdleHeight = useCallback(() => {
    const el = ref.current
    if (!el || focusedRef.current) return
    expandFull(el, minHeight)
  }, [minHeight])

  const syncFocused = useCallback(() => {
    const el = ref.current
    if (!el || !focusedRef.current) return
    applyFocusedSize(el, minHeight)
    const pos = el.selectionEnd ?? el.value.length
    if (preferEndRef.current || pos >= el.value.length - 1) {
      scrollToEnd(el)
    } else {
      scrollPosIntoView(el, pos)
    }
  }, [minHeight])

  useEffect(() => {
    if (focusedRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(syncFocused)
    } else {
      syncIdleHeight()
    }
  }, [value, syncFocused, syncIdleHeight])

  useEffect(() => {
    const onVvResize = () => {
      if (!focusedRef.current || !ref.current) return
      const h = vvHeight()
      if (Math.abs(h - lastVvHRef.current) < 40) return
      lastVvHRef.current = h
      syncFocused()
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
      window.clearTimeout(blurTimerRef.current)
      document.documentElement.classList.remove('dp-field-focused')
    }
  }, [syncFocused])

  function setCaret(pos: number) {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => {
      el.setSelectionRange(pos, pos)
      preferEndRef.current = pos >= el.value.length - 1
      syncFocused()
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
      onPointerDown={() => {
        // Tap inside existing text → show that place (not force end)
        preferEndRef.current = false
      }}
      onChange={e => {
        onChange(e.target.value)
        preferEndRef.current =
          (e.target.selectionEnd ?? 0) >= e.target.value.length - 1
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(syncFocused)
      }}
      onSelect={e => {
        if (!focusedRef.current) return
        const el = e.currentTarget
        preferEndRef.current =
          (el.selectionEnd ?? 0) >= el.value.length - 1
        scrollPosIntoView(el, el.selectionEnd ?? el.value.length)
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
        preferEndRef.current = true
        setCaret(caret)
      }}
      onBlur={e => {
        focusedRef.current = false
        placedRef.current = false
        preferEndRef.current = false
        window.clearTimeout(focusTimerRef.current)
        document.documentElement.classList.remove('dp-field-focused')
        const el = e.currentTarget
        // Double rAF + short delay: iOS needs a tick after keyboard dismissal
        expandFull(el, minHeight)
        window.clearTimeout(blurTimerRef.current)
        blurTimerRef.current = window.setTimeout(() => {
          if (!focusedRef.current) expandFull(el, minHeight)
        }, 50)
        onBlur?.(e.target.value)
      }}
      onFocus={e => {
        focusedRef.current = true
        placedRef.current = false
        lastVvHRef.current = vvHeight()
        document.documentElement.classList.add('dp-field-focused')

        const el = e.currentTarget
        const wasEmpty = el.value.trim() === ''

        if (softNumbering && !disabled) {
          const starter = ensureEmptyFocusPrefix(el.value)
          if (starter) {
            preferEndRef.current = true
            onChange(starter)
            setCaret(starter.length)
            onFocus?.()
            window.clearTimeout(focusTimerRef.current)
            focusTimerRef.current = window.setTimeout(() => {
              if (!focusedRef.current || !ref.current) return
              lastVvHRef.current = vvHeight()
              syncFocused()
              placeOnce(ref.current)
              placedRef.current = true
            }, 350)
            return
          }
        }

        // Empty / near-end → show end; otherwise keep tap caret location
        const pos = el.selectionStart ?? 0
        preferEndRef.current =
          wasEmpty || pos >= el.value.length - 1 || el.value.length < 8

        onFocus?.()
        syncFocused()

        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = window.setTimeout(() => {
          if (!focusedRef.current || !ref.current) return
          lastVvHRef.current = vvHeight()
          // After browser sets caret from the tap, sync scroll to it
          const p = ref.current.selectionEnd ?? ref.current.value.length
          preferEndRef.current = p >= ref.current.value.length - 1
          syncFocused()
          placeOnce(ref.current)
          placedRef.current = true
        }, 350)
      }}
      className={`${className ?? ''} touch-manipulation [overflow-anchor:none]`}
    />
  )
}
