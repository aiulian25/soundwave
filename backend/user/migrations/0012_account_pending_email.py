from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('user', '0011_encrypt_2fa_secrets'),
    ]

    operations = [
        migrations.AddField(
            model_name='account',
            name='pending_email',
            field=models.EmailField(blank=True, max_length=60, null=True),
        ),
    ]
