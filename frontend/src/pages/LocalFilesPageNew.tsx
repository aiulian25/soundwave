import { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton,
  LinearProgress,
  Alert,
  Snackbar,
  Tooltip,
} from '@mui/material';
import {
  FolderOpen as FolderIcon,
  PlayArrow as PlayIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Add as AddIcon,
} from '@mui/icons-material';
import { localAudioDB, type LocalAudioFile } from '../utils/localAudioDB';
import { extractMetadata, getAudioDuration } from '../utils/id3Reader';
import type { Audio } from '../types';

interface LocalFilesPageProps {
  setCurrentAudio: (audio: Audio, queue?: Audio[]) => void;
}

export default function LocalFilesPage({ setCurrentAudio }: LocalFilesPageProps) {
  const [audioFiles, setAudioFiles] = useState<LocalAudioFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState<{ message: string; severity: 'success' | 'error' | 'info' } | null>(null);

  useEffect(() => {
    loadFiles();
  }, []);

  const loadFiles = async () => {
    try {
      const files = await localAudioDB.getAll();
      setAudioFiles(files);
    } catch (error) {
      console.error('Error loading files:', error);
    }
  };

  const processFiles = async (files: File[]) => {
    const processedFiles: LocalAudioFile[] = [];

    for (const file of files) {
      try {
        const metadata = await extractMetadata(file);
        const duration = await getAudioDuration(file);

        const localFile: LocalAudioFile = {
          id: `${Date.now()}-${Math.random()}`,
          title: metadata.title || file.name,
          artist: metadata.artist || 'Unknown Artist',
          album: metadata.album || '',
          year: metadata.year || null,
          genre: metadata.genre || '',
          duration,
          file,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          coverArt: metadata.coverArt,
          addedDate: new Date(),
          playCount: 0,
        };

        processedFiles.push(localFile);
      } catch (error) {
        console.error(`Error processing ${file.name}:`, error);
      }
    }

    return processedFiles;
  };

  const handleSelectFiles = async () => {
    try {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'audio/*';

      input.onchange = async (e: Event) => {
        const target = e.target as HTMLInputElement;
        const files = Array.from(target.files || []);
        
        if (files.length === 0) return;

        setLoading(true);
        setAlert({ message: `Processing ${files.length} files...`, severity: 'info' });

        const processedFiles = await processFiles(files);

        await localAudioDB.addFiles(processedFiles);
        await loadFiles();
        
        setLoading(false);
        setAlert({ message: `Added ${processedFiles.length} files successfully!`, severity: 'success' });
      };

      input.click();
    } catch (error) {
      console.error('Error selecting files:', error);
      setAlert({ message: 'Failed to select files', severity: 'error' });
      setLoading(false);
    }
  };

  const handleSelectFolder = async () => {
    try {
      // Check if File System Access API is supported
      if (!('showDirectoryPicker' in window)) {
        setAlert({ 
          message: 'Folder selection not supported in this browser. Use Chrome, Edge, or Opera.', 
          severity: 'error' 
        });
        return;
      }
      
      // Check if we're on HTTPS or localhost
      const isSecureContext = window.isSecureContext;
      if (!isSecureContext) {
        setAlert({ 
          message: 'Folder selection requires HTTPS or localhost. For local network access, use "Select Files" instead or access via https://sound.iulian.uk', 
          severity: 'info' 
        });
        return;
      }

      const dirHandle = await (window as any).showDirectoryPicker({
        mode: 'read',
      });

      setLoading(true);
      setAlert({ message: 'Scanning folder and subfolders...', severity: 'info' });

      const audioFiles: File[] = [];
      const audioExtensions = ['.mp3', '.m4a', '.flac', '.wav', '.ogg', '.opus', '.aac', '.wma'];

      // Recursive function to scan directory
      async function scanDirectory(dirHandle: any, path = '') {
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            const file = await entry.getFile();
            const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
            
            if (audioExtensions.includes(ext)) {
              audioFiles.push(file);
            }
          } else if (entry.kind === 'directory') {
            // Recursively scan subdirectory
            await scanDirectory(entry, `${path}/${entry.name}`);
          }
        }
      }

      await scanDirectory(dirHandle);

      if (audioFiles.length === 0) {
        setLoading(false);
        setAlert({ message: 'No audio files found in the selected folder', severity: 'info' });
        return;
      }

      setAlert({ message: `Processing ${audioFiles.length} audio files...`, severity: 'info' });

      const processedFiles = await processFiles(audioFiles);

      await localAudioDB.addFiles(processedFiles);
      await loadFiles();
      
      setLoading(false);
      setAlert({ 
        message: `Successfully added ${processedFiles.length} files from folder!`, 
        severity: 'success' 
      });
    } catch (error: any) {
      console.error('Error selecting folder:', error);
      if (error.name === 'AbortError') {
        setAlert({ message: 'Folder selection cancelled', severity: 'info' });
      } else {
        setAlert({ message: 'Failed to read folder', severity: 'error' });
      }
      setLoading(false);
    }
  };

  const handlePlay = async (localFile: LocalAudioFile) => {
    try {
      // Update play count
      await localAudioDB.updatePlayCount(localFile.id);

      // Create object URL for the file
      const audioURL = localFile.file ? URL.createObjectURL(localFile.file) : '';

      // Convert to Audio format expected by player
      const audio: Audio = {
        id: parseInt(localFile.id.split('-')[0]) || Date.now(),
        youtube_id: undefined,  // Local files don't have YouTube ID
        title: localFile.title,
        channel_name: localFile.artist,
        channel_id: '',
        description: `${localFile.album}${localFile.year ? ` (${localFile.year})` : ''}`,
        thumbnail_url: localFile.coverArt || '/placeholder.jpg',
        duration: localFile.duration,
        file_size: localFile.fileSize,
        file_path: audioURL,
        media_url: audioURL,  // THIS is what Player uses for local files
        play_count: localFile.playCount,
        published_date: localFile.addedDate.toISOString(),
        downloaded_date: localFile.addedDate.toISOString(),
        view_count: 0,
        like_count: 0,
        audio_format: localFile.mimeType.split('/')[1] || 'mp3',
        artist: localFile.artist,
        album: localFile.album,
        cover_art_url: localFile.coverArt,
      };

      // Convert all audio files to queue format
      const queue: Audio[] = audioFiles.map(file => {
        const fileURL = file.file ? URL.createObjectURL(file.file) : '';
        return {
          id: parseInt(file.id.split('-')[0]) || Date.now(),
          youtube_id: undefined,
          title: file.title,
          channel_name: file.artist,
          channel_id: '',
          description: `${file.album}${file.year ? ` (${file.year})` : ''}`,
          thumbnail_url: file.coverArt || '/placeholder.jpg',
          duration: file.duration,
          file_size: file.fileSize,
          file_path: fileURL,
          media_url: fileURL,
          play_count: file.playCount,
          published_date: file.addedDate.toISOString(),
          downloaded_date: file.addedDate.toISOString(),
          view_count: 0,
          like_count: 0,
          audio_format: file.mimeType.split('/')[1] || 'mp3',
          artist: file.artist,
          album: file.album,
          cover_art_url: file.coverArt,
        };
      });

      setCurrentAudio(audio, queue);
    } catch (error) {
      console.error('Error playing file:', error);
      setAlert({ message: 'Failed to play file', severity: 'error' });
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Remove this file from your library?')) return;
    
    try {
      await localAudioDB.delete(id);
      await loadFiles();
      setAlert({ message: 'File removed', severity: 'success' });
    } catch (error) {
      console.error('Error deleting file:', error);
      setAlert({ message: 'Failed to remove file', severity: 'error' });
    }
  };

  const handleClearAll = async () => {
    if (!confirm('Remove ALL files from your library? This cannot be undone.')) return;

    try {
      await localAudioDB.clear();
      await loadFiles();
      setAlert({ message: 'All files removed', severity: 'success' });
    } catch (error) {
      console.error('Error clearing library:', error);
      setAlert({ message: 'Failed to clear library', severity: 'error' });
    }
  };

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, px: 0.5, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700, letterSpacing: '-0.02em' }}>
          My Local Files
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<RefreshIcon />}
            onClick={loadFiles}
            sx={{ 
              borderRadius: 1, 
              textTransform: 'none',
              minWidth: 'auto',
              px: 1.5,
              py: 0.5,
              fontSize: '0.813rem'
            }}
          >
            Refresh
          </Button>
          {audioFiles.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              color="error"
              onClick={handleClearAll}
              sx={{ 
                borderRadius: 1, 
                textTransform: 'none',
                minWidth: 'auto',
                px: 1.5,
                py: 0.5,
                fontSize: '0.813rem'
              }}
            >
              Clear All
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={<AddIcon />}
            onClick={handleSelectFiles}
            disabled={loading}
            sx={{ 
              borderRadius: 1, 
              textTransform: 'none', 
              fontWeight: 600,
              minWidth: 'auto',
              px: 2,
              py: 0.5,
              fontSize: '0.813rem'
            }}
          >
            Select Files
          </Button>
          <Tooltip 
            title={!window.isSecureContext 
              ? 'Folder selection requires HTTPS or localhost. Currently viewing over HTTP. Use "Select Files" instead, or access via https://sound.iulian.uk' 
              : 'Select a folder to scan recursively including all subfolders'
            }
            arrow
          >
            <span>
              <Button
                variant="contained"
                size="small"
                startIcon={<FolderIcon />}
                onClick={handleSelectFolder}
                disabled={loading || !window.isSecureContext}
                color="secondary"
                sx={{ 
                  borderRadius: 1, 
                  textTransform: 'none', 
                  fontWeight: 600,
                  minWidth: 'auto',
                  px: 2,
                  py: 0.5,
                  fontSize: '0.813rem'
                }}
              >
                Select Folder {!window.isSecureContext && '🔒'}
              </Button>
            </span>
          </Tooltip>
        </Box>
      </Box>

      {/* Info Alert */}
      {audioFiles.length === 0 && !loading && (
        <Alert severity="info" sx={{ mb: 3, borderRadius: 3 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            No local files yet
          </Typography>
          <Typography variant="caption">
            Click "Select Files" to choose individual audio files (works everywhere), or "Select Folder" to scan an entire folder including subfolders (requires HTTPS or localhost). Files are stored in your browser and play locally without uploading.
          </Typography>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <Box sx={{ mb: 3 }}>
          <LinearProgress />
        </Box>
      )}

      {/* Files Table */}
      {audioFiles.length > 0 && (
        <TableContainer
          component={Paper}
          sx={{
            bgcolor: 'background.paper',
            borderRadius: 3,
            border: '1px solid',
            borderColor: 'rgba(255, 255, 255, 0.05)',
            '& .MuiTableCell-root': {
              borderColor: 'rgba(255, 255, 255, 0.05)',
              padding: { xs: '6px 8px', sm: '8px 12px' },
              fontSize: { xs: '0.7rem', sm: '0.8125rem' },
            },
          }}
        >
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell width={30} sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>#</TableCell>
                <TableCell sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>Title</TableCell>
                <TableCell sx={{ fontWeight: 600, display: { xs: 'none', sm: 'table-cell' }, fontSize: '0.75rem' }}>Artist</TableCell>
                <TableCell sx={{ fontWeight: 600, display: { xs: 'none', md: 'table-cell' }, fontSize: '0.75rem' }}>Album</TableCell>
                <TableCell align="right" sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>Duration</TableCell>
                <TableCell align="center" width={80} sx={{ fontWeight: 600, fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {audioFiles.map((file, index) => (
                <TableRow
                  key={file.id}
                  sx={{
                    cursor: 'pointer',
                    transition: 'background-color 0.3s ease',
                    '&:hover': {
                      bgcolor: 'rgba(19, 236, 106, 0.05)',
                    },
                  }}
                  onClick={() => handlePlay(file)}
                >
                  <TableCell sx={{ color: 'text.secondary', fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                    {index + 1}
                  </TableCell>
                  <TableCell>
                    <Box>
                      <Typography 
                        variant="body2" 
                        noWrap 
                        sx={{ 
                          maxWidth: { xs: 150, sm: 200, md: 300 }, 
                          fontWeight: 500,
                          fontSize: { xs: '0.75rem', sm: '0.813rem' },
                          lineHeight: 1.3,
                        }}
                      >
                        {file.title}
                      </Typography>
                      <Typography 
                        variant="caption" 
                        noWrap
                        sx={{ 
                          display: { xs: 'block', sm: 'none' },
                          color: 'text.secondary',
                          fontSize: '0.65rem',
                          maxWidth: 150,
                        }}
                      >
                        {file.artist}
                      </Typography>
                    </Box>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', sm: 'table-cell' } }}>
                    <Typography 
                      variant="body2" 
                      color="text.secondary" 
                      noWrap 
                      sx={{ 
                        maxWidth: 120,
                        fontSize: '0.75rem',
                      }}
                    >
                      {file.artist}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ display: { xs: 'none', md: 'table-cell' } }}>
                    <Typography 
                      variant="body2" 
                      color="text.secondary" 
                      noWrap 
                      sx={{ 
                        maxWidth: 150,
                        fontSize: '0.75rem',
                      }}
                    >
                      {file.album || '-'}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', fontSize: { xs: '0.7rem', sm: '0.75rem' } }}>
                    {formatDuration(file.duration)}
                  </TableCell>
                  <TableCell align="center" onClick={(e) => e.stopPropagation()}>
                    <IconButton
                      size="small"
                      onClick={() => handlePlay(file)}
                      sx={{
                        color: 'primary.main',
                        padding: { xs: '4px', sm: '6px' },
                        '&:hover': {
                          bgcolor: 'rgba(19, 236, 106, 0.1)',
                        },
                      }}
                    >
                      <PlayIcon sx={{ fontSize: { xs: '1rem', sm: '1.2rem' } }} />
                    </IconButton>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(file.id)}
                      sx={{
                        color: 'error.main',
                        padding: { xs: '4px', sm: '6px' },
                        '&:hover': {
                          bgcolor: 'rgba(255, 0, 0, 0.1)',
                        },
                      }}
                    >
                      <DeleteIcon sx={{ fontSize: { xs: '1rem', sm: '1.2rem' } }} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {/* Snackbar for alerts */}
      <Snackbar
        open={!!alert}
        autoHideDuration={4000}
        onClose={() => setAlert(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert onClose={() => setAlert(null)} severity={alert?.severity} sx={{ borderRadius: 2 }}>
          {alert?.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
