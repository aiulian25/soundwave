# Generated migration for enhanced metadata fields

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0001_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='audio',
            name='artist',
            field=models.CharField(blank=True, help_text='Artist name from metadata lookup', max_length=500),
        ),
        migrations.AddField(
            model_name='audio',
            name='album',
            field=models.CharField(blank=True, help_text='Album name', max_length=500),
        ),
        migrations.AddField(
            model_name='audio',
            name='year',
            field=models.IntegerField(blank=True, help_text='Release year', null=True),
        ),
        migrations.AddField(
            model_name='audio',
            name='genre',
            field=models.CharField(blank=True, help_text='Music genre', max_length=100),
        ),
        migrations.AddField(
            model_name='audio',
            name='track_number',
            field=models.IntegerField(blank=True, help_text='Track number on album', null=True),
        ),
        migrations.AddField(
            model_name='audio',
            name='cover_art_url',
            field=models.URLField(blank=True, help_text='Cover art from metadata source', max_length=500),
        ),
        migrations.AddField(
            model_name='audio',
            name='musicbrainz_id',
            field=models.CharField(blank=True, help_text='MusicBrainz recording ID', max_length=50),
        ),
        migrations.AddField(
            model_name='audio',
            name='metadata_source',
            field=models.CharField(blank=True, help_text='Source of enhanced metadata', max_length=50),
        ),
        migrations.AddField(
            model_name='audio',
            name='metadata_updated',
            field=models.DateTimeField(blank=True, help_text='When metadata was last updated', null=True),
        ),
    ]
