import { useMemo, useState } from 'react';
import { Box, Typography, Link, Stack } from '@mui/material';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import EventOutlinedIcon from '@mui/icons-material/EventOutlined';
import { useTranslation } from 'react-i18next';

interface TrackDetailsProps {
  description?: string;
  viewCount?: number;
  likeCount?: number;
  publishedDate?: string;
}

const URL_PATTERN = /(https?:\/\/[^\s]+)/g;
const DESCRIPTION_COLLAPSED_LINE_COUNT = 4;
const DESCRIPTION_EXPANDABLE_MIN_CHARS = 200;

export function hasTrackDetails({ description, viewCount, likeCount, publishedDate }: TrackDetailsProps): boolean {
  const hasViews = typeof viewCount === 'number' && viewCount > 0;
  const hasLikes = typeof likeCount === 'number' && likeCount > 0;
  const hasDescription = (description?.trim().length ?? 0) > 0;
  const hasPublishedDate = typeof publishedDate === 'string' && publishedDate.trim().length > 0;
  return hasViews || hasLikes || hasDescription || hasPublishedDate;
}

function renderDescriptionWithLinks(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const matcher = new RegExp(URL_PATTERN);
  let lastIndex = 0;
  let match: RegExpExecArray | null = matcher.exec(text);

  while (match !== null) {
    const url = match[0];
    const matchStart = match.index;
    if (matchStart > lastIndex) {
      nodes.push(text.slice(lastIndex, matchStart));
    }
    nodes.push(
      <Link
        key={matchStart}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        underline="hover"
        sx={{ wordBreak: 'break-all' }}
      >
        {url}
      </Link>,
    );
    lastIndex = matchStart + url.length;
    match = matcher.exec(text);
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

export default function TrackDetails({ description, viewCount, likeCount, publishedDate }: TrackDetailsProps) {
  const { t, i18n } = useTranslation();
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const language = i18n.language;

  const compactNumberFormatter = useMemo(
    () => new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }),
    [language],
  );

  const publishedDateLabel = useMemo(() => {
    if (!publishedDate) {
      return '';
    }
    const parsedDate = new Date(publishedDate);
    if (Number.isNaN(parsedDate.getTime())) {
      return '';
    }
    return new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short', year: 'numeric' }).format(parsedDate);
  }, [publishedDate, language]);

  const trimmedDescription = description?.trim() ?? '';
  const hasViews = typeof viewCount === 'number' && viewCount > 0;
  const hasLikes = typeof likeCount === 'number' && likeCount > 0;
  const hasPublishedDate = publishedDateLabel.length > 0;
  const hasDescription = trimmedDescription.length > 0;

  if (!hasViews && !hasLikes && !hasPublishedDate && !hasDescription) {
    return null;
  }

  const descriptionNewlineCount = (trimmedDescription.match(/\n/g) ?? []).length;
  const isDescriptionExpandable =
    trimmedDescription.length > DESCRIPTION_EXPANDABLE_MIN_CHARS ||
    descriptionNewlineCount >= DESCRIPTION_COLLAPSED_LINE_COUNT;
  const shouldClampDescription = isDescriptionExpandable && !isDescriptionExpanded;

  const renderStat = (icon: React.ReactNode, label: string) => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
      {icon}
      <Typography variant="body2">{label}</Typography>
    </Box>
  );

  return (
    <Box sx={{ px: 2, py: 2 }}>
      <Stack
        direction="row"
        spacing={2}
        sx={{ flexWrap: 'wrap', rowGap: 1, mb: hasDescription ? 2 : 0, color: 'text.secondary' }}
      >
        {hasViews &&
          renderStat(
            <VisibilityOutlinedIcon fontSize="small" />,
            t('player.details.views', { count: compactNumberFormatter.format(viewCount as number) }),
          )}
        {hasLikes &&
          renderStat(
            <ThumbUpOutlinedIcon fontSize="small" />,
            t('player.details.likes', { count: compactNumberFormatter.format(likeCount as number) }),
          )}
        {hasPublishedDate &&
          renderStat(<EventOutlinedIcon fontSize="small" />, t('player.details.published', { date: publishedDateLabel }))}
      </Stack>

      {hasDescription && (
        <Box>
          <Typography
            variant="body2"
            component="div"
            sx={{
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color: 'text.primary',
              lineHeight: 1.7,
              ...(shouldClampDescription && {
                display: '-webkit-box',
                WebkitLineClamp: DESCRIPTION_COLLAPSED_LINE_COUNT,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }),
            }}
          >
            {renderDescriptionWithLinks(trimmedDescription)}
          </Typography>
          {isDescriptionExpandable && (
            <Link
              component="button"
              type="button"
              variant="body2"
              onClick={() => setIsDescriptionExpanded((previous) => !previous)}
              sx={{ mt: 0.5, fontWeight: 500 }}
            >
              {isDescriptionExpanded ? t('player.details.showLess') : t('player.details.showMore')}
            </Link>
          )}
        </Box>
      )}
    </Box>
  );
}
