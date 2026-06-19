"""Avatar image validation + normalization (APP-09).

Do not trust the client-supplied Content-Type or filename. Instead, decode the
bytes with Pillow (magic-byte validation), enforce a format whitelist and a pixel
cap, then re-encode — which strips EXIF/metadata, discards any appended payload
(polyglots), and removes animation. SVG and other non-raster inputs are rejected
because Pillow cannot decode them.
"""

from io import BytesIO

from PIL import Image, UnidentifiedImageError

# Largest stored avatar edge (downscale only, aspect preserved).
MAX_DIMENSION = 1024
# Reject absurd dimensions before decoding pixels (decompression-bomb guard).
MAX_PIXELS = 40_000_000  # 40 megapixels

# Verified Pillow input format -> (output format, extension).
# Animated/looping GIFs are normalized to a single static PNG frame.
_FORMAT_OUTPUT = {
    'JPEG': ('JPEG', '.jpg'),
    'PNG': ('PNG', '.png'),
    'WEBP': ('WEBP', '.webp'),
    'GIF': ('PNG', '.png'),
}


class InvalidAvatarImage(Exception):
    """Raised when an uploaded avatar is not an acceptable image.

    Carries a stable ``code`` (for SPA localization) and an English ``message``.
    """

    def __init__(self, code, message):
        self.code = code
        self.message = message
        super().__init__(message)


def process_avatar_image(raw_bytes):
    """Validate and re-encode avatar bytes.

    Returns ``(data: bytes, ext: str)`` for the normalized image, or raises
    :class:`InvalidAvatarImage`.
    """
    # 1) Magic-byte validation: it must be a decodable raster image.
    try:
        probe = Image.open(BytesIO(raw_bytes))
        probe.verify()
    except (UnidentifiedImageError, OSError, ValueError, Exception):
        raise InvalidAvatarImage('invalid_image', 'File is not a valid image.')

    fmt = (probe.format or '').upper()
    if fmt not in _FORMAT_OUTPUT:
        raise InvalidAvatarImage('unsupported_format', 'Unsupported image format. Use JPEG, PNG, GIF, or WebP.')

    # 2) Re-open (verify() leaves the object unusable). Check dimensions from the
    #    header BEFORE decoding pixels, then load.
    try:
        img = Image.open(BytesIO(raw_bytes))
        width, height = img.size
        if width * height > MAX_PIXELS:
            raise InvalidAvatarImage('invalid_image', 'Image dimensions are too large.')
        img.load()
    except InvalidAvatarImage:
        raise
    except Exception:
        raise InvalidAvatarImage('invalid_image', 'File is not a valid image.')

    out_format, ext = _FORMAT_OUTPUT[fmt]

    # 3) Cap dimensions (downscale only) and re-encode from scratch.
    img.thumbnail((MAX_DIMENSION, MAX_DIMENSION))
    buffer = BytesIO()
    try:
        if out_format == 'JPEG':
            img.convert('RGB').save(buffer, format='JPEG', quality=85, optimize=True)
        else:
            img.convert('RGBA').save(buffer, format=out_format)
    except Exception:
        raise InvalidAvatarImage('invalid_image', 'Could not process image.')

    return buffer.getvalue(), ext
