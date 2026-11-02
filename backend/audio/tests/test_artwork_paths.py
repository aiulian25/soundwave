"""SW-001: artwork writes and embedding must not reach outside the requester's library
or the artwork directory, at the API or in the worker.

Run: python manage.py test audio.tests.test_artwork_paths --settings=config.settings_test
"""
import shutil
import tempfile
import wave
from io import BytesIO
from pathlib import Path
from unittest.mock import patch

from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient, APIRequestFactory

from audio.artwork_images import InvalidArtworkImage, MAX_ARTWORK_PIXELS, load_artwork_image
from audio.id3_service import ID3TagService
from audio.models import Audio
from audio.models_artwork import Artwork
from audio.serializers_artwork import ArtworkSerializer
from audio.tasks_artwork import embed_artwork_in_audio
from channel.models import Channel
from user.models import Account

ARTWORK_ROOT = '/api/audio/api/artwork'
AUDIO_ARTWORK_ROOT = '/api/audio/api/audio-artwork'
OUTSIDE_MARKER = b'SYNTHETIC-OUTSIDE-ROOT-MARKER'
SHARED_CHANNEL_ID = 'UC_shared'
EMBED_DELAY = 'audio.views_artwork.embed_artwork_in_audio.delay'
TAG_WRITER = 'audio.tasks_artwork.ID3TagService.embed_cover_art'


def image_bytes(image_format='PNG', size=(4, 4)):
    buffer = BytesIO()
    Image.new('RGB', size, 'red').save(buffer, format=image_format)
    return buffer.getvalue()


def make_audio(owner, youtube_id, channel_id=SHARED_CHANNEL_ID):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=youtube_id,
        channel_id=channel_id,
        channel_name='Synthetic Channel',
        duration=1,
        file_path=f'{youtube_id}.wav',
        file_size=1,
        published_date=timezone.now(),
    )


def make_channel(owner, channel_id=SHARED_CHANNEL_ID):
    return Channel.objects.create(owner=owner, channel_id=channel_id, channel_name='Synthetic Channel')


class ArtworkBoundaryTestCase(TestCase):
    def setUp(self):
        self.media_root = Path(tempfile.mkdtemp())
        self.outside = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.media_root)
        self.addCleanup(shutil.rmtree, self.outside)
        settings_override = override_settings(MEDIA_ROOT=str(self.media_root))
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        self.artwork_dir = self.media_root / 'artwork'
        self.artwork_dir.mkdir()
        self.outside_file = self.outside / 'secret.txt'
        self.outside_file.write_bytes(OUTSIDE_MARKER)

        self.alice = Account.objects.create_user('alice', 'alice@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob', 'bob@test.local', 'Bobpw_2026!')
        self.audio = make_audio(self.alice, 'alice_track')
        self.bob_audio = make_audio(self.bob, 'bob_track')
        self._write_wav(self.audio)

        self.client = APIClient()
        self.client.force_authenticate(self.alice)

    def _write_wav(self, audio):
        with wave.open(str(self.media_root / audio.file_path), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(bytes(1600))

    def stored_artwork(self, name='cover.png', content=None, audio=None, **fields):
        (self.artwork_dir / name).write_bytes(image_bytes() if content is None else content)
        return self.artwork_row(f'artwork/{name}', audio=audio or self.audio, **fields)

    def artwork_row(self, local_path, **fields):
        fields.setdefault('audio', self.audio)
        return Artwork.objects.create(
            artwork_type='audio_cover',
            source='manual',
            url='https://example.test/cover.png',
            local_path=local_path,
            **fields,
        )

    def embed_url(self, audio=None):
        return f'{AUDIO_ARTWORK_ROOT}/{(audio or self.audio).pk}/embed_artwork/'

    def hostile_rows(self):
        link = self.artwork_dir / 'link.png'
        link.symlink_to(self.outside_file)
        return {
            'absolute': self.artwork_row(str(self.outside_file)),
            'traversal': self.artwork_row(f'../{self.outside.name}/secret.txt'),
            'artwork_traversal': self.artwork_row(f'artwork/../../{self.outside.name}/secret.txt'),
            'symlink': self.artwork_row('artwork/link.png'),
            'outside_artwork_dir': self.artwork_row(self.audio.file_path),
            'directory': self.artwork_row('artwork'),
            'not_an_image': self.stored_artwork('fake.png', content=OUTSIDE_MARKER),
            'missing': self.artwork_row('artwork/never-downloaded.png'),
        }


class ArtworkWriteTests(ArtworkBoundaryTestCase):
    def test_path_and_derived_fields_cannot_be_written(self):
        artwork = self.stored_artwork(width=4, height=4)
        response = self.client.patch(
            f'{ARTWORK_ROOT}/{artwork.pk}/',
            {'local_path': str(self.outside_file), 'width': 1, 'height': 1, 'priority': 7},
            format='json',
        )
        self.assertEqual(response.status_code, 200)
        artwork.refresh_from_db()
        self.assertEqual(artwork.local_path, 'artwork/cover.png')
        self.assertEqual((artwork.width, artwork.height), (4, 4))
        self.assertEqual(artwork.priority, 7, 'ordinary fields stay editable')

    def test_cannot_reparent_to_foreign_or_own_objects(self):
        artwork = self.stored_artwork()
        other_audio = make_audio(self.alice, 'alice_other')
        targets = {
            'foreign audio': {'audio': self.bob_audio.pk},
            'foreign channel': {'channel': make_channel(self.bob).pk},
            'own other audio': {'audio': other_audio.pk},
            'detached': {'audio': None},
        }
        for label, body in targets.items():
            with self.subTest(label):
                response = self.client.patch(f'{ARTWORK_ROOT}/{artwork.pk}/', body, format='json')
                self.assertEqual(response.status_code, 400, response.content)
                artwork.refresh_from_db()
                self.assertEqual(artwork.audio, self.audio)

    def test_resending_the_current_association_is_accepted(self):
        artwork = self.stored_artwork()
        response = self.client.patch(f'{ARTWORK_ROOT}/{artwork.pk}/', {'audio': self.audio.pk}, format='json')
        self.assertEqual(response.status_code, 200)

    def test_foreign_id_is_indistinguishable_from_a_missing_one(self):
        artwork = self.stored_artwork()
        url = f'{ARTWORK_ROOT}/{artwork.pk}/'
        foreign = self.client.patch(url, {'audio': self.bob_audio.pk}, format='json').json()
        missing = self.client.patch(url, {'audio': 999999}, format='json').json()
        self.assertEqual(
            foreign['audio'][0].replace(str(self.bob_audio.pk), 'ID'),
            missing['audio'][0].replace('999999', 'ID'),
        )

    def test_create_serializer_requires_one_owned_parent(self):
        # The collection route is shadowed today (audit step 11), so exercise the
        # serializer directly: it must already be safe when that route opens.
        request = APIRequestFactory().post('/')
        request.user = self.alice
        base = {'artwork_type': 'audio_cover', 'source': 'manual', 'url': 'https://example.test/a.png'}
        own_channel = make_channel(self.alice)
        cases = [
            ({'audio': self.audio.pk, 'local_path': str(self.outside_file)}, True),
            ({'channel': own_channel.pk}, True),
            ({'audio': self.bob_audio.pk}, False),
            ({}, False),
            ({'audio': self.audio.pk, 'channel': own_channel.pk}, False),
        ]
        for extra, expected in cases:
            with self.subTest(extra=extra):
                serializer = ArtworkSerializer(data={**base, **extra}, context={'request': request})
                self.assertEqual(serializer.is_valid(), expected, serializer.errors)
                if expected:
                    self.assertNotIn('local_path', serializer.validated_data)


class EmbedEntryTests(ArtworkBoundaryTestCase):
    def test_owned_cover_is_queued(self):
        artwork = self.stored_artwork()
        with patch(EMBED_DELAY) as delay:
            response = self.client.post(self.embed_url(), {'artwork_id': artwork.pk}, format='json')
        self.assertEqual(response.status_code, 200)
        delay.assert_called_once_with(self.audio.pk, artwork.pk)

    def test_without_id_the_task_picks_the_best(self):
        with patch(EMBED_DELAY) as delay:
            response = self.client.post(self.embed_url(), {}, format='json')
        self.assertEqual(response.status_code, 200)
        delay.assert_called_once_with(self.audio.pk)

    def test_foreign_or_unrelated_artwork_is_not_found(self):
        other_audio = make_audio(self.alice, 'alice_other')
        cases = {
            'other tenant': self.stored_artwork('bob.png', audio=self.bob_audio).pk,
            'other own track': self.stored_artwork('other.png', audio=other_audio).pk,
            'missing': 999999,
            'not a number': 'abc',
        }
        with patch(EMBED_DELAY) as delay:
            for label, artwork_id in cases.items():
                with self.subTest(label):
                    response = self.client.post(self.embed_url(), {'artwork_id': artwork_id}, format='json')
                    self.assertEqual(response.status_code, 404)
        delay.assert_not_called()

    def test_other_users_track_is_not_found(self):
        with patch(EMBED_DELAY) as delay:
            response = self.client.post(self.embed_url(self.bob_audio), {}, format='json')
        self.assertEqual(response.status_code, 404)
        delay.assert_not_called()

    def test_hostile_rows_are_refused_without_queueing(self):
        with patch(EMBED_DELAY) as delay:
            for label, artwork in self.hostile_rows().items():
                with self.subTest(label):
                    response = self.client.post(self.embed_url(), {'artwork_id': artwork.pk}, format='json')
                    self.assertEqual(response.status_code, 400)
                    self.assertNotIn(OUTSIDE_MARKER, response.content)
        delay.assert_not_called()

    def test_same_owner_channel_artwork_is_accepted_only_for_its_channel(self):
        (self.artwork_dir / 'channel.png').write_bytes(image_bytes())
        channel_artwork = self.artwork_row('artwork/channel.png', audio=None, channel=make_channel(self.alice))
        unrelated = make_audio(self.alice, 'alice_elsewhere', channel_id='UC_elsewhere')
        with patch(EMBED_DELAY) as delay:
            accepted = self.client.post(self.embed_url(), {'artwork_id': channel_artwork.pk}, format='json')
            refused = self.client.post(self.embed_url(unrelated), {'artwork_id': channel_artwork.pk}, format='json')
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(refused.status_code, 404)
        delay.assert_called_once_with(self.audio.pk, channel_artwork.pk)


class EmbedExecutionTests(ArtworkBoundaryTestCase):
    def test_valid_cover_really_lands_in_the_file(self):
        cover = image_bytes()
        artwork = self.stored_artwork(content=cover)
        embed_artwork_in_audio(self.audio.pk, artwork.pk)
        embedded = ID3TagService().extract_cover_art(str(self.media_root / self.audio.file_path))
        self.assertEqual(embedded, cover)

    def test_mime_type_comes_from_the_decoded_image_not_the_extension(self):
        for image_format, mime_type in (('JPEG', 'image/jpeg'), ('PNG', 'image/png'), ('WEBP', 'image/webp')):
            with self.subTest(image_format):
                artwork = self.stored_artwork('misnamed.gif', content=image_bytes(image_format))
                with patch(TAG_WRITER, return_value=True) as writer:
                    embed_artwork_in_audio(self.audio.pk, artwork.pk)
                self.assertEqual(writer.call_args.args[2], mime_type)

    def test_best_artwork_selection_still_embeds(self):
        self.stored_artwork('low.png', priority=1)
        best = image_bytes(size=(8, 8))
        self.stored_artwork('high.png', content=best, priority=9)
        with patch(TAG_WRITER, return_value=True) as writer:
            embed_artwork_in_audio(self.audio.pk)
        self.assertEqual(writer.call_args.args[1], best)

    def test_hostile_rows_never_reach_the_tag_writer(self):
        for label, artwork in self.hostile_rows().items():
            with self.subTest(label), patch(TAG_WRITER) as writer:
                embed_artwork_in_audio(self.audio.pk, artwork.pk)
                writer.assert_not_called()

    def test_hostile_best_artwork_never_reaches_the_tag_writer(self):
        self.artwork_row(str(self.outside_file), priority=99)
        with patch(TAG_WRITER) as writer:
            embed_artwork_in_audio(self.audio.pk)
        writer.assert_not_called()

    def test_queued_foreign_artwork_never_reaches_the_tag_writer(self):
        foreign = self.stored_artwork('bob.png', audio=self.bob_audio)
        with patch(TAG_WRITER) as writer:
            embed_artwork_in_audio(self.audio.pk, foreign.pk)
        writer.assert_not_called()

    def test_concurrent_deletion_is_a_safe_no_op(self):
        artwork = self.stored_artwork()
        audio_pk, artwork_pk = self.audio.pk, artwork.pk
        (self.artwork_dir / 'cover.png').unlink()
        with patch(TAG_WRITER) as writer:
            embed_artwork_in_audio(audio_pk, artwork_pk)
            artwork.delete()
            embed_artwork_in_audio(audio_pk, artwork_pk)
            self.audio.delete()
            embed_artwork_in_audio(audio_pk, artwork_pk)
        writer.assert_not_called()


class ImageValidationTests(ArtworkBoundaryTestCase):
    def test_refuses_oversized_dimensions(self):
        side = int(MAX_ARTWORK_PIXELS ** 0.5) + 1
        artwork = self.stored_artwork('huge.png', content=image_bytes(size=(side, side)))
        with self.assertRaises(InvalidArtworkImage):
            load_artwork_image(artwork)

    def test_refuses_oversized_file(self):
        artwork = self.stored_artwork(content=image_bytes() + bytes(64))
        with patch('audio.artwork_images.MAX_ARTWORK_BYTES', 32):
            with self.assertRaises(InvalidArtworkImage):
                load_artwork_image(artwork)

    def test_refuses_formats_outside_the_allow_list(self):
        artwork = self.stored_artwork('cover.gif', content=image_bytes('GIF'))
        with self.assertRaises(InvalidArtworkImage):
            load_artwork_image(artwork)

    def test_damaged_images_are_refused_never_crash(self):
        for image_format in ('JPEG', 'PNG', 'WEBP'):
            complete = image_bytes(image_format, size=(32, 32))
            for length in range(0, len(complete) - 1, 7):
                with self.subTest(image_format=image_format, length=length):
                    artwork = self.stored_artwork('cut.img', content=complete[:length])
                    try:
                        load_artwork_image(artwork)
                    except InvalidArtworkImage:
                        pass
