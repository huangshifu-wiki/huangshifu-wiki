import React from 'react'
import { ViewModeSelector } from '../components/ViewModeSelector'
import { useUserPreferences } from '../context/UserPreferencesContext'
import { useSearchPage } from '../hooks/useSearchPage'
import { SearchBox } from '../components/search/SearchBox'
import { SearchFilters } from '../components/search/SearchFilters'
import { SearchResults } from '../components/search/SearchResults'
import { usePublicFeatures } from '../hooks/usePublicFeatures'

const Search: React.FC = () => {
  const { preferences, setViewMode } = useUserPreferences()
  const viewMode = preferences.viewMode
  const { features } = usePublicFeatures()
  const semanticSearchEnabled = features.semanticSearch

  const {
    state,
    searchHistory,
    tabItems,
    performSearch,
    handleQueryChange,
    handleImageSearch,
    toggleTag,
    updateFilters,
    resetFilters,
    setActiveTab,
    setShowFilters,
    dismissSuggestions,
    removeSearchHistoryItem,
    clearSearchHistory,
  } = useSearchPage()

  React.useEffect(() => {
    if (!semanticSearchEnabled && state.filters.semanticImageSearch) {
      updateFilters({ semanticImageSearch: false })
    }
  }, [semanticSearchEnabled, state.filters.semanticImageSearch, updateFilters])

  return (
    <div className="gufeng-search-page mobile-page-shell">
      <div className="mobile-page-container search-page">
        <header className="mobile-page-header">
          <div className="mobile-page-titlebar">
            <div className="min-w-0">
              <h1 className="mobile-page-title">搜索</h1>
              <div className="mt-3 flex">
                <div className="h-px w-16 bg-gradient-to-r from-brand-gold/40 to-transparent" />
              </div>
            </div>
            <div className="mobile-action-row">
              <ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
            </div>
          </div>
        </header>

        <SearchBox
          query={state.query}
          suggestions={state.suggestions}
          aiSearching={state.aiSearching}
          semanticImageSearch={state.filters.semanticImageSearch}
          semanticSearchEnabled={semanticSearchEnabled}
          searchHistory={searchHistory}
          onQueryChange={handleQueryChange}
          onSearch={performSearch}
          onImageSearch={handleImageSearch}
          onToggleSemanticSearch={() => {
            if (semanticSearchEnabled) {
              updateFilters({ semanticImageSearch: !state.filters.semanticImageSearch })
            }
          }}
          onDismissSuggestions={dismissSuggestions}
          onRemoveSearchHistoryItem={removeSearchHistoryItem}
          onClearSearchHistory={clearSearchHistory}
        />

        <SearchFilters
          filters={state.filters}
          hotKeywords={state.hotKeywords}
          showFilters={state.showFilters}
          semanticSearchEnabled={semanticSearchEnabled}
          onToggleShowFilters={() => setShowFilters(!state.showFilters)}
          onToggleTag={toggleTag}
          onUpdateFilters={updateFilters}
          onResetFilters={resetFilters}
          onApplyFilters={() => performSearch(state.query)}
          onSearchKeyword={(keyword) => performSearch(keyword)}
        />

        <SearchResults
          state={state}
          viewMode={viewMode}
          tabItems={tabItems}
          onTabChange={setActiveTab}
        />
      </div>
    </div>
  )
}

export default Search
