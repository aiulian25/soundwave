"""Migration to remove duplicate Channel model from audio app"""
from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0006_rename_audio_radio_user_id_youtube_idx_audio_radio_user_id_ddcf35_idx_and_more'),
    ]

    operations = [
        migrations.DeleteModel(
            name='Channel',
        ),
    ]
