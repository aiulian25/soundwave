# Generated migration for LRC upload filename storage

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0002_add_enhanced_metadata'),
    ]

    operations = [
        # Extend source field length
        migrations.AlterField(
            model_name='lyrics',
            name='source',
            field=models.CharField(default='lrclib', max_length=100),
        ),
        # Add uploaded_filename field
        migrations.AddField(
            model_name='lyrics',
            name='uploaded_filename',
            field=models.CharField(blank=True, default='', max_length=255),
        ),
    ]
