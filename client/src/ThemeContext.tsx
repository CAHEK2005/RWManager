import React, { useState, useMemo, useEffect } from 'react';
import { ThemeProvider as MuiThemeProvider, createTheme, responsiveFontSizes } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';
import useMediaQuery from '@mui/material/useMediaQuery';
import { getDesignTokens } from './theme'; 
import { ThemeContext } from './theme-context';
import type { ColorMode } from './theme-context';

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ColorMode>(() => {
    return (localStorage.getItem('themeMode') as ColorMode) || 'system';
  });

  const prefersDarkMode = useMediaQuery('(prefers-color-scheme: dark)');

  useEffect(() => {
    localStorage.setItem('themeMode', mode);
  }, [mode]);

  const toggleColorMode = () => {
    setMode((prevMode) => {
      if (prevMode === 'light') return 'dark';
      if (prevMode === 'dark') return 'system';
      return 'light';
    });
  };

  const theme = useMemo(() => {
    let activeMode: ColorMode;

    if (mode === 'system') {
      activeMode = prefersDarkMode ? 'dark' : 'light';
    } else {
      activeMode = mode;
    }

    const themeOptions = getDesignTokens(activeMode);

    return responsiveFontSizes(createTheme(themeOptions));
  }, [mode, prefersDarkMode]);

  return (
    <ThemeContext.Provider value={{ mode, toggleColorMode }}>
      <MuiThemeProvider theme={theme}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeContext.Provider>
  );
};
