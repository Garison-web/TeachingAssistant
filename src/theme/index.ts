export type ThemeColors = {
  background:    string;
  card:          string;
  cardAlt:       string;
  accent:        string;
  accentLight:   string;
  accentDark:    string;
  text:          string;
  textSecondary: string;
  border:        string;
  success:       string;
  successLight:  string;
  warning:       string;
  warningLight:  string;
  orange:        string;
  orangeLight:   string;
  error:         string;
  errorLight:    string;
  inputBg:       string;
  navy:          string;
  tabBar:        string;
};

export const lightColors: ThemeColors = {
  background:    '#F8F7FF',
  card:          '#FFFFFF',
  cardAlt:       '#F0EEFF',
  accent:        '#7C3AED',
  accentLight:   '#EDE9FE',
  accentDark:    '#5B21B6',
  text:          '#1E1B4B',
  textSecondary: '#6B7280',
  border:        '#E5E7EB',
  success:       '#10B981',
  successLight:  '#D1FAE5',
  warning:       '#F59E0B',
  warningLight:  '#FEF3C7',
  orange:        '#F97316',
  orangeLight:   '#FFEDD5',
  error:         '#EF4444',
  errorLight:    '#FEE2E2',
  inputBg:       '#F9F8FF',
  navy:          '#3730A3',
  tabBar:        '#0F0E1A',
};

export const darkColors: ThemeColors = {
  background:    '#0D0C18',
  card:          '#1C1A2E',
  cardAlt:       '#252240',
  accent:        '#8B5CF6',
  accentLight:   '#2D2550',
  accentDark:    '#7C3AED',
  text:          '#F0EEFF',
  textSecondary: '#9CA3AF',
  border:        '#2D2550',
  success:       '#10B981',
  successLight:  '#064E3B',
  warning:       '#F59E0B',
  warningLight:  '#451A03',
  orange:        '#F97316',
  orangeLight:   '#431407',
  error:         '#EF4444',
  errorLight:    '#450A0A',
  inputBg:       '#1C1A2E',
  navy:          '#6366F1',
  tabBar:        '#080712',
};

// Backward-compat static export (used in StyleSheet.create at module level in legacy code)
export const colors = lightColors;

export const cardShadow = {
  shadowColor:   '#7C3AED',
  shadowOffset:  { width: 0, height: 4 },
  shadowOpacity: 0.10,
  shadowRadius:  16,
  elevation:     5,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const radius = {
  sm:   8,
  md:   14,
  lg:   20,
  xl:   28,
  full: 999,
};

export const typography = {
  title:      { fontSize: 28, fontWeight: '800' as const, color: '#1E1B4B' },
  heading:    { fontSize: 20, fontWeight: '700' as const, color: '#1E1B4B' },
  subheading: { fontSize: 16, fontWeight: '600' as const, color: '#1E1B4B' },
  body:       { fontSize: 15, fontWeight: '400' as const, color: '#1E1B4B' },
  caption:    { fontSize: 13, fontWeight: '400' as const, color: '#6B7280' },
};
