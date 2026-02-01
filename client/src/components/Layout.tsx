import { 
  Toolbar, Drawer, List, ListItem, 
  ListItemButton, ListItemIcon, ListItemText, Box 
} from '@mui/material';
import { People, Settings, Dns, SwapHoriz } from '@mui/icons-material';
import { useNavigate, useLocation, Outlet } from 'react-router-dom';

import Header from './Header';
import Footer from './Footer';

const drawerWidth = 240;

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { text: 'Подписки', icon: <People />, path: '/' },
    { text: 'Домены', icon: <Dns />, path: '/domains' },
    { text: 'Перенаправление', icon: <SwapHoriz />, path: '/tunnels' },
    { text: 'Настройки', icon: <Settings />, path: '/settings' },
  ];

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', width: '100%' }}>
      
      <Header />

      <Drawer
        variant="permanent"
        sx={{
          width: drawerWidth,
          flexShrink: 0,
          [`& .MuiDrawer-paper`]: { width: drawerWidth, boxSizing: 'border-box' },
        }}
      >
        <Toolbar />
        <Box sx={{ overflow: 'auto' }}>
          <List>
            {menuItems.map((item) => (
              <ListItem key={item.text} disablePadding>
                <ListItemButton 
                  selected={location.pathname === item.path}
                  onClick={() => navigate(item.path)}
                >
                  <ListItemIcon>{item.icon}</ListItemIcon>
                  <ListItemText primary={item.text} />
                </ListItemButton>
              </ListItem>
            ))}
          </List>
        </Box>
      </Drawer>

      <Box 
        component="main" 
        sx={{ 
          flexGrow: 1, 
          display: 'flex',
          flexDirection: 'column',
          minHeight: '100vh',
          width: '100%'
        }}
      >
        <Toolbar />
        
        <Box sx={{ flexGrow: 1, p: 3 }}>
          <Outlet />
        </Box>

        <Footer />
      </Box>
    </Box>
  );
}