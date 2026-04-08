# Upload Progress Bar — Design Spec

**Date:** 2026-04-08  
**Status:** Approved

## Problem

The SEO Parser upload gives no feedback beyond an "Uploading..." text label. Large folder uploads (dozens of CSVs, up to 169MB) are split into multiple ≤40MB batches posted sequentially. Users have no way to know how far along the upload is.

## Solution

Add a slim green progress bar inside the dropzone that appears during upload and fills from 0% → 100% as batches complete. Progress is calculated from total byte counts — more accurate than file count for mixed-size batches.

## Approach

Batch-level byte tracking: compute `totalBytes` from all dropped files before batching begins. After each batch completes, add that batch's bytes to `uploadedBytes`. `uploadProgress = Math.round((uploadedBytes / totalBytes) * 100)`. No changes to the upload mechanism or API.

## Files Changed

### `app/seo-parser/page.tsx`

- Add `uploadProgress` state: `const [uploadProgress, setUploadProgress] = useState(0)`
- In `handleDrop`, before the batch loop: compute `totalBytes = droppedFiles.reduce((s, f) => s + f.size, 0)`; initialize `uploadedBytes = 0`
- After each batch fetch resolves successfully: `uploadedBytes += batch.reduce((s, f) => s + f.size, 0)`; call `setUploadProgress(Math.round((uploadedBytes / totalBytes) * 100))`
- Reset `uploadProgress` to 0 in the `finally` block (after `setIsUploading(false)`)
- Also reset `uploadProgress` to 0 in `handleReset`
- Pass `uploadProgress` to `<FileDropzone>`

### `components/seo-parser/FileDropzone.tsx`

- Add `uploadProgress?: number` to `FileDropzoneProps`
- When `isUploading` is true, replace the "Uploading..." paragraph with:
  - A progress bar container: `h-1.5`, `rounded-full`, `bg-gray-200 dark:bg-navy-border`, full width
  - A green fill bar: `bg-green-500`, `rounded-full`, `h-full`, `transition-width duration-300`, width set via inline style `{{ width: '${uploadProgress ?? 0}%' }}`
  - A small label below: `text-xs text-gray-500 dark:text-white/50` showing `"Uploading… ${uploadProgress ?? 0}%"`

## Behaviour

| Scenario | Result |
|---|---|
| Single batch (all files ≤ 40MB) | Jumps 0% → 100% when batch completes |
| Multiple batches | Increments at each batch boundary |
| Upload error | `finally` resets progress to 0; error message shows |
| Re-upload after reset | Progress resets to 0 via `handleReset` |

## Out of Scope

- Mid-batch byte-level progress (XHR not needed for this use case)
- Progress bar on the Analyze step (that's parsing, not uploading)
- Any server-side changes
