"""APP-03: encrypt existing TOTP secrets and hash existing backup codes.

Widens two_factor_secret to hold the Fernet ciphertext, then backfills existing
rows. Idempotent and reversible-safe: secrets already encrypted are skipped, and
codes already hashed are left untouched.
"""

from django.db import migrations, models


def _looks_hashed(value):
    # Django password hashes look like "<algo>$<iterations>$<salt>$<hash>".
    return isinstance(value, str) and value.count('$') >= 2


def encrypt_and_hash(apps, schema_editor):
    Account = apps.get_model('user', 'Account')
    users = list(Account.objects.exclude(two_factor_secret__isnull=True))
    if not users:
        # Nothing to convert (e.g. fresh install / test DB) — avoid importing the
        # crypto helpers at all so the migration has no hard dependency until needed.
        return

    from user.two_factor import encrypt_secret, decrypt_secret, hash_backup_code

    for user in users:
        changed = False

        secret = user.two_factor_secret
        if secret:
            # Only encrypt if it is not already a valid Fernet token. decrypt_secret
            # returns the input unchanged when it cannot decrypt (legacy plaintext).
            if decrypt_secret(secret) == secret:
                user.two_factor_secret = encrypt_secret(secret)
                changed = True

        codes = user.backup_codes or []
        if isinstance(codes, list) and any(not _looks_hashed(c) for c in codes):
            user.backup_codes = [c if _looks_hashed(c) else hash_backup_code(c) for c in codes]
            changed = True

        if changed:
            user.save(update_fields=['two_factor_secret', 'backup_codes'])


def noop_reverse(apps, schema_editor):
    # Cannot recover plaintext from hashes/ciphertext; reverse is a no-op.
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('user', '0010_account_password_change_required'),
    ]

    operations = [
        migrations.AlterField(
            model_name='account',
            name='two_factor_secret',
            field=models.CharField(blank=True, max_length=255, null=True),
        ),
        migrations.RunPython(encrypt_and_hash, noop_reverse),
    ]
