import { useState, useEffect } from 'react';
import { Fab, Zoom } from '@mui/material';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { useTranslation } from 'react-i18next';

interface ScrollToTopProps {
  threshold?: number;
}

export default function ScrollToTop({ threshold = 300 }: ScrollToTopProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setVisible(window.scrollY > threshold);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [threshold]);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  return (
    <Zoom in={visible}>
      <Fab
        color="primary"
        size="medium"
        onClick={scrollToTop}
        sx={{
          position: 'fixed',
          bottom: 100, // Above the player
          right: 24,
          zIndex: 1000,
        }}
        aria-label={t('listeningHistory.actions.scrollToTop')}
      >
        <KeyboardArrowUpIcon />
      </Fab>
    </Zoom>
  );
}
