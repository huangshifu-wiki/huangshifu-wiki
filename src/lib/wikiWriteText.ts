type Translate = (key: string, params?: Record<string, string | number>) => string

export type WikiWriteMode = 'draft' | 'pending'
export type WikiWriteStatus = 'draft' | 'pending' | 'published'

export function getWikiDraftButtonText(t: Translate, savingMode: WikiWriteMode | null) {
  return savingMode === 'draft' ? t('wiki.saving') : t('wiki.saveDraft')
}

export function getWikiSubmitButtonText(t: Translate, isAdmin: boolean, submitting: boolean) {
  if (submitting) {
    return isAdmin ? t('wiki.publishing') : t('wiki.submitting')
  }

  return isAdmin ? t('wiki.publishWiki') : t('wiki.submitReview')
}

export function getWikiSaveResultText(t: Translate, status: WikiWriteStatus) {
  if (status === 'published') {
    return t('wiki.pagePublished')
  }

  if (status === 'pending') {
    return t('wiki.reviewSubmitted')
  }

  return t('wiki.draftSaved')
}
