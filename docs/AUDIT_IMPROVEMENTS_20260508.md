# SoundWave — Full Audit: 20 Improvement Findings

> Audit date: 2026-05-08  
> Scope: security, performance, code quality, PWA, i18n  
> Principle: **zero regression on usability**

---

## #1 — Auth token stored in `localStorage` (XSS risk)

**Where:** `frontend/src/pages/LoginPage.tsx:77`, `frontend/src/api/client.ts:21`, all `localStorage.getItem('token')` calls throughout frontend.

**Finding:**  
The DRF auth token is written to `localStorage` on login and read on every request. Any JavaScript injected via XSS (e.g. a rogue npm package, a DOM injection) can steal it with `localStorage.getItem('token')`. `localStorage` has no `HttpOnly` or `SameSite` protection.

**Recommended fix:**  
Use the existing Django session cookie infrastructure for browser clients. On login, issue a session cookie with `HttpOnly=True; SameSite=Lax; Secure` (already configured in settings) instead of returning a plain token. Keep the token-in-header flow only for the API key / widget use case. The `ExpiringTokenAuthentication` class can remain for programmatic clients.

**Impact if not fixed:** Medium-high. A single XSS gadget = full account takeover.

---

## #2 — No i18n framework installed

**Where:** `frontend/src/` — entire source tree. No `react-i18next`, `lingui`, `react-intl`, or any locale files detected.

**Finding:**  
All UI strings are hardcoded English literals scattered across 50+ `.tsx` files (buttons, labels, error messages, snackbars, dialogs). There is no translation infrastructure whatsoever. This directly blocks internationalisation for all new and existing features.

**Recommended fix:**  
Install `react-i18next` + `i18next`. Extract all strings into `frontend/public/locales/en/translation.json`. Add a language switcher to Settings. Initial languages: `en`, `ro` (given the user base). The app's backend already has `USE_I18N = True` and `gettext`-ready infrastructure.

**Impact if not fixed:** Feature parity with user's own stated requirement ("translate all new added features in all app languages") is permanently blocked.

---

## #3 — Hardcoded default credentials in `docker-compose.yml`

**Where:** `docker-compose.yml` lines 30–35.

**Finding:**  
```
SW_PASSWORD=soundwave
ELASTIC_PASSWORD=soundwave
```
These hardcoded credentials are committed to the repository and will be used verbatim by anyone who clones and runs `docker compose up` without reading documentation. `docker-compose.prod.yml` correctly uses `${VAR:?error}` mandatory substitution, but the dev file is what most people run first and forget to change.

**Recommended fix:**  
Replace plaintext defaults with env-var references that fall back to an obvious insecure marker that fails on startup:
```yaml
SW_PASSWORD: ${SW_PASSWORD:-CHANGE_ME_NOW}
ELASTIC_PASSWORD: ${ELASTIC_PASSWORD:-CHANGE_ME_NOW}
```
Add a startup check in `docker_assets/run.sh` that refuses to start if any credential equals `CHANGE_ME_NOW`.

**Impact if not fixed:** High. Default Elasticsearch password + default admin password exposed for any instance not explicitly configured.

---

## #4 — MD5 used for cache key hashing

**Where:** `backend/common/rate_limiter.py:33,42`.

**Finding:**  
```python
key_hash = hashlib.md5(identifier.encode()).hexdigest()
```
MD5 has known collision attacks. While this is a cache key (not a password hash), using MD5 here sends the wrong signal in a security-sensitive code path (login rate limiting). If two IPs produce the same MD5, they share a lockout counter — an attacker could craft a request that resets another IP's lockout bucket.

**Recommended fix:**  
Replace `hashlib.md5` with `hashlib.sha256` (same one-liner). No performance difference in practice.

---

## #5 — `ALLOWED_HOSTS` contains 500+ auto-generated IPs

**Where:** `backend/config/settings.py:63–82`.

**Finding:**  
The `get_allowed_hosts()` function loops through `192.168.0.1–254`, `192.168.1.1–254`, and `10.0.0.1–254`, adding 763 IPs to `ALLOWED_HOSTS`. Django checks this list on every incoming request's `Host` header. This has a real (small) per-request cost, produces enormous `ALLOWED_HOSTS` values in logs, and makes it impossible to audit what is and is not allowed at a glance.

**Recommended fix:**  
Use a single `ALLOWED_HOSTS = ['*']` guarded behind an explicit `ALLOW_LOCAL_NETWORK=True` env check **only in dev**, or better: let the reverse proxy (nginx) handle host validation and set `ALLOWED_HOSTS` to just the production hostname(s) via `DJANGO_ALLOWED_HOSTS`.

---

## #6 — `print()` statements in production backend code

**Where:** `backend/audio/views.py:358,360,362,510`, `backend/audio/views_lyrics.py:114`, `backend/audio/tag_writer.py` (8 calls), `backend/audio/metadata_fetcher.py` (4 calls), `backend/config/settings.py:180,182`.

**Finding:**  
27+ `print()` calls are scattered throughout production backend code. They bypass the configured `LOGGING` infrastructure (formatters, level filtering, log rotation) and write directly to stdout in unstructured form. Sensitive data like `youtube_id`, file paths, and lyrics metadata appear in these print calls.

**Recommended fix:**  
Replace all `print(...)` with the appropriate `logger.debug(...)`, `logger.info(...)`, or `logger.warning(...)` call using the module-level logger already present in most files.

---

## #7 — Auth token exposed in media stream URLs

**Where:** `backend/audio/views.py` — `AudioPlayerView.get()`, approximately line 455.

**Finding:**  
```python
stream_url = f"/media/{encoded_path}?token={token.key}"
```
The full auth token appears in the `?token=` query parameter of every stream URL. This means the token is:
- Stored in browser history
- Logged in every web server / nginx / proxy access log
- Leaked in HTTP `Referer` headers when loading album art from external CDNs
- Visible in `<audio>` element inspection in DevTools

**Recommended fix:**  
Issue short-lived (5–15 min), single-use signed URL tokens for media access (e.g., `itsdangerous.TimestampSigner` or a UUID stored in Redis). The streaming endpoint validates these, not the main DRF token.

---

## #8 — SQLite as the sole database in a multi-user, multi-process app

**Where:** `backend/config/settings.py:165–185`. Celery workers (`ForkPoolWorker-1`, `ForkPoolWorker-2`) confirmed running in logs.

**Finding:**  
SQLite in WAL mode handles concurrent reads well, but each Celery worker that writes (download tasks, sync tasks) still serialises writes. With 8+ playlists and 2 channels syncing simultaneously (confirmed in logs), write contention is real. SQLite also has a 2 GB default page limit per WAL file and no row-level locking.

**Recommended fix:**  
Migrate to PostgreSQL. The app's ORM usage is already database-agnostic. A `pg` service can be added to `docker-compose.yml` with a named volume. This also unlocks `django-celery-results` table partitioning and proper connection pooling.

**Implemented:** PostgreSQL-backed deployment wiring has been added to the compose files, with `DATABASE_URL` support in Django settings and SQLite retained only as a fallback for non-container development.

---

## #9 — `play_count` increment has a race condition

**Where:** `backend/audio/views.py` — `AudioProgressView.post()`.

**Finding:**  
```python
audio.play_count += 1
audio.save()
```
Multiple concurrent requests (two devices playing simultaneously, or Celery + a web request) both read `play_count = N`, both increment to `N+1`, and both save `N+1`. The result is `N+1` instead of `N+2`.

**Recommended fix:**  
```python
Audio.objects.filter(pk=audio.pk).update(play_count=F('play_count') + 1)
```
Django's `F()` expression pushes the increment to the database atomically.

**Implemented:** The increment now happens with an atomic database update in `AudioProgressView.post()`, so concurrent playback updates no longer drop counts.

---

## #10 — `LoginPage.tsx.backup` committed to version control

**Where:** `frontend/src/pages/LoginPage.tsx.backup`.

**Finding:**  
A backup copy of the login page source is committed to the repository. Backup files often contain older, less-hardened code and expose implementation details. They are never served but clutter the diff history and may confuse future contributors.

**Recommended fix:**  
```bash
git rm frontend/src/pages/LoginPage.tsx.backup
```
Add `*.backup` and `*.bak` to `.gitignore`.

**Implemented:** The backup file has been removed and the ignore rules now exclude future `*.backup` and `*.bak` artifacts.

---

## #11 — `AuthDebugMiddleware` runs on every production request

**Where:** `backend/config/settings.py:116`, `backend/common/middleware.py`.

**Finding:**  
`AuthDebugMiddleware` is unconditionally in `MIDDLEWARE`. Even though it only logs when `AUTH_DEBUG=true`, the middleware object is instantiated and `__call__` is invoked on every single HTTP request in production. In a high-traffic production instance this is pure overhead with no benefit.

**Recommended fix:**  
Conditionally add the middleware only when `AUTH_DEBUG` is enabled:
```python
if os.environ.get('AUTH_DEBUG', 'false').lower() == 'true':
    MIDDLEWARE.insert(X, 'common.middleware.AuthDebugMiddleware')
```

**Implemented:** `AuthDebugMiddleware` is now inserted only when `AUTH_DEBUG=true`, so production requests no longer pay for the middleware unless debugging is explicitly enabled.

---

## #12 — No rate limiting on the `/media/` streaming endpoint

**Where:** `backend/common/streaming.py`, `backend/config/urls.py`.

**Finding:**  
The media file streaming endpoint authenticates users but has no per-user or per-IP rate limit. A single authenticated account can open hundreds of parallel streaming connections and saturate server bandwidth or I/O. DRF throttles apply to `/api/` endpoints only; WhiteNoise/direct file serving bypasses DRF entirely.

**Recommended fix:**  
Add an nginx `limit_req_zone` rule (preferred for production) or a lightweight Django middleware that tracks concurrent media connections per user in Redis. A limit of 10–20 concurrent streams per user is generous for legitimate usage.

**Implemented:** A cache-backed concurrent stream limiter is now enforced in the `/media/` streaming handler, with configurable per-user/per-IP limits and safe release of stream slots when responses end.

---

## #13 — Celery task results stored indefinitely in Redis

**Where:** `backend/config/settings.py:334–346`. `CELERY_RESULT_BACKEND` set; no `CELERY_RESULT_EXPIRES` configured.

**Finding:**  
Every completed Celery task result is stored in Redis forever. With sync cycles every 15 minutes (8 playlists + 2 channels = 10 tasks per cycle), that is 960+ task results per day accumulating in Redis. Over weeks this bloats Redis memory and slows `KEYS`-based operations.

**Recommended fix:**  
```python
CELERY_RESULT_EXPIRES = 60 * 60  # 1 hour
```
One line in `settings.py`. Task results older than 1 hour have no value for this app's use case.

**Implemented:** Celery result retention is now bounded with `CELERY_RESULT_EXPIRES` (default 1 hour, env-overridable) to prevent indefinite Redis growth.

---

## #14 — `is_safe_artwork_url` allowlist is prefix-based, not origin-based

**Where:** `backend/audio/views.py:18–34`.

**Finding:**  
```python
ALLOWED_ARTWORK_URL_PREFIXES = (
    'https://i.ytimg.com', 'https://coverartarchive.org', ...
)
def is_safe_artwork_url(url):
    return any(url.startswith(prefix) for prefix in ALLOWED_ARTWORK_URL_PREFIXES)
```
A URL like `https://i.ytimg.com.evil.com/...` passes this check because `url.startswith('https://i.ytimg.com')` is `True`. This is a classic allowlist bypass that could enable SSRF to attacker-controlled servers.

**Recommended fix:**  
Parse the URL and compare the `hostname` component, not the raw string prefix:
```python
from urllib.parse import urlparse
ALLOWED_ARTWORK_HOSTS = {'i.ytimg.com', 'coverartarchive.org', ...}

def is_safe_artwork_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        return parsed.scheme == 'https' and parsed.hostname in ALLOWED_ARTWORK_HOSTS
    except Exception:
        return False
```

**Implemented:** Artwork URL validation now parses URLs and enforces exact host/scheme allowlisting, removing the prefix-based bypass risk.

---

## #15 — File deleted from disk before database transaction commits

**Where:** `backend/audio/models.py` — `Audio.delete()`, called from `backend/channel/views.py` and `backend/playlist/views.py`.

**Finding:**  
```python
def delete(self, *args, **kwargs):
    if self.file_path:
        full_path.unlink()   # File deleted from disk HERE
    super().delete(...)      # DB row deleted HERE
```
If the database delete raises an exception (e.g. FK constraint, DB lock), the audio file is already gone from disk. The database still has the record pointing to a now-missing file. This creates orphan database rows with no corresponding files.

**Recommended fix:**  
Delete the file _after_ confirming the DB record is removed, using a `try/finally` pattern:
```python
def delete(self, *args, **kwargs):
    file_to_delete = Path(settings.MEDIA_ROOT) / self.file_path if self.file_path else None
    super().delete(*args, **kwargs)   # DB first
    if file_to_delete:
        try:
            file_to_delete.unlink(missing_ok=True)
        except OSError as e:
            logger.warning("Could not delete audio file %s: %s", file_to_delete, e)
```

**Implemented:** `Audio.delete()` now deletes the database row first, then attempts filesystem cleanup with warning-level logging on unlink failures.

---

## #16 — Bare `except:` clauses silently swallow errors

**Where:** `backend/audio/views.py:383` (`except: pass`), `backend/audio/id3_service.py` (multiple), `backend/task/tasks.py` (multiple).

**Finding:**  
Bare `except:` catches `SystemExit`, `KeyboardInterrupt`, and `GeneratorExit` in addition to application errors. Several instances use `except Exception as e:` with no log call, meaning errors disappear entirely. When tasks fail silently, the user sees no feedback and the developer has no trace.

**Recommended fix:**  
All `except` clauses that don't re-raise should at minimum call `logger.exception(...)` or `logger.warning(...)`. Bare `except:` should always be `except Exception:` at the narrowest reasonable scope.

**Implemented:** Bare `except:` blocks in the targeted audio view paths were replaced with explicit `except Exception as e`, and previously swallowed failures now emit structured warning/info logs instead of silently passing.

---

## #17 — `DJANGO_DEBUG=True` hardcoded in `docker-compose.yml`

**Where:** `docker-compose.yml:35`.

**Finding:**  
```yaml
- DJANGO_DEBUG=True
```
Django's debug mode exposes full stack traces (including local variable values) to any HTTP client when an error occurs. A developer who uses `docker-compose.yml` in a shared/network environment unintentionally leaks sensitive information.

**Recommended fix:**  
Change to:
```yaml
- DJANGO_DEBUG=${DJANGO_DEBUG:-False}
```
Developers who need debug mode set it explicitly in their shell. The default is safe.

**Implemented:** `docker-compose.yml` now defaults `DJANGO_DEBUG` to `False`, and debug mode must be explicitly enabled via environment override.

---

## #18 — No API versioning

**Where:** `backend/config/urls.py` — all routes are under `/api/` with no version segment.

**Finding:**  
All API endpoints are mounted at `/api/channel/`, `/api/audio/`, etc. with no version identifier. Any future breaking change to a response schema requires a hard cut-over. Mobile PWA clients cached in service workers may receive a new response shape they cannot parse, causing silent data errors or crashes.

**Recommended fix:**  
Add a version prefix: `/api/v1/channel/`, `/api/v1/audio/`, etc. Keep `/api/` as an alias pointing to `/api/v1/` for backward compatibility. This is a one-line `include()` change in `urls.py` and allows future `/api/v2/` routes to coexist.

**Implemented:** API routes are now mounted under both `/api/v1/` and `/api/` (backward-compatible alias), enabling versioned evolution without breaking current clients.

---

## #19 — `sitemap.xml` references `soundwave.app` (wrong hostname for self-hosted installs)

**Where:** `frontend/public/sitemap.xml`, `frontend/public/robots.txt:8`.

**Finding:**  
```xml
<loc>https://soundwave.app/</loc>
```
and
```
Sitemap: https://soundwave.app/sitemap.xml
```
Every self-hosted instance serves a sitemap pointing to a different host. Search engines crawling a self-hosted instance (e.g. `sound.ascunse.uk`) follow the sitemap to `soundwave.app` instead, producing incorrect indexing. More importantly, the `robots.txt` references are broken for any non-default deployment.

**Recommended fix:**  
Generate `sitemap.xml` and the `robots.txt` sitemap reference dynamically from `SW_HOST` at build time (Vite `define` + env var) or serve them as Django template views that inject the configured hostname.

**Implemented:** `robots.txt` and `sitemap.xml` are now served dynamically by Django using `SW_HOST` (with request-host fallback), so self-hosted deployments emit correct hostnames.

---

## #20 — No PWA offline fallback page

**Where:** `frontend/public/service-worker.js` — offline strategy.

**Finding:**  
When the user is offline and navigates to a page not in the service worker cache, the browser shows the browser's generic "no internet" error page. There is no custom offline page registered in the service worker's fetch handler as a fallback. This is a PWA baseline requirement (Lighthouse PWA audit: "Has an offline page").

**Recommended fix:**  
1. Create `frontend/public/offline.html` — a branded page with the SoundWave logo, a message, and a link to the Library (which works offline).  
2. Register it as a precached asset in the service worker.  
3. In the `fetch` event handler, return `offline.html` when the network fails and no cache match is found.

This is also the right place to add an "You're offline — here are your cached tracks" summary using the `audioCache` IndexedDB data.

**Implemented:** Added `offline.html`, precached it in the service worker, configured navigation-request fallback to return the offline page when network and cache miss occur, localized the offline page for all shipped app locales (`en`, `ro`), and added a safe IndexedDB-based summary of cached offline playlists/tracks.

---

## Summary Table

| # | Area | Severity | Effort |
|---|------|----------|--------|
| 1 | Auth token in localStorage | 🔴 High | Medium |
| 2 | No i18n framework | 🟠 Medium | High |
| 3 | Hardcoded credentials in compose | 🔴 High | Low |
| 4 | MD5 for rate-limiter cache keys | 🟡 Low | Trivial |
| 5 | 763 IPs in ALLOWED_HOSTS | 🟡 Low | Low |
| 6 | `print()` instead of logger | 🟠 Medium | Low |
| 7 | Auth token in stream URL query param | 🔴 High | Medium |
| 8 | SQLite in multi-process production | 🟠 Medium | High |
| 9 | `play_count` race condition | 🟡 Low | Trivial |
| 10 | Backup file in version control | 🟡 Low | Trivial |
| 11 | Debug middleware runs in production | 🟡 Low | Trivial |
| 12 | No rate limit on `/media/` streaming | 🟠 Medium | Medium |
| 13 | Celery results stored forever | 🟡 Low | Trivial |
| 14 | SSRF bypass via prefix allowlist | 🔴 High | Low |
| 15 | File deleted before DB commit | 🟠 Medium | Low |
| 16 | Bare `except:` silences errors | 🟠 Medium | Low |
| 17 | `DJANGO_DEBUG=True` in compose | 🔴 High | Trivial |
| 18 | No API versioning | 🟠 Medium | Low |
| 19 | Hardcoded hostname in sitemap | 🟡 Low | Low |
| 20 | No PWA offline fallback page | 🟠 Medium | Low |

**Severity key:** 🔴 High = security impact or data loss risk · 🟠 Medium = reliability or UX degradation · 🟡 Low = code quality / best practice
