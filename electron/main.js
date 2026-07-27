// Desktop mode: boots the same Express+WebSocket server on a free local port,
// stores data in Electron's userData dir, and opens a window auto-logged-in as admin.
// Agents can run this all day as their chat console.
const { app, BrowserWindow, shell } = require('electron');
const path = require('path');
const crypto = require('crypto');
const { gateLicense, registerLicenseIpc } = require('./license-gate');

let win;

app.whenReady().then(async () => {
  if (!(await gateLicense())) return; // quit already requested
  registerLicenseIpc();

  const dataDir = path.join(app.getPath('userData'), 'data');
  const autologinToken = crypto.randomBytes(24).toString('hex');

  const { createServer } = require(path.join(__dirname, '..', 'server', 'app.js'));
  const server = createServer({
    dataDir,
    autologinToken,
    adminPassword: process.env.ADMIN_PASSWORD || 'admin'
  });

  // listen on port 0 → OS picks a free port (no collisions with a VPS install)
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    win = new BrowserWindow({
      width: 1360,
      height: 900,
      autoHideMenuBar: true,
      backgroundColor: '#09090b',
      title: 'Chatlet',
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    });
    // open external links (visitor pages etc.) in the system browser
    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    win.loadURL(`http://127.0.0.1:${port}/auth/auto?token=${autologinToken}`);
  });

  app.on('window-all-closed', () => {
    server.close();
    app.quit();
  });
});
