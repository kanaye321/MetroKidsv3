/**
 * RideSocket — all Socket.IO event handlers for the MetroEast RideLink backend.
 * Groups, rider presence, real-time chat, location sharing, voice gateway,
 * and group navigation (destination sync).
 */
import type { Server, Socket } from 'socket.io';
import { mumbleManager } from '../mumble/MumbleManager.js';
import { logger } from '../lib/logger.js';

// ─── In-memory store ──────────────────────────────────────────────────────────

interface NavDestination {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

interface NavWaypoint extends NavDestination {
  id: string;
}

interface GroupRecord {
  id: string;
  name: string;
  inviteCode: string;
  /** All riders with host privileges — first entry is the group creator. */
  hostIds: string[];
  createdAt: number;
  // Navigation
  destination: NavDestination | null;
  waypoints: NavWaypoint[];
}

interface MemberRecord {
  socketId: string;
  userId: string;
  name: string;
  nickname: string;
  motorcycle: string;
  avatarColor: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  lastSeen: number;
  speaking: boolean;
  connectionType: 'bluetooth' | 'network';
}

interface RoutePoint { lat: number; lng: number; }
interface SharedRoute { points: RoutePoint[]; color: string; nickname: string; updatedAt: number; }

// code → group
const groups = new Map<string, GroupRecord>();
// code → members
const members = new Map<string, Map<string, MemberRecord>>();
// socketId → { userId, inviteCode }
const socketMeta = new Map<string, { userId: string; inviteCode: string }>();
// code → userId → shared route (breadcrumb trail a rider has opted to broadcast)
const sharedRoutes = new Map<string, Map<string, SharedRoute>>();

function getRoutesSnapshot(code: string) {
  const m = sharedRoutes.get(code);
  if (!m) return [];
  return Array.from(m.entries()).map(([riderId, r]) => ({ riderId, ...r }));
}

function getOrCreateMembers(code: string) {
  if (!members.has(code)) members.set(code, new Map());
  return members.get(code)!;
}

function broadcastRiders(io: Server, code: string) {
  const m = members.get(code);
  if (!m) return;
  const list = Array.from(m.values()).map(r => ({
    id: r.userId,
    nickname: r.nickname,
    name: r.name,
    motorcycle: r.motorcycle,
    avatarColor: r.avatarColor,
    connectionType: r.connectionType,
    lastSeen: r.lastSeen,
    latitude: r.lat,
    longitude: r.lng,
    speed: r.speed,
    heading: r.heading,
    speaking: r.speaking,
  }));
  io.to(code).emit('riders:update', { riders: list });
}

// ─── Register all socket events ────────────────────────────────────────────────
export function registerSocketEvents(io: Server) {
  io.on('connection', (socket: Socket) => {
    logger.info({ socketId: socket.id }, 'Socket connected');

    // ── Group: create ──────────────────────────────────────────────────────
    socket.on('group:create', ({ name, userId, userProfile }: {
      name: string; userId: string; userProfile: any;
    }) => {
      try {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = '';
        do { code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
        while (groups.has(code));

        const group: GroupRecord = {
          id: `g_${Date.now()}`,
          name: name.trim() || 'Ride Group',
          inviteCode: code,
          hostIds: [userId],
          createdAt: Date.now(),
          destination: null,
          waypoints: [],
        };
        groups.set(code, group);
        getOrCreateMembers(code);

        socket.join(code);
        socketMeta.set(socket.id, { userId, inviteCode: code });

        // Add creator as first member
        getOrCreateMembers(code).set(userId, {
          socketId: socket.id,
          userId,
          name: userProfile.name ?? 'Rider',
          nickname: userProfile.nickname ?? userProfile.name ?? 'Rider',
          motorcycle: userProfile.motorcycle ?? '',
          avatarColor: userProfile.avatarColor ?? '#FF4D00',
          lat: 0, lng: 0, speed: 0, heading: 0,
          lastSeen: Date.now(),
          speaking: false,
          connectionType: 'network',
        });

        socket.emit('group:created', { group: { id: group.id, name: group.name, hostIds: group.hostIds, inviteCode: code } });
        socket.emit('route:snapshot', { routes: getRoutesSnapshot(code) });
        broadcastRiders(io, code);
        logger.info({ code, name, userId }, 'Group created');
      } catch (err) {
        logger.error(err);
        socket.emit('group:error', { message: 'Failed to create group' });
      }
    });

    // ── Group: join ────────────────────────────────────────────────────────
    socket.on('group:join', ({ code, userId, userProfile }: {
      code: string; userId: string; userProfile: any;
    }) => {
      const upperCode = (code ?? '').toUpperCase();
      const group = groups.get(upperCode);
      if (!group) {
        socket.emit('group:error', { message: `No group with code ${upperCode}` });
        return;
      }

      // Leave current group first
      const prev = socketMeta.get(socket.id);
      if (prev) {
        members.get(prev.inviteCode)?.delete(prev.userId);
        socket.leave(prev.inviteCode);
        broadcastRiders(io, prev.inviteCode);
      }

      socket.join(upperCode);
      socketMeta.set(socket.id, { userId, inviteCode: upperCode });

      getOrCreateMembers(upperCode).set(userId, {
        socketId: socket.id,
        userId,
        name: userProfile.name ?? 'Rider',
        nickname: userProfile.nickname ?? userProfile.name ?? 'Rider',
        motorcycle: userProfile.motorcycle ?? '',
        avatarColor: userProfile.avatarColor ?? '#3B82F6',
        lat: 0, lng: 0, speed: 0, heading: 0,
        lastSeen: Date.now(),
        speaking: false,
        connectionType: 'network',
      });

      const memberList = Array.from(getOrCreateMembers(upperCode).values()).map(r => ({
        id: r.userId, nickname: r.nickname, name: r.name,
        motorcycle: r.motorcycle, avatarColor: r.avatarColor,
        connectionType: r.connectionType, lastSeen: r.lastSeen,
        latitude: r.lat, longitude: r.lng, speed: r.speed, heading: r.heading,
        speaking: r.speaking,
      }));

      socket.emit('group:joined', {
        group: { id: group.id, name: group.name, hostIds: group.hostIds, inviteCode: upperCode },
        riders: memberList,
      });
      socket.emit('route:snapshot', { routes: getRoutesSnapshot(upperCode) });

      // Send active group destination to the joining rider
      if (group.destination) {
        socket.emit('nav:destination:update', {
          destination: group.destination,
          waypoints: group.waypoints,
          setBy: group.hostIds[0],
          setAt: group.createdAt,
        });
      }

      broadcastRiders(io, upperCode);
      logger.info({ code: upperCode, userId }, 'Rider joined group');
    });

    // ── Group: leave ───────────────────────────────────────────────────────
    socket.on('group:leave', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      members.get(meta.inviteCode)?.delete(meta.userId);
      sharedRoutes.get(meta.inviteCode)?.delete(meta.userId);
      socket.to(meta.inviteCode).emit('route:cleared', { riderId: meta.userId });
      socket.leave(meta.inviteCode);
      socketMeta.delete(socket.id);
      broadcastRiders(io, meta.inviteCode);
      mumbleManager.disconnectUser(meta.inviteCode, meta.userId);
    });

    // ── Rider: location update ─────────────────────────────────────────────
    socket.on('rider:location', ({ lat, lng, speed, heading }: {
      lat: number; lng: number; speed: number; heading: number;
    }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const member = members.get(meta.inviteCode)?.get(meta.userId);
      if (!member) return;
      member.lat = lat; member.lng = lng;
      member.speed = speed; member.heading = heading;
      member.lastSeen = Date.now();
      // Broadcast only location update (lighter than full rider list)
      socket.to(meta.inviteCode).emit('rider:location', {
        riderId: meta.userId, lat, lng, speed, heading, ts: Date.now(),
      });
    });

    // ── Route: share breadcrumb trail with the group ───────────────────────
    socket.on('route:share', ({ points, color }: { points: RoutePoint[]; color?: string }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const member = members.get(meta.inviteCode)?.get(meta.userId);
      if (!member || !Array.isArray(points)) return;

      const groupRoutes = sharedRoutes.get(meta.inviteCode) ?? new Map<string, SharedRoute>();
      sharedRoutes.set(meta.inviteCode, groupRoutes);
      groupRoutes.set(meta.userId, {
        points: points.slice(-2000), // cap so one rider's trail can't grow unbounded in memory
        color: color ?? member.avatarColor,
        nickname: member.nickname,
        updatedAt: Date.now(),
      });

      socket.to(meta.inviteCode).emit('route:update', {
        riderId: meta.userId, points, color: color ?? member.avatarColor, nickname: member.nickname,
      });
    });

    // ── Route: stop sharing ─────────────────────────────────────────────────
    socket.on('route:clear', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      sharedRoutes.get(meta.inviteCode)?.delete(meta.userId);
      socket.to(meta.inviteCode).emit('route:cleared', { riderId: meta.userId });
    });

    // ── Group: add a host ──────────────────────────────────────────────────
    socket.on('group:host:add', ({ targetUserId }: { targetUserId: string }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const group = groups.get(meta.inviteCode);
      if (!group) return;

      if (!group.hostIds.includes(meta.userId)) {
        socket.emit('group:error', { message: 'Only a host can add another host' });
        return;
      }
      const target = members.get(meta.inviteCode)?.get(targetUserId);
      if (!target) {
        socket.emit('group:error', { message: 'Rider not found in group' });
        return;
      }
      if (!group.hostIds.includes(targetUserId)) {
        group.hostIds = [...group.hostIds, targetUserId];
      }
      io.to(meta.inviteCode).emit('group:hosts:updated', { hostIds: group.hostIds });
      logger.info({ code: meta.inviteCode, targetUserId }, 'Host added');
    });

    // ── Group: remove a host ───────────────────────────────────────────────
    socket.on('group:host:remove', ({ targetUserId }: { targetUserId: string }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const group = groups.get(meta.inviteCode);
      if (!group) return;

      if (!group.hostIds.includes(meta.userId)) {
        socket.emit('group:error', { message: 'Only a host can remove another host' });
        return;
      }
      // Keep at least one host in the group
      if (group.hostIds.length <= 1 && group.hostIds.includes(targetUserId)) {
        socket.emit('group:error', { message: 'The group must have at least one host' });
        return;
      }
      group.hostIds = group.hostIds.filter(id => id !== targetUserId);
      io.to(meta.inviteCode).emit('group:hosts:updated', { hostIds: group.hostIds });
      logger.info({ code: meta.inviteCode, targetUserId }, 'Host removed');
    });

    // ── Navigation: leader sets a group destination ────────────────────────
    socket.on('nav:destination:set', ({ destination, waypoints }: {
      destination: NavDestination;
      waypoints?: NavWaypoint[];
    }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const group = groups.get(meta.inviteCode);
      if (!group) return;

      // Only a host can set the group destination
      if (!group.hostIds.includes(meta.userId)) {
        socket.emit('nav:error', { message: 'Only a group host can set the destination' });
        return;
      }

      group.destination = destination;
      group.waypoints = Array.isArray(waypoints) ? waypoints : [];

      // Broadcast to every rider in the group (including the leader)
      io.to(meta.inviteCode).emit('nav:destination:update', {
        destination: group.destination,
        waypoints: group.waypoints,
        setBy: meta.userId,
        setAt: Date.now(),
      });

      logger.info({ code: meta.inviteCode, destination: destination.name }, 'Group destination set');
    });

    // ── Navigation: leader clears the group destination ────────────────────
    socket.on('nav:destination:clear', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const group = groups.get(meta.inviteCode);
      if (!group) return;

      if (!group.hostIds.includes(meta.userId)) {
        socket.emit('nav:error', { message: 'Only a group host can clear the destination' });
        return;
      }

      group.destination = null;
      group.waypoints = [];

      io.to(meta.inviteCode).emit('nav:destination:cleared', { clearedBy: meta.userId });
      logger.info({ code: meta.inviteCode }, 'Group destination cleared');
    });

    // ── Chat: send message ─────────────────────────────────────────────────
    socket.on('chat:send', ({ content, type, latitude, longitude, address, imageBase64, durationSec }: {
      content: string; type: string; latitude?: number; longitude?: number;
      address?: string; imageBase64?: string; durationSec?: number;
    }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const member = members.get(meta.inviteCode)?.get(meta.userId);
      if (!member) return;

      const msg = {
        id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        senderId: meta.userId,
        senderName: member.name,
        senderNickname: member.nickname,
        avatarColor: member.avatarColor,
        type: type ?? 'text',
        content,
        transport: 'network' as const,
        timestamp: Date.now(),
        latitude,
        longitude,
        address,
        imageBase64,
        durationSec,
      };
      // Broadcast to everyone else in the group — the sender already renders its own
      // message optimistically (see ChatContext.addLocal), so echoing it back here would
      // show up as a second, duplicate bubble for the sender.
      socket.to(meta.inviteCode).emit('chat:message', { message: msg });
    });

    // ── Voice: join Mumble channel ─────────────────────────────────────────
    socket.on('voice:join', async () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const member = members.get(meta.inviteCode)?.get(meta.userId);
      if (!member) return;

      const username = member.nickname || member.name;
      try {
        const conn = await mumbleManager.connectUser(meta.inviteCode, meta.userId, username);
        socket.emit('mumble:status', {
          connected: true,
          server: `${MUMBLE_HOST}:${MUMBLE_PORT}`,
          username,
          channelUsers: mumbleManager.getGroupSize(meta.inviteCode),
        });

        // Relay incoming Mumble audio to the socket. Sent as a base64 string, not a raw
        // Buffer/ArrayBuffer — some Socket.IO client environments (React Native's polling
        // transport in particular) can't encode/decode binary payloads reliably, so voice
        // audio always travels as text over the wire.
        conn.on('audio', (payload: Buffer) => {
          socket.emit('voice:audio', payload.toString('base64'));
        });

        conn.on('close', () => {
          socket.emit('mumble:status', { connected: false });
        });

        logger.info({ username, inviteCode: meta.inviteCode }, 'Voice joined Mumble');
      } catch {
        socket.emit('mumble:status', { connected: false, error: 'Could not reach voice server' });
      }
    });

    // ── Voice: leave Mumble channel ────────────────────────────────────────
    socket.on('voice:leave', () => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      mumbleManager.disconnectUser(meta.inviteCode, meta.userId);
      socket.emit('mumble:status', { connected: false });
    });

    // ── Voice: PTT / open mic speaking state ──────────────────────────────
    socket.on('voice:speaking', ({ speaking }: { speaking: boolean }) => {
      const meta = socketMeta.get(socket.id);
      if (!meta) return;
      const member = members.get(meta.inviteCode)?.get(meta.userId);
      if (member) member.speaking = speaking;
      // Broadcast speaking state to group (so avatars animate)
      socket.to(meta.inviteCode).emit('voice:speaking', { riderId: meta.userId, speaking });
    });

    // ── Voice: audio frame relay ───────────────────────────────────────────
    // Clients always send/receive voice audio as base64 strings (see SocketContext.tsx /
    // voice.tsx on the mobile side) — not raw binary — since React Native's polling
    // transport can't reliably encode ArrayBuffers into Socket.IO packets.
    socket.on('voice:audio', (audioChunkBase64: string) => {
      const meta = socketMeta.get(socket.id);
      if (!meta || typeof audioChunkBase64 !== 'string') return;
      // Relay to all OTHER group members (peer relay)
      socket.to(meta.inviteCode).emit('voice:audio', audioChunkBase64);
      // Also forward to Mumble if connected
      const conn = mumbleManager.getConnection(meta.inviteCode, meta.userId);
      if (conn?.connected) conn.sendAudio(Buffer.from(audioChunkBase64, 'base64'));
    });

    // ── Disconnect cleanup ─────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const meta = socketMeta.get(socket.id);
      if (meta) {
        members.get(meta.inviteCode)?.delete(meta.userId);
        sharedRoutes.get(meta.inviteCode)?.delete(meta.userId);
        socket.to(meta.inviteCode).emit('route:cleared', { riderId: meta.userId });
        socketMeta.delete(socket.id);
        mumbleManager.disconnectUser(meta.inviteCode, meta.userId);
        broadcastRiders(io, meta.inviteCode);
        logger.info({ socketId: socket.id, ...meta }, 'Rider disconnected');
      }
    });
  });
}

const MUMBLE_HOST = 'flash.redmumble.eu';
const MUMBLE_PORT = 64787;
