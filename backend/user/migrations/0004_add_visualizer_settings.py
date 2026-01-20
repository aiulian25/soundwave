# Generated migration for visualizer settings

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('user', '0003_alter_account_options_alter_account_groups'),
    ]

    operations = [
        migrations.AddField(
            model_name='userconfig',
            name='visualizer_enabled',
            field=models.BooleanField(default=True, help_text='Enable audio visualizer'),
        ),
        migrations.AddField(
            model_name='userconfig',
            name='visualizer_glow',
            field=models.BooleanField(default=True, help_text='Enable glow effect on visualizer'),
        ),
        migrations.AddField(
            model_name='userconfig',
            name='visualizer_theme',
            field=models.CharField(default='classic-bars', help_text='Audio visualizer theme', max_length=50),
        ),
    ]
