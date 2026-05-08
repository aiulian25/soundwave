"""
Diagnostic command for monitoring and troubleshooting sync tasks.
Usage: python manage.py sync_diagnostics
"""

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone
from playlist.models import Playlist
from channel.models import Channel
from download.models import DownloadQueue
from audio.models import Audio
from django.db.models import Count, Q
from datetime import timedelta
import redis
from django.conf import settings
import logging

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Diagnose and troubleshoot YouTube playlist/channel sync issues'

    def add_arguments(self, parser):
        parser.add_argument(
            '--verbose',
            action='store_true',
            help='Show detailed information about each subscription',
        )
        parser.add_argument(
            '--fix-stuck',
            action='store_true',
            help='Reset stuck downloads that are > 30 minutes in "downloading" status',
        )
        parser.add_argument(
            '--clear-redis',
            action='store_true',
            help='Clear Redis task queue (WARNING: cancels pending tasks)',
        )

    def handle(self, *args, **options):
        self.stdout.write('\n' + '='*70)
        self.stdout.write('  🔍 SOUNDWAVE SYNC DIAGNOSTICS')
        self.stdout.write('='*70 + '\n')
        
        verbose = options.get('verbose', False)
        fix_stuck = options.get('fix_stuck', False)
        clear_redis = options.get('clear_redis', False)
        
        try:
            # 1. Check Celery connectivity
            self.check_celery_health()
            
            # 2. Check Redis connectivity
            self.check_redis_health()
            
            # 3. Show subscription status
            self.show_subscription_status(verbose=verbose)
            
            # 4. Show download queue status
            self.show_download_queue_status(verbose=verbose)
            
            # 5. Show recent sync results
            self.show_recent_sync_results()
            
            # 6. Check for stuck downloads
            stuck_count = self.check_stuck_downloads()
            
            if fix_stuck and stuck_count > 0:
                self.fix_stuck_downloads()
            
            if clear_redis:
                self.clear_redis_queue()
            
            self.stdout.write('\n' + '='*70)
            self.stdout.write('✅ Diagnostics complete\n')
            
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'\n❌ Error: {str(e)}\n'))
            raise CommandError(str(e))

    def check_celery_health(self):
        """Check if Celery worker is running"""
        self.stdout.write(self.style.HTTP_INFO('\n📋 CELERY WORKER STATUS'))
        self.stdout.write('-' * 70)
        
        from celery.app.control import Inspect
        from config.celery import app
        
        try:
            inspector = Inspect(app=app)
            active_tasks = inspector.active()
            
            if active_tasks is None:
                self.stdout.write(self.style.WARNING('⚠️  No Celery workers connected!'))
                self.stdout.write('   → Celery worker process may not be running')
                self.stdout.write('   → Check Docker container logs: docker logs soundwave | grep celery')
            else:
                worker_count = len(active_tasks)
                self.stdout.write(self.style.SUCCESS(f'✅ {worker_count} Celery worker(s) connected'))
                
                total_active = sum(len(tasks) for tasks in active_tasks.values())
                self.stdout.write(f'   Active tasks: {total_active}')
        except Exception as e:
            self.stdout.write(self.style.WARNING(f'⚠️  Could not connect to Celery: {e}'))

    def check_redis_health(self):
        """Check if Redis is accessible"""
        self.stdout.write(self.style.HTTP_INFO('\n📊 REDIS STATUS'))
        self.stdout.write('-' * 70)
        
        try:
            redis_url = settings.CELERY_BROKER_URL
            # Parse connection info from URL
            if '@' in redis_url:
                auth_part, host_part = redis_url.rsplit('@', 1)
                password = auth_part.split(':')[-1]
                host = host_part.split(':')[0]
                port = int(host_part.split(':')[1])
            else:
                password = settings.REDIS_PASSWORD if hasattr(settings, 'REDIS_PASSWORD') else None
                host = settings.REDIS_HOST
                port = 6379
            
            r = redis.Redis(host=host, port=port, password=password, db=0, socket_timeout=5)
            ping_response = r.ping()
            
            if ping_response:
                self.stdout.write(self.style.SUCCESS(f'✅ Redis is connected ({host}:{port})'))
                info = r.info()
                queue_size = r.llen('celery')
                self.stdout.write(f'   Memory usage: {info.get("used_memory_human", "unknown")}')
                self.stdout.write(f'   Celery queue size: {queue_size} tasks')
            else:
                self.stdout.write(self.style.ERROR('❌ Redis not responding'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'❌ Redis connection failed: {e}'))

    def show_subscription_status(self, verbose=False):
        """Show status of all subscriptions"""
        self.stdout.write(self.style.HTTP_INFO('\n📺 SUBSCRIPTION STATUS'))
        self.stdout.write('-' * 70)
        
        playlists = Playlist.objects.all()
        channels = Channel.objects.all()
        
        if not playlists and not channels:
            self.stdout.write('ℹ️  No subscriptions found')
            return
        
        # Playlists
        if playlists.exists():
            self.stdout.write(f'\n🎵 PLAYLISTS ({playlists.count()}):')
            for p in playlists:
                status_icon = {'success': '✅', 'pending': '⏳', 'syncing': '🔄', 'failed': '❌', 'stale': '⚠️'}.get(p.sync_status, '?')
                auto_dl = '📥 auto' if p.auto_download else '⏸️  manual'
                
                line = f'   {status_icon} {p.title[:40]:<40} [{auto_dl}]'
                self.stdout.write(line)
                
                if verbose:
                    self.stdout.write(f'      Owner: {p.owner.username} | Items: {p.item_count} | Downloaded: {p.downloaded_count}')
                    if p.error_message:
                        self.stdout.write(f'      Error: {p.error_message[:80]}')
                    self.stdout.write(f'      Last sync: {p.last_refresh or "never"}')
        
        # Channels
        if channels.exists():
            self.stdout.write(f'\n📻 CHANNELS ({channels.count()}):')
            for c in channels:
                status_icon = {'success': '✅', 'pending': '⏳', 'syncing': '🔄', 'failed': '❌', 'stale': '⚠️'}.get(c.sync_status, '?')
                auto_dl = '📥 auto' if c.auto_download else '⏸️  manual'
                
                line = f'   {status_icon} {c.channel_name[:40]:<40} [{auto_dl}]'
                self.stdout.write(line)
                
                if verbose:
                    self.stdout.write(f'      Owner: {c.owner.username} | Downloaded: {c.downloaded_count}')
                    if c.error_message:
                        self.stdout.write(f'      Error: {c.error_message[:80]}')
                    self.stdout.write(f'      Last sync: {c.last_refreshed}')

    def show_download_queue_status(self, verbose=False):
        """Show download queue status"""
        self.stdout.write(self.style.HTTP_INFO('\n⬇️  DOWNLOAD QUEUE STATUS'))
        self.stdout.write('-' * 70)
        
        queue_stats = DownloadQueue.objects.aggregate(
            pending=Count('id', filter=Q(status='pending')),
            downloading=Count('id', filter=Q(status='downloading')),
            completed=Count('id', filter=Q(status='completed')),
            failed=Count('id', filter=Q(status='failed')),
        )
        
        self.stdout.write(f'   ⏳ Pending: {queue_stats["pending"]}')
        self.stdout.write(f'   🔄 Downloading: {queue_stats["downloading"]}')
        self.stdout.write(f'   ✅ Completed: {queue_stats["completed"]}')
        self.stdout.write(f'   ❌ Failed: {queue_stats["failed"]}')
        
        if queue_stats["failed"] > 0 and verbose:
            self.stdout.write('\n   Recent failures:')
            failed_items = DownloadQueue.objects.filter(status='failed').order_by('-added_date')[:5]
            for item in failed_items:
                self.stdout.write(f'      • {item.title[:50]} - {item.error_message[:60]}')

    def show_recent_sync_results(self):
        """Show recent sync results from logs"""
        self.stdout.write(self.style.HTTP_INFO('\n📈 RECENT SYNC ACTIVITY'))
        self.stdout.write('-' * 70)
        
        from datetime import timedelta
        from django.utils import timezone
        
        now = timezone.now()
        one_hour_ago = now - timedelta(hours=1)
        
        playlists = Playlist.objects.filter(last_refresh__gte=one_hour_ago).order_by('-last_refresh')[:5]
        
        if playlists.exists():
            self.stdout.write('   Recent playlist syncs:')
            for p in playlists:
                elapsed = (now - p.last_refresh).total_seconds() if p.last_refresh else None
                if elapsed:
                    if elapsed < 60:
                        time_str = f'{int(elapsed)}s ago'
                    elif elapsed < 3600:
                        time_str = f'{int(elapsed/60)}m ago'
                    else:
                        time_str = f'{int(elapsed/3600)}h ago'
                else:
                    time_str = 'never'
                
                self.stdout.write(f'      • {p.title[:40]:<40} - {time_str} ({p.sync_status})')

    def check_stuck_downloads(self):
        """Check for downloads stuck in 'downloading' state"""
        self.stdout.write(self.style.HTTP_INFO('\n⚠️  STUCK DOWNLOADS CHECK'))
        self.stdout.write('-' * 70)
        
        thirty_min_ago = timezone.now() - timedelta(minutes=30)
        
        stuck = DownloadQueue.objects.filter(
            status='downloading',
            started_date__lt=thirty_min_ago
        )
        
        if not stuck.exists():
            self.stdout.write('   ✅ No stuck downloads detected')
            return 0
        
        count = stuck.count()
        self.stdout.write(self.style.WARNING(f'   ⚠️  Found {count} stuck download(s)'))
        
        for item in stuck[:5]:
            elapsed_min = (timezone.now() - item.started_date).total_seconds() / 60
            self.stdout.write(f'      • {item.title[:50]} - stuck for {int(elapsed_min)}min')
        
        return count

    def fix_stuck_downloads(self):
        """Reset stuck downloads to 'pending' status"""
        self.stdout.write(self.style.HTTP_INFO('\n🔧 FIXING STUCK DOWNLOADS'))
        self.stdout.write('-' * 70)
        
        thirty_min_ago = timezone.now() - timedelta(minutes=30)
        
        stuck = DownloadQueue.objects.filter(
            status='downloading',
            started_date__lt=thirty_min_ago
        )
        
        count = stuck.update(
            status='pending',
            error_message='Reset by diagnostics after being stuck for > 30min',
            started_date=None
        )
        
        self.stdout.write(self.style.SUCCESS(f'   ✅ Fixed {count} stuck download(s)'))

    def clear_redis_queue(self):
        """Clear Redis task queue"""
        self.stdout.write(self.style.WARNING('\n🚨 CLEARING REDIS QUEUE'))
        self.stdout.write('-' * 70)
        self.stdout.write('   ⚠️  WARNING: This will cancel all pending and active tasks!')
        
        try:
            from config.celery import app
            app.control.purge()
            self.stdout.write(self.style.SUCCESS('   ✅ Redis queue cleared'))
        except Exception as e:
            self.stdout.write(self.style.ERROR(f'   ❌ Failed to clear queue: {e}'))
