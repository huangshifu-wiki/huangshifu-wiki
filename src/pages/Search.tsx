import React from "react";
import { ViewModeSelector } from "../components/ViewModeSelector";
import { useUserPreferences } from "../context/UserPreferencesContext";
import { useSearchPage } from "../hooks/useSearchPage";
import { SearchBox } from "../components/search/SearchBox";
import { SearchFilters } from "../components/search/SearchFilters";
import { SearchResults } from "../components/search/SearchResults";

const Search: React.FC = () => {
  const { preferences, setViewMode } = useUserPreferences();
  const viewMode = preferences.viewMode;

  const {
    state,
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
  } = useSearchPage();

  return (
    <div
      className="min-h-[calc(100vh-60px)]"
      style={{
        backgroundColor: "#f7f5f0",
        fontFamily: "'Noto Serif SC', 'Source Han Serif SC', 'SimSun', 'STSong', 'FangSong', serif",
        lineHeight: 1.8,
      }}
    >
      <div className="max-w-[1100px] mx-auto px-6 py-8 pb-32 search-page">
        {/* Header */}
        <header className="mb-7">
          <div className="flex items-end justify-between flex-wrap gap-3">
            <h1 className="text-[1.75rem] font-bold text-[#2c2c2c] tracking-[0.12em]">搜索</h1>
            <div className="flex items-center gap-3">
              <ViewModeSelector value={viewMode} onChange={setViewMode} size="sm" />
            </div>
          </div>
        </header>

        {/* Search Box */}
        <SearchBox
          query={state.query}
          suggestions={state.suggestions}
          aiSearching={state.aiSearching}
          semanticImageSearch={state.filters.semanticImageSearch}
          onQueryChange={handleQueryChange}
          onSearch={performSearch}
          onImageSearch={handleImageSearch}
          onToggleSemanticSearch={() => updateFilters({ semanticImageSearch: !state.filters.semanticImageSearch })}
          onDismissSuggestions={dismissSuggestions}
        />

        {/* Search Filters */}
        <SearchFilters
          filters={state.filters}
          hotKeywords={state.hotKeywords}
          showFilters={state.showFilters}
          onToggleShowFilters={() => setShowFilters(!state.showFilters)}
          onToggleTag={toggleTag}
          onUpdateFilters={updateFilters}
          onResetFilters={resetFilters}
          onApplyFilters={() => performSearch(state.query)}
          onSearchKeyword={(keyword) => performSearch(keyword)}
        />

        {/* Search Results */}
        <SearchResults
          state={state}
          viewMode={viewMode}
          tabItems={tabItems}
          onTabChange={setActiveTab}
        />
      </div>
    </div>
  );
};

export default Search;
