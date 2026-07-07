'use client'
import { useRef, useState } from 'react'

export function DropZone({
  onFiles,
  accept = '.csv,.txt,text/csv',
  disabled = false,
  label = 'Drop CSV files or click to browse',
}: {
  onFiles: (files: File[]) => void
  accept?: string
  disabled?: boolean
  label?: string
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)

  const emit = (list: FileList | null) => {
    if (disabled || !list || list.length === 0) return
    onFiles(Array.from(list))
  }

  const open = () => {
    if (!disabled) inputRef.current?.click()
  }

  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      aria-label={label}
      onClick={open}
      onKeyDown={(e) => {
        if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault()
          open()
        }
      }}
      onDragOver={(e) => { if (!disabled) { e.preventDefault(); setOver(true) } }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); emit(e.dataTransfer.files) }}
      className={`flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors ${
        disabled
          ? 'cursor-not-allowed border-gray-200 dark:border-navy-border opacity-50'
          : over
          ? 'border-orange bg-orange/5 dark:bg-orange/10'
          : 'border-gray-300 hover:border-orange dark:border-navy-border dark:hover:border-orange'
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        disabled={disabled}
        className="hidden"
        onChange={(e) => emit(e.target.files)}
      />
      <span className="text-[13px] font-body text-gray-500 dark:text-white/60">{label}</span>
    </div>
  )
}
