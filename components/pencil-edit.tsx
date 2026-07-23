'use client'

import { useEffect, useRef, useState } from 'react'

interface Props {
  value: string
  onSave: (value: string) => void
  disabled?: boolean
  className?: string
  textClassName?: string
}

export default function PencilEdit({
  value,
  onSave,
  disabled,
  className = '',
  textClassName = 'font-medium text-foreground',
}: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  function commit() {
    const trimmed = draft.trim()
    if (!trimmed || trimmed === value) {
      setDraft(value)
      setEditing(false)
      return
    }
    onSave(trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        <input
          ref={inputRef}
          value={draft}
          disabled={disabled}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(value)
              setEditing(false)
            }
          }}
          onBlur={commit}
          className="min-w-0 flex-1 rounded-lg border border-input bg-white px-2 py-1 text-sm"
        />
      </div>
    )
  }

  return (
    <div className={`group flex items-center gap-1.5 ${className}`}>
      <span className={textClassName}>{value || '—'}</span>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setEditing(true)}
        className="tap-btn rounded p-1 text-muted-foreground opacity-70 hover:bg-muted hover:opacity-100 disabled:opacity-30"
        title="Редагувати"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
        </svg>
      </button>
    </div>
  )
}
