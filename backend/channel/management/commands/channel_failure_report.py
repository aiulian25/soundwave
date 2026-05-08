"""Admin diagnostics report for failing YouTube channel subscriptions."""

from django.core.management.base import BaseCommand
from channel.models import Channel
from task.tasks import is_invalid_channel_subscription_error


class Command(BaseCommand):
    help = 'Show failing channel subscriptions and recommended remediation steps'

    def add_arguments(self, parser):
        parser.add_argument(
            '--owner',
            type=str,
            default='',
            help='Optional username filter',
        )
        parser.add_argument(
            '--only-disabled',
            action='store_true',
            help='Show only auto-disabled subscriptions',
        )

    def handle(self, *args, **options):
        owner = options.get('owner')
        only_disabled = options.get('only_disabled')

        queryset = Channel.objects.select_related('owner').filter(sync_status='failed')

        if owner:
            queryset = queryset.filter(owner__username=owner)

        if only_disabled:
            queryset = queryset.filter(auto_disabled=True)

        queryset = queryset.order_by('-consecutive_sync_failures', 'owner__username', 'channel_name')

        self.stdout.write('\n' + '=' * 100)
        self.stdout.write('CHANNEL FAILURE REPORT')
        self.stdout.write('=' * 100)

        if not queryset.exists():
            self.stdout.write('No failing channel subscriptions found with current filters.')
            return

        self.stdout.write(
            f'Found {queryset.count()} failing subscription(s). '
            'No local audio files are deleted by this report.'
        )
        self.stdout.write('')

        for channel in queryset:
            error_message = channel.error_message or ''
            is_invalid = is_invalid_channel_subscription_error(error_message)

            if channel.auto_disabled:
                recommendation = 'Use admin action to re-enable only after fixing channel ID/handle.'
            elif is_invalid:
                recommendation = (
                    'Likely invalid channel reference. Replace with canonical UC... channel ID '
                    'or valid @handle, then re-enable auto-download.'
                )
            else:
                recommendation = 'Temporary/transient error. Keep subscribed and retry sync.'

            self.stdout.write('-' * 100)
            self.stdout.write(f'Owner:            {channel.owner.username}')
            self.stdout.write(f'Channel:          {channel.channel_name}')
            self.stdout.write(f'Channel ID:       {channel.channel_id}')
            self.stdout.write(f'Subscribed:       {channel.subscribed}')
            self.stdout.write(f'Auto-download:    {channel.auto_download}')
            self.stdout.write(f'Auto-disabled:    {channel.auto_disabled}')
            self.stdout.write(f'Consec failures:  {channel.consecutive_sync_failures}')
            self.stdout.write(f'Last failed sync: {channel.last_failed_sync}')
            self.stdout.write(f'Error:            {error_message[:220]}')
            self.stdout.write(f'Recommendation:   {recommendation}')

        self.stdout.write('-' * 100)
        self.stdout.write('End of report.')
