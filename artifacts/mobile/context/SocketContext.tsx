/**
 * SocketContext — manages the Socket.IO connection to the MetroEast API server.
 * Socket instance is stored in state so children re-render when it becomes available.
 */
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

const API_HOST = `https://${process.env.EXPO_PUBLIC_DOMAIN ?? 'localhost'}`;
const SOCKET_PATH = '/api/socket.io';

// Start on polling (plain HTTP) rather than a raw websocket upgrade, on every platform.
// In the Replit dev workspace the API server runs behind a same-origin dev proxy (see
// metro.config.js) that only forwards regular HTTP requests, not the websocket upgrade
// handshake — a direct websocket attempt 502s there, on native as well as web, since both
// reach the API through the same Metro dev server. Polling still opportunistically
// upgrades to a websocket once connected outside of that constrained dev setup (e.g. in
// production, where the API is the same origin for real). Voice audio (context/voice.tsx
// in app/(tabs)) is sent as base64 text rather than raw ArrayBuffers specifically so this
// polling-first setup works on native too — React Native's Blob polyfill can't build a
// Blob from an ArrayBuffer, which is what Socket.IO's polling transport does internally to
// pack binary payloads for XHR.
const SOCKET_TRANSPORTS = ['polling', 'websocket'];

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextType>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: React.ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  // Keep a ref so we can clean up on unmount even if state updates are batched
  const sockRef = useRef<Socket | null>(null);

  useEffect(() => {
    const sock = io(API_HOST, {
      path: SOCKET_PATH,
      transports: SOCKET_TRANSPORTS,
      reconnection: true,
      reconnectionDelay: 1500,
      reconnectionAttempts: Infinity,
      timeout: 10_000,
    });

    sockRef.current = sock;
    setSocket(sock);

    sock.on('connect', () => setConnected(true));
    sock.on('disconnect', () => setConnected(false));
    sock.on('connect_error', () => setConnected(false));

    return () => {
      sock.disconnect();
      sockRef.current = null;
      setSocket(null);
      setConnected(false);
    };
  }, []);

  return (
    <SocketContext.Provider value={{ socket, connected }}>
      {children}
    </SocketContext.Provider>
  );
}

export const useSocket = () => useContext(SocketContext);
