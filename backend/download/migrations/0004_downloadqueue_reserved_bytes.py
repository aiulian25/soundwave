from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('download', '0003_queue_identity_and_lifecycle'),
    ]

    operations = [
        migrations.AddField(
            model_name='downloadqueue',
            name='reserved_bytes',
            field=models.BigIntegerField(default=0, editable=False, help_text='Quota held while downloading'),
        ),
    ]
