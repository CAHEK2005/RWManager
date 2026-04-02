import {
  Toolbar, Drawer, List, ListItem,
  ListItemButton, ListItemIcon, ListItemText, Box, useMediaQuery, useTheme
} from '@mui/material';
import { Layers, Dns, Settings, Storage, Dashboard } from '@mui/icons-material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useState } from 'react';

import Header from './Header';

const drawerWidth = 240;

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const menuItems = [
    { text: 'Главная',   icon: <Dashboard />, path: '/dashboard' },
    { text: 'Профили',   icon: <Layers />,    path: '/profiles' },
    { text: 'Ноды',      icon: <Storage />,   path: '/nodes' },
    { text: 'Домены',    icon: <Dns />,       path: '/domains' },
    { text: 'Настройки', icon: <Settings />,  path: '/settings' },
  ];

  const isActive = (path: string) => {
    if (path === '/dashboard') return location.pathname === '/' || location.pathname === '/dashboard';
    return location.pathname === path;
  };

  const drawerContent = (
    <Box sx={{ overflow: 'auto' }}>
      <Toolbar />
      <List>
        {menuItems.map((item) => (
          <ListItem key={item.text} disablePadding>
            <ListItemButton
              selected={isActive(item.path)}
              onClick={() => {
                navigate(item.path);
                if (isMobile) setMobileOpen(false);
              }}
            >
              <ListItemIcon>{item.icon}</ListItemIcon>
              <ListItemText primary={item.text} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      <Header onMenuClick={handleDrawerToggle} isMobile={isMobile} />

      <Drawer
        variant={isMobile ? "temporary" : "permanent"}
        open={isMobile ? mobileOpen : true}
        onClose={handleDrawerToggle}
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        {drawerContent}
      </Drawer>

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          width: '100%',
          overflowX: 'hidden'
        }}
      >
        <Toolbar />
        <Box sx={{ flexGrow: 1, p: { xs: 2, md: 3 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
