"""Background tasks for shared infrastructure."""

from celery import shared_task

from common.readiness import record_heartbeat


@shared_task(name='common.record_heartbeat', ignore_result=True)
def heartbeat():
    """Scheduled by beat and run by a worker, so it proves the two are connected."""
    record_heartbeat()
