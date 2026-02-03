# Generated migration for PlaybackSession model (cross-device sync)

from django.db import migrations, models
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('audio', '0003_lyrics_uploaded_filename'),
    ]

    operations = [
        migrations.CreateModel(
            name='PlaybackSession',
            fields=[
                ('user', models.OneToOneField(
                    help_text='User who owns this playback session',
                    on_delete=models.deletion.CASCADE,
                    primary_key=True,
                    related_name='playback_session',
                    serialize=False,
                    to=settings.AUTH_USER_MODEL,
                )),
                ('youtube_id', models.CharField(
                    db_index=True,
                    help_text='YouTube ID of the currently playing track',
                    max_length=50,
                )),
                ('position', models.FloatField(
                    default=0,
                    help_text='Current playback position in seconds',
                )),
                ('duration', models.IntegerField(
                    default=0,
                    help_text='Total track duration in seconds',
                )),
                ('is_playing', models.BooleanField(
                    default=False,
                    help_text='Whether playback was active when last synced',
                )),
                ('volume', models.IntegerField(
                    default=100,
                    help_text='Volume level (0-100)',
                )),
                ('queue_youtube_ids', models.JSONField(
                    blank=True,
                    default=list,
                    help_text='List of YouTube IDs in the current queue',
                )),
                ('queue_index', models.IntegerField(
                    default=0,
                    help_text='Current position in the queue',
                )),
                ('device_id', models.CharField(
                    blank=True,
                    help_text='Identifier of the device that last synced',
                    max_length=100,
                )),
                ('device_name', models.CharField(
                    blank=True,
                    help_text='Name/type of the device that last synced',
                    max_length=200,
                )),
                ('updated_at', models.DateTimeField(
                    auto_now=True,
                    help_text='When the session was last updated',
                )),
            ],
            options={
                'verbose_name': 'Playback Session',
                'verbose_name_plural': 'Playback Sessions',
            },
        ),
    ]
