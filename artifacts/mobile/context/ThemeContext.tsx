/**
 * ThemeContext — user-selectable Light / Dark / System appearance, persisted locally.
 *
 * `useColors()` (hooks/useColors.ts) reads the resolved scheme from here instead of
 * going straight to react-native's `useColorScheme`, so a manual choice overrides the
 * OS setting everywhere colors are used.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme as useDeviceColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedScheme = 'light' | 'dark';

interface ThemeContextType {
  themeMode: ThemeMode;
  colorScheme: ResolvedScheme;
  setThemeMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = '@rl_theme_mode';

const ThemeContext = createContext<ThemeContextType>({
  themeMode: 'system',
  colorScheme: 'dark',
  setThemeMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useDeviceColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setThemeModeState(stored);
      }
    }).catch(() => {});
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  };

  const colorScheme: ResolvedScheme = useMemo(() => {
    if (themeMode === 'system') return deviceScheme === 'dark' ? 'dark' : 'light';
    return themeMode;
  }, [themeMode, deviceScheme]);

  return (
    <ThemeContext.Provider value={{ themeMode, colorScheme, setThemeMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
