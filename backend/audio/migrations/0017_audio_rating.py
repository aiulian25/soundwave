from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('audio', '0016_artwork_for_playlists'),
    ]

    operations = [
        migrations.AddField(
            model_name='audio',
            name='rating',
            field=models.PositiveSmallIntegerField(default=0, help_text="The owner's stars, 0 when not rated"),
        ),
        migrations.AddConstraint(
            model_name='audio',
            constraint=models.CheckConstraint(condition=models.Q(('rating__lte', 5)), name='audio_rating_at_most_five'),
        ),
    ]
