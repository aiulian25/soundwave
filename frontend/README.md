# SoundWave Frontend

React + TypeScript + Material-UI frontend for SoundWave audio archiving platform.

## 🎨 Features

- **Pixel-perfect Login Page** - Matches the design specification exactly
- **Dark Theme** - Deep blue/purple color scheme
- **Material Design** - Using Material-UI components and icons
- **Responsive Audio Player** - Full playback controls
- **Modern Architecture** - React 18 + TypeScript + Vite

## 🚀 Development

### Install Dependencies

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:3000`

### Build for Production

```bash
npm run build
```

The build output will be in the `dist/` directory.

## 📁 Project Structure

```
src/
├── api/           # API client and endpoints
├── components/    # Reusable components
│   ├── Sidebar.tsx
│   ├── TopBar.tsx
│   └── Player.tsx
├── pages/         # Page components
│   ├── LoginPage.tsx   # Pixel-perfect login page
│   ├── HomePage.tsx
│   ├── LibraryPage.tsx
│   ├── SearchPage.tsx
│   ├── FavoritesPage.tsx
│   └── SettingsPage.tsx
├── theme/         # Material-UI theme
├── types/         # TypeScript definitions
├── App.tsx        # Main app component
└── main.tsx       # Entry point
```

## 🎨 Design System

### Colors

- **Primary**: `#5C6BC0` (Indigo)
- **Secondary**: `#7E57C2` (Deep Purple)
- **Accent**: `#4ECDC4` (Cyan - for login page)
- **Background**: `#0A0E27` (Very Dark Blue)
- **Paper**: `#151932` (Dark Blue-Gray)

### Login Page Colors

- **Left Side**: `#A8DADC` (Light Cyan)
- **Right Side**: `#F1F3F4` (Light Gray)
- **Logo**: Dark Navy `#1D3557` + Cyan `#4ECDC4`
- **Button**: `#2D3748` (Dark Gray)

## 🔌 API Integration

The frontend connects to the Django backend API at:
- Development: `http://localhost:8000/api/`
- Production: Configured via proxy

## 📱 Responsive Design

The application is optimized for:
- Desktop (1920x1080 and above)
- Tablet (768px - 1024px)
- Mobile (coming soon)

## 🛠️ Technologies

- **React 18** - UI library
- **TypeScript** - Type safety
- **Material-UI (MUI)** - Component library
- **Vite** - Build tool
- **React Router** - Navigation
- **Axios** - HTTP client

## 🔐 Authentication

The login page integrates with the Django backend authentication system. Upon successful login, a token is stored in localStorage and used for subsequent API requests.

## 🎵 Audio Player

The built-in audio player features:
- Play/Pause controls
- Progress bar with seek
- Volume control
- Previous/Next track
- Shuffle and Repeat
- Now playing information

Enjoy building with SoundWave! 🎧
