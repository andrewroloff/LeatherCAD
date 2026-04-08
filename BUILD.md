# LeatherCAD Build Instructions

This document guides you through building LeatherCAD from source and creating distributables for Windows, macOS, and Linux using **electron-builder**.

---

## 1. Prerequisites

Make sure you have the following installed:

* **Node.js** (v20.x recommended) and npm
* **Git**
* **Python 3** (for native module builds if required)
* **C++ Build Tools**

  * Windows: Visual Studio Build Tools
  * macOS: Xcode Command Line Tools
  * Linux: `build-essential`

## 2. Clone the Repository

```bash
git clone https://github.com/yourusername/LeatherCAD.git
cd LeatherCAD
```

## 3. Install Dependencies

```bash
npm install
```

This will install all required Electron and JavaScript dependencies.

## 4. Run in Development Mode

```bash
npm run dev
```

This launches LeatherCAD in development mode with live reload.

## 5. Build Distributables

LeatherCAD uses **electron-builder** to create native packages for all platforms.

### 5.1 Build for Your Current Platform

```bash
npm run build
```

This creates a production-ready Electron app in the `dist/` folder.

### 5.2 Build for Specific Platforms

* **Windows (x64)**

```bash
npm run dist:win
```

* **macOS (x64 or ARM)**

```bash
npm run dist:mac
```

* **Linux (AppImage, deb, rpm)**

```bash
npm run dist:linux
```

> You can configure targets in `package.json` under the `build` section.

## 6. Configuring `electron-builder`

Example `package.json` snippet:

```json
"build": {
  "appId": "com.yourusername.leathercad",
  "productName": "LeatherCAD",
  "directories": {
    "output": "dist"
  },
  "files": [
    "**/*"
  ],
  "mac": {
    "target": ["dmg", "zip"]
  },
  "win": {
    "target": ["nsis", "zip"]
  },
  "linux": {
    "target": ["AppImage", "deb", "rpm"]
  }
}
```

### 6.1 Customizing Output

You can adjust:

* **Icons** per platform (`build/icons`)
* **Publish settings** (GitHub releases or private server)
* **Extra resources** if your app needs assets outside the app bundle

## 7. Notes & Tips

* Always test your distributables on each OS before publishing.
* Use `--x64` or `--arm64` flags to force architecture.
* For automated builds, CI/CD tools like GitHub Actions can be configured with electron-builder.
* Ensure your `README.md` and LICENSE files are included in the build if needed.

## 8. Publishing

* Create a GitHub release.
* Upload your `dist/` folder artifacts for each platform.
* Update your main `README.md` download links.

---

LeatherCAD © 2026 Andrew Roloff | MIT License
