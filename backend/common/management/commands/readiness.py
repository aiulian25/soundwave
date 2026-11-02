"""Prints whether the whole system is working, and exits non-zero when it is not."""

import json
import sys

from django.core.management.base import BaseCommand

from common.readiness import readiness_report


class Command(BaseCommand):
    help = 'Report database, Redis, worker and scheduler health'

    def handle(self, *args, **options):
        report = readiness_report()
        self.stdout.write(json.dumps(report, indent=2))
        if not report['ready']:
            sys.exit(1)
