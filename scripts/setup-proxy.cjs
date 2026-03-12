// CJS script loaded via --require before ESM modules
// Sets up proxy for undici (REST) and ws (WebSocket)
const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
if (proxyUrl) {
  try {
    // 1. Patch CJS undici global dispatcher (@discordjs/rest uses CJS undici)
    const { setGlobalDispatcher, ProxyAgent } = require('undici');
    setGlobalDispatcher(new ProxyAgent(proxyUrl));

    // 2. Patch ws module in CJS require cache (@discordjs/ws uses CJS require('ws'))
    const { HttpsProxyAgent } = require('https-proxy-agent');
    const proxyAgent = new HttpsProxyAgent(proxyUrl);
    const ws = require('ws');
    const OriginalWebSocket = ws.WebSocket;

    function PatchedWebSocket(url, protocols, options) {
      const opts = Object.assign({}, options, { agent: proxyAgent });
      return new OriginalWebSocket(url, protocols, opts);
    }
    // Copy static properties
    Object.setPrototypeOf(PatchedWebSocket, OriginalWebSocket);
    Object.setPrototypeOf(PatchedWebSocket.prototype, OriginalWebSocket.prototype);
    PatchedWebSocket.CONNECTING = OriginalWebSocket.CONNECTING;
    PatchedWebSocket.OPEN = OriginalWebSocket.OPEN;
    PatchedWebSocket.CLOSING = OriginalWebSocket.CLOSING;
    PatchedWebSocket.CLOSED = OriginalWebSocket.CLOSED;

    // Patch the CJS module cache entry for 'ws'
    const wsPath = require.resolve('ws');
    const wsModule = require.cache[wsPath];
    if (wsModule) {
      wsModule.exports.WebSocket = PatchedWebSocket;
    }

  } catch (e) {
    console.error('[setup-proxy] Failed to set up proxy:', e.message);
  }
}
