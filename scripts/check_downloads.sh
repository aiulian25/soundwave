#!/bin/bash
echo "📊 SOUNDWAVE DOWNLOAD STATUS"
echo "=============================="
echo ""

# Playlists
echo "📝 PLAYLISTS:"
docker compose exec soundwave python manage.py shell -c "from playlist.models import Playlist; [print(f'  {p.title}: {p.sync_status} - {p.downloaded_count}/{p.item_count} songs') for p in Playlist.objects.all()]" 2>/dev/null

echo ""

# Channels
echo "📺 CHANNELS:"
docker compose exec soundwave python manage.py shell -c "from channel.models import Channel; [print(f'  {c.channel_name}: {c.sync_status} - {c.downloaded_count} songs') for c in Channel.objects.all()]" 2>/dev/null

echo ""

# Download Queue
echo "📥 DOWNLOAD QUEUE:"
docker compose exec soundwave python manage.py shell -c "from download.models import DownloadQueue; print(f'  Pending: {DownloadQueue.objects.filter(status=\"pending\").count()}'); print(f'  Downloading: {DownloadQueue.objects.filter(status=\"downloading\").count()}'); print(f'  Completed: {DownloadQueue.objects.filter(status=\"completed\").count()}'); print(f'  Failed: {DownloadQueue.objects.filter(status=\"failed\").count()}')" 2>/dev/null

echo ""

# Downloaded Audio
echo "🎵 DOWNLOADED AUDIO:"
docker compose exec soundwave python manage.py shell -c "from audio.models import Audio; print(f'  Total songs: {Audio.objects.count()}')" 2>/dev/null
