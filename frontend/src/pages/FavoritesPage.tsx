import { Box, Typography } from '@mui/material';
import FavoriteIcon from '@mui/icons-material/Favorite';
import type { Audio } from '../types';

interface FavoritesPageProps {
  setCurrentAudio: (audio: Audio) => void;
}

export default function FavoritesPage({ setCurrentAudio }: FavoritesPageProps) {
  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 2, fontWeight: 600 }}>
        Favorites
      </Typography>

      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 300,
          gap: 1.5,
        }}
      >
        <FavoriteIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
        <Typography variant="subtitle1" color="text.secondary">
          No favorites yet
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Start adding songs to your favorites
        </Typography>
      </Box>
    </Box>
  );
}
