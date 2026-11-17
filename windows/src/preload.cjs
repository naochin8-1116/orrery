const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('orrery', Object.freeze({
  load: () => ipcRenderer.invoke('load'), save: s => ipcRenderer.invoke('save', s),
  metrics: () => ipcRenderer.invoke('metrics'), weather: () => ipcRenderer.invoke('weather'), market: () => ipcRenderer.invoke('market'), usage: () => ipcRenderer.invoke('usage'),
  chooseApp: () => ipcRenderer.invoke('choose-app'), launch: () => ipcRenderer.invoke('launch'),
  wake: enabled => ipcRenderer.invoke('wake', enabled),
  endSession: force => ipcRenderer.invoke('end-session', force), processAudio: enabled => ipcRenderer.invoke('process-audio',enabled),
  onProcessAudio: callback => { const fn=(_,packet)=>callback(packet);ipcRenderer.on('process-audio',fn);return ()=>ipcRenderer.removeListener('process-audio',fn); },
  onWindowMode: callback => ipcRenderer.on('window-mode',(_,mode)=>callback(mode)),
  onOpenSettings: callback => ipcRenderer.on('open-settings',callback),
  minimize: () => ipcRenderer.send('minimize'), close: () => ipcRenderer.send('close'),
  onWake: callback => { const fn = (_, value) => callback(value); ipcRenderer.on('wake-status', fn); return () => ipcRenderer.removeListener('wake-status', fn); }
}));
