import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Alert, Box, Button, Card, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import RemoveIcon from '@mui/icons-material/Remove';
import SaveIcon from '@mui/icons-material/Save';
import TimerIcon from '@mui/icons-material/Timer';
import UndoIcon from '@mui/icons-material/Undo';
import { useTranslation } from 'react-i18next';
import { audioAPI } from '../api/client';
import { offlineStorage } from '../utils/offlineStorage';
import { replaceOfflineLyrics } from '../utils/offlineLibrary';
import {
  activeLineIndex,
  formatPosition,
  lrcFromTimedLines,
  retimeLine,
  sameWords,
  shiftLines,
  timedLinesFromLrc,
  timingIssues,
  type TimedLine,
} from '../utils/lyricsTiming';

const SMALL_STEP_MS = 100;
const LARGE_STEP_MS = 1000;
const MILLISECONDS_PER_SECOND = 1000;
const UNDO_LIMIT = 100;
const STAMP_KEY = 't';
const HTTP_CONFLICT = 409;

type Notice = 'draftRestored' | 'offlineDraft' | 'saveFailed' | null;

interface SavedLyrics {
  synced_lyrics: string;
  revision?: string;
  [field: string]: unknown;
}

interface LyricsTimingEditorProps {
  youtubeId: string;
  title: string;
  syncedLyrics: string;
  originalSyncedLyrics: string;
  revision: string;
  currentTime: number;
  duration?: number;
  onSeek?: (time: number) => void;
  onClose: () => void;
  onSaved: (saved: any) => void;
}

export default function LyricsTimingEditor({
  youtubeId,
  title,
  syncedLyrics,
  originalSyncedLyrics,
  revision,
  currentTime,
  duration,
  onSeek,
  onClose,
  onSaved,
}: LyricsTimingEditorProps) {
  const { t } = useTranslation();
  const savedLines = useMemo(() => timedLinesFromLrc(syncedLyrics), [syncedLyrics]);
  const originalLines = useMemo(() => timedLinesFromLrc(originalSyncedLyrics), [originalSyncedLyrics]);

  const [lines, setLines] = useState<TimedLine[]>(savedLines);
  const [undoStack, setUndoStack] = useState<TimedLine[][]>([]);
  const [baseRevision, setBaseRevision] = useState(revision);
  const [nextLineToStamp, setNextLineToStamp] = useState(0);
  const [notice, setNotice] = useState<Notice>(null);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState<SavedLyrics | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const nextLineRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => timingIssues(lines, duration), [lines, duration]);
  const activeIndex = activeLineIndex(lines, currentTime * MILLISECONDS_PER_SECOND);
  const canRestoreOriginal = originalLines.length > 0 && sameWords(originalLines, lines);
  const conflictLines = useMemo(() => (conflict ? timedLinesFromLrc(conflict.synced_lyrics) : []), [conflict]);
  const canKeepMine = conflict !== null && sameWords(conflictLines, lines);

  useEffect(() => {
    let cancelled = false;
    offlineStorage.getLyricsTimingDraft(youtubeId).then((draft) => {
      if (cancelled || !draft || !sameWords(draft.lines, savedLines)) return;
      setLines(draft.lines);
      setBaseRevision(draft.base_revision);
      setNotice('draftRestored');
    }).catch((error) => console.error('[LyricsTiming] Could not read the draft:', error));
    editorRef.current?.focus();
    return () => {
      cancelled = true;
    };
  }, [youtubeId, savedLines]);

  useEffect(() => {
    nextLineRef.current?.scrollIntoView?.({ block: 'center' });
  }, [nextLineToStamp]);

  const keepDraft = (draftLines: TimedLine[], draftRevision: string) => {
    offlineStorage
      .saveLyricsTimingDraft({ youtube_id: youtubeId, base_revision: draftRevision, lines: draftLines })
      .catch((error) => console.error('[LyricsTiming] Could not keep the draft:', error));
  };

  const applyEdit = (edited: TimedLine[]) => {
    setUndoStack((stack) => [...stack.slice(-(UNDO_LIMIT - 1)), lines]);
    setLines(edited);
    keepDraft(edited, baseRevision);
  };

  const undo = () => {
    const previous = undoStack[undoStack.length - 1];
    if (!previous) return;
    setUndoStack(undoStack.slice(0, -1));
    setLines(previous);
    keepDraft(previous, baseRevision);
  };

  const stampLine = (index: number) => {
    applyEdit(retimeLine(lines, index, currentTime * MILLISECONDS_PER_SECOND));
    setNextLineToStamp(Math.min(index + 1, lines.length - 1));
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== STAMP_KEY || event.ctrlKey || event.metaKey || event.altKey) return;
    event.preventDefault();
    stampLine(nextLineToStamp);
  };

  const startOverFrom = (startingLines: TimedLine[], startingRevision: string) => {
    setLines(startingLines);
    setUndoStack([]);
    setBaseRevision(startingRevision);
    setNextLineToStamp(0);
    setNotice(null);
    setSaveError('');
    offlineStorage
      .removeLyricsTimingDraft(youtubeId)
      .catch((error) => console.error('[LyricsTiming] Could not remove the draft:', error));
  };

  const keepMine = () => {
    const latestRevision = conflict?.revision ?? '';
    setBaseRevision(latestRevision);
    setConflict(null);
    keepDraft(lines, latestRevision);
  };

  const takeLatest = () => {
    if (!conflict) return;
    startOverFrom(conflictLines, conflict.revision ?? '');
    setConflict(null);
  };

  const askServerForLatest = async () => {
    const response = await audioAPI.getLyrics(youtubeId);
    setConflict(response.data);
  };

  const save = async () => {
    setSaveError('');
    keepDraft(lines, baseRevision);
    if (!navigator.onLine) {
      setNotice('offlineDraft');
      return;
    }

    setSaving(true);
    try {
      // A copy cached before revisions existed has nothing to compare against.
      if (!baseRevision) {
        await askServerForLatest();
        return;
      }
      const response = await audioAPI.saveLyricsTiming(youtubeId, {
        synced_lyrics: lrcFromTimedLines(lines),
        base_revision: baseRevision,
      });
      await offlineStorage.removeLyricsTimingDraft(youtubeId);
      await replaceOfflineLyrics(youtubeId, response.data);
      onSaved(response.data);
    } catch (error: any) {
      if (error.response?.status === HTTP_CONFLICT) {
        setConflict(error.response.data.current);
      } else if (error.response?.data?.error) {
        setSaveError(error.response.data.error);
      } else {
        setNotice('saveFailed');
      }
    } finally {
      setSaving(false);
    }
  };

  const downloadRevisedLrc = () => {
    const url = URL.createObjectURL(new Blob([lrcFromTimedLines(lines)], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${title || youtubeId}.lrc`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const shiftButtons: [string, number][] = [
    ['earlierSecond', -LARGE_STEP_MS],
    ['earlierTenth', -SMALL_STEP_MS],
    ['laterTenth', SMALL_STEP_MS],
    ['laterSecond', LARGE_STEP_MS],
  ];

  return (
    <Card
      ref={editorRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      data-testid="lyrics-timing-editor"
      sx={{ height: '100%', display: 'flex', flexDirection: 'column', bgcolor: 'background.paper', outline: 'none' }}
    >
      <Box sx={{ borderBottom: 1, borderColor: 'divider', display: 'flex', alignItems: 'center', px: 2, py: 1 }}>
        <Typography variant="h6" sx={{ flexGrow: 1 }}>{t('lyrics.timing.title')}</Typography>
        <IconButton aria-label={t('common.close')} size="small" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Box>

      <Box sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mb: 1 }}>
          {t('lyrics.timing.help')}
        </Typography>
        <Typography variant="caption" component="p" sx={{ mb: 0.5 }}>{t('lyrics.timing.shiftAll')}</Typography>
        <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} sx={{ mb: 1 }}>
          {shiftButtons.map(([label, deltaMs]) => (
            <Button key={label} size="small" variant="outlined" onClick={() => applyEdit(shiftLines(lines, deltaMs))}>
              {t(`lyrics.timing.${label}`)}
            </Button>
          ))}
        </Stack>
        <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1}>
          <Button size="small" variant="contained" startIcon={<TimerIcon />} onClick={() => stampLine(nextLineToStamp)}>
            {t('lyrics.timing.stampNext')}
          </Button>
          <Button size="small" startIcon={<UndoIcon />} disabled={undoStack.length === 0} onClick={undo}>
            {t('lyrics.timing.undo')}
          </Button>
          {canRestoreOriginal && (
            <Button size="small" onClick={() => applyEdit(originalLines)}>{t('lyrics.timing.restoreOriginal')}</Button>
          )}
          <Button size="small" onClick={() => startOverFrom(savedLines, revision)}>{t('lyrics.timing.reset')}</Button>
        </Stack>
      </Box>

      {notice && (
        <Alert severity={notice === 'draftRestored' ? 'info' : 'warning'} onClose={() => setNotice(null)} sx={{ borderRadius: 0 }}>
          {t(`lyrics.timing.${notice}`)}
        </Alert>
      )}
      {saveError && <Alert severity="error" sx={{ borderRadius: 0 }}>{saveError}</Alert>}
      {conflict && (
        <Alert
          severity="warning"
          sx={{ borderRadius: 0 }}
          data-testid="lyrics-timing-conflict"
          action={
            <Stack direction="row" spacing={1}>
              {canKeepMine && <Button size="small" color="inherit" onClick={keepMine}>{t('lyrics.timing.conflictKeep')}</Button>}
              <Button size="small" color="inherit" onClick={takeLatest}>{t('lyrics.timing.useLatest')}</Button>
            </Stack>
          }
        >
          {t('lyrics.timing.conflictTitle')}
          {!canKeepMine && <Typography variant="caption" component="p">{t('lyrics.timing.conflictTextChanged')}</Typography>}
        </Alert>
      )}

      <Box sx={{ flexGrow: 1, overflow: 'auto', px: 1, py: 1 }}>
        {lines.map((line, index) => {
          const issue = issues.get(index);
          const isNextToStamp = index === nextLineToStamp;
          return (
            <Box
              key={index}
              ref={isNextToStamp ? nextLineRef : undefined}
              data-testid="lyrics-timing-line"
              data-active={index === activeIndex}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                px: 1,
                py: 0.5,
                borderRadius: 1,
                borderLeft: 3,
                borderColor: isNextToStamp ? 'primary.main' : 'transparent',
                bgcolor: index === activeIndex ? 'action.selected' : 'transparent',
              }}
            >
              <Button
                size="small"
                sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 76 }}
                aria-label={t('lyrics.timing.seekLine', { time: formatPosition(line.timeMs) })}
                onClick={() => onSeek?.(line.timeMs / MILLISECONDS_PER_SECOND)}
              >
                {formatPosition(line.timeMs)}
              </Button>
              <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>{line.text}</Typography>
                {issue && (
                  <Typography variant="caption" color="error" component="p">{t(`lyrics.timing.${issue}`)}</Typography>
                )}
              </Box>
              <Tooltip title={t('lyrics.timing.nudgeEarlier')}>
                <IconButton
                  size="small"
                  aria-label={t('lyrics.timing.nudgeEarlier')}
                  onClick={() => applyEdit(retimeLine(lines, index, line.timeMs - SMALL_STEP_MS))}
                >
                  <RemoveIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('lyrics.timing.nudgeLater')}>
                <IconButton
                  size="small"
                  aria-label={t('lyrics.timing.nudgeLater')}
                  onClick={() => applyEdit(retimeLine(lines, index, line.timeMs + SMALL_STEP_MS))}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('lyrics.timing.stampLine')}>
                <IconButton size="small" aria-label={t('lyrics.timing.stampLine')} onClick={() => stampLine(index)}>
                  <MyLocationIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </Box>
          );
        })}
      </Box>

      <Stack direction="row" useFlexGap flexWrap="wrap" spacing={1} sx={{ p: 1.5, borderTop: 1, borderColor: 'divider' }}>
        <Button
          size="small"
          variant="contained"
          startIcon={<SaveIcon />}
          disabled={saving || issues.size > 0 || conflict !== null}
          onClick={save}
        >
          {t('lyrics.timing.save')}
        </Button>
        <Button size="small" startIcon={<DownloadIcon />} disabled={issues.size > 0} onClick={downloadRevisedLrc}>
          {t('lyrics.timing.downloadLrc')}
        </Button>
      </Stack>
    </Card>
  );
}
