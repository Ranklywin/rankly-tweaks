// Fixed optional services. Core Windows, security, networking and game services
// are deliberately outside this allowlist.
export const leanServices = Object.freeze(['WSearch', 'SysMain', 'DiagTrack']);

export const backgroundApps = Object.freeze([
  { id:'chrome', name:'Google Chrome', executables:['chrome.exe'] },
  { id:'edge', name:'Microsoft Edge', executables:['msedge.exe'] },
  { id:'firefox', name:'Firefox', executables:['firefox.exe'] },
  { id:'discord', name:'Discord', executables:['Discord.exe','DiscordCanary.exe','DiscordPTB.exe'] },
  { id:'spotify', name:'Spotify', executables:['Spotify.exe'] },
  { id:'teams', name:'Microsoft Teams', executables:['ms-teams.exe','Teams.exe'] },
  { id:'onedrive', name:'OneDrive', executables:['OneDrive.exe'] },
]);
