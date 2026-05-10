from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0007_delete_duplicate_channel_model'),
    ]

    operations = [
        migrations.AlterField(
            model_name='audio',
            name='like_count',
            field=models.BigIntegerField(default=0),
        ),
        migrations.AlterField(
            model_name='audio',
            name='view_count',
            field=models.BigIntegerField(default=0),
        ),
    ]
