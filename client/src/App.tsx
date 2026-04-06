import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import ProfilesPage from './pages/ProfilesPage';
import SettingsPage from './pages/SettingsPage';
import DomainsPage from './pages/DomainsPage';
import NodesPage from './pages/NodesPage';
import DashboardPage from './pages/DashboardPage';
import ScriptsPage from './pages/ScriptsPage';
import HistoryPage from './pages/HistoryPage';
import TerminalPopupPage from './pages/TerminalPopupPage';
import LoginPage from './pages/LoginPage';
import { ThemeProvider } from './ThemeContext';
import { AuthProvider } from './auth/AuthContext';
import RequireAuth from './auth/RequireAuth';
import NotFoundPage from './pages/NotFoundPage';
import { AxiosInterceptor } from './auth/AxiosInterceptor';
import PublicRoute from './auth/PublicRoute';

function App() {
  return (
    <AuthProvider>
      <ThemeProvider>
        <BrowserRouter>
          <AxiosInterceptor />
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
        </BrowserRouter>
      </ThemeProvider>
    </AuthProvider>
  );
}

export default App;
