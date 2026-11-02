from urllib.parse import parse_qs, urlparse

from django.conf import settings
from django.db import migrations, models

# Frozen copies: a migration must keep meaning what it meant when it first ran.
WATCH_HOSTS = {'youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'}
# Lower wins: finished work first, then the user's "stop asking" tombstone.
STATUS_RANK = {'completed': 0, 'ignored': 1, 'downloading': 2, 'pending': 3, 'failed': 4}
URL_MAX_LENGTH = 500


def canonical(url):
    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    video_id = ''
    if host == 'youtu.be':
        video_id = parsed.path.strip('/')
    elif host in WATCH_HOSTS and parsed.path.startswith('/shorts/'):
        video_id = parsed.path[len('/shorts/'):].strip('/')
    elif host in WATCH_HOSTS and parsed.path.rstrip('/') == '/watch':
        video_id = parse_qs(parsed.query).get('v', [''])[0]
    return f'https://www.youtube.com/watch?v={video_id}' if video_id else url


def merge_duplicates(apps, schema_editor):
    """Only queue rows are removed, never media or Audio rows."""
    DownloadQueue = apps.get_model('download', 'DownloadQueue')
    groups = {}
    for row in DownloadQueue.objects.order_by('-id').iterator():
        groups.setdefault((row.owner_id, canonical(row.url)), []).append(row)

    for (_, url), rows in groups.items():
        rows.sort(key=lambda row: STATUS_RANK.get(row.status, len(STATUS_RANK)))
        keeper, *duplicates = rows
        if not keeper.youtube_id:
            keeper.youtube_id = next((row.youtube_id for row in duplicates if row.youtube_id), '')
        DownloadQueue.objects.filter(pk__in=[row.pk for row in duplicates]).delete()
        keeper.url = url[:URL_MAX_LENGTH]
        keeper.save(update_fields=['url', 'youtube_id'])


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('download', '0002_downloadqueue_retry_count'),
    ]

    operations = [
        migrations.AddField(
            model_name='downloadqueue',
            name='claim_token',
            field=models.UUIDField(blank=True, editable=False, help_text='Held by the worker allowed to finish this row', null=True),
        ),
        migrations.AddField(
            model_name='downloadqueue',
            name='lease_expires_at',
            field=models.DateTimeField(blank=True, editable=False, null=True),
        ),
        migrations.AddField(
            model_name='downloadqueue',
            name='source_playlist_id',
            field=models.CharField(blank=True, help_text='Playlist sync that queued this row', max_length=100),
        ),
        migrations.RunPython(merge_duplicates, migrations.RunPython.noop),
        migrations.AddConstraint(
            model_name='downloadqueue',
            constraint=models.UniqueConstraint(fields=('owner', 'url'), name='download_queue_unique_owner_url'),
        ),
    ]
