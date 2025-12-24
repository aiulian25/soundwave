"""ID3 tag service for reading and writing audio metadata with broad codec support"""
import logging
from pathlib import Path
from typing import Dict, Any, Optional
from mutagen.mp4 import MP4, MP4Cover
from mutagen.id3 import ID3, APIC, TIT2, TPE1, TALB, TPE2, TDRC, TCON, TRCK, TPOS
from mutagen.flac import FLAC, Picture
from mutagen.oggvorbis import OggVorbis
from mutagen.oggopus import OggOpus
from mutagen.wavpack import WavPack
from mutagen.musepack import Musepack
from mutagen.monkeysaudio import MonkeysAudio
from mutagen.aiff import AIFF
from mutagen.wave import WAVE
from mutagen.dsf import DSF
from mutagen.dsdiff import DSDIFF
from mutagen.mp3 import MP3
import base64

logger = logging.getLogger(__name__)


class ID3TagService:
    """Service for reading and writing ID3 tags with broad codec support including DSD"""
    
    SUPPORTED_FORMATS = {
        # Lossy formats
        '.mp3': 'MP3',
        '.m4a': 'MP4',
        '.m4b': 'MP4',
        '.m4p': 'MP4',
        '.mp4': 'MP4',
        '.ogg': 'OGG',
        '.oga': 'OGG',
        '.opus': 'OPUS',
        '.mpc': 'MUSEPACK',
        
        # Lossless formats
        '.flac': 'FLAC',
        '.wv': 'WAVPACK',
        '.ape': 'APE',
        '.aiff': 'AIFF',
        '.aif': 'AIFF',
        '.aifc': 'AIFF',
        '.wav': 'WAVE',
        
        # High-resolution DSD formats
        '.dsf': 'DSF',
        '.dff': 'DSDIFF',
    }
    
    def read_tags(self, file_path: str) -> Optional[Dict[str, Any]]:
        """
        Read tags from audio file
        
        Supports: MP3, MP4/M4A, FLAC, OGG Vorbis, Opus, WavPack, APE, Musepack, 
                  DSF, DFF (DSDIFF), AIFF, WAV
        
        Args:
            file_path: Path to audio file
            
        Returns:
            Dictionary with tag information or None if error
        """
        try:
            path = Path(file_path)
            if not path.exists():
                logger.error(f"File not found: {file_path}")
                return None
            
            suffix = path.suffix.lower()
            format_type = self.SUPPORTED_FORMATS.get(suffix)
            
            if not format_type:
                logger.warning(f"Unsupported audio format: {suffix}")
                return None
            
            # Handle different audio formats
            if format_type == 'MP4':
                audio = MP4(file_path)
                tags = self._read_mp4_tags(audio)
            elif format_type == 'MP3':
                audio = MP3(file_path)
                tags = self._read_id3_tags(audio)
            elif format_type == 'FLAC':
                audio = FLAC(file_path)
                tags = self._read_vorbis_tags(audio)
            elif format_type in ['OGG', 'OPUS']:
                audio = OggVorbis(file_path) if format_type == 'OGG' else OggOpus(file_path)
                tags = self._read_vorbis_tags(audio)
            elif format_type == 'WAVPACK':
                audio = WavPack(file_path)
                tags = self._read_apev2_tags(audio)
            elif format_type == 'APE':
                audio = MonkeysAudio(file_path)
                tags = self._read_apev2_tags(audio)
            elif format_type == 'MUSEPACK':
                audio = Musepack(file_path)
                tags = self._read_apev2_tags(audio)
            elif format_type == 'DSF':
                audio = DSF(file_path)
                tags = self._read_dsf_tags(audio)
            elif format_type == 'DSDIFF':
                audio = DSDIFF(file_path)
                tags = self._read_dsdiff_tags(audio)
            elif format_type == 'AIFF':
                audio = AIFF(file_path)
                tags = self._read_id3_tags(audio)
            elif format_type == 'WAVE':
                audio = WAVE(file_path)
                tags = self._read_id3_tags(audio)
            else:
                logger.warning(f"Unsupported format type: {format_type}")
                return None
            
            # Add audio properties
            if hasattr(audio, 'info'):
                tags['duration'] = getattr(audio.info, 'length', 0)
                tags['bitrate'] = getattr(audio.info, 'bitrate', 0)
                # DSD-specific properties
                if format_type in ['DSF', 'DSDIFF']:
                    tags['sample_rate'] = getattr(audio.info, 'sample_rate', 0)
                    tags['channels'] = getattr(audio.info, 'channels', 0)
                    tags['bits_per_sample'] = getattr(audio.info, 'bits_per_sample', 1)
            
            tags['format'] = format_type
            
            return tags
            
        except Exception as e:
            logger.error(f"Error reading tags from {file_path}: {e}")
            return None
    
    def _read_mp4_tags(self, audio: MP4) -> Dict[str, Any]:
        """Read tags from MP4/M4A file"""
        tags = {
            'title': audio.get('\xa9nam', [''])[0] if '\xa9nam' in audio else '',
            'artist': audio.get('\xa9ART', [''])[0] if '\xa9ART' in audio else '',
            'album': audio.get('\xa9alb', [''])[0] if '\xa9alb' in audio else '',
            'album_artist': audio.get('aART', [''])[0] if 'aART' in audio else '',
            'year': audio.get('\xa9day', [''])[0] if '\xa9day' in audio else '',
            'genre': audio.get('\xa9gen', [''])[0] if '\xa9gen' in audio else '',
            'has_cover': 'covr' in audio,
        }
        
        # Track number
        if 'trkn' in audio:
            track_info = audio['trkn'][0]
            tags['track_number'] = track_info[0] if track_info[0] > 0 else None
        
        # Disc number
        if 'disk' in audio:
            disc_info = audio['disk'][0]
            tags['disc_number'] = disc_info[0] if disc_info[0] > 0 else None
        
        return tags
    
    def _read_id3_tags(self, audio) -> Dict[str, Any]:
        """Read tags from ID3 format (MP3, AIFF, WAV, DSF, DFF)"""
        tags = self._empty_tags()
        
        if not hasattr(audio, 'tags') or audio.tags is None:
            return tags
        
        id3 = audio.tags
        
        tags['title'] = str(id3.get('TIT2', ''))
        tags['artist'] = str(id3.get('TPE1', ''))
        tags['album'] = str(id3.get('TALB', ''))
        tags['album_artist'] = str(id3.get('TPE2', ''))
        tags['genre'] = str(id3.get('TCON', ''))
        
        # Year
        if 'TDRC' in id3:
            tags['year'] = str(id3['TDRC'])
        
        # Track number
        if 'TRCK' in id3:
            track_str = str(id3['TRCK'])
            try:
                tags['track_number'] = int(track_str.split('/')[0]) if '/' in track_str else int(track_str)
            except ValueError:
                pass
        
        # Disc number
        if 'TPOS' in id3:
            disc_str = str(id3['TPOS'])
            try:
                tags['disc_number'] = int(disc_str.split('/')[0]) if '/' in disc_str else int(disc_str)
            except ValueError:
                pass
        
        # Check for cover art
        tags['has_cover'] = any(key.startswith('APIC') for key in id3.keys())
        
        return tags
    
    def _read_vorbis_tags(self, audio) -> Dict[str, Any]:
        """Read tags from Vorbis comment format (FLAC, OGG, Opus)"""
        tags = {
            'title': audio.get('title', [''])[0],
            'artist': audio.get('artist', [''])[0],
            'album': audio.get('album', [''])[0],
            'album_artist': audio.get('albumartist', [''])[0] or audio.get('album artist', [''])[0],
            'year': audio.get('date', [''])[0] or audio.get('year', [''])[0],
            'genre': audio.get('genre', [''])[0],
            'has_cover': False,
        }
        
        # Check for embedded pictures (FLAC)
        if hasattr(audio, 'pictures'):
            tags['has_cover'] = len(audio.pictures) > 0
        elif 'metadata_block_picture' in audio:
            tags['has_cover'] = True
        
        # Track number
        track = audio.get('tracknumber', [''])[0]
        if track:
            try:
                tags['track_number'] = int(track.split('/')[0]) if '/' in track else int(track)
            except ValueError:
                pass
        
        # Disc number
        disc = audio.get('discnumber', [''])[0]
        if disc:
            try:
                tags['disc_number'] = int(disc.split('/')[0]) if '/' in disc else int(disc)
            except ValueError:
                pass
        
        return tags
    
    def _read_apev2_tags(self, audio) -> Dict[str, Any]:
        """Read tags from APEv2 format (WavPack, APE, Musepack)"""
        tags = {
            'title': str(audio.get('Title', [''])[0]) if audio.get('Title') else '',
            'artist': str(audio.get('Artist', [''])[0]) if audio.get('Artist') else '',
            'album': str(audio.get('Album', [''])[0]) if audio.get('Album') else '',
            'album_artist': str(audio.get('Album Artist', [''])[0]) if audio.get('Album Artist') else '',
            'year': str(audio.get('Year', [''])[0]) if audio.get('Year') else '',
            'genre': str(audio.get('Genre', [''])[0]) if audio.get('Genre') else '',
            'has_cover': audio.get('Cover Art (Front)') is not None,
        }
        
        # Track number
        track = audio.get('Track')
        if track:
            track_str = str(track[0]) if isinstance(track, list) else str(track)
            try:
                tags['track_number'] = int(track_str.split('/')[0]) if '/' in track_str else int(track_str)
            except ValueError:
                pass
        
        # Disc number
        disc = audio.get('Disc')
        if disc:
            disc_str = str(disc[0]) if isinstance(disc, list) else str(disc)
            try:
                tags['disc_number'] = int(disc_str.split('/')[0]) if '/' in disc_str else int(disc_str)
            except ValueError:
                pass
        
        return tags
    
    def _read_dsf_tags(self, audio: DSF) -> Dict[str, Any]:
        """Read tags from DSF file (DSD Stream File)"""
        # DSF uses ID3v2 tags
        if hasattr(audio, 'tags') and audio.tags:
            return self._read_id3_tags(audio)
        return self._empty_tags()
    
    def _read_dsdiff_tags(self, audio: DSDIFF) -> Dict[str, Any]:
        """Read tags from DSDIFF/DFF file"""
        # DSDIFF uses ID3v2 tags
        if hasattr(audio, 'tags') and audio.tags:
            return self._read_id3_tags(audio)
        return self._empty_tags()
    
    def _empty_tags(self) -> Dict[str, Any]:
        """Return empty tags structure"""
        return {
            'title': '',
            'artist': '',
            'album': '',
            'album_artist': '',
            'year': '',
            'genre': '',
            'track_number': None,
            'disc_number': None,
            'has_cover': False,
        }
    
    def write_tags(self, file_path: str, tags: Dict[str, Any]) -> bool:
        """
        Write tags to audio file
        
        Args:
            file_path: Path to audio file
            tags: Dictionary with tag values
            
        Returns:
            True if successful, False otherwise
        """
        try:
            path = Path(file_path)
            if not path.exists():
                logger.error(f"File not found: {file_path}")
                return False
            
            suffix = path.suffix.lower()
            format_type = self.SUPPORTED_FORMATS.get(suffix)
            
            if not format_type:
                logger.warning(f"Unsupported audio format for writing: {suffix}")
                return False
            
            # Handle different audio formats
            if format_type == 'MP4':
                audio = MP4(file_path)
                self._write_mp4_tags(audio, tags)
            elif format_type == 'MP3':
                audio = MP3(file_path)
                if audio.tags is None:
                    audio.add_tags()
                self._write_id3_tags(audio.tags, tags)
            elif format_type in ['FLAC', 'OGG', 'OPUS']:
                if format_type == 'FLAC':
                    audio = FLAC(file_path)
                elif format_type == 'OGG':
                    audio = OggVorbis(file_path)
                else:
                    audio = OggOpus(file_path)
                self._write_vorbis_tags(audio, tags)
            elif format_type in ['WAVPACK', 'APE', 'MUSEPACK']:
                if format_type == 'WAVPACK':
                    audio = WavPack(file_path)
                elif format_type == 'APE':
                    audio = MonkeysAudio(file_path)
                else:
                    audio = Musepack(file_path)
                self._write_apev2_tags(audio, tags)
            elif format_type in ['DSF', 'DSDIFF']:
                if format_type == 'DSF':
                    audio = DSF(file_path)
                else:
                    audio = DSDIFF(file_path)
                if audio.tags is None:
                    audio.add_tags()
                self._write_id3_tags(audio.tags, tags)
            elif format_type in ['AIFF', 'WAVE']:
                if format_type == 'AIFF':
                    audio = AIFF(file_path)
                else:
                    audio = WAVE(file_path)
                if audio.tags is None:
                    audio.add_tags()
                self._write_id3_tags(audio.tags, tags)
            else:
                logger.warning(f"Write not implemented for: {format_type}")
                return False
            
            audio.save()
            logger.info(f"Successfully wrote tags to {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error writing tags to {file_path}: {e}")
            return False
    
    def _write_mp4_tags(self, audio: MP4, tags: Dict[str, Any]) -> None:
        """Write tags to MP4/M4A file"""
        if 'title' in tags:
            audio['\xa9nam'] = tags['title']
        if 'artist' in tags:
            audio['\xa9ART'] = tags['artist']
        if 'album' in tags:
            audio['\xa9alb'] = tags['album']
        if 'album_artist' in tags:
            audio['aART'] = tags['album_artist']
        if 'year' in tags:
            audio['\xa9day'] = tags['year']
        if 'genre' in tags:
            audio['\xa9gen'] = tags['genre']
        if 'track_number' in tags:
            current_disc = audio.get('trkn', [(0, 0)])[0]
            audio['trkn'] = [(tags['track_number'], current_disc[1] if current_disc else 0)]
        if 'disc_number' in tags:
            current_disc = audio.get('disk', [(0, 0)])[0]
            audio['disk'] = [(tags['disc_number'], current_disc[1] if current_disc else 0)]
    
    def _write_id3_tags(self, id3: ID3, tags: Dict[str, Any]) -> None:
        """Write tags to ID3 format"""
        if 'title' in tags:
            id3.add(TIT2(encoding=3, text=tags['title']))
        if 'artist' in tags:
            id3.add(TPE1(encoding=3, text=tags['artist']))
        if 'album' in tags:
            id3.add(TALB(encoding=3, text=tags['album']))
        if 'album_artist' in tags:
            id3.add(TPE2(encoding=3, text=tags['album_artist']))
        if 'year' in tags:
            id3.add(TDRC(encoding=3, text=tags['year']))
        if 'genre' in tags:
            id3.add(TCON(encoding=3, text=tags['genre']))
        if 'track_number' in tags:
            id3.add(TRCK(encoding=3, text=str(tags['track_number'])))
        if 'disc_number' in tags:
            id3.add(TPOS(encoding=3, text=str(tags['disc_number'])))
    
    def _write_vorbis_tags(self, audio, tags: Dict[str, Any]) -> None:
        """Write tags to Vorbis comment format (FLAC, OGG, Opus)"""
        if 'title' in tags:
            audio['title'] = tags['title']
        if 'artist' in tags:
            audio['artist'] = tags['artist']
        if 'album' in tags:
            audio['album'] = tags['album']
        if 'album_artist' in tags:
            audio['albumartist'] = tags['album_artist']
        if 'year' in tags:
            audio['date'] = tags['year']
        if 'genre' in tags:
            audio['genre'] = tags['genre']
        if 'track_number' in tags:
            audio['tracknumber'] = str(tags['track_number'])
        if 'disc_number' in tags:
            audio['discnumber'] = str(tags['disc_number'])
    
    def _write_apev2_tags(self, audio, tags: Dict[str, Any]) -> None:
        """Write tags to APEv2 format (WavPack, APE, Musepack)"""
        if 'title' in tags:
            audio['Title'] = tags['title']
        if 'artist' in tags:
            audio['Artist'] = tags['artist']
        if 'album' in tags:
            audio['Album'] = tags['album']
        if 'album_artist' in tags:
            audio['Album Artist'] = tags['album_artist']
        if 'year' in tags:
            audio['Year'] = tags['year']
        if 'genre' in tags:
            audio['Genre'] = tags['genre']
        if 'track_number' in tags:
            audio['Track'] = str(tags['track_number'])
        if 'disc_number' in tags:
            audio['Disc'] = str(tags['disc_number'])
    
    def embed_cover_art(self, file_path: str, image_data: bytes, mime_type: str = 'image/jpeg') -> bool:
        """
        Embed cover art in audio file
        
        Args:
            file_path: Path to audio file
            image_data: Image data as bytes
            mime_type: MIME type of image (image/jpeg or image/png)
            
        Returns:
            True if successful, False otherwise
        """
        try:
            path = Path(file_path)
            if not path.exists():
                logger.error(f"File not found: {file_path}")
                return False
            
            suffix = path.suffix.lower()
            format_type = self.SUPPORTED_FORMATS.get(suffix)
            
            if not format_type:
                logger.warning(f"Unsupported format for cover art: {suffix}")
                return False
            
            # Handle different audio formats
            if format_type == 'MP4':
                audio = MP4(file_path)
                if mime_type == 'image/png':
                    cover = MP4Cover(image_data, imageformat=MP4Cover.FORMAT_PNG)
                else:
                    cover = MP4Cover(image_data, imageformat=MP4Cover.FORMAT_JPEG)
                audio['covr'] = [cover]
            elif format_type in ['MP3', 'AIFF', 'WAVE', 'DSF', 'DSDIFF']:
                # All these formats support ID3v2
                if format_type == 'MP3':
                    audio = MP3(file_path)
                elif format_type == 'DSF':
                    audio = DSF(file_path)
                elif format_type == 'DSDIFF':
                    audio = DSDIFF(file_path)
                elif format_type == 'AIFF':
                    audio = AIFF(file_path)
                else:
                    audio = WAVE(file_path)
                
                if audio.tags is None:
                    audio.add_tags()
                
                # Remove existing APIC frames
                audio.tags.delall('APIC')
                
                # Add new cover
                audio.tags.add(APIC(
                    encoding=3,
                    mime=mime_type,
                    type=3,  # Cover (front)
                    desc='Cover',
                    data=image_data
                ))
            elif format_type in ['FLAC', 'OGG', 'OPUS']:
                if format_type == 'FLAC':
                    audio = FLAC(file_path)
                elif format_type == 'OGG':
                    audio = OggVorbis(file_path)
                else:
                    audio = OggOpus(file_path)
                
                # Create picture
                picture = Picture()
                picture.type = 3  # Cover (front)
                picture.mime = mime_type
                picture.desc = 'Cover'
                picture.data = image_data
                
                if format_type == 'FLAC':
                    # FLAC has native picture support
                    audio.clear_pictures()
                    audio.add_picture(picture)
                else:
                    # OGG/Opus use base64 encoded metadata block
                    if 'metadata_block_picture' in audio:
                        del audio['metadata_block_picture']
                    encoded = base64.b64encode(picture.write()).decode('ascii')
                    audio['metadata_block_picture'] = [encoded]
            elif format_type in ['WAVPACK', 'APE', 'MUSEPACK']:
                if format_type == 'WAVPACK':
                    audio = WavPack(file_path)
                elif format_type == 'APE':
                    audio = MonkeysAudio(file_path)
                else:
                    audio = Musepack(file_path)
                
                # APEv2 stores cover as binary item
                audio['Cover Art (Front)'] = image_data
            else:
                logger.warning(f"Cover art embedding not implemented for: {format_type}")
                return False
            
            audio.save()
            logger.info(f"Successfully embedded cover art in {file_path}")
            return True
            
        except Exception as e:
            logger.error(f"Error embedding cover art in {file_path}: {e}")
            return False
    
    def extract_cover_art(self, file_path: str) -> Optional[bytes]:
        """
        Extract cover art from audio file
        
        Args:
            file_path: Path to audio file
            
        Returns:
            Cover art data as bytes or None if not found
        """
        try:
            path = Path(file_path)
            if not path.exists():
                logger.error(f"File not found: {file_path}")
                return None
            
            suffix = path.suffix.lower()
            format_type = self.SUPPORTED_FORMATS.get(suffix)
            
            if not format_type:
                return None
            
            # Handle different audio formats
            if format_type == 'MP4':
                audio = MP4(file_path)
                covers = audio.get('covr', [])
                if covers:
                    return bytes(covers[0])
            elif format_type in ['MP3', 'AIFF', 'WAVE', 'DSF', 'DSDIFF']:
                if format_type == 'MP3':
                    audio = MP3(file_path)
                elif format_type == 'DSF':
                    audio = DSF(file_path)
                elif format_type == 'DSDIFF':
                    audio = DSDIFF(file_path)
                elif format_type == 'AIFF':
                    audio = AIFF(file_path)
                else:
                    audio = WAVE(file_path)
                
                if audio.tags:
                    for key in audio.tags.keys():
                        if key.startswith('APIC'):
                            return audio.tags[key].data
            elif format_type == 'FLAC':
                audio = FLAC(file_path)
                if audio.pictures:
                    return audio.pictures[0].data
            elif format_type in ['OGG', 'OPUS']:
                if format_type == 'OGG':
                    audio = OggVorbis(file_path)
                else:
                    audio = OggOpus(file_path)
                
                # Check for base64 encoded picture
                if 'metadata_block_picture' in audio:
                    encoded = audio['metadata_block_picture'][0]
                    picture_data = base64.b64decode(encoded)
                    picture = Picture(picture_data)
                    return picture.data
            elif format_type in ['WAVPACK', 'APE', 'MUSEPACK']:
                if format_type == 'WAVPACK':
                    audio = WavPack(file_path)
                elif format_type == 'APE':
                    audio = MonkeysAudio(file_path)
                else:
                    audio = Musepack(file_path)
                
                cover = audio.get('Cover Art (Front)')
                if cover:
                    return bytes(cover[0]) if isinstance(cover, list) else bytes(cover)
            
            return None
            
        except Exception as e:
            logger.error(f"Error extracting cover art from {file_path}: {e}")
            return None
