import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search as SearchIcon, Camera, Sparkles } from "lucide-react";
import { clsx } from "clsx";
import { useFloatingPresence } from "../../hooks/useFloatingPresence";
import type { SearchSuggestion } from "../../hooks/useSearch";

interface SearchBoxProps {
  query: string;
  suggestions: SearchSuggestion[];
  aiSearching: boolean;
  semanticImageSearch: boolean;
  onQueryChange: (val: string) => void;
  onSearch: (q: string) => void;
  onImageSearch: (file: File) => void;
  onToggleSemanticSearch: () => void;
  onDismissSuggestions: () => void;
}

export const SearchBox: React.FC<SearchBoxProps> = ({
  query,
  suggestions,
  aiSearching,
  semanticImageSearch,
  onQueryChange,
  onSearch,
  onImageSearch,
  onToggleSemanticSearch,
  onDismissSuggestions,
}) => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isComposingRef = useRef(false);

  // 建议列表键盘导航状态
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const suggestionsPresence = useFloatingPresence(suggestions.length > 0);
  const lastSuggestionsRef = useRef<SearchSuggestion[]>([]);

  if (suggestions.length > 0) {
    lastSuggestionsRef.current = suggestions;
  }

  const visibleSuggestions = suggestions.length > 0 ? suggestions : lastSuggestionsRef.current;

  useEffect(() => {
    if (!suggestions.length) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onDismissSuggestions();
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [suggestions.length, onDismissSuggestions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isComposingRef.current) return
    onSearch(query);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    onImageSearch(file);
    e.target.value = "";
  };

  const getSuggestionTypeLabel = (type: SearchSuggestion["type"]) => {
    switch (type) {
      case "keyword": return "搜索";
      case "wiki": return "百科";
      case "music": return "音乐";
      case "album": return "专辑";
      default: return "帖子";
    }
  };

  const getSuggestionTypeClass = (type: SearchSuggestion["type"]) => {
    switch (type) {
      case "keyword": return "bg-surface-alt text-text-secondary";
      case "wiki": return "theme-tag";
      case "music": return "theme-status-error";
      case "album": return "bg-purple-50 text-purple-600";
      default: return "bg-surface-alt text-text-secondary";
    }
  };

  const handleSuggestionClick = (s: SearchSuggestion) => {
    setHighlightedIndex(-1);
    if (s.type === "keyword") {
      onSearch(s.text);
    } else {
      if (s.type === "wiki" && s.id) {
        navigate(`/wiki/${s.id}`);
      } else if (s.type === "post" && s.id) {
        navigate(`/forum/${s.id}`);
      } else if (s.type === "music" && s.id) {
        navigate(`/music/${s.id}`);
      } else if (s.type === "album" && s.id) {
        navigate(`/album/${s.id}`);
      }
    }
  };

  // 建议列表变化时重置高亮索引
  useEffect(() => {
    setHighlightedIndex(-1);
  }, [suggestions]);

  // 建议列表键盘导航处理
  const handleListboxKeyDown = (e: React.KeyboardEvent) => {
    const showSuggestions = suggestions.length > 0;
    if (!showSuggestions) return;

    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      }
      case 'ArrowUp': {
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      }
      case 'Enter': {
        if (e.nativeEvent.isComposing) return
        if (highlightedIndex >= 0 && highlightedIndex < suggestions.length) {
          e.preventDefault();
          handleSuggestionClick(suggestions[highlightedIndex]);
        }
        break;
      }
      case 'Escape': {
        onDismissSuggestions();
        setHighlightedIndex(-1);
        break;
      }
    }
  };

  return (
    <div ref={wrapperRef} className="theme-panel rounded p-6 mb-6">
      <form onSubmit={handleSubmit} className="relative group mb-5" role="search" onKeyDown={handleListboxKeyDown}>
        <input
          type="text"
          value={query}
          onChange={(e) => {
            onQueryChange(e.target.value);
          }}
          onFocus={() => query.length >= 2 && onQueryChange(query)}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder="搜索百科、帖子、图集、音乐或专辑..."
          aria-label="搜索百科、帖子、图集、音乐或专辑"
          autoComplete="off"
          aria-owns="search-suggestions"
          aria-expanded={suggestions.length > 0}
          className="theme-input w-full px-12 py-4 rounded transition-all text-base"
        />
        <SearchIcon
          className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-brand-gold transition-colors"
          size={20}
        />

        {suggestionsPresence.mounted && visibleSuggestions.length > 0 && (
            <div
              className="floating-dropdown absolute left-0 right-0 top-full mt-2 bg-surface border border-border rounded z-50 overflow-hidden"
              data-state={suggestionsPresence.state}
              role="listbox"
              id="search-suggestions"
              aria-hidden={suggestions.length === 0}
            >
              {visibleSuggestions.map((s, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => handleSuggestionClick(s)}
                  className={clsx(
                    "w-full text-left px-4 py-2.5 transition-colors border-b border-border last:border-0",
                    i === highlightedIndex ? "bg-[var(--color-theme-accent)] text-white" : "hover:bg-surface-alt"
                  )}
                  role="option"
                  aria-selected={i === highlightedIndex}
                  id={`suggestion-${i}`}
                >
                  <div className="flex items-center gap-3">
                    <span className={clsx("px-2 py-0.5 rounded text-[10px] font-medium", getSuggestionTypeClass(s.type))}>
                      {getSuggestionTypeLabel(s.type)}
                    </span>
                    <span className="text-sm text-text-primary">{s.text}</span>
                    {s.subtext && (
                      <span className="text-xs text-text-muted">{s.subtext}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
        )}

        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={aiSearching}
            className="p-2.5 bg-surface-alt text-text-muted rounded hover:text-brand-gold transition-all"
            title="AI 图片搜索"
            aria-label="AI 图片搜索"
          >
            {aiSearching ? (
              <Sparkles className="animate-spin" size={18} />
            ) : (
              <Camera size={18} />
            )}
          </button>
          <button
            type="submit"
            className="theme-button-primary px-6 py-2.5 rounded font-medium transition-all"
            aria-label="提交搜索"
          >
            搜索
          </button>
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept="image/*"
          className="hidden"
        />
      </form>

      {/* 混合搜索模式切换 */}
      <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onToggleSemanticSearch}
            className={clsx(
              "relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-brand-gold focus:ring-offset-2",
              semanticImageSearch ? "bg-[var(--color-theme-accent)]" : "bg-border"
            )}
            role="switch"
            aria-checked={semanticImageSearch}
            aria-label="切换智能混合搜索模式"
            id="hybrid-search-toggle"
          >
            <span
              className={clsx(
                "inline-block h-4 w-4 transform rounded-full bg-white transition-transform shadow-sm",
                semanticImageSearch ? "translate-x-6" : "translate-x-1"
              )}
            />
          </button>
          <label
            htmlFor="hybrid-search-toggle"
            className="text-sm text-text-secondary cursor-pointer select-none"
          >
            <span className="font-medium">智能混合搜索</span>
            <span className="ml-1.5 text-xs text-text-muted">(关键词+语义向量融合搜索)</span>
          </label>
        </div>
        <div className="text-xs text-text-muted">
          {semanticImageSearch ? (
            <span className="text-brand-gold font-medium">● 混合模式已开启</span>
          ) : (
            <span>关键词模式</span>
          )}
        </div>
      </div>
    </div>
  );
};
