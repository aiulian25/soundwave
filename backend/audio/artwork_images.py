"""Reading and removing stored artwork: every persisted path and file is treated as untrusted."""

from io import BytesIO
from pathlib import Path

from django.conf import settings
from PIL import Image

ARTWORK_SUBDIRECTORY = 'artwork'
MAX_ARTWORK_BYTES = 20 * 1024 * 1024
MAX_ARTWORK_PIXELS = 25_000_000
MIME_TYPE_BY_FORMAT = {
    'JPEG': 'image/jpeg',
    'PNG': 'image/png',
    'WEBP': 'image/webp',
}
IMAGE_DECODE_ERRORS = (OSError, SyntaxError, ValueError, Image.DecompressionBombError)


class InvalidArtworkImage(Exception):
    """The stored artwork is missing, outside the artwork directory, or not an acceptable image."""


def _contained_file(local_path):
    """Resolve symlinks and `..` first, so containment is judged on the file actually opened."""
    media_root = Path(settings.MEDIA_ROOT)
    artwork_root = (media_root / ARTWORK_SUBDIRECTORY).resolve()
    resolved = (media_root / local_path).resolve()
    if not resolved.is_relative_to(artwork_root) or not resolved.is_file():
        raise InvalidArtworkImage('not a file in the artwork directory')
    return resolved


def delete_artwork_file(local_path):
    """Remove a kept image. Returns True if bytes were removed; a path outside the folder is left."""
    try:
        _contained_file(local_path).unlink()
    except (InvalidArtworkImage, OSError, ValueError):
        return False
    return True


def _read_bounded(path):
    with open(path, 'rb') as image_file:
        image_data = image_file.read(MAX_ARTWORK_BYTES + 1)
    if len(image_data) > MAX_ARTWORK_BYTES:
        raise InvalidArtworkImage('file too large')
    return image_data


def decoded_mime_type(image_data):
    """Decode rather than trust the extension; dimensions are checked before pixels are allocated."""
    try:
        with Image.open(BytesIO(image_data), formats=tuple(MIME_TYPE_BY_FORMAT)) as image:
            width, height = image.size
            if width * height > MAX_ARTWORK_PIXELS:
                raise InvalidArtworkImage('dimensions too large')
            image.load()
            return MIME_TYPE_BY_FORMAT[image.format]
    except IMAGE_DECODE_ERRORS as error:
        raise InvalidArtworkImage(type(error).__name__) from error


def load_artwork_image(artwork):
    """Return `(image_bytes, mime_type)` for an Artwork, or raise InvalidArtworkImage."""
    try:
        image_data = _read_bounded(_contained_file(artwork.local_path))
    except (OSError, ValueError) as error:
        raise InvalidArtworkImage(type(error).__name__) from error
    return image_data, decoded_mime_type(image_data)
