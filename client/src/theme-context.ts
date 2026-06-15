import { createContext } from 'react';

export type ColorMode = 'light' | 'dark' | 'system';

export interface ThemeContextType {
  mode: ColorMode;
  toggleColorMode: () => void;
}

export const ThemeContext = createContext<ThemeContextType>({} as ThemeContextType);
