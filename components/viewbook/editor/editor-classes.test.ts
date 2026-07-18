import { describe, expect, it } from 'vitest'
import {
  editorDestructiveBtnClass,
  editorInputClass,
  editorLabelClass,
  editorPrimaryBtnClass,
  editorSecondaryBtnClass,
  editorTextareaClass,
  editorWellClass,
} from './editor-classes'

describe('viewbook editor class recipes', () => {
  it('provides dark-mode coverage for every shared recipe', () => {
    const recipes = [
      editorLabelClass,
      editorInputClass,
      editorTextareaClass,
      editorPrimaryBtnClass,
      editorSecondaryBtnClass,
      editorDestructiveBtnClass,
      editorWellClass,
    ]

    for (const recipe of recipes) expect(recipe).toContain('dark:')
  })
})
