const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openChat: (roomId, roomName) => ipcRenderer.send('open-chat', { roomId, roomName }),
  closeChat: (roomId) => ipcRenderer.send('close-chat', roomId),
  closeWindow: () => ipcRenderer.send('close-window'),
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  showNotification: (title, body) => ipcRenderer.send('show-notification', { title, body }),
  isElectron: true,
});
