export {}

declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean
      openChat: (roomId: string, roomName: string) => void
      closeChat: (roomId: string) => void
      closeWindow: () => void
      minimizeWindow: () => void
      showNotification: (title: string, body: string) => void
      openPath: (filePath: string) => void
      selectFile: () => Promise<string | null>
    }
  }
}
