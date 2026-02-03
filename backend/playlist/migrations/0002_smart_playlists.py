# Generated migration for Smart Playlists

from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('playlist', '0001_initial'),
    ]

    operations = [
        migrations.CreateModel(
            name='SmartPlaylist',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200)),
                ('description', models.TextField(blank=True)),
                ('icon', models.CharField(blank=True, default='auto_awesome', help_text='Material icon name', max_length=50)),
                ('color', models.CharField(blank=True, default='#7C3AED', help_text='Theme color (hex)', max_length=20)),
                ('match_mode', models.CharField(choices=[('all', 'Match all rules (AND)'), ('any', 'Match any rule (OR)')], default='all', max_length=10)),
                ('order_by', models.CharField(choices=[('title', 'Title (A-Z)'), ('-title', 'Title (Z-A)'), ('artist', 'Artist (A-Z)'), ('-artist', 'Artist (Z-A)'), ('channel_name', 'Channel (A-Z)'), ('-channel_name', 'Channel (Z-A)'), ('downloaded_date', 'Date Added (Oldest first)'), ('-downloaded_date', 'Date Added (Newest first)'), ('play_count', 'Play Count (Least played)'), ('-play_count', 'Play Count (Most played)'), ('last_played', 'Last Played (Oldest first)'), ('-last_played', 'Last Played (Most recent)'), ('duration', 'Duration (Shortest first)'), ('-duration', 'Duration (Longest first)'), ('year', 'Year (Oldest first)'), ('-year', 'Year (Newest first)'), ('random', 'Random')], default='-downloaded_date', max_length=30)),
                ('limit', models.IntegerField(blank=True, help_text='Maximum number of tracks (null = unlimited)', null=True)),
                ('is_system', models.BooleanField(default=False, help_text='System preset smart playlist')),
                ('preset_type', models.CharField(blank=True, choices=[('most_played', 'Most Played'), ('recently_added', 'Recently Added'), ('not_played_recently', 'Not Played Recently'), ('never_played', 'Never Played'), ('favorites', 'Favorites'), ('short_tracks', 'Short Tracks'), ('long_tracks', 'Long Tracks')], help_text='Preset type for system playlists', max_length=30)),
                ('cached_count', models.IntegerField(default=0, help_text='Cached track count')),
                ('cache_updated', models.DateTimeField(blank=True, null=True)),
                ('created_date', models.DateTimeField(auto_now_add=True)),
                ('last_updated', models.DateTimeField(auto_now=True)),
                ('owner', models.ForeignKey(help_text='User who owns this smart playlist', on_delete=django.db.models.deletion.CASCADE, related_name='smart_playlists', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'ordering': ['is_system', 'name'],
            },
        ),
        migrations.CreateModel(
            name='SmartPlaylistRule',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('field', models.CharField(choices=[('title', 'Title'), ('artist', 'Artist'), ('album', 'Album'), ('genre', 'Genre'), ('channel_name', 'Channel Name'), ('year', 'Year'), ('play_count', 'Play Count'), ('last_played', 'Last Played'), ('downloaded_date', 'Date Added'), ('duration', 'Duration (seconds)'), ('is_favorite', 'Is Favorite')], max_length=50)),
                ('operator', models.CharField(choices=[('contains', 'Contains'), ('not_contains', 'Does not contain'), ('equals', 'Equals'), ('not_equals', 'Does not equal'), ('starts_with', 'Starts with'), ('ends_with', 'Ends with'), ('greater_than', 'Greater than'), ('less_than', 'Less than'), ('greater_equal', 'Greater than or equal'), ('less_equal', 'Less than or equal'), ('between', 'Between'), ('in_last_days', 'In the last N days'), ('not_in_last_days', 'Not in the last N days'), ('before_date', 'Before date'), ('after_date', 'After date'), ('is_true', 'Is true'), ('is_false', 'Is false'), ('is_set', 'Is set'), ('is_not_set', 'Is not set')], max_length=30)),
                ('value', models.CharField(blank=True, help_text='Value to compare against', max_length=500)),
                ('value_2', models.CharField(blank=True, help_text="Second value for 'between' operator", max_length=500)),
                ('order', models.IntegerField(default=0, help_text='Order of rule evaluation')),
                ('smart_playlist', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='rules', to='playlist.smartplaylist')),
            ],
            options={
                'ordering': ['order'],
            },
        ),
        migrations.AddIndex(
            model_name='smartplaylist',
            index=models.Index(fields=['owner', 'is_system'], name='playlist_sm_owner_i_7e7731_idx'),
        ),
        migrations.AddIndex(
            model_name='smartplaylist',
            index=models.Index(fields=['owner', 'preset_type'], name='playlist_sm_owner_i_a9f5c4_idx'),
        ),
        migrations.AddConstraint(
            model_name='smartplaylist',
            constraint=models.UniqueConstraint(fields=('owner', 'name'), name='unique_smart_playlist_name_per_user'),
        ),
    ]
