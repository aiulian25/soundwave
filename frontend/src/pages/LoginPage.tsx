import { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Checkbox,
  FormControlLabel,
  Typography,
  InputAdornment,
  IconButton,
} from '@mui/material';
import PersonOutlineIcon from '@mui/icons-material/PersonOutline';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import { userAPI } from '../api/client';

interface LoginPageProps {
  onLoginSuccess: () => void;
}

export default function LoginPage({ onLoginSuccess }: LoginPageProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [error, setError] = useState('');
  const [requires2FA, setRequires2FA] = useState(false);
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const handleLogin = async () => {
    try {
      const response = await userAPI.login({ 
        username, 
        password,
        ...(requires2FA && { two_factor_code: twoFactorCode })
      });
      
      if (response.data.requires_2fa) {
        setRequires2FA(true);
        setError('Please enter your two-factor authentication code');
        return;
      }
      
      localStorage.setItem('token', response.data.token);
      onLoginSuccess();
    } catch (err: any) {
      if (err.response?.data?.requires_2fa) {
        setRequires2FA(true);
        setError('Please enter your two-factor authentication code');
      } else {
        setError('Invalid credentials or verification code');
      }
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        width: '100vw',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
        position: 'relative',
        overflow: 'auto',
      }}
    >
      {/* Logo Section - Top Half */}
      <Box
        sx={{
          flex: { xs: 0.6, sm: 1 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: { xs: 3, sm: 4 },
          paddingTop: { xs: 6, sm: 8 },
        }}
      >
        {/* Animated Logo */}
        <Box
          component="img"
          src="/img/logo.png"
          alt="SoundWave Logo"
          sx={{
            width: { xs: 180, sm: 220 },
            height: { xs: 180, sm: 220 },
            borderRadius: '50%',
            mb: 3,
            boxShadow: '0 20px 60px rgba(34, 211, 238, 0.3)',
            border: '4px solid rgba(34, 211, 238, 0.2)',
            position: 'relative',
            animation: 'pulse 2s ease-in-out infinite',
            '@keyframes pulse': {
              '0%, 100%': {
                transform: 'scale(1)',
                boxShadow: '0 20px 60px rgba(34, 211, 238, 0.3)',
              },
              '50%': {
                transform: 'scale(1.05)',
                boxShadow: '0 25px 70px rgba(34, 211, 238, 0.5)',
              },
            },
          }}
        />

        {/* App Name */}
        <Typography
          sx={{
            fontSize: { xs: '2.5rem', sm: '3.5rem' },
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#22d3ee',
            textAlign: 'center',
            textShadow: '0 4px 20px rgba(34, 211, 238, 0.4)',
            mb: 1,
          }}
        >
          SoundWave
        </Typography>
        <Typography
          sx={{
            fontSize: { xs: '0.9rem', sm: '1rem' },
            color: '#94a3b8',
            textAlign: 'center',
            fontWeight: 500,
          }}
        >
          Your Personal Music Hub
        </Typography>
      </Box>

      {/* Login Form Section - Bottom Half */}
      <Box
        sx={{
          flex: { xs: 1, sm: 1.2 },
          backgroundColor: 'rgba(30, 41, 59, 0.8)',
          backdropFilter: 'blur(20px)',
          borderTopLeftRadius: { xs: 32, sm: 40 },
          borderTopRightRadius: { xs: 32, sm: 40 },
          padding: { xs: 3, sm: 4 },
          paddingTop: { xs: 4, sm: 5 },
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          border: '1px solid rgba(34, 211, 238, 0.1)',
          borderBottom: 'none',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: { xs: '100%', sm: 420 },
            padding: { xs: 0, sm: 2 },
          }}
        >
          <Typography
            variant="h4"
            sx={{
              color: '#f8fafc',
              fontWeight: 700,
              marginBottom: { xs: 3, sm: 4 },
              fontSize: { xs: '1.5rem', sm: '1.75rem' },
              textAlign: 'center',
            }}
          >
            Welcome Back
          </Typography>

          {/* Username Field */}
          <TextField
            fullWidth
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyPress={handleKeyPress}
            autoFocus
            sx={{
              marginBottom: 2,
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 3,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                '& fieldset': {
                  borderColor: 'rgba(34, 211, 238, 0.2)',
                  borderWidth: 2,
                },
                '&:hover fieldset': {
                  borderColor: 'rgba(34, 211, 238, 0.4)',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#22d3ee',
                  borderWidth: 2,
                },
              },
              '& .MuiOutlinedInput-input': {
                padding: { xs: '14px 16px', sm: '16px 18px' },
                fontSize: '0.95rem',
                color: '#f8fafc',
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <PersonOutlineIcon sx={{ color: '#94a3b8', fontSize: 22 }} />
                </InputAdornment>
              ),
            }}
          />

          {/* Password Field */}
          <TextField
            fullWidth
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyPress={handleKeyPress}
            sx={{
              marginBottom: 1.5,
              '& .MuiOutlinedInput-root': {
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                borderRadius: 3,
                boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                '& fieldset': {
                  borderColor: 'rgba(34, 211, 238, 0.2)',
                  borderWidth: 2,
                },
                '&:hover fieldset': {
                  borderColor: 'rgba(34, 211, 238, 0.4)',
                },
                '&.Mui-focused fieldset': {
                  borderColor: '#22d3ee',
                  borderWidth: 2,
                },
              },
              '& .MuiOutlinedInput-input': {
                padding: { xs: '14px 16px', sm: '16px 18px' },
                fontSize: '0.95rem',
                color: '#f8fafc',
              },
            }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <LockOutlinedIcon sx={{ color: '#94a3b8', fontSize: 22 }} />
                </InputAdornment>
              ),
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    onClick={() => setShowPassword(!showPassword)}
                    edge="end"
                    sx={{
                      backgroundColor: 'rgba(34, 211, 238, 0.2)',
                      borderRadius: '50%',
                      width: 36,
                      height: 36,
                      '&:hover': {
                        backgroundColor: 'rgba(34, 211, 238, 0.3)',
                      },
                    }}
                  >
                    {showPassword ? (
                      <VisibilityOffOutlinedIcon sx={{ color: '#22d3ee', fontSize: 18 }} />
                    ) : (
                      <VisibilityOutlinedIcon sx={{ color: '#22d3ee', fontSize: 18 }} />
                    )}
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />

          {/* Two-Factor Code Field - shown only when 2FA is required */}
          {requires2FA && (
            <TextField
              fullWidth
              placeholder="Two-Factor Code"
              value={twoFactorCode}
              onChange={(e) => setTwoFactorCode(e.target.value)}
              onKeyPress={handleKeyPress}
              autoFocus
              inputProps={{ maxLength: 6 }}
              sx={{
                marginBottom: 1.5,
                '& .MuiOutlinedInput-root': {
                  backgroundColor: 'rgba(15, 23, 42, 0.6)',
                  borderRadius: 3,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
                  '& fieldset': {
                    borderColor: 'rgba(34, 211, 238, 0.2)',
                    borderWidth: 2,
                  },
                  '&:hover fieldset': {
                    borderColor: 'rgba(34, 211, 238, 0.4)',
                  },
                  '&.Mui-focused fieldset': {
                    borderColor: '#22d3ee',
                    borderWidth: 2,
                  },
                },
                '& .MuiOutlinedInput-input': {
                  padding: '14px 16px',
                  fontSize: '0.95rem',
                  color: '#f8fafc',
                  textAlign: 'center',
                  letterSpacing: '0.5em',
                },
              }}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <LockOutlinedIcon sx={{ color: '#94a3b8', fontSize: 22 }} />
                  </InputAdornment>
                ),
              }}
            />
          )}

          {/* Remember Password Checkbox */}
          <FormControlLabel
            control={
              <Checkbox
                checked={rememberPassword}
                onChange={(e) => setRememberPassword(e.target.checked)}
                sx={{
                  color: '#475569',
                  '&.Mui-checked': {
                    color: '#22d3ee',
                  },
                }}
              />
            }
            label={
              <Typography sx={{ color: '#94a3b8', fontSize: '0.9rem' }}>
                Remember Password
              </Typography>
            }
            sx={{ marginBottom: { xs: 2.5, sm: 3 } }}
          />

          {/* Login Button */}
          <Button
            fullWidth
            variant="contained"
            onClick={handleLogin}
            sx={{
              background: 'linear-gradient(135deg, #22d3ee 0%, #06b6d4 100%)',
              color: '#0f172a',
              padding: { xs: '14px', sm: '16px' },
              borderRadius: 3,
              fontSize: '0.95rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              boxShadow: '0 4px 20px rgba(34, 211, 238, 0.4)',
              border: '1px solid rgba(34, 211, 238, 0.3)',
              '&:hover': {
                background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                boxShadow: '0 6px 30px rgba(34, 211, 238, 0.6)',
                transform: 'translateY(-2px)',
              },
              transition: 'all 0.3s ease',
            }}
            endIcon={<ArrowForwardIcon />}
          >
            Login
          </Button>

          {error && (
            <Typography
              sx={{
                color: '#ef4444',
                fontSize: '0.875rem',
                marginTop: 2,
                textAlign: 'center',
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                padding: '8px 12px',
                borderRadius: 2,
                border: '1px solid rgba(239, 68, 68, 0.2)',
              }}
            >
              {error}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
  );
}
