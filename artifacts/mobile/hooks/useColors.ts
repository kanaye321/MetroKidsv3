import colors from '@/constants/colors';
import { useTheme } from '@/context/ThemeContext';

/**
 * Returns the design tokens for the current color scheme.
 *
 * The returned object contains all color tokens for the active palette
 * plus scheme-independent values like `radius`.
 *
 * The active scheme comes from ThemeContext, which resolves the user's
 * Light/Dark/System choice (persisted via AsyncStorage) against the
 * device's appearance setting when "System" is selected. Falls back to
 * the light palette when no dark key is defined in constants/colors.ts.
 */
export function useColors() {
  const { colorScheme } = useTheme();
  const palette =
    colorScheme === 'dark' && 'dark' in colors
      ? (colors as Record<string, typeof colors.light>).dark
      : colors.light;
  return { ...palette, radius: colors.radius };
}
