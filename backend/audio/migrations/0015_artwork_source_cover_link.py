from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0014_lyrics_original_synced_lyrics'),
    ]

    operations = [
        migrations.AlterField(
            model_name='artwork',
            name='source',
            field=models.CharField(
                choices=[
                    ('youtube', 'YouTube'),
                    ('lastfm', 'Last.fm'),
                    ('fanart', 'Fanart.tv'),
                    ('manual', 'Manual Upload'),
                    ('cover_link', 'Cover art link'),
                ],
                max_length=50,
            ),
        ),
    ]
