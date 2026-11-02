from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0013_export_job'),
    ]

    operations = [
        migrations.AddField(
            model_name='lyrics',
            name='original_synced_lyrics',
            field=models.TextField(blank=True, default=''),
        ),
    ]
