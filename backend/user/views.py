"""User API views"""

import os
import mimetypes
from pathlib import Path
from django.contrib.auth import authenticate, login, logout
from django.http import HttpResponse, FileResponse
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.parsers import MultiPartParser, FormParser
from user.models import Account
from user.serializers import (
    AccountSerializer,
    LoginSerializer,
    UserConfigSerializer,
    TwoFactorSetupSerializer,
    TwoFactorVerifySerializer,
    TwoFactorStatusSerializer,
)
from user.two_factor import (
    generate_totp_secret,
    get_totp_uri,
    generate_qr_code,
    verify_totp,
    generate_backup_codes,
    generate_backup_codes_pdf,
)
from datetime import datetime


class UserAccountView(APIView):
    """User account endpoint"""

    def get(self, request):
        """Get current user account"""
        user = request.user
        # Calculate current storage usage
        user.calculate_storage_usage()
        serializer = AccountSerializer(user)
        return Response(serializer.data)


class UserProfileView(APIView):
    """User profile management"""
    
    def patch(self, request):
        """Update user profile (username, email, first_name, last_name)"""
        user = request.user
        username = request.data.get('username')
        email = request.data.get('email')
        first_name = request.data.get('first_name')
        last_name = request.data.get('last_name')
        current_password = request.data.get('current_password', '').strip()
        
        # At least one field must be provided
        if not username and not email and first_name is None and last_name is None:
            return Response(
                {'error': 'At least one field (username, email, first_name, last_name) must be provided'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Password is required to change username or email (security critical fields)
        if (username or email) and not current_password:
            return Response(
                {'error': 'Current password is required to change username or email'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verify current password only if it's provided (for username/email changes)
        if current_password and not user.check_password(current_password):
            return Response(
                {'error': 'Current password is incorrect'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        
        # Validate username
        if username:
            username = username.strip()
            if len(username) < 3:
                return Response(
                    {'error': 'Username must be at least 3 characters long'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            if not username.isalnum() and '_' not in username:
                return Response(
                    {'error': 'Username can only contain letters, numbers, and underscores'},
                    status=status.HTTP_400_BAD_REQUEST
                )
            # Check if username is already taken
            if Account.objects.exclude(id=user.id).filter(username=username).exists():
                return Response(
                    {'error': 'Username already taken'},
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        # Check if email is already taken
        if email and Account.objects.exclude(id=user.id).filter(email=email).exists():
            return Response(
                {'error': 'Email already in use'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Update fields
        updated_fields = []
        if username:
            user.username = username
            updated_fields.append('username')
        if email:
            user.email = email
            updated_fields.append('email')
        if first_name is not None:
            user.first_name = first_name
            updated_fields.append('name')
        if last_name is not None:
            user.last_name = last_name
            if 'name' not in updated_fields:
                updated_fields.append('name')
        
        user.save()
        
        return Response({
            'message': f'{" and ".join(updated_fields).capitalize()} updated successfully',
            'user': AccountSerializer(user).data
        })


class ChangePasswordView(APIView):
    """Change user password"""
    
    def post(self, request):
        """Change password"""
        user = request.user
        current_password = request.data.get('current_password')
        new_password = request.data.get('new_password')
        
        if not current_password or not new_password:
            return Response(
                {'error': 'Current and new password are required'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verify current password
        if not user.check_password(current_password):
            return Response(
                {'error': 'Current password is incorrect'},
                status=status.HTTP_401_UNAUTHORIZED
            )
        
        # Validate new password length
        if len(new_password) < 8:
            return Response(
                {'error': 'Password must be at least 8 characters long'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Set new password
        user.set_password(new_password)
        user.save()
        
        # Delete old token and create new one for security
        Token.objects.filter(user=user).delete()
        new_token = Token.objects.create(user=user)
        
        return Response({
            'message': 'Password changed successfully',
            'token': new_token.key  # Return new token so user stays logged in
        })


class LoginView(APIView):
    """Login endpoint"""
    permission_classes = [AllowAny]

    def post(self, request):
        """Authenticate user"""
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = authenticate(
            username=serializer.validated_data['username'],
            password=serializer.validated_data['password']
        )

        if not user:
            return Response(
                {'error': 'Invalid credentials'},
                status=status.HTTP_401_UNAUTHORIZED
            )

        # Check if 2FA is enabled
        if user.two_factor_enabled:
            two_factor_code = serializer.validated_data.get('two_factor_code')
            
            if not two_factor_code:
                return Response({
                    'requires_2fa': True,
                    'message': 'Two-factor authentication required'
                }, status=status.HTTP_200_OK)
            
            # Verify TOTP code
            if user.two_factor_secret and verify_totp(user.two_factor_secret, two_factor_code):
                pass  # Code is valid, continue login
            # Check backup codes
            elif two_factor_code in user.backup_codes:
                # Remove used backup code
                user.backup_codes.remove(two_factor_code)
                user.save()
            else:
                return Response(
                    {'error': 'Invalid two-factor code'},
                    status=status.HTTP_401_UNAUTHORIZED
                )

        login(request, user)
        token, _ = Token.objects.get_or_create(user=user)
        return Response({
            'token': token.key,
            'user': AccountSerializer(user).data
        })


class LogoutView(APIView):
    """Logout endpoint"""

    def post(self, request):
        """Logout user and delete token"""
        # Delete the user's token for security
        if request.user.is_authenticated:
            try:
                Token.objects.filter(user=request.user).delete()
            except Token.DoesNotExist:
                pass
        
        logout(request)
        return Response({'message': 'Logged out successfully'})


class RegisterView(APIView):
    """
    Registration endpoint - DISABLED
    Public registration is not allowed. Only admins can create new users.
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        """Block public registration"""
        from config.user_settings import ALLOW_PUBLIC_REGISTRATION
        
        if not ALLOW_PUBLIC_REGISTRATION:
            return Response(
                {
                    'error': 'Public registration is disabled',
                    'message': 'New users can only be created by administrators. Please contact your system administrator for account creation.'
                },
                status=status.HTTP_403_FORBIDDEN
            )
        
        # If registration is enabled in settings, this would handle it
        # This code is kept for potential future use
        return Response(
            {'error': 'Registration endpoint not implemented'},
            status=status.HTTP_501_NOT_IMPLEMENTED
        )


class UserConfigView(APIView):
    """User configuration endpoint"""

    def get(self, request):
        """Get user configuration"""
        # TODO: Implement user config storage
        config = {
            'theme': 'dark',
            'items_per_page': 50,
            'audio_quality': 'best'
        }
        serializer = UserConfigSerializer(config)
        return Response(serializer.data)

    def post(self, request):
        """Update user configuration"""
        serializer = UserConfigSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        # TODO: Store user config
        return Response(serializer.data)


class TwoFactorStatusView(APIView):
    """Get 2FA status"""

    def get(self, request):
        """Get 2FA status for current user"""
        user = request.user
        serializer = TwoFactorStatusSerializer({
            'enabled': user.two_factor_enabled,
            'backup_codes_count': len(user.backup_codes) if user.backup_codes else 0
        })
        return Response(serializer.data)


class TwoFactorSetupView(APIView):
    """Setup 2FA"""

    def post(self, request):
        """Generate 2FA secret and QR code"""
        user = request.user
        
        # Generate new secret
        secret = generate_totp_secret()
        uri = get_totp_uri(secret, user.username)
        qr_code = generate_qr_code(uri)
        
        # Generate backup codes
        backup_codes = generate_backup_codes()
        
        # Store secret temporarily (not enabled yet)
        user.two_factor_secret = secret
        user.backup_codes = backup_codes
        user.save()
        
        serializer = TwoFactorSetupSerializer({
            'secret': secret,
            'qr_code': qr_code,
            'backup_codes': backup_codes
        })
        return Response(serializer.data)


class TwoFactorVerifyView(APIView):
    """Verify and enable 2FA"""

    def post(self, request):
        """Verify 2FA code and enable"""
        serializer = TwoFactorVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        user = request.user
        code = serializer.validated_data['code']
        
        if not user.two_factor_secret:
            return Response(
                {'error': 'No 2FA setup found. Please setup 2FA first.'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if verify_totp(user.two_factor_secret, code):
            user.two_factor_enabled = True
            user.save()
            return Response({
                'message': 'Two-factor authentication enabled successfully',
                'enabled': True
            })
        
        return Response(
            {'error': 'Invalid verification code'},
            status=status.HTTP_400_BAD_REQUEST
        )


class TwoFactorDisableView(APIView):
    """Disable 2FA"""

    def post(self, request):
        """Disable 2FA for user"""
        serializer = TwoFactorVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        
        user = request.user
        code = serializer.validated_data['code']
        
        if not user.two_factor_enabled:
            return Response(
                {'error': 'Two-factor authentication is not enabled'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Verify code before disabling
        if verify_totp(user.two_factor_secret, code) or code in user.backup_codes:
            user.two_factor_enabled = False
            user.two_factor_secret = None
            user.backup_codes = []
            user.save()
            return Response({
                'message': 'Two-factor authentication disabled successfully',
                'enabled': False
            })
        
        return Response(
            {'error': 'Invalid verification code'},
            status=status.HTTP_400_BAD_REQUEST
        )


class TwoFactorRegenerateCodesView(APIView):
    """Regenerate backup codes"""

    def post(self, request):
        """Generate new backup codes"""
        user = request.user
        
        if not user.two_factor_enabled:
            return Response(
                {'error': 'Two-factor authentication is not enabled'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Generate new backup codes
        backup_codes = generate_backup_codes()
        user.backup_codes = backup_codes
        user.save()
        
        return Response({
            'backup_codes': backup_codes,
            'message': 'Backup codes regenerated successfully'
        })


class TwoFactorDownloadCodesView(APIView):
    """Download backup codes as PDF"""

    def get(self, request):
        """Generate and download backup codes PDF"""
        user = request.user
        
        if not user.two_factor_enabled or not user.backup_codes:
            return Response(
                {'error': 'No backup codes available'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Generate PDF
        pdf_buffer = generate_backup_codes_pdf(user.username, user.backup_codes)
        
        # Create filename: username_SoundWave_BackupCodes_YYYY-MM-DD.pdf
        filename = f"{user.username}_SoundWave_BackupCodes_{datetime.now().strftime('%Y-%m-%d')}.pdf"
        
        response = HttpResponse(pdf_buffer, content_type='application/pdf')
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        
        return response


class AvatarUploadView(APIView):
    """Upload user avatar"""
    parser_classes = [MultiPartParser, FormParser]
    
    # Avatar directory - persistent storage
    AVATAR_DIR = Path('/app/data/avatars')
    MAX_SIZE = 20 * 1024 * 1024  # 20MB
    ALLOWED_TYPES = {'image/jpeg', 'image/png', 'image/gif', 'image/webp'}
    
    def post(self, request):
        """Upload custom avatar image"""
        if 'avatar' not in request.FILES:
            return Response(
                {'error': 'No avatar file provided'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        avatar_file = request.FILES['avatar']
        
        # Validate file size
        if avatar_file.size > self.MAX_SIZE:
            return Response(
                {'error': f'File too large. Maximum size is {self.MAX_SIZE // (1024*1024)}MB'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Validate content type
        content_type = avatar_file.content_type
        if content_type not in self.ALLOWED_TYPES:
            return Response(
                {'error': f'Invalid file type. Allowed types: {", ".join(self.ALLOWED_TYPES)}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Create avatars directory if it doesn't exist
        self.AVATAR_DIR.mkdir(parents=True, exist_ok=True)
        
        # Generate safe filename: username_timestamp.ext
        ext = Path(avatar_file.name).suffix or '.jpg'
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"{request.user.username}_{timestamp}{ext}"
        filepath = self.AVATAR_DIR / filename
        
        # Remove old avatar file if it exists and is not a preset
        if request.user.avatar and not request.user.avatar.startswith('preset_'):
            old_path = self.AVATAR_DIR / request.user.avatar.split('/')[-1]
            if old_path.exists():
                old_path.unlink()
        
        # Save file
        with open(filepath, 'wb+') as destination:
            for chunk in avatar_file.chunks():
                destination.write(chunk)
        
        # Update user model
        request.user.avatar = f"avatars/{filename}"
        request.user.save()
        
        return Response({
            'message': 'Avatar uploaded successfully',
            'avatar': request.user.avatar
        })
    
    def delete(self, request):
        """Remove custom avatar and reset to default"""
        user = request.user
        
        # Remove file if it exists and is not a preset
        if user.avatar and not user.avatar.startswith('preset_'):
            filepath = self.AVATAR_DIR / user.avatar.split('/')[-1]
            if filepath.exists():
                filepath.unlink()
        
        user.avatar = None
        user.save()
        
        return Response({
            'message': 'Avatar removed successfully'
        })


class AvatarPresetView(APIView):
    """Set preset avatar"""
    
    def post(self, request):
        """Set preset avatar (1-5)"""
        preset = request.data.get('preset')
        
        if not preset or not str(preset).isdigit():
            return Response(
                {'error': 'Invalid preset number'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        preset_num = int(preset)
        if preset_num < 1 or preset_num > 5:
            return Response(
                {'error': 'Preset must be between 1 and 5'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Remove old custom avatar file if exists
        user = request.user
        if user.avatar and not user.avatar.startswith('preset_'):
            avatar_dir = Path('/app/data/avatars')
            filepath = avatar_dir / user.avatar.split('/')[-1]
            if filepath.exists():
                filepath.unlink()
        
        # Set preset
        user.avatar = f"preset_{preset_num}"
        user.save()
        
        return Response({
            'message': 'Preset avatar set successfully',
            'avatar': user.avatar
        })


class AvatarFileView(APIView):
    """Serve avatar files"""
    
    def get(self, request, filename):
        """Serve avatar file"""
        avatar_dir = Path('/app/data/avatars')
        filepath = avatar_dir / filename
        
        # Security: validate path
        if not filepath.resolve().is_relative_to(avatar_dir.resolve()):
            return Response(
                {'error': 'Invalid path'},
                status=status.HTTP_403_FORBIDDEN
            )
        
        if not filepath.exists():
            return Response(
                {'error': 'Avatar not found'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Determine content type
        content_type, _ = mimetypes.guess_type(str(filepath))
        if not content_type:
            content_type = 'application/octet-stream'
        
        return FileResponse(open(filepath, 'rb'), content_type=content_type)
