export const CHROME = new Set([
  'resources/new.gif',
  'resources/firework.gif',
  'resources/yt.png',
  'resources/images/logo.png',
  'resources/images/start.gif',
  'resources/images/pdf.gif',
]);

export function isChrome(repoPath) {
  return CHROME.has(repoPath);
}
