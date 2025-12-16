# User Registration Policy

## Public Registration Status: DISABLED ❌

Public user registration is **disabled** in SoundWave. This is a security feature for multi-tenant deployments.

## User Creation

### Admin-Only User Creation

Only administrators can create new user accounts through:

1. **Django Admin Panel**:
   ```
   http://localhost:8888/admin/user/account/add/
   ```

2. **REST API** (Admin only):
   ```bash
   POST /api/user/admin/users/
   {
     "username": "newuser",
     "email": "user@example.com",
     "password": "SecurePass123",
     "password_confirm": "SecurePass123",
     "storage_quota_gb": 50,
     "max_channels": 50,
     "max_playlists": 100,
     "is_admin": false,
     "is_active": true
   }
   ```

3. **Frontend Admin Panel**:
   - Navigate to Admin Users page
   - Click "Create User" button
   - Fill in user details and resource quotas

### Django Management Command

Admins can also use Django management commands:

```bash
# Create regular user
python manage.py createsuperuser

# Or use shell
python manage.py shell
>>> from user.models import Account
>>> user = Account.objects.create_user(
...     username='john_doe',
...     email='john@example.com',
...     password='SecurePass123'
... )
>>> user.storage_quota_gb = 100
>>> user.max_channels = 75
>>> user.save()
```

## Attempted Public Registration

If someone attempts to access the registration endpoint:

**Request**:
```bash
POST /api/user/register/
{
  "username": "newuser",
  "email": "user@example.com",
  "password": "password123"
}
```

**Response** (403 Forbidden):
```json
{
  "error": "Public registration is disabled",
  "message": "New users can only be created by administrators. Please contact your system administrator for account creation."
}
```

## Configuration

Registration policy is controlled in `config/user_settings.py`:

```python
# Public registration disabled - only admins can create users
ALLOW_PUBLIC_REGISTRATION = False
```

### To Enable Public Registration (Not Recommended)

If you need to enable public registration for testing or specific use cases:

1. Edit `config/user_settings.py`:
   ```python
   ALLOW_PUBLIC_REGISTRATION = True
   ```

2. Implement registration logic in `user/views.py` RegisterView
3. Add frontend registration form (not included by default)

**⚠️ Warning**: Enabling public registration bypasses the multi-tenant security model and allows anyone to create accounts.

## Security Benefits

### Why Registration is Disabled

1. **Resource Control**: Admins control who gets accounts and resource quotas
2. **Quality Control**: Prevents spam accounts and abuse
3. **Multi-Tenancy**: Each user is a "tenant" with isolated data
4. **Storage Management**: Admins allocate storage based on needs
5. **Compliance**: Controlled user base for compliance requirements
6. **Billing**: Users can be tied to billing/subscription models

### Admin Capabilities

Admins have full control over:
- User creation and deletion
- Resource quotas (storage, channels, playlists)
- Account activation/deactivation
- 2FA reset
- Storage usage monitoring
- User permissions (admin/regular)

## User Onboarding Flow

### Recommended Process

1. **Request**: User requests account via email/form
2. **Admin Review**: Admin reviews request
3. **Account Creation**: Admin creates account with appropriate quotas
4. **Credentials**: Admin sends credentials to user securely
5. **First Login**: User logs in and changes password
6. **2FA Setup**: User sets up 2FA (recommended)

### Example Onboarding Email

```
Welcome to SoundWave!

Your account has been created:
- Username: john_doe
- Temporary Password: [generated_password]

Storage Quota: 50 GB
Max Channels: 50
Max Playlists: 100

Please login and change your password immediately:
http://soundwave.example.com/

For security, we recommend enabling 2FA in Settings.

Questions? Contact: admin@example.com
```

## API Endpoints

### Public Endpoints (No Auth Required)
- `POST /api/user/login/` - User login
- `POST /api/user/register/` - Returns 403 (disabled)

### Authenticated Endpoints
- `GET /api/user/account/` - Get current user
- `POST /api/user/logout/` - Logout
- `GET /api/user/config/` - User settings

### Admin-Only Endpoints
- `GET /api/user/admin/users/` - List all users
- `POST /api/user/admin/users/` - Create new user
- `PATCH /api/user/admin/users/{id}/` - Update user
- `POST /api/user/admin/users/{id}/reset_storage/` - Reset storage
- `POST /api/user/admin/users/{id}/toggle_active/` - Activate/deactivate

## Password Requirements

When creating users, passwords must meet these requirements:

```python
PASSWORD_MIN_LENGTH = 8
PASSWORD_REQUIRE_UPPERCASE = True
PASSWORD_REQUIRE_LOWERCASE = True
PASSWORD_REQUIRE_NUMBERS = True
PASSWORD_REQUIRE_SPECIAL = False  # Optional
```

Example valid passwords:
- `SecurePass123`
- `MyPassword1`
- `Admin2024Test`

## Future Enhancements

Potential features for user management:

- [ ] Invitation system (admin sends invite links)
- [ ] Approval workflow (users request, admin approves)
- [ ] Self-service password reset
- [ ] Email verification
- [ ] Account expiration dates
- [ ] Welcome email templates
- [ ] User onboarding wizard
- [ ] Bulk user import from CSV
- [ ] SSO/LDAP integration
- [ ] OAuth providers (Google, GitHub)

## Troubleshooting

### "Registration is disabled" error

**Cause**: Public registration is intentionally disabled.

**Solution**: Contact system administrator to create an account.

### Cannot create users

**Cause**: User is not an admin.

**Solution**: Only admin users (`is_admin=True` or `is_superuser=True`) can create users.

### How to create first admin?

```bash
python manage.py createsuperuser
```

This creates the first admin who can then create other users.

## Best Practices

1. **Strong Passwords**: Enforce strong password requirements
2. **Enable 2FA**: Require 2FA for admin accounts
3. **Audit Logs**: Track user creation and modifications
4. **Resource Planning**: Allocate quotas based on user needs
5. **Regular Review**: Periodically review active users
6. **Offboarding**: Deactivate accounts for departed users
7. **Backup**: Regular database backups including user data
8. **Documentation**: Keep user list and quotas documented
