from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('user', '0009_apikey'),
    ]

    operations = [
        migrations.AddField(
            model_name='account',
            name='password_change_required',
            field=models.BooleanField(
                default=False,
                help_text='Require the user to set a new password before using the app',
            ),
        ),
    ]
