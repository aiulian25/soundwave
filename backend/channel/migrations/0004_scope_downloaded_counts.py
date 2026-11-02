from django.db import migrations


def scope_downloaded_counts_to_channel(apps, schema_editor):
    """Replace counts of everything the owner has with counts of this channel's tracks.

    Migrations must not depend on the media volume, so this trusts stored paths; the next
    sync checks the files themselves.
    """
    Audio = apps.get_model('audio', 'Audio')
    Channel = apps.get_model('channel', 'Channel')
    for channel in Channel.objects.all():
        channel.downloaded_count = (
            Audio.objects.filter(owner_id=channel.owner_id, channel_id=channel.channel_id)
            .exclude(file_path='')
            .count()
        )
        channel.save(update_fields=['downloaded_count'])


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0012_audio_bpm_audio_energy_audio_feature_vector_and_more'),
        ('channel', '0003_channel_sync_depth'),
    ]

    operations = [
        migrations.RunPython(scope_downloaded_counts_to_channel, migrations.RunPython.noop),
    ]
