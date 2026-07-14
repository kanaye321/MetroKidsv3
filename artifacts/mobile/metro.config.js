const { getDefaultConfig } = require('expo/metro-config');
const { createProxyMiddleware } = require('http-proxy-middleware');

const config = getDefaultConfig(__dirname);

// Dev-only: the app calls the API server at the same origin under /api (see
// context/SocketContext.tsx). In this workspace the API server runs as its
// own process on a separate port, so proxy plain /api/* HTTP requests from
// the Expo web dev server to it. This covers Socket.IO's polling transport
// (which is plain HTTP) — the websocket upgrade itself isn't proxied here,
// so the client is configured to start on polling and it works from there.
const API_DEV_TARGET = `http://localhost:${process.env.API_PORT || 8000}`;
const apiProxy = createProxyMiddleware({
  target: API_DEV_TARGET,
  changeOrigin: true,
});

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (req.url && req.url.startsWith('/api')) {
      return apiProxy(req, res, next);
    }
    return middleware(req, res, next);
  },
};

module.exports = config;
