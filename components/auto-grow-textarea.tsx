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

function focusMaxHeight(minHeight: number) {
  return Math.max(minHeight, Math.floor(vvHeight() * FOCUS_MAX_RATIO))
}

/**
 * Blurred: full text on the page.
 * height:0 probe fixes iOS scrollHeight after a focused constrained box.
 */
function expandFull(el: HTMLTextAreaElement, minHeight: number) {
  const s = scroller()
  const y0 = s.scrollTop
  const top0 = el.getBoundingClientRect().top

  el.style.overflowY = 'hidden'
  el.style.maxHeight = 'none'
  el.style.height = '0px'
  const next = Math.max(minHeight, el.scrollHeight)
  el.style.height = `${next}px`
  el.style.maxHeight = ''
  el.style.overflowY = 'hidden'

  const dy = el.getBoundingClientRect().top - top0
  if (dy) s.scrollTop = y0 + dy
}

/**
 * Lock focused box once (on focus / keyboard resize only).
 */
function lockFocusedBox(el: HTMLTextAreaElement, minHeight: number) {
  const maxH = focusMaxHeight(minHeight)
  el.style.overflowY = 'hidden'
  el.style.maxHeight = 'none'
  el.style.height = 'auto'
  const natural = Math.max(minHeight, el.scrollHeight)
  const next = Math.min(natural, maxH)
  el.style.maxHeight = `${maxH}px`
  el.style.height = `${next}px`
  el.style.overflowY = natural > maxH + 1 ? 'auto' : 'hidden'
  return maxH
}

/**
 * While typing: only GROW height up to max — never shrink, never height:auto.
 * Shrinking / remeasure was the mid-keystroke jerk.
 */
function growFocusedIfNeeded(
  el: HTMLTextAreaElement,
  maxH: number,
  minHeight: number
) {
  el.style.maxHeight = `${maxH}px`
  el.style.overflowY = 'auto'
  const content = Math.max(minHeight, el.scrollHeight)
  const cur = el.offsetHeight
  if (content > cur + 1 && cur < maxH) {
    el.style.height = `${Math.min(content, maxH)}px`
  }
  el.style.overflowY = content > maxH + 1 ? 'auto' : 'hidden'
}

function lineHeightPx(el: HTMLTextAreaElement) {
  const cs = window.getComputedStyle(el)
  return parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45 || 22
}

function scrollPosIntoView(el: HTMLTextAreaElement, pos: number) {
  if (el.scrollHeight <= el.clientHeight + 1) return
  const line = lineHeightPx(el)
  const padTop = parseFloat(window.getComputedStyle(el).paddingTop) || 0
  const lines = el.value.slice(0, pos).split('\n').length
  const caretY = padTop + (lines - 1) * line
  const viewTop = el.scrollTop
  const viewBottom = viewTop + el.clientHeight - line * 1.2
  if (caretY > viewBottom) el.scrollTop = caretY - el.clientHeight + line * 2
  else if (caretY < viewTop + line * 0.4) el.scrollTop = Math.max(0, caretY - line)
}

function scrollToEnd(el: HTMLTextAreaElement) {
  el.scrollTop = el.scrollHeight
}

function placeOnce(el: HTMLTextAreaElement) {
  const vv = window.visualViewport
  const viewTop = vv?.offsetTop ?? 0
  const viewH = vv?.height ?? window.innerHeight
  const rect = el.getBoundingClientRect()
  const desiredTop = viewTop + Math.min(64, viewH * 0.1)
  const delta = rect.top - desiredTop
  if (Math.abs(delta) > 20) scroller().scrollTop += delta
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
  const preferEndRef = useRef(false)
  const lockedMaxRef = useRef(0)

  const syncIdle = useCallback(() => {
    const el = ref.current
    if (!el || focusedRef.current) return
    expandFull(el, minHeight)
  }, [minHeight])

  /** Only scroll inside — never touch height while typing. */
  const syncCaretOnly = useCallback(() => {
    const el = ref.current
    if (!el || !focusedRef.current) return
    if (el.scrollHeight <= el.clientHeight + 1) return
    const pos = el.selectionEnd ?? el.value.length
    if (preferEndRef.current || pos >= el.value.length - 1) {
      const maxScroll = el.scrollHeight - el.clientHeight
      if (el.scrollTop < maxScroll - 2) el.scrollTop = maxScroll
    } else {
      scrollPosIntoView(el, pos)
    }
  }, [])

  useEffect(() => {
    if (focusedRef.current) {
      // Typing: caret only. Do NOT relock height (that jerks).
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(syncCaretOnly)
    } else {
      syncIdle()
    }
  }, [value, syncCaretOnly, syncIdle])

  useEffect(() => {
    const onVvResize = () => {
      if (!focusedRef.current || !ref.current) return
      const h = vvHeight()
      if (Math.abs(h - lastVvHRef.current) < 60) return
      lastVvHRef.current = h
      // Keyboard open/close only — relock once
      lockedMaxRef.current = lockFocusedBox(ref.current, minHeight)
      syncCaretOnly()
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
  }, [minHeight, syncCaretOnly])

  function setCaret(pos: number) {
    const el = ref.current
    if (!el) return
    requestAnimationFrame(() => {
      el.setSelectionRange(pos, pos)
      preferEndRef.current = pos >= el.value.length - 1
      syncCaretOnly()
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
        preferEndRef.current = false
      }}
      onChange={e => {
        onChange(e.target.value)
        preferEndRef.current =
          (e.target.selectionEnd ?? 0) >= e.target.value.length - 1
        const el = e.target
        const maxH = lockedMaxRef.current || focusMaxHeight(minHeight)
        lockedMaxRef.current = maxH
        // Grow-only + caret — no remeasure/shrink
        growFocusedIfNeeded(el, maxH, minHeight)
        cancelAnimationFrame(rafRef.current)
        rafRef.current = requestAnimationFrame(syncCaretOnly)
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
        lockedMaxRef.current = 0
        window.clearTimeout(focusTimerRef.current)
        document.documentElement.classList.remove('dp-field-focused')
        const el = e.currentTarget
        expandFull(el, minHeight)
        window.clearTimeout(blurTimerRef.current)
        blurTimerRef.current = window.setTimeout(() => {
          if (!focusedRef.current) expandFull(el, minHeight)
        }, 80)
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
            lockedMaxRef.current = lockFocusedBox(el, minHeight)
            setCaret(starter.length)
            onFocus?.()
            window.clearTimeout(focusTimerRef.current)
            focusTimerRef.current = window.setTimeout(() => {
              if (!focusedRef.current || !ref.current) return
              lastVvHRef.current = vvHeight()
              lockedMaxRef.current = lockFocusedBox(ref.current, minHeight)
              syncCaretOnly()
              placeOnce(ref.current)
              placedRef.current = true
            }, 350)
            return
          }
        }

        const pos = el.selectionStart ?? 0
        preferEndRef.current =
          wasEmpty || pos >= el.value.length - 1 || el.value.length < 8

        onFocus?.()
        lockedMaxRef.current = lockFocusedBox(el, minHeight)
        syncCaretOnly()

        window.clearTimeout(focusTimerRef.current)
        focusTimerRef.current = window.setTimeout(() => {
          if (!focusedRef.current || !ref.current) return
          lastVvHRef.current = vvHeight()
          lockedMaxRef.current = lockFocusedBox(ref.current, minHeight)
          const p = ref.current.selectionEnd ?? ref.current.value.length
          preferEndRef.current = p >= ref.current.value.length - 1
          syncCaretOnly()
          placeOnce(ref.current)
          placedRef.current = true
        }, 350)
      }}
      className={`${className ?? ''} touch-manipulation [overflow-anchor:none]`}
    />
  )
}
