from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('user', '0013_passkey'),
    ]

    operations = [
        migrations.AddField(
            model_name='userconfig',
            name='playback_sync_enabled',
            field=models.BooleanField(default=True, help_text='Share playback position and queue across devices'),
        ),
    ]
