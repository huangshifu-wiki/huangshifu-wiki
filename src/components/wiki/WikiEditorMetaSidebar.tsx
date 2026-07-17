import React from 'react'
import { ChevronDown, Save, Send } from '@/src/components/icons'
import { BookEditorActions } from '../../components/BookEditor'
import { useI18n } from '../../lib/i18n'
import { getWikiDraftButtonText, getWikiSubmitButtonText } from '../../lib/wikiWriteText'
import { Button } from '@/src/components/ui'

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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onToggleAdvancedOptions}
        aria-expanded={showAdvancedOptions}
        aria-controls="wiki-advanced-options"
        className="mr-auto text-text-muted"
        leftIcon={
          <ChevronDown
            size={16}
            className={`transition-transform ${showAdvancedOptions ? 'rotate-180' : ''}`}
          />
        }
      >
        {t('wiki.advancedOptions')}
      </Button>
    ) : null

    return (
      <BookEditorActions leading={advancedToggle}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onSubmit('draft')}
          disabled={Boolean(savingMode)}
          leftIcon={<Save size={16} />}
        >
          {saveButtonText}
        </Button>
        <Button
          type="submit"
          disabled={Boolean(savingMode)}
          className="px-8"
          leftIcon={<Send size={16} />}
        >
          {submitButtonText}
        </Button>
      </BookEditorActions>
    )
  }
)

WikiEditorMetaSidebar.displayName = 'WikiEditorMetaSidebar'

export default WikiEditorMetaSidebar
