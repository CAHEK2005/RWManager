import { useState } from 'react';
import {
  Box, Drawer, IconButton, Stack, Tooltip, Typography,
  useMediaQuery, useTheme, AppBar, Toolbar,
} from '@mui/material';
import {
  Layers, Dns, Settings, Storage, Dashboard, Terminal,
  Brightness7, Brightness4, BrightnessAuto, Logout, Menu as MenuIcon,
  HelpOutline,
} from '@mui/icons-material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useThemeContext } from '../ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { SIDEBAR_WIDTH, sidebarTokens as s } from '../theme';
import HelpDialog from './HelpDialog';

const menuItems = [
  { text: 'Главная',    icon: <Dashboard sx={{ fontSize: 17 }} />,  path: '/dashboard' },
  { text: 'Профили',    icon: <Layers sx={{ fontSize: 17 }} />,     path: '/profiles' },
  { text: 'Ноды',       icon: <Storage sx={{ fontSize: 17 }} />,    path: '/nodes' },
  { text: 'Домены',     icon: <Dns sx={{ fontSize: 17 }} />,        path: '/domains' },
  { text: 'Скрипты',    icon: <Terminal sx={{ fontSize: 17 }} />,   path: '/scripts' },
  { text: 'Настройки',  icon: <Settings sx={{ fontSize: 17 }} />,   path: '/settings' },
];

function NavItem({ icon, text, active, onClick }: { icon: React.ReactNode; text: string; active: boolean; onClick: () => void }) {
  return (
    <Box
      onClick={onClick}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        px: 1.5,
        py: '7px',
        mx: 1,
        borderRadius: '7px',
        cursor: 'pointer',
        color: active ? s.textActive : s.text,
        bgcolor: active ? s.bgActive : 'transparent',
        transition: 'background 0.12s, color 0.12s',
        userSelect: 'none',
        '&:hover': {
          bgcolor: active ? s.bgActive : s.bgHover,
          color: active ? s.textActive : 'rgba(255,255,255,0.7)',
        },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', color: active ? s.textBrand : 'inherit' }}>
        {icon}
      </Box>
      <Typography sx={{ fontSize: '0.8375rem', fontWeight: active ? 500 : 400, lineHeight: 1 }}>
        {text}
      </Typography>
    </Box>
  );
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const { mode, toggleColorMode } = useThemeContext();
  const { logout } = useAuth();

  const isActive = (path: string) =>
    path === '/dashboard'
      ? location.pathname === '/' || location.pathname === '/dashboard'
      : location.pathname === path;

  const handleNav = (path: string) => {
    navigate(path);
    if (isMobile) setMobileOpen(false);
  };

  const handleLogout = () => {
    if (confirm('Выйти из системы?')) { logout(); navigate('/login'); }
  };

  const getThemeIcon = () => {
    switch (mode) {
      case 'light': return <Brightness7 sx={{ fontSize: 16 }} />;
      case 'dark': return <Brightness4 sx={{ fontSize: 16 }} />;
      default: return <BrightnessAuto sx={{ fontSize: 16 }} />;
    }
  };

  const sidebarContent = (
    <Box sx={{
      width: SIDEBAR_WIDTH,
      height: '100vh',
      bgcolor: s.bg,
      display: 'flex',
      flexDirection: 'column',
      borderRight: `1px solid ${s.border}`,
      position: 'fixed',
      top: 0,
      left: 0,
    }}>
      {/* Brand */}
      <Box sx={{ px: 2.5, py: 2, display: 'flex', alignItems: 'center', gap: 1.5, height: 56 }}>
        <Box sx={{
          width: 28, height: 28, borderRadius: '8px',
          bgcolor: s.textBrand, display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
        }}>
          <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: '0.8rem', lineHeight: 1 }}>RW</Typography>
        </Box>
        <Typography sx={{ color: s.textActive, fontWeight: 600, fontSize: '0.9rem', letterSpacing: '-0.01em' }}>
          RWManager
        </Typography>
      </Box>

      <Box sx={{ mx: 1, my: 0.5, height: '1px', bgcolor: s.border }} />

      {/* Navigation */}
      <Box sx={{ flex: 1, overflowY: 'auto', py: 1 }}>
        <Stack spacing={0.25}>
          {menuItems.map(item => (
            <NavItem
              key={item.path}
              icon={item.icon}
              text={item.text}
              active={isActive(item.path)}
              onClick={() => handleNav(item.path)}
            />
          ))}
        </Stack>
      </Box>

      <Box sx={{ mx: 1, my: 0.5, height: '1px', bgcolor: s.border }} />

      {/* Bottom actions */}
      <Box sx={{ px: 1.5, py: 1.5, display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title="Справка" placement="top">
          <IconButton size="small" onClick={() => setHelpOpen(true)} sx={{ color: s.text, '&:hover': { color: s.textActive, bgcolor: s.bgHover } }}>
            <HelpOutline sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Переключить тему" placement="top">
          <IconButton size="small" onClick={toggleColorMode} sx={{ color: s.text, '&:hover': { color: s.textActive, bgcolor: s.bgHover } }}>
            {getThemeIcon()}
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Выйти" placement="top">
          <IconButton size="small" onClick={handleLogout} sx={{ color: s.text, '&:hover': { color: '#ef4444', bgcolor: 'rgba(239,68,68,0.08)' } }}>
            <Logout sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      {/* Desktop sidebar */}
      {!isMobile && (
        <Box sx={{ width: SIDEBAR_WIDTH, flexShrink: 0 }}>
          {sidebarContent}
        </Box>
      )}

      {/* Mobile: AppBar + Drawer */}
      {isMobile && (
        <>
          <AppBar position="fixed" elevation={0} sx={{
            bgcolor: s.bg,
            borderBottom: `1px solid ${s.border}`,
            zIndex: theme.zIndex.drawer + 1,
          }}>
            <Toolbar sx={{ minHeight: '48px !important', px: 2 }}>
              <IconButton edge="start" onClick={() => setMobileOpen(true)} sx={{ color: s.textActive, mr: 1 }}>
                <MenuIcon sx={{ fontSize: 20 }} />
              </IconButton>
              <Typography sx={{ color: s.textActive, fontWeight: 600, fontSize: '0.9rem', flex: 1 }}>
                RWManager
              </Typography>
              <IconButton size="small" onClick={toggleColorMode} sx={{ color: s.text }}>
                {getThemeIcon()}
              </IconButton>
              <IconButton size="small" onClick={handleLogout} sx={{ color: s.text }}>
                <Logout sx={{ fontSize: 16 }} />
              </IconButton>
            </Toolbar>
          </AppBar>

          <Drawer
            variant="temporary"
            open={mobileOpen}
            onClose={() => setMobileOpen(false)}
            ModalProps={{ keepMounted: true }}
            PaperProps={{ sx: { bgcolor: 'transparent', boxShadow: 'none', border: 'none' } }}
          >
            {sidebarContent}
          </Drawer>
        </>
      )}

      {/* Main content */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minHeight: '100vh',
          overflowX: 'hidden',
          pt: isMobile ? '48px' : 0,
          bgcolor: 'background.default',
        }}
      >
        <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 1400, mx: 'auto' }}>
          <Outlet />
        </Box>
      </Box>

      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
    </Box>
  );
}
