import React, { useState } from 'react';
import { Box, Paper, TextField, Button, Typography, Alert } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const [creds, setCreds] = useState({ login: '', password: '' });
  const [error, setError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await api.post('/auth/login', creds);
      login(res.data.access_token);
      navigate('/');
    } catch {
      setError('Неверный логин или пароль');
    }
  };

  return (
    <Box sx={{
      height: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      bgcolor: 'background.default',
    }}>
      <Paper variant="outlined" sx={{ p: 4, width: '100%', maxWidth: 380 }}>
        {/* Brand */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 3 }}>
          <Box sx={{
            width: 32, height: 32, borderRadius: '8px',
            bgcolor: '#1395de',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Typography sx={{ color: '#fff', fontWeight: 800, fontSize: '0.8rem', lineHeight: 1 }}>RW</Typography>
          </Box>
          <Typography sx={{ fontWeight: 600, fontSize: '1rem' }}>RWManager</Typography>
        </Box>

        <Typography variant="h6" sx={{ fontWeight: 600, mb: 0.5 }}>Вход в систему</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Введите учётные данные администратора
        </Typography>

        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        <form onSubmit={handleSubmit}>
          <TextField
            fullWidth size="small" label="Логин"
            autoComplete="username"
            value={creds.login}
            onChange={(e) => { setCreds({ ...creds, login: e.target.value }); setError(''); }}
            sx={{ mb: 2 }}
          />
          <TextField
            fullWidth size="small" label="Пароль" type="password"
            autoComplete="current-password"
            value={creds.password}
            onChange={(e) => { setCreds({ ...creds, password: e.target.value }); setError(''); }}
            sx={{ mb: 3 }}
          />
          <Button fullWidth variant="contained" type="submit">
            Войти
          </Button>
        </form>
      </Paper>
    </Box>
  );
}
