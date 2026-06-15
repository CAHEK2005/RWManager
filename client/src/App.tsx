import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import Layout from './components/Layout';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import { AxiosInterceptor } from './auth/AxiosInterceptor';
import PublicRoute from './auth/PublicRoute';

const ProfilesPage = lazy(() => import('./pages/ProfilesPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DomainsPage = lazy(() => import('./pages/DomainsPage'));
const NodesPage = lazy(() => import('./pages/NodesPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const ScriptsPage = lazy(() => import('./pages/ScriptsPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const TerminalPopupPage = lazy(() => import('./pages/TerminalPopupPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage'));

function PageFallback() {
  return (
    <Box sx={{ minHeight: 240, display: 'grid', placeItems: 'center' }}>
      <CircularProgress size={24} />
    </Box>
  );
}

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AxiosInterceptor />
          <Suspense fallback={<PageFallback />}>
            <Routes>
              <Route element={<PublicRoute />}>
                <Route path="/login" element={<LoginPage />} />
              </Route>

              <Route path="/" element={
                <RequireAuth>
                  <Layout />
                </RequireAuth>
              }>
                <Route index element={<DashboardPage />} />
                <Route path="dashboard" element={<DashboardPage />} />
                <Route path="profiles" element={<ProfilesPage />} />
                <Route path="nodes" element={<NodesPage />} />
                <Route path="settings" element={<SettingsPage />} />
                <Route path="domains" element={<DomainsPage />} />
                <Route path="scripts" element={<ScriptsPage />} />
                <Route path="history" element={<HistoryPage />} />
              </Route>
              <Route path="/terminal-popup" element={
                new URLSearchParams(window.location.search).get('ticket')
                  ? <TerminalPopupPage />
                  : <NotFoundPage />
              } />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
