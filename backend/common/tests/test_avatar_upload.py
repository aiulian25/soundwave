"""APP-09: avatar uploads are validated by magic bytes and re-encoded through
Pillow, rejecting renamed/polyglot/SVG/oversized files.

Run: python manage.py test common.tests --settings=config.settings_test
"""

from io import BytesIO

from django.test import TestCase
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient
from PIL import Image

from user.models import Account
from user.avatar_utils import process_avatar_image, InvalidAvatarImage, MAX_DIMENSION


def make_image_bytes(fmt='PNG', size=(64, 64), color=(10, 120, 200)):
    img = Image.new('RGB', size, color)
    buf = BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


class AvatarProcessingTests(TestCase):
    def test_valid_png_processed(self):
        data, ext = process_avatar_image(make_image_bytes('PNG'))
        self.assertEqual(ext, '.png')
        self.assertEqual(Image.open(BytesIO(data)).format, 'PNG')

    def test_valid_jpeg_processed(self):
        data, ext = process_avatar_image(make_image_bytes('JPEG'))
        self.assertEqual(ext, '.jpg')
        self.assertEqual(Image.open(BytesIO(data)).format, 'JPEG')

    def test_gif_normalized_to_png(self):
        data, ext = process_avatar_image(make_image_bytes('GIF'))
        self.assertEqual(ext, '.png')  # animation/vector stripped
        self.assertEqual(Image.open(BytesIO(data)).format, 'PNG')

    def test_renamed_text_file_rejected(self):
        with self.assertRaises(InvalidAvatarImage) as cm:
            process_avatar_image(b'this is definitely not an image' * 10)
        self.assertEqual(cm.exception.code, 'invalid_image')

    def test_svg_rejected(self):
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        with self.assertRaises(InvalidAvatarImage):
            process_avatar_image(svg)

    def test_polyglot_payload_is_stripped(self):
        polyglot = make_image_bytes('PNG') + b'<?php system($_GET[0]); ?>'
        data, ext = process_avatar_image(polyglot)
        self.assertNotIn(b'<?php', data)  # re-encoded, trailing payload gone

    def test_oversized_dimensions_downscaled(self):
        data, ext = process_avatar_image(make_image_bytes('PNG', size=(4000, 3000)))
        w, h = Image.open(BytesIO(data)).size
        self.assertLessEqual(max(w, h), MAX_DIMENSION)


class AvatarUploadViewTests(TestCase):
    def setUp(self):
        self.user = Account.objects.create_user('avataruser', 'av@test.local', 'Pw_2026!aA')
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_valid_upload_accepted(self):
        upload = SimpleUploadedFile('a.png', make_image_bytes('PNG'), content_type='image/png')
        resp = self.client.post('/api/user/avatar/upload/', {'avatar': upload}, format='multipart')
        self.assertEqual(resp.status_code, 200)
        self.user.refresh_from_db()
        self.assertTrue(self.user.avatar and self.user.avatar.endswith('.png'))

    def test_renamed_file_with_image_content_type_rejected(self):
        # Lying Content-Type must not bypass validation (the core APP-09 fix).
        upload = SimpleUploadedFile('evil.png', b'MZ\x90\x00 not an image', content_type='image/png')
        resp = self.client.post('/api/user/avatar/upload/', {'avatar': upload}, format='multipart')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json().get('code'), 'invalid_image')
