# LeatherCAD

LeatherCAD is an open-source leather tooling design application built with Electron and WebAssembly (WASM). It allows you to draw, simplify, and export leather patterns across Windows, macOS, and Linux.

## Features

* Interactive tooling workspace
* Stroke simplification using RDP algorithm
* Export designs to main CAD engine
* Cross-platform support (Windows, macOS, Linux)
* WASM-accelerated drawing engine

## Downloads

* [Windows](https://github.com/andrewroloff/LeatherCAD/releases/download/v1.1.0/leathercad-windows-latest.zip)
* [macOS](https://github.com/andrewroloff/LeatherCAD/releases/download/v1.1.0/leathercad-macos-latest.zip)
* [Linux](https://github.com/andrewroloff/LeatherCAD/releases/download/v1.1.0/leathercad-ubuntu-latest.zip)


## Manual Build / Installation

### Clone the repository

```bash
git clone https://github.com/username/LeatherCAD.git
cd LeatherCAD
```

### Install dependencies

```bash
npm install
```

### Build the WASM tooling engine

```bash
npm run build-wasm
```

### Run in development mode

```bash
npm start
```

## Building Distributables

LeatherCAD uses `electron-builder` to create platform-specific builds.

### Build for all platforms

```bash
npm run dist
```

This produces:

* Windows: `dist/win-unpacked/LeatherCAD Setup.exe`
* macOS: `dist/mac/LeatherCAD.dmg`
* Linux: `dist/linux-unpacked/LeatherCAD.AppImage`

### Folder Structure After Build

```
LeatherCAD/
├─ dist/
│  ├─ win-unpacked/
│  ├─ mac/
│  └─ linux-unpacked/
├─ src/
|   ├─ main.js
|   ├─ renderer.js
|   ├─ drawing.js
|   └─ package.json
```

## Preparing a Release

1. Commit your changes:

```bash
git add .
git commit -m "Release v1.0.0"
```

2. Tag the release:

```bash
git tag v1.0.0
git push origin --tags
```

3. Upload distributables from `dist/` to GitHub Releases.

## Contributing

* Rebuild WASM after modifying `cpp/drawing.cpp`, or `cpp/geometry.cpp`:

```bash
npm run build-wasm
```

* Test changes across all platforms.
* Commit and tag releases for version control.

## License

LeatherCAD is released under the MIT License.
