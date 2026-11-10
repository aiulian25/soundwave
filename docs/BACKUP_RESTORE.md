# Backing up and restoring SoundWave

There are two kinds of backup, and they protect against different things.

| | Settings > Backup (JSON) | `scripts/backup-instance.sh` |
|---|---|---|
| Scope | One account's library definition | The whole instance |
| Audio files | No: tracks are downloaded again from their video IDs | Yes |
| Deleted or private videos | **Lost**: they cannot be downloaded again | Kept |
| Lyrics you supplied | No | Yes |
| Listening history, stats and achievements | No | Yes |
| Accounts, passwords and two-factor | No | Yes |
| Use it for | Moving a library to another account | Disaster recovery and upgrades |

Files imported in the browser ("Local Files") live only in that browser and are in neither backup.

## What the full backup contains

- `database.dump`: the PostgreSQL database.
- `files.tar`: the `audio` and `data` folders, including avatars.
- `MANIFEST.sha256`: a checksum of every one of those files.
- `VERSION`: the app version, image and PostgreSQL version it came from.
- `secrets/`: only with `--include-secrets`.

**Left out on purpose:**

- **Redis.** It only holds the task queue and caches. After a restore, downloads still marked as pending are queued again by the regular schedule, and the job claims make a repeated task harmless, so replaying an old queue would add risk and no value.
- **`cache/`.** It holds export scratch files and can be rebuilt.

## Secrets

Secrets are only copied if you pass `--include-secrets`, and then the backup is as sensitive as they are. Without that flag, keep these yourself:

- `DJANGO_SECRET_KEY`, and `TOTP_ENC_KEY` if you set it. **Two-factor secrets are encrypted with one of these. Restore with a different key and those accounts cannot pass two-factor.**
- `POSTGRES_PASSWORD` and `REDIS_PASSWORD`. A restored instance can have new ones.
- `cookies.txt`. A fresh export works too.

## Making a backup

```bash
scripts/backup-instance.sh -f docker-compose.prod.yml --output /path/to/safe/place
```

SoundWave stops while this runs, so the database and the files describe the same moment, and starts again afterwards even if the backup fails. Files are created readable only by you. Copy the result off the machine, because a backup on the same disk does not survive that disk.

## Restoring

Restore onto an empty instance. The script refuses to overwrite existing data, so move any old `audio` and `data` folders aside rather than deleting them.

1. Put `.env` in place with the **same `DJANGO_SECRET_KEY`**, and put `cookies.txt` in place.
2. Create empty `audio`, `cache` and `data` folders owned by UID 1000: `./setup-dirs.sh`.
3. Run the restore. It checks the archives, restores the database and files, and compares every file with the manifest:

   ```bash
   scripts/restore-instance.sh -f docker-compose.prod.yml /path/to/soundwave-YYYYMMDD-HHMMSS
   ```

4. Start everything and check it: `docker compose -f docker-compose.prod.yml up -d`, then `scripts/check-readiness.sh -f docker-compose.prod.yml`.

SoundWave applies any newer database migrations when it starts, so restoring an older backup into a newer image is supported.

## Upgrading and going back

Database migrations only move forward, so **an older image cannot run against a database a newer image has already migrated.**

1. Before upgrading, run `scripts/backup-instance.sh`. Its `VERSION` file records the image you are on.
2. Pin to a version you can return to, using an image tag such as `ghcr.io/aiulian25/soundwave:1.20.2` rather than `main`. The digest of every published image is in that release's workflow summary.
3. Upgrade: `docker compose -f docker-compose.prod.yml pull`, then `up -d`.

To go back after an upgrade has migrated the database, restore the backup from step 1 onto an empty instance with the old image. Anything changed since that backup is lost. Changing the image tag alone is not enough.

Elasticsearch is no longer used. An old `es_data` volume can stay or go as you prefer, and nothing needs rebuilding.

Releases before v1.21.0 shipped a default Elasticsearch password in the Compose files, and it remains in the repository's public history. If you ever reused that password for anything else, change it there.

## After a restore, on a phone or laptop

Offline downloads and locally imported files live in each browser. They are not touched by a server restore, and offline status is re-checked against what is really on that device.
