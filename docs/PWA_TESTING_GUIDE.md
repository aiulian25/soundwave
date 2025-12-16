# 🎵 SoundWave PWA - Setup & Testing Guide

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ and npm
- Python 3.10+
- Docker & Docker Compose (optional)

### Installation

1. **Clone and Install**
   ```bash
   cd soundwave/frontend
   npm install
   ```

2. **Generate PWA Icons (Optional for testing)**
   ```bash
   # If you have ImageMagick installed:
   ../scripts/generate-pwa-icons.sh
   
   # Otherwise, use online tools:
   # - https://www.pwabuilder.com/imageGenerator
   # - https://realfavicongenerator.net/
   ```

3. **Start Development Server**
   ```bash
   npm run dev
   ```
   Visit: http://localhost:3000

4. **Build for Production**
   ```bash
   npm run build
   npm run preview
   ```
   Visit: http://localhost:4173

## 📱 Testing PWA Features

### 1. Test Service Worker

1. Open Chrome DevTools (F12)
2. Go to **Application** tab
3. Click **Service Workers** in sidebar
4. Verify:
   - ✅ Service worker is registered
   - ✅ Status shows "activated and is running"
   - ✅ Source: `/service-worker.js`

### 2. Test Manifest

1. In DevTools > **Application** tab
2. Click **Manifest** in sidebar
3. Verify:
   - ✅ Name: "SoundWave"
   - ✅ Short name: "SoundWave"
   - ✅ Start URL: "/"
   - ✅ Display: "standalone"
   - ✅ Icons: 8 icons (72px to 512px)
   - ✅ Theme color: "#1976d2"

### 3. Test Offline Mode

1. In DevTools > **Application** > **Service Workers**
2. Check **Offline** checkbox
3. Reload the page (Ctrl+R)
4. Verify:
   - ✅ Page loads successfully
   - ✅ Cached content is displayed
   - ✅ Offline indicator shows in UI
   - ✅ "You're offline" alert appears

### 4. Test Cache Storage

1. In DevTools > **Application** > **Cache Storage**
2. Verify caches:
   - ✅ `soundwave-v1` (static assets)
   - ✅ `soundwave-api-v1` (API responses)
   - ✅ `soundwave-audio-v1` (audio files)
   - ✅ `soundwave-images-v1` (images)
3. Click on each cache to view cached items

### 5. Test Install Prompt

**Desktop (Chrome/Edge):**
1. Visit http://localhost:4173 (must be preview mode)
2. Look for install icon in address bar
3. Click to install
4. Or wait 3 seconds for install prompt

**Mobile (Chrome):**
1. Visit site in Chrome mobile
2. Wait for "Add to Home Screen" prompt
3. Tap "Add" to install

**Mobile (Safari iOS):**
1. Visit site in Safari
2. Tap Share button
3. Scroll and tap "Add to Home Screen"
4. Confirm

### 6. Run Lighthouse Audit

1. Open Chrome DevTools
2. Go to **Lighthouse** tab
3. Select:
   - ✅ Progressive Web App
   - ✅ Performance
   - ✅ Accessibility
   - ✅ Best Practices
   - ✅ SEO
4. Click **Generate report**
5. Target scores:
   - PWA: **100/100**
   - Performance: **90+/100**
   - Accessibility: **95+/100**
   - Best Practices: **100/100**
   - SEO: **100/100**

### 7. Test Media Session API

1. Play an audio file
2. Check notification tray (desktop/mobile)
3. Verify:
   - ✅ Song title displayed
   - ✅ Artist name displayed
   - ✅ Album art shown (if available)
   - ✅ Play/pause button works
   - ✅ Seek buttons work (10s forward/back)

**Lock Screen (Mobile):**
1. Play audio
2. Lock device
3. Check lock screen controls

### 8. Test Notifications

1. Go to **Settings** page
2. Find **PWA** section
3. Toggle **Enable push notifications**
4. Accept permission prompt
5. Verify:
   - ✅ Permission granted
   - ✅ Toggle stays enabled
   - ✅ Success message shown

### 9. Test Cache Management

1. Go to **Settings** > **PWA** section
2. Check cache size display
3. Click **Clear Cache** button
4. Verify:
   - ✅ Cache cleared successfully
   - ✅ Cache size resets
   - ✅ Success message shown
5. Reload page to rebuild cache

### 10. Test Update Flow

1. Make a change to code
2. Build new version: `npm run build`
3. In running app, wait ~30 seconds
4. Verify:
   - ✅ Update notification appears
   - ✅ "Update" button shown
5. Click "Update"
6. Verify:
   - ✅ Page reloads
   - ✅ New version active

## 🧪 Testing Checklist

### Installation
- [ ] Desktop Chrome install prompt appears
- [ ] Desktop Edge install prompt appears
- [ ] Android Chrome "Add to Home Screen" works
- [ ] iOS Safari "Add to Home Screen" works
- [ ] Installed app opens in standalone mode
- [ ] App has correct icon and name

### Offline Functionality
- [ ] Service worker registers successfully
- [ ] Page loads offline
- [ ] Previously viewed content accessible offline
- [ ] Offline indicator shows when offline
- [ ] Online indicator shows when back online
- [ ] Cached audio plays offline
- [ ] Images load from cache offline

### Performance
- [ ] First page load < 3 seconds
- [ ] Subsequent loads < 1 second
- [ ] Smooth scrolling on mobile
- [ ] No layout shift
- [ ] Touch targets ≥ 44px
- [ ] No zoom on input focus

### Media Controls
- [ ] Media session metadata shows correctly
- [ ] Play/pause from notification tray works
- [ ] Lock screen controls work (mobile)
- [ ] Seek forward/backward works
- [ ] Position state updates on system controls
- [ ] Controls disappear when audio ends

### UI/UX
- [ ] Install prompt shows after 3 seconds
- [ ] Update prompt shows when available
- [ ] Offline alert persistent when offline
- [ ] Online notification shows briefly
- [ ] Cache size displays correctly
- [ ] Clear cache works
- [ ] All buttons have proper touch feedback
- [ ] Loading states show appropriately

### Responsive Design
- [ ] Works on mobile (320px width)
- [ ] Works on tablet (768px width)
- [ ] Works on desktop (1920px width)
- [ ] Safe areas respected on notched devices
- [ ] Landscape mode works correctly

### Accessibility
- [ ] Keyboard navigation works
- [ ] Focus indicators visible
- [ ] Screen reader compatible
- [ ] Color contrast sufficient
- [ ] Reduced motion respected

### Cross-Browser
- [ ] Chrome Desktop
- [ ] Chrome Android
- [ ] Edge Desktop
- [ ] Safari Desktop
- [ ] Safari iOS
- [ ] Firefox Desktop
- [ ] Samsung Internet

## 🐛 Troubleshooting

### Service Worker Not Registering

**Issue**: Console shows service worker registration failed

**Solutions**:
1. Serve over HTTPS or localhost
2. Check service worker file path is correct
3. Clear browser cache (Ctrl+Shift+Delete)
4. Check console for detailed error
5. Verify `vite.config.ts` has correct `publicDir`

```bash
# Force rebuild
rm -rf frontend/dist
npm run build
```

### Install Prompt Not Showing

**Issue**: No install button or prompt appears

**Checklist**:
- [ ] Using HTTPS or localhost
- [ ] Manifest.json loads without errors
- [ ] Service worker registered and active
- [ ] All manifest icons exist
- [ ] User hasn't dismissed recently (wait 90 days)
- [ ] User hasn't already installed
- [ ] Using Chrome/Edge (not Firefox/Safari)

**Test**:
```javascript
// In console
window.addEventListener('beforeinstallprompt', (e) => {
  console.log('Install prompt available!', e);
});
```

### Offline Mode Not Working

**Issue**: Page doesn't load offline

**Solutions**:
1. Visit pages while online first (to cache them)
2. Check service worker is active:
   ```javascript
   navigator.serviceWorker.getRegistration().then(reg => {
     console.log('Active:', reg?.active);
   });
   ```
3. Check cache storage has content:
   - DevTools > Application > Cache Storage
4. Verify fetch handler in service worker

### Media Session Not Working

**Issue**: No controls in notification tray

**Browser Support**:
- ✅ Chrome Desktop/Android
- ✅ Edge Desktop
- ⚠️ Safari (limited)
- ❌ Firefox Desktop (partial)

**Solutions**:
1. Check if API supported:
   ```javascript
   if ('mediaSession' in navigator) {
     console.log('Media Session API supported');
   }
   ```
2. Verify metadata is set correctly
3. Check action handlers are defined
4. Test in Chrome first

### Cache Not Clearing

**Issue**: Old content still showing after clear

**Solutions**:
1. Hard refresh (Ctrl+Shift+R)
2. Clear browser cache:
   - DevTools > Application > Clear storage > Clear site data
3. Unregister service worker:
   ```javascript
   navigator.serviceWorker.getRegistrations().then(registrations => {
     registrations.forEach(reg => reg.unregister());
   });
   ```
4. Reload page

### Icons Not Loading

**Issue**: Icons show broken or default

**Solutions**:
1. Generate icons:
   ```bash
   ../scripts/generate-pwa-icons.sh
   ```
2. Or use online tools and place in `frontend/public/img/`
3. Required sizes: 72, 96, 128, 144, 152, 192, 384, 512
4. Update manifest.json paths if needed
5. Clear cache and rebuild

## 📊 Performance Optimization

### Check Bundle Size
```bash
npm run build -- --report
```

### Analyze Cache Usage
```javascript
// In console
async function checkCacheSize() {
  const estimate = await navigator.storage.estimate();
  const usage = estimate.usage / (1024 * 1024); // MB
  const quota = estimate.quota / (1024 * 1024); // MB
  console.log(`Cache: ${usage.toFixed(2)} MB / ${quota.toFixed(2)} MB`);
}
checkCacheSize();
```

### Monitor Service Worker
```javascript
// In console
navigator.serviceWorker.addEventListener('message', (event) => {
  console.log('SW Message:', event.data);
});
```

## 📚 Additional Resources

- **Full Documentation**: [PWA_IMPLEMENTATION.md](./PWA_IMPLEMENTATION.md)
- **Complete Summary**: [COMPLETE_PWA_SUMMARY.md](./COMPLETE_PWA_SUMMARY.md)
- **Developer Guide**: [PWA_DEVELOPER_GUIDE.md](./PWA_DEVELOPER_GUIDE.md)
- **Icon Generator**: https://www.pwabuilder.com/imageGenerator
- **PWA Checklist**: https://web.dev/pwa-checklist/
- **Lighthouse**: https://developers.google.com/web/tools/lighthouse

## 🎉 Success Criteria

Your PWA is ready when:
- ✅ Lighthouse PWA score: 100/100
- ✅ Installs successfully on all platforms
- ✅ Works offline with cached content
- ✅ Service worker registers and caches content
- ✅ Media controls work in notification tray
- ✅ Update flow works correctly
- ✅ All touch targets ≥ 44px
- ✅ Responsive on all screen sizes
- ✅ Accessible via keyboard
- ✅ No console errors

---

**Ready to Deploy?** Check the production deployment guide in [PWA_IMPLEMENTATION.md](./PWA_IMPLEMENTATION.md)!
