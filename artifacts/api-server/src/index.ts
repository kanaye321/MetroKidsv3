import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import app from './app.js';
import { logger } from './lib/logger.js';
import { registerSocketEvents } from './socket/RideSocket.js';

const rawPort = process.env['PORT'];
if (!rawPort) throw new Error('PORT environment variable is required but was not provided.');
const port = Number(rawPort);
if (Number.isNaN(port) || port <= 0) throw new Error(`Invalid PORT value: "${rawPort}"`);

const httpServer = createServer(app);

// Socket.IO — path must include the /api prefix because Replit proxies /api/* → this server
const io = new SocketIO(httpServer, {
  path: '/api/socket.io',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling'],
});

registerSocketEvents(io);

httpServer.listen(port, (err?: Error) => {
  if (err) { logger.error({ err }, 'Error listening on port'); process.exit(1); }
  logger.info({ port }, 'Server listening (HTTP + Socket.IO)');
});
