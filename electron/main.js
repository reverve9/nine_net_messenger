const { app, BrowserWindow, shell, Tray, Menu, screen, ipcMain, Notification } = require('electron');
const path = require('path');

let mainWindow;
let chatWindows = new Map();
let tray;

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;
const baseUrl = isDev ? 'http://localhost:3001' : 'https://nine-net-messenger.vercel.app';

// 단일 인스턴스 보장
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 이미 실행 중이면 창 보여주기
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// 프로토콜 핸들러 (메인앱에서 호출 시)
app.setAsDefaultProtocolClient('ninenet-messenger');

app.on('open-url', (event, url) => {
  event.preventDefault();
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
});

function createMainWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  mainWindow = new BrowserWindow({
    width: 400,
    height: 600,
    minWidth: 350,
    minHeight: 400,
    x: width - 420,
    y: 80,
    frame: false,
    transparent: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      
    },
    icon: path.join(__dirname, '../public/icon-512.png'),
    title: 'Nine Net Messenger',
  });

  mainWindow.loadURL(baseUrl);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 닫기 버튼 누르면 숨기기 (트레이로)
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function createChatWindow(roomId, roomName) {
  if (chatWindows.has(roomId)) {
    const existingWindow = chatWindows.get(roomId);
    existingWindow.show();
    existingWindow.focus();
    return;
  }

  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const offset = chatWindows.size * 30;

  const chatWindow = new BrowserWindow({
    width: 400,
    height: 550,
    minWidth: 350,
    minHeight: 400,
    x: width - 440 - offset,
    y: 120 + offset,
    frame: false,
    transparent: false,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      
    },
    icon: path.join(__dirname, '../public/icon-512.png'),
    title: roomName || '채팅',
  });

  chatWindow.loadURL(baseUrl + '/chat/' + roomId);
  chatWindows.set(roomId, chatWindow);

  chatWindow.on('closed', () => {
    chatWindows.delete(roomId);
  });
}

function createTray() {
  const trayIconPath = path.join(__dirname, '../public/tray-iconTemplate.png');
  
  tray = new Tray(trayIconPath);

  const contextMenu = Menu.buildFromTemplate([
    { label: '메신저 열기', click: () => {
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    }},
    { type: 'separator' },
    { label: '종료', click: () => {
      app.isQuitting = true;
      app.quit();
    }},
  ]);

  tray.setToolTip('Nine Net Messenger');
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
}

// IPC 핸들러
ipcMain.on('open-chat', (event, { roomId, roomName }) => {
  createChatWindow(roomId, roomName);
});

ipcMain.on('close-chat', (event, roomId) => {
  if (chatWindows.has(roomId)) {
    chatWindows.get(roomId).close();
  }
});

ipcMain.on('close-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.close();
});

ipcMain.on('minimize-window', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.minimize();
});

ipcMain.on('show-notification', (event, { title, body }) => {
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: title,
      body: body,
      silent: false,
    });
    
    notification.on('click', () => {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win) {
        win.show();
        win.focus();
      }
    });
    
    notification.show();
  }
});

app.whenReady().then(() => {
  createMainWindow();
  createTray();
});

app.on('window-all-closed', () => {
  // macOS에서는 종료하지 않음 (트레이에 유지)
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  } else {
    createMainWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (tray) tray.destroy();
});
