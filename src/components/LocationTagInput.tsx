import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapPin, X, Loader2 } from 'lucide-react';
import { MapPickerModal, type PickedLocation } from './MapPickerModal';
import { apiGet, apiPost } from '../lib/apiClient';

interface RegionSuggestion {
  code: string;
  name: string;
  fullName: string;
  level: number;
  levelName: string;
  parentCode: string | null;
}

interface LocationTagInputProps {
  value: string | null;
  locationCode: string | null;
  onChange: (fullName: string, code: string) => void;
  onClear: () => void;
}

export const LocationTagInput = ({
  value,
  locationCode,
  onChange,
  onClear,
}: LocationTagInputProps) => {
  const [open, setOpen] = useState(false);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [inputValue, setInputValue] = useState(value || '');
  const [suggestions, setSuggestions] = useState<RegionSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    setInputValue(value || '');
  }, [value]);

  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 1) { setSuggestions([]); return; }
    setLoading(true);
    try {
      const data = await apiGet<{ regions?: RegionSuggestion[] }>(
        `/api/regions/search?q=${encodeURIComponent(query)}&limit=10`
      );
      setSuggestions(data.regions || []);
    } catch (err) {
      console.error('Failed to fetch suggestions:', err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setShowDropdown(true);
    setSelectedIndex(-1);
    if (debounceRef.current) { window.clearTimeout(debounceRef.current); }
    debounceRef.current = window.setTimeout(() => { fetchSuggestions(newValue); }, 200);
  };

  const handleSelect = (region: RegionSuggestion) => {
    setInputValue(region.fullName);
    onChange(region.fullName, region.code);
    setShowDropdown(false);
    setSuggestions([]);
    setSelectedIndex(-1);
  };

  const handleClear = () => {
    setInputValue('');
    onClear();
    setSuggestions([]);
    setShowDropdown(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex((prev) => prev < suggestions.length - 1 ? prev + 1 : prev);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex((prev) => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) { handleSelect(suggestions[selectedIndex]); }
        break;
      case 'Escape':
        setShowDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  };

  const handleMapConfirm = async (location: PickedLocation) => {
    try {
      const data = await apiPost<{ result?: { adcode: string; province: string; city: string; district: string } }>(
        '/api/regions/resolve',
        { lng: location.lng, lat: location.lat }
      );
      if (data.result) {
        const fullName = `${data.result.province}${data.result.city}${data.result.district}`;
        setInputValue(fullName);
        onChange(fullName, data.result.adcode);
      }
    } catch (err) {
      console.error('Failed to resolve location:', err);
    }
  };

  const handleFocus = () => {
    if (inputValue && suggestions.length > 0) { setShowDropdown(true); }
  };

  const handleBlur = () => {
    setTimeout(() => { setShowDropdown(false); }, 150);
  };

  if (value && !inputValue) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="px-2 py-0.5 bg-[#fdf5d8] text-[#c8951e] rounded text-[10px] font-medium flex items-center gap-1">
          <MapPin size={11} />
          {value}
        </span>
        <button
          onClick={handleClear}
          className="p-0.5 rounded hover:bg-[#f7f5f0] transition-colors"
          type="button"
        >
          <X size={11} className="text-[#9e968e]" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-1">
        <div className="relative flex-1">
          <MapPin size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#9e968e] pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            onBlur={handleBlur}
            placeholder="输入或选择地点..."
            className="w-full pl-8 pr-8 py-1.5 text-sm rounded border border-[#e0dcd3] bg-[#f7f5f0] focus:border-[#c8951e] focus:outline-none text-[#2c2c2c]"
          />
          {loading && (
            <Loader2 size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#9e968e] animate-spin" />
          )}
          {!loading && inputValue && (
            <button
              onClick={handleClear}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-[#f7f5f0]"
              type="button"
            >
              <X size={13} className="text-[#9e968e]" />
            </button>
          )}
        </div>
        <button
          onClick={() => setMapPickerOpen(true)}
          className="p-1.5 border border-[#e0dcd3] rounded hover:border-[#c8951e] hover:text-[#c8951e] transition-all"
          type="button"
          title="在地图上选择"
        >
          <MapPin size={15} className="text-[#9e968e]" />
        </button>
      </div>

      {showDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white rounded border border-[#e0dcd3] z-20 max-h-60 overflow-y-auto"
        >
          {suggestions.map((region, index) => (
            <button
              key={region.code}
              onClick={() => handleSelect(region)}
              className={`w-full px-3 py-2 text-left border-b border-[#e0dcd3] last:border-b-0 transition-colors ${
                index === selectedIndex ? 'bg-[#f7f5f0]' : 'hover:bg-[#f7f5f0]'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <MapPin size={11} className="text-[#c8951e] flex-shrink-0" />
                <span className="text-sm font-medium text-[#2c2c2c]">{region.name}</span>
                <span className="text-[10px] text-[#9e968e] bg-[#f7f5f0] px-1 rounded">
                  {region.levelName}
                </span>
              </div>
              <div className="text-xs text-[#9e968e] mt-0.5 pl-[1.125rem]">
                {region.fullName}
              </div>
            </button>
          ))}
        </div>
      )}

      <MapPickerModal
        open={mapPickerOpen}
        onClose={() => setMapPickerOpen(false)}
        onConfirm={handleMapConfirm}
      />
    </div>
  );
};

export type { RegionSuggestion };
