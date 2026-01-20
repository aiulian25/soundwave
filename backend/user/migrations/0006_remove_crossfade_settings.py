# Migration to remove unused crossfade settings

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('user', '0005_add_prefetch_enabled'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='userconfig',
            name='crossfade_enabled',
        ),
        migrations.RemoveField(
            model_name='userconfig',
            name='crossfade_duration',
        ),
    ]
