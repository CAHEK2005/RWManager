import type { PaletteMode } from '@mui/material';

export const SIDEBAR_WIDTH = 220;

// Sidebar is always dark regardless of light/dark mode
export const sidebarTokens = {
  bg: '#0f0f0f',
  bgHover: 'rgba(255,255,255,0.05)',
  bgActive: 'rgba(19,149,222,0.12)',
  border: 'rgba(255,255,255,0.06)',
  text: 'rgba(255,255,255,0.45)',
  textActive: '#ffffff',
  textBrand: '#1395de',
};

export const getDesignTokens = (mode: PaletteMode) => ({
  palette: {
    mode,
    primary: {
      main: '#1395de',
      light: '#42a9e8',
      dark: '#0e78b3',
      contrastText: '#ffffff',
    },
    secondary: {
      main: '#8b5cf6',
      contrastText: '#ffffff',
    },
    success: {
      main: '#10b981',
      light: '#34d399',
      dark: '#059669',
    },
    error: {
      main: '#ef4444',
      light: '#f87171',
      dark: '#dc2626',
    },
    warning: {
      main: '#f59e0b',
      light: '#fbbf24',
      dark: '#d97706',
    },
    background: {
      default: mode === 'light' ? '#f4f5f7' : '#111111',
      paper: mode === 'light' ? '#ffffff' : '#1a1a1a',
    },
    text: {
      primary: mode === 'light' ? '#111111' : '#efefef',
      secondary: mode === 'light' ? '#6b7280' : '#888888',
    },
    divider: mode === 'light' ? '#e8e8e8' : '#2a2a2a',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 600, letterSpacing: '-0.01em' },
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: {
      textTransform: 'none' as const,
      fontWeight: 500,
      letterSpacing: '0',
    },
    caption: {
      letterSpacing: '0',
    },
  },
  shape: {
    borderRadius: 10,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarColor: mode === 'dark' ? '#2a2a2a transparent' : '#d1d5db transparent',
          '&::-webkit-scrollbar, & *::-webkit-scrollbar': {
            width: '6px',
            height: '6px',
            backgroundColor: 'transparent',
          },
          '&::-webkit-scrollbar-thumb, & *::-webkit-scrollbar-thumb': {
            borderRadius: 6,
            backgroundColor: mode === 'dark' ? '#2a2a2a' : '#d1d5db',
          },
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: 'none',
          fontWeight: 500,
          fontSize: '0.8125rem',
          '&:hover': { boxShadow: 'none' },
        },
        containedPrimary: {
          background: '#1395de',
          '&:hover': { background: '#0e78b3' },
        },
        outlinedPrimary: {
          borderColor: mode === 'light' ? '#e0e0e0' : '#2a2a2a',
          color: mode === 'light' ? '#333' : '#ccc',
          '&:hover': {
            borderColor: mode === 'light' ? '#bbb' : '#444',
            background: mode === 'light' ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.04)',
          },
        },
        sizeSmall: {
          fontSize: '0.8rem',
          padding: '4px 12px',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
        },
        outlined: {
          border: `1px solid ${mode === 'light' ? '#e8e8e8' : '#2a2a2a'}`,
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          boxShadow: 'none',
          border: `1px solid ${mode === 'light' ? '#e8e8e8' : '#2a2a2a'}`,
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          fontSize: '0.875rem',
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: mode === 'light' ? '#e0e0e0' : '#2a2a2a',
          },
          '&:hover .MuiOutlinedInput-notchedOutline': {
            borderColor: mode === 'light' ? '#aaa' : '#444',
          },
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            color: mode === 'light' ? '#888' : '#666',
            fontSize: '0.7rem',
            fontWeight: 600,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
            borderBottom: `1px solid ${mode === 'light' ? '#e8e8e8' : '#2a2a2a'}`,
            padding: '10px 16px',
          },
        },
      },
    },
    MuiTableBody: {
      styleOverrides: {
        root: {
          '& .MuiTableRow-root:hover': {
            backgroundColor: mode === 'light' ? '#fafafa' : 'rgba(255,255,255,0.02)',
          },
          '& .MuiTableCell-body': {
            borderBottom: `1px solid ${mode === 'light' ? '#f0f0f0' : '#1f1f1f'}`,
            padding: '10px 16px',
            fontSize: '0.8125rem',
          },
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:last-child td': { borderBottom: 0 },
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          fontWeight: 500,
          fontSize: '0.7rem',
          height: 22,
        },
        sizeSmall: {
          height: 20,
          fontSize: '0.7rem',
          fontWeight: 600,
        },
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          borderRadius: 6,
          fontSize: '0.75rem',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          borderRadius: 14,
          boxShadow: mode === 'light'
            ? '0 25px 50px -12px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.04)'
            : '0 25px 50px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.06)',
        },
      },
    },
  },
});
