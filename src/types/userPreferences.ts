export type ViewMode = 'large' | 'medium' | 'small' | 'list';
export type ThemeMode = 'default' | 'dark' | 'system';

export interface UserPreferences {
  viewMode: ViewMode;
  theme: ThemeMode;
  showCharacterCount: boolean;
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  viewMode: 'medium',
  theme: 'system',
  showCharacterCount: false,
};
