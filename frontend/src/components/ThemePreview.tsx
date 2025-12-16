import { Box, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

interface ThemePreviewProps {
  name: string;
  mode: 'dark' | 'blue' | 'white' | 'green' | 'lightBlue';
  isSelected: boolean;
  onClick: () => void;
}

const themeColors = {
  dark: {
    primary: '#22d3ee',
    secondary: '#fbbf24',
    bg1: '#0f172a',
    bg2: '#1e293b',
    text: '#f8fafc',
  },
  blue: {
    primary: '#2196F3',
    secondary: '#00BCD4',
    bg1: '#0D1B2A',
    bg2: '#1B263B',
    text: '#E0F7FA',
  },
  white: {
    primary: '#1976D2',
    secondary: '#9C27B0',
    bg1: '#F5F7FA',
    bg2: '#FFFFFF',
    text: '#1A202C',
  },
  green: {
    primary: '#4CAF50',
    secondary: '#00E676',
    bg1: '#0D1F12',
    bg2: '#1A2F23',
    text: '#E8F5E9',
  },
  lightBlue: {
    primary: '#06b6d4',
    secondary: '#0ea5e9',
    bg1: '#ecfeff',
    bg2: '#ffffff',
    text: '#0c4a6e',
  },
};

export default function ThemePreview({ name, mode, isSelected, onClick }: ThemePreviewProps) {
  const colors = themeColors[mode];

  return (
    <Box
      onClick={onClick}
      sx={{
        position: 'relative',
        height: 100,
        borderRadius: 2,
        cursor: 'pointer',
        border: 3,
        borderColor: isSelected ? colors.primary : 'divider',
        transition: 'all 0.3s ease',
        overflow: 'hidden',
        '&:hover': {
          transform: 'scale(1.05)',
          boxShadow: `0 4px 20px ${colors.primary}40`,
        },
      }}
    >
      {/* Background */}
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${colors.bg1} 0%, ${colors.bg2} 100%)`,
        }}
      />

      {/* Content preview */}
      <Box
        sx={{
          position: 'absolute',
          top: 8,
          left: 8,
          right: 8,
          bottom: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        {/* Header bar */}
        <Box
          sx={{
            height: 8,
            borderRadius: 0.5,
            bgcolor: colors.primary,
            width: '60%',
          }}
        />

        {/* Content bars */}
        <Box
          sx={{
            height: 4,
            borderRadius: 0.5,
            bgcolor: colors.text,
            opacity: 0.7,
            width: '80%',
          }}
        />
        <Box
          sx={{
            height: 4,
            borderRadius: 0.5,
            bgcolor: colors.text,
            opacity: 0.5,
            width: '60%',
          }}
        />
        <Box
          sx={{
            height: 4,
            borderRadius: 0.5,
            bgcolor: colors.secondary,
            opacity: 0.7,
            width: '40%',
            mt: 0.5,
          }}
        />
      </Box>

      {/* Theme name */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 4,
          left: 8,
          right: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <Typography
          sx={{
            color: colors.text,
            fontSize: '0.75rem',
            fontWeight: 600,
            textShadow: mode === 'white' ? 'none' : '0 1px 2px rgba(0,0,0,0.5)',
          }}
        >
          {name}
        </Typography>
        {isSelected && (
          <CheckCircleIcon
            sx={{
              fontSize: 16,
              color: colors.primary,
            }}
          />
        )}
      </Box>
    </Box>
  );
}
