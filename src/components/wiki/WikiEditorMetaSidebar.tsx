import React from 'react'
import { ChevronDown, Save, Send } from '@/src/components/icons'
import { BookEditorActions, bookSecondaryButtonClass } from '../../components/BookEditor'
import { useI18n } from '../../lib/i18n'
import { getWikiDraftButtonText, getWikiSubmitButtonText } from '../../lib/wikiWriteText'

interface WikiEditorMetaSidebarProps {
  savingMode: 'draft' | 'pending' | null
  isAdmin: boolean
  onSubmit: (status: 'draft' | 'pending') => void
  showAdvancedToggle?: boolean
  showAdvancedOptions?: boolean
  onToggleAdvancedOptions?: () => void
}

const WikiEditorMetaSidebar = React.memo(
  ({
    savingMode,
    isAdmin,
    onSubmit,
    showAdvancedToggle = false,
    showAdvancedOptions = false,
    onToggleAdvancedOptions,
  }: WikiEditorMetaSidebarProps) => {
    const { t } = useI18n()
    const saveButtonText = getWikiDraftButtonText(t, savingMode)
    const submitButtonText = getWikiSubmitButtonText(t, isAdmin, savingMode === 'pending')
    const advancedToggle = showAdvancedToggle ? (
      <button
        type="button"
        onClick={onToggleAdvancedOptions}
        aria-expanded={showAdvancedOptions}
        aria-controls="wiki-advanced-options"
        className="mr-auto flex items-center gap-2 text-sm text-text-muted transition-colors hover:text-brand-gold"
      >
        <ChevronDown
          size={16}
          className={`transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
        />{' '}
        {t('wiki.advancedOptions')}
      </button>
    ) : null

    return (
      <BookEditorActions leading={advancedToggle}>
        <button
          type="button"
          onClick={() => onSubmit('draft')}
          disabled={Boolean(savingMode)}
          className={bookSecondaryButtonClass}
        >
          <Save size={16} /> {saveButtonText}
        </button>
        <button
          type="submit"
          disabled={Boolean(savingMode)}
          className="inline-flex items-center gap-2 rounded px-8 py-2.5 text-sm font-medium theme-button-primary transition-all disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Send size={16} /> {submitButtonText}
        </button>
      </BookEditorActions>
    )
  }
)

WikiEditorMetaSidebar.displayName = 'WikiEditorMetaSidebar'

export default WikiEditorMetaSidebar
