const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

const RECENTS_PATH = path.join(app.getPath('userData'), 'recents.json');
const SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');

// ---------------- Recents ----------------
function loadRecents() {
    try {
        if (fs.existsSync(RECENTS_PATH)) {
            const data = JSON.parse(fs.readFileSync(RECENTS_PATH, 'utf-8'));

            // ✅ Ensure it's an array
            if (Array.isArray(data)) {
                return data;
            } else {
                console.warn('Recents file was not an array. Resetting.');
                return [];
            }
        }
    } catch (e) {
        console.error('Failed to load recents:', e);
    }
    return [];
}

function saveRecents(recents) {
    try {
        fs.writeFileSync(RECENTS_PATH, JSON.stringify(recents, null, 2));
    } catch (e) {
        console.error('Failed to save recents:', e);
    }
}

function addRecent(filePath) {
    let recents = loadRecents();

    if (!Array.isArray(recents)) recents = []; // extra guard

    recents = recents.filter(p => p !== filePath);
    recents.unshift(filePath);
    recents = recents.slice(0, 10);

    saveRecents(recents);
}

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
            if (typeof data === 'object' && data !== null) return data;
        }
    } catch (e) {
        console.error('Failed to load settings:', e);
    }

    return {
        darkMode: false,
        units: 'in', // 'in' or 'mm'
        page: {
            type: 'letter', // 'letter', 'a4', 'custom'
            width: 8.5,
            height: 11
        },
        theme: 'default'
    };
}

function saveSettings(settings) {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
}

// ---------------- App ----------------
app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        icon: path.join(__dirname, 'assets/Icon.png'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
        },
        autoHideMenuBar: false,
    });

    mainWindow.loadFile('src/index.html');
    mainWindow.maximize();

    ipcMain.handle('get-settings', () => {
        return loadSettings();
    });

    ipcMain.on('set-setting', (event, key, value) => {
        const settings = loadSettings();
        settings[key] = value;
        saveSettings(settings);

        // broadcast to renderer
        mainWindow.webContents.send('setting-updated', key, value);
    });

    // ---------------- Menu ----------------
    const template = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'New Pattern',
                    accelerator: 'Ctrl+N',
                    click: () => {
                        mainWindow.webContents.send('file-new');
                    }
                },
                {
                    label: 'Open Pattern',
                    accelerator: 'Ctrl+O',
                    click: async () => {
                        const { canceled, filePaths } = await dialog.showOpenDialog({
                            filters: [{ name: 'Pattern Files', extensions: ['pattern'] }],
                            properties: ['openFile']
                        });

                        if (!canceled && filePaths.length) {
                            const file = filePaths[0];
                            addRecent(file); // ✅ FIX
                            mainWindow.webContents.send('open-pattern', file);
                        }
                    }
                },
                {
                    label: 'Save Pattern',
                    accelerator: 'Ctrl+S',
                    click: async () => {
                        const { canceled, filePath } = await dialog.showSaveDialog({
                            title: 'Save Pattern',
                            defaultPath: 'untitled.pattern',
                            filters: [{ name: 'Pattern Files', extensions: ['pattern'] }]
                        });

                        if (!canceled && filePath) {
                            mainWindow.webContents.send('save-pattern-as', filePath);
                        }
                    }
                },
                {
                    label: 'Save Pattern As...',
                    accelerator: 'Ctrl+Shift+S',
                    click: async () => {
                        const { canceled, filePath } = await dialog.showSaveDialog({
                            title: 'Save Pattern',
                            defaultPath: 'untitled.pattern',
                            filters: [{ name: 'Pattern Files', extensions: ['pattern'] }]
                        });

                        if (!canceled && filePath) {
                            mainWindow.webContents.send('save-pattern-as', filePath);
                        }
                    }
                },
                { label: 'Print...', accelerator: 'Ctrl+p', click: () => mainWindow.webContents.send('print') }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                {
                    label: 'Preferences',
                    accelerator: 'Ctrl+,',
                    click: () => {
                        mainWindow.webContents.send('open-preferences');
                    }
                }
            ]
        },
        {
            label: 'Workspace',
            submenu: [
                { label: 'Pattern Mode', click: () => mainWindow.webContents.send('set-workspace', 'pattern') },
                { label: 'Tooling Mode', click: () => mainWindow.webContents.send('set-workspace', 'tooling') }
            ]
        },
        {
            label: 'Tools',
            submenu: [
                { label: 'Line Tool', click: () => mainWindow.webContents.send('set-tool', 'line') },
                { label: 'Rectangle Tool', click: () => mainWindow.webContents.send('set-tool', 'rectangle') },
                { label: 'Circle Tool', click: () => mainWindow.webContents.send('set-tool', 'circle') },
                { label: 'Select Tool', click: () => mainWindow.webContents.send('set-tool', 'select') },
                { label: 'Node Edit Tool', click: () => mainWindow.webContents.send('set-tool', 'node') },
            ]
        },
        {
            label: 'View',
            submenu: [
                { label: 'Dark Mode', click: () => mainWindow.webContents.send('toggle-dark') },
                { label: 'Show Dimensions', click: () => mainWindow.webContents.send('show-dims') }
            ]
        },
        {
            label: 'Help',
            submenu: [
                { label: 'About', click: () => mainWindow.webContents.send('about') },
                {
                    label: 'Documentation', click: () => {
                        const file = path.join(__dirname, 'help.html');
                        shell.openPath(file);
                    }
                }
            ]
        },
        {
            label: 'Developer',
            submenu: [
                { role: 'toggleDevTools' },
                { role: 'reload' },
                { role: 'forceReload' }
            ]
        }
    ];

    Menu.setApplicationMenu(Menu.buildFromTemplate(template));

    // ---------------- IPC ----------------

    ipcMain.handle('open-pattern-dialog', async () => {
        const { canceled, filePaths } = await dialog.showOpenDialog({
            filters: [{ name: 'Pattern Files', extensions: ['pattern'] }],
            properties: ['openFile']
        });

        if (!canceled && filePaths.length) {
            const file = filePaths[0];
            addRecent(file);
            mainWindow.webContents.send('open-pattern', file);
        }

        return null;
    });

    ipcMain.on('open-pattern', (event, filePath) => {
        if (!filePath) return;

        addRecent(filePath);
        mainWindow.webContents.send('open-pattern', filePath);
    });

    ipcMain.handle('get-recent-files', () => loadRecents()); // ✅ FIX

    ipcMain.on('add-recent-file', (event, filePath) => {
        if (!filePath) return;
        addRecent(filePath); // ✅ FIX
    });
});