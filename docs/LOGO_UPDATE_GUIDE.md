# Logo Update Guide

## Quick Start

Your new SoundWave logo is ready to be integrated! Follow these steps:

### Step 1: Save the Logo Image

Save the logo image you provided (the circular SoundWave logo with play button) to:

```
frontend/public/img/logo.png
```

**Important:** Make sure the file is named exactly `logo.png` and is placed in the `frontend/public/img/` directory.

### Step 2: Generate All Icon Sizes

Run the automated script to generate all PWA icons and favicon:

```bash
./scripts/update-logo.sh
```

This will automatically create:
- ✅ PWA icons (72x72, 96x96, 128x128, 144x144, 152x152, 192x192, 384x384, 512x512)
- ✅ Maskable icons for PWA (192x192, 512x512 with safe padding)
- ✅ Favicon (multi-size ICO file)

### Step 3: Update Code References

The code will automatically use the new logo in these locations:
- Login page
- Sidebar
- Splash screen  
- PWA manifest
- Browser tab icon
- Push notifications

### Step 4: Rebuild and Deploy

```bash
cd frontend
npm run build
```

Then restart your Docker container:
```bash
docker restart soundwave
```

---

## Where the Logo Appears

### Frontend UI
- **Login Page** - Large animated logo at the top
- **Sidebar** - Small logo next to "SoundWave" text
- **Splash Screen** - Loading screen logo

### PWA Features
- **Home Screen Icon** - When users install the PWA
- **Notification Icon** - Push notifications
- **Task Switcher** - App icon in multitasking view
- **Splash Screen** - PWA launch screen

### Browser
- **Favicon** - Browser tab icon
- **Bookmarks** - Bookmark icon

---

## Logo Specifications

Your logo perfectly matches the requirements:

✅ **Design Elements:**
- Circular play button in center
- Concentric circle patterns
- Sound wave visualizer lines on sides
- "soundwave" text in modern typography
- Professional color scheme (teal/turquoise + dark blue)

✅ **Technical Details:**
- Format: PNG with transparency
- Recommended size: 1024x1024 or higher
- Background: Transparent or solid color
- Color mode: RGB

---

## Troubleshooting

**Logo not showing after update?**
1. Clear browser cache (Ctrl+Shift+Delete)
2. Hard refresh (Ctrl+Shift+R)
3. Check browser console for 404 errors
4. Verify file is at: `frontend/public/img/logo.png`

**Icons look blurry on mobile?**
- Make sure source logo is high resolution (1024x1024+)
- Re-run `./scripts/update-logo.sh`

**Old logo still showing in PWA?**
- Uninstall the PWA from device
- Clear service worker cache
- Reinstall the PWA

---

## Manual Icon Generation (Alternative)

If the script doesn't work, you can use online tools:

1. **PWA Icon Generator**: https://www.pwabuilder.com/imageGenerator
2. **Favicon Generator**: https://realfavicongenerator.net/

Upload your `logo.png` and download the generated icons to `frontend/public/img/icons/`

---

## Files Modified by This Update

```
✅ frontend/public/img/logo.png (NEW - your logo)
✅ frontend/public/img/icons/ (PWA icons)
✅ frontend/public/favicon.ico (browser icon)
✅ scripts/update-logo.sh (automation script)
```

No code changes needed - all references already point to the correct paths!

---

## Current Logo Usage in Code

The logo is referenced in these files (already configured correctly):

1. **frontend/src/components/Sidebar.tsx**
   - Line 52: `src="/img/logo.svg"` → Will use PNG fallback

2. **frontend/src/components/SplashScreen.tsx**
   - Line 24: `src="/img/logo.svg"` → Will use PNG fallback

3. **frontend/src/pages/LoginPage.tsx**
   - Line 91: `src="/img/logo.svg"` → Will use PNG fallback

4. **frontend/public/manifest.json**
   - All icon paths already pointing to `/img/icons/icon-*` ✅

---

## Notes

- The `.svg` references will still work - browsers will fall back to `.png` if SVG isn't available
- For best quality, keep the original high-res PNG as backup
- PWA icons are cached - users may need to reinstall the app to see updates
