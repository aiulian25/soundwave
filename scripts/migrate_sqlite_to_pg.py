"""
SQLite → PostgreSQL one-time migration script for SoundWave v1.11.0+

Usage (run inside the soundwave container):
    python /app/data/migrate_sqlite_to_pg.py

The script reads /app/data/db.sqlite3 (your existing SQLite database) and
copies all data into the connected PostgreSQL database (configured via
DATABASE_URL or POSTGRES_* environment variables in your .env file).

Requirements:
  - soundwave-pg container must be healthy
  - Django migrations must already be applied (`manage.py migrate`)
  - This script must be placed in ./data/ so it is mounted at /app/data/
"""
import os
import sys
import sqlite3
import django

sys.path.insert(0, '/app/backend')
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from django.db import connection, transaction

SQLITE_PATH = '/app/data/db.sqlite3'

if not os.path.exists(SQLITE_PATH):
    print(f"ERROR: SQLite database not found at {SQLITE_PATH}")
    print("Make sure ./data/db.sqlite3 exists and is mounted into the container.")
    sys.exit(1)

sq = sqlite3.connect(SQLITE_PATH)
sq.row_factory = sqlite3.Row
cur = sq.cursor()


def get_pg_bool_cols(table):
    with connection.cursor() as c:
        c.execute("""
            SELECT column_name FROM information_schema.columns
            WHERE table_name = %s AND data_type = 'boolean'
        """, [table])
        return {r[0] for r in c.fetchall()}


def get_pg_cols(table):
    with connection.cursor() as c:
        c.execute(
            "SELECT column_name FROM information_schema.columns WHERE table_name = %s",
            [table]
        )
        return {r[0] for r in c.fetchall()}


def get_sq_cols(table):
    cur.execute(f"PRAGMA table_info({table})")
    return [r['name'] for r in cur.fetchall()]


def migrate(sqlite_table, pg_table=None, order_by='id', truncate=True, extra_defaults=None):
    pg_table = pg_table or sqlite_table
    extra_defaults = extra_defaults or {}

    sq_cols = set(get_sq_cols(sqlite_table))
    pg_cols = get_pg_cols(pg_table)
    bool_cols = get_pg_bool_cols(pg_table)
    common = sorted(sq_cols & pg_cols)
    extra_cols = sorted(extra_defaults.keys())
    all_cols = common + extra_cols

    cur.execute(f"SELECT * FROM {sqlite_table} ORDER BY {order_by}")
    rows = cur.fetchall()
    if not rows:
        print(f"  {sqlite_table}: empty, skipping")
        return 0

    with connection.cursor() as c:
        if truncate:
            c.execute(f'TRUNCATE TABLE "{pg_table}" CASCADE')
        cols_str = ', '.join(f'"{col}"' for col in all_cols)
        vals_str = ', '.join(['%s'] * len(all_cols))
        sql = f'INSERT INTO "{pg_table}" ({cols_str}) VALUES ({vals_str})'
        batch = []
        for row in rows:
            vals = []
            for col in common:
                v = row[col]
                if col in bool_cols and v is not None:
                    v = bool(v)
                vals.append(v)
            for col in extra_cols:
                vals.append(extra_defaults[col])
            batch.append(vals)
        with transaction.atomic():
            c.executemany(sql, batch)
    print(f"  {sqlite_table}: {len(rows)} rows migrated")
    return len(rows)


def reset_sequences():
    """Reset PostgreSQL sequences so auto-increment starts after the last migrated id."""
    tables = [
        'user_account', 'user_userconfig', 'channel_channel',
        'audio_audio', 'playlist_playlist', 'playlist_playlistitem',
        'stats_listeninghistory', 'download_downloadqueue',
        'audio_artistinfo', 'playlist_smartplaylist', 'playlist_smartplaylistrule',
    ]
    with connection.cursor() as c:
        for table in tables:
            try:
                c.execute(f"""
                    SELECT setval(
                        pg_get_serial_sequence('"{table}"', 'id'),
                        COALESCE(MAX(id), 1)
                    ) FROM "{table}"
                """)
            except Exception:
                pass  # table may not have a serial id column


print("=== SQLite -> PostgreSQL Migration ===")
print()

print("1. Users (user_account)...")
migrate('user_account')

print("2. User configs...")
migrate('user_userconfig')

print("3. Auth tokens...")
migrate('authtoken_token', order_by='key')

print("4. YouTube accounts...")
migrate('user_useryoutubeaccount')

print("5. Channels...")
migrate('channel_channel')

print("6. Audio tracks...")
migrate('audio_audio')

print("7. Playlists...")
migrate('playlist_playlist')

print("8. Playlist items...")
migrate('playlist_playlistitem')

print("9. Listening history...")
migrate('stats_listeninghistory')

print("10. Download queue...")
migrate('download_downloadqueue')

print("11. Artist info...")
migrate('audio_artistinfo')

print("12. Smart playlists...")
migrate('playlist_smartplaylist')

print("13. Smart playlist rules...")
migrate('playlist_smartplaylistrule')

print()
print("Resetting PostgreSQL sequences...")
reset_sequences()

with connection.cursor() as c:
    def count(t):
        c.execute(f'SELECT COUNT(*) FROM "{t}"')
        return c.fetchone()[0]

    print()
    print("=== Final counts ===")
    print(f"Users:     {count('user_account')}")
    print(f"Channels:  {count('channel_channel')}")
    print(f"Playlists: {count('playlist_playlist')}")
    print(f"Tracks:    {count('audio_audio')}")

sq.close()
print()
print("Migration complete!")
