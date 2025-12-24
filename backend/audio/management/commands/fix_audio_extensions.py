"""Management command to fix audio file extensions in database"""

from django.core.management.base import BaseCommand
from audio.models import Audio
import os


class Command(BaseCommand):
    help = 'Fix audio file extensions in database to match actual files'

    def handle(self, *args, **options):
        self.stdout.write('Checking for audio files with incorrect extensions...\n')
        
        # Find all audio entries with non-.m4a extensions
        problematic = Audio.objects.exclude(file_path__endswith='.m4a').exclude(file_path='')
        total = problematic.count()
        
        if total == 0:
            self.stdout.write(self.style.SUCCESS('✅ No files need fixing'))
            return
        
        self.stdout.write(f'Found {total} files with non-.m4a extensions\n')
        
        fixed_count = 0
        missing_count = 0
        
        for audio in problematic:
            old_path = audio.file_path
            
            # Try different extensions that might be in database
            for ext in ['.webm', '.opus', '.mp3', '.ogg', '.wav']:
                if old_path.endswith(ext):
                    # Try .m4a version (our post-processor creates .m4a files)
                    new_path = old_path[:-len(ext)] + '.m4a'
                    full_path = f"/app/audio/{new_path}"
                    
                    if os.path.exists(full_path):
                        audio.file_path = new_path
                        audio.save()
                        size = os.path.getsize(full_path)
                        self.stdout.write(
                            self.style.SUCCESS(
                                f'✅ Fixed: {audio.youtube_id} ({size/1024/1024:.1f} MB)'
                            )
                        )
                        fixed_count += 1
                    else:
                        # Check if original file exists
                        old_full_path = f"/app/audio/{old_path}"
                        if os.path.exists(old_full_path):
                            self.stdout.write(
                                self.style.WARNING(
                                    f'⚠️  File exists but with wrong extension: {audio.youtube_id}'
                                )
                            )
                        else:
                            self.stdout.write(
                                self.style.ERROR(
                                    f'❌ File missing: {audio.youtube_id}'
                                )
                            )
                            missing_count += 1
                    break
        
        self.stdout.write('\n' + '='*50)
        self.stdout.write(self.style.SUCCESS(f'✅ Fixed: {fixed_count} file(s)'))
        if missing_count > 0:
            self.stdout.write(self.style.ERROR(f'❌ Missing: {missing_count} file(s)'))
        self.stdout.write('='*50)
