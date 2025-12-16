"""Settings for user registration and authentication"""

# Public registration disabled - only admins can create users
ALLOW_PUBLIC_REGISTRATION = False

# Require admin approval for new users (future feature)
REQUIRE_ADMIN_APPROVAL = False

# Minimum password requirements
PASSWORD_MIN_LENGTH = 8
PASSWORD_REQUIRE_UPPERCASE = True
PASSWORD_REQUIRE_LOWERCASE = True
PASSWORD_REQUIRE_NUMBERS = True
PASSWORD_REQUIRE_SPECIAL = False

# Account security
ENABLE_2FA = True
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_DURATION_MINUTES = 15
