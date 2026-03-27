import { useState } from 'react';
import {
  AppBar, Toolbar, Typography, IconButton, Tooltip, Box,
  Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions, Button, List, ListItem, ListItemText
} from '@mui/material';
import {
  Brightness7, Brightness4, BrightnessAuto,
  Logout, HelpOutline
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useThemeContext } from '../ThemeContext';
import { useAuth } from '../auth/AuthContext';
import { Menu as MenuIcon } from '@mui/icons-material';

interface HeaderProps {
  onMenuClick?: () => void;
  isMobile?: boolean;
}

export default function Header({ onMenuClick, isMobile }: HeaderProps) {
  const { mode, toggleColorMode } = useThemeContext();
  const { logout } = useAuth();
  const navigate = useNavigate();

  const [helpOpen, setHelpOpen] = useState(false);

  const handleLogout = () => {
    if (confirm('Вы действительно хотите выйти?')) {
      logout();
      navigate('/login');
    }
  };

  const getThemeIcon = () => {
    switch (mode) {
      case 'light': return <Brightness7 />;
      case 'dark': return <Brightness4 />;
      case 'system': return <BrightnessAuto />;
    }
  };

  const getThemeLabel = () => {
    switch (mode) {
      case 'light': return 'Светлая тема';
      case 'dark': return 'Темная тема';
      case 'system': return 'Системная тема';
    }
  };

  return (
    <>
      <AppBar
        position="fixed"
        sx={{ zIndex: (theme) => theme.zIndex.drawer + 1 }}
      >
        <Toolbar>
          {isMobile && (
            <IconButton color="inherit" edge="start" onClick={onMenuClick} sx={{ mr: 1 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant={isMobile ? 'body1' : 'h6'} noWrap component="div" sx={{ flexGrow: 1, fontWeight: 'bold', color: '#1395de' }}>
            RW Profile Manager
          </Typography>

          <Box sx={{ display: 'flex', gap: isMobile ? 0.25 : 1 }}>

            <Tooltip title="Справка о программе">
              <IconButton color="inherit" onClick={() => setHelpOpen(true)}>
                <HelpOutline />
              </IconButton>
            </Tooltip>

            <Tooltip title={`Режим: ${getThemeLabel()}`}>
              <IconButton color="inherit" onClick={toggleColorMode}>
                {getThemeIcon()}
              </IconButton>
            </Tooltip>

            <Tooltip title="Выйти из системы">
              <IconButton color="inherit" onClick={handleLogout}>
                <Logout />
              </IconButton>
            </Tooltip>

          </Box>
        </Toolbar>
      </AppBar>

      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>О программе RW Profile Manager</DialogTitle>
        <DialogContent dividers>
          <DialogContentText paragraph>
            Инструмент для автоматического обновления config-profile в панели Remnawave случайными инбаундами по расписанию.
          </DialogContentText>

          <Typography variant="subtitle1" gutterBottom sx={{ fontWeight: 'bold' }}>
            Основные возможности:
          </Typography>

          <List dense>
            <ListItem>
              <ListItemText
                primary="Автоматическая ротация"
                secondary="Обновляет инбаунды в выбранном config-profile Remnawave с заданным интервалом."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Гибкая конфигурация"
                secondary="Поддержка VLESS Reality, VMess, Shadowsocks, Trojan — любая комбинация типов."
              />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Белый список доменов"
                secondary="SNI-домены для Reality инбаундов выбираются случайно из вашего списка."
              />
            </ListItem>
          </List>

          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            RW Profile Manager
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHelpOpen(false)}>Понятно</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}