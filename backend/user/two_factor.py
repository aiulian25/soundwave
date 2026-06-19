"""2FA utility functions"""

import pyotp
import qrcode
import io
import base64
import hashlib
import secrets
from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.contrib.auth.hashers import make_password, check_password
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib import colors
from datetime import datetime


def _fernet():
    """Fernet built from a dedicated TOTP_ENC_KEY if set, else DJANGO_SECRET_KEY.

    APP-03: rotating the underlying key makes existing encrypted TOTP secrets
    undecryptable (affected users must re-enroll 2FA). Use a dedicated TOTP_ENC_KEY
    to decouple 2FA from Django secret-key rotation.
    """
    key_material = (getattr(settings, 'TOTP_ENC_KEY', '') or settings.SECRET_KEY).encode()
    fernet_key = base64.urlsafe_b64encode(hashlib.sha256(key_material).digest())
    return Fernet(fernet_key)


def encrypt_secret(plain):
    """Encrypt a TOTP secret for storage. Returns the original on empty input."""
    if not plain:
        return plain
    return _fernet().encrypt(plain.encode()).decode()


def decrypt_secret(token):
    """Decrypt a stored TOTP secret.

    Falls back to returning the value unchanged if it is not a valid Fernet token
    (e.g. a legacy plaintext secret not yet converted by the data migration), so
    verification never hard-breaks mid-deploy.
    """
    if not token:
        return token
    try:
        return _fernet().decrypt(token.encode()).decode()
    except (InvalidToken, ValueError, TypeError):
        return token


def hash_backup_code(code):
    """Hash a single backup code for storage (one-way)."""
    return make_password(code)


def hash_backup_codes(codes):
    """Hash a list of raw backup codes for storage."""
    return [hash_backup_code(code) for code in codes]


def verify_and_consume_backup_code(user, code):
    """Check a backup code against the user's stored hashes.

    On a match, removes that hash (single-use) and returns True. The caller is
    responsible for saving the user. Does not match plaintext, so unconverted
    legacy codes simply fail closed (the data migration hashes existing codes).
    """
    if not code or not user.backup_codes:
        return False
    for stored in list(user.backup_codes):
        if isinstance(stored, str) and '$' in stored and check_password(code, stored):
            user.backup_codes.remove(stored)
            return True
    return False


def generate_totp_secret():
    """Generate a new TOTP secret"""
    return pyotp.random_base32()


def get_totp_uri(secret, username, issuer='SoundWave'):
    """Generate TOTP URI for QR code"""
    totp = pyotp.TOTP(secret)
    return totp.provisioning_uri(name=username, issuer_name=issuer)


def generate_qr_code(uri):
    """Generate QR code image as base64 string"""
    qr = qrcode.QRCode(
        version=1,
        error_correction=qrcode.constants.ERROR_CORRECT_L,
        box_size=10,
        border=4,
    )
    qr.add_data(uri)
    qr.make(fit=True)
    
    img = qr.make_image(fill_color="black", back_color="white")
    
    # Convert to base64
    buffer = io.BytesIO()
    img.save(buffer, format='PNG')
    buffer.seek(0)
    img_base64 = base64.b64encode(buffer.getvalue()).decode()
    
    return f"data:image/png;base64,{img_base64}"


def verify_totp(secret, token):
    """Verify a TOTP token"""
    totp = pyotp.TOTP(secret)
    return totp.verify(token, valid_window=1)


def generate_backup_codes(count=10):
    """Generate backup codes"""
    codes = []
    for _ in range(count):
        code = '-'.join([
            secrets.token_hex(2).upper(),
            secrets.token_hex(2).upper(),
            secrets.token_hex(2).upper()
        ])
        codes.append(code)
    return codes


def generate_backup_codes_pdf(username, codes):
    """Generate PDF with backup codes"""
    buffer = io.BytesIO()
    
    # Create PDF
    doc = SimpleDocTemplate(buffer, pagesize=letter)
    story = []
    styles = getSampleStyleSheet()
    
    # Custom styles
    title_style = ParagraphStyle(
        'CustomTitle',
        parent=styles['Heading1'],
        fontSize=24,
        textColor=colors.HexColor('#1D3557'),
        spaceAfter=30,
    )
    
    subtitle_style = ParagraphStyle(
        'CustomSubtitle',
        parent=styles['Normal'],
        fontSize=12,
        textColor=colors.HexColor('#718096'),
        spaceAfter=20,
    )
    
    # Title
    story.append(Paragraph('SoundWave Backup Codes', title_style))
    story.append(Paragraph(f'User: {username}', subtitle_style))
    story.append(Paragraph(f'Generated: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}', subtitle_style))
    story.append(Spacer(1, 0.3 * inch))
    
    # Warning
    warning_style = ParagraphStyle(
        'Warning',
        parent=styles['Normal'],
        fontSize=10,
        textColor=colors.HexColor('#E53E3E'),
        spaceAfter=20,
        leftIndent=20,
        rightIndent=20,
    )
    story.append(Paragraph(
        '<b>⚠️ IMPORTANT:</b> Store these codes securely. Each code can only be used once. '
        'If you lose access to your 2FA device, you can use these codes to log in.',
        warning_style
    ))
    story.append(Spacer(1, 0.3 * inch))
    
    # Codes table
    data = [['#', 'Backup Code']]
    for i, code in enumerate(codes, 1):
        data.append([str(i), code])
    
    table = Table(data, colWidths=[0.5 * inch, 3 * inch])
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4ECDC4')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.HexColor('#1D3557')),
        ('ALIGN', (0, 0), (-1, -1), 'LEFT'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 12),
        ('BACKGROUND', (0, 1), (-1, -1), colors.white),
        ('TEXTCOLOR', (0, 1), (-1, -1), colors.HexColor('#2D3748')),
        ('FONTNAME', (0, 1), (-1, -1), 'Courier'),
        ('FONTSIZE', (0, 1), (-1, -1), 11),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#E2E8F0')),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 1), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 1), (-1, -1), 8),
    ]))
    story.append(table)
    
    # Footer
    story.append(Spacer(1, 0.5 * inch))
    footer_style = ParagraphStyle(
        'Footer',
        parent=styles['Normal'],
        fontSize=9,
        textColor=colors.HexColor('#A0AEC0'),
        alignment=1,  # Center
    )
    story.append(Paragraph('Keep this document in a safe place', footer_style))
    
    # Build PDF
    doc.build(story)
    buffer.seek(0)
    
    return buffer
