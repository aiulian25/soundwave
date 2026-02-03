# Generated migration for Smart Radio models

from django.db import migrations, models
from django.conf import settings


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('audio', '0004_playback_sync'),
    ]

    operations = [
        migrations.CreateModel(
            name='RadioSession',
            fields=[
                ('user', models.OneToOneField(
                    on_delete=models.deletion.CASCADE,
                    primary_key=True,
                    related_name='radio_session',
                    serialize=False,
                    to=settings.AUTH_USER_MODEL,
                )),
                ('mode', models.CharField(
                    choices=[
                        ('track', 'Based on Track'),
                        ('artist', 'Based on Artist'),
                        ('favorites', 'Favorites Mix'),
                        ('discovery', 'Discovery Mode'),
                        ('recent', 'Recently Added'),
                    ],
                    default='track',
                    max_length=20,
                )),
                ('seed_youtube_id', models.CharField(
                    blank=True,
                    help_text='YouTube ID of the seed track',
                    max_length=50,
                )),
                ('seed_channel_id', models.CharField(
                    blank=True,
                    help_text='Channel ID for artist-based radio',
                    max_length=50,
                )),
                ('seed_title', models.CharField(
                    blank=True,
                    help_text='Title of seed track for display',
                    max_length=500,
                )),
                ('seed_artist', models.CharField(
                    blank=True,
                    help_text='Artist/channel name for display',
                    max_length=200,
                )),
                ('is_active', models.BooleanField(default=True)),
                ('current_youtube_id', models.CharField(
                    blank=True,
                    help_text='Currently playing track',
                    max_length=50,
                )),
                ('played_youtube_ids', models.JSONField(
                    default=list,
                    help_text='List of recently played YouTube IDs',
                )),
                ('skipped_youtube_ids', models.JSONField(
                    default=list,
                    help_text='List of skipped YouTube IDs',
                )),
                ('liked_channels', models.JSONField(
                    default=list,
                    help_text='Channels the user engages with positively',
                )),
                ('disliked_channels', models.JSONField(
                    default=list,
                    help_text='Channels the user skips frequently',
                )),
                ('max_history_size', models.IntegerField(
                    default=50,
                    help_text='Max tracks to remember for non-repeat',
                )),
                ('variety_level', models.IntegerField(
                    default=50,
                    help_text='0-100, higher = more variety',
                )),
                ('started_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Radio Session',
                'verbose_name_plural': 'Radio Sessions',
            },
        ),
        migrations.CreateModel(
            name='RadioTrackFeedback',
            fields=[
                ('id', models.BigAutoField(
                    auto_created=True,
                    primary_key=True,
                    serialize=False,
                    verbose_name='ID',
                )),
                ('youtube_id', models.CharField(db_index=True, max_length=50)),
                ('channel_id', models.CharField(db_index=True, max_length=50)),
                ('feedback_type', models.CharField(
                    choices=[
                        ('played', 'Played through'),
                        ('skipped', 'Skipped'),
                        ('liked', 'Liked'),
                        ('repeated', 'Repeated'),
                    ],
                    max_length=20,
                )),
                ('seed_youtube_id', models.CharField(blank=True, max_length=50)),
                ('radio_mode', models.CharField(blank=True, max_length=20)),
                ('listen_duration', models.IntegerField(
                    default=0,
                    help_text='How long user listened before skip/end',
                )),
                ('track_duration', models.IntegerField(
                    default=0,
                    help_text='Total track duration',
                )),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='radio_feedback',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'ordering': ['-created_at'],
            },
        ),
        migrations.AddIndex(
            model_name='radiotrackfeedback',
            index=models.Index(fields=['user', 'youtube_id'], name='audio_radio_user_id_youtube_idx'),
        ),
        migrations.AddIndex(
            model_name='radiotrackfeedback',
            index=models.Index(fields=['user', 'channel_id'], name='audio_radio_user_id_channel_idx'),
        ),
        migrations.AddIndex(
            model_name='radiotrackfeedback',
            index=models.Index(fields=['user', '-created_at'], name='audio_radio_user_id_created_idx'),
        ),
    ]
