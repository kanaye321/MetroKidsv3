/**
 * MumbleManager — lightweight Mumble protocol gateway.
 * Connects to the Mumble server on behalf of each rider using TLS + raw protobuf.
 * Server: flash.redmumble.eu:64787
 */
import * as tls from 'tls';
import { EventEmitter } from 'events';
import { logger } from '../lib/logger.js';

const MUMBLE_HOST = 'flash.redmumble.eu';
const MUMBLE_PORT = 64787;

// Mumble control message type IDs
const MT = {
  Version: 0,
  UDPTunnel: 1,
  Authenticate: 2,
  Ping: 3,
  Reject: 4,
  ServerSync: 5,
  ChannelState: 7,
  UserRemove: 8,
  UserState: 9,
  TextMessage: 11,
  CryptSetup: 15,
  CodecVersion: 21,
  ServerConfig: 24,
} as const;

// ─── Minimal protobuf helpers ────────────────────────────────────────────────
function encodeVarint(v: number): Buffer {
  const bytes: number[] = [];
  while (v > 0x7f) { bytes.push((v & 0x7f) | 0x80); v >>>= 7; }
  bytes.push(v & 0x7f);
  return Buffer.from(bytes);
}
function pbUint32(f: number, v: number) {
  return Buffer.concat([encodeVarint((f << 3) | 0), encodeVarint(v)]);
}
function pbString(f: number, s: string) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([encodeVarint((f << 3) | 2), encodeVarint(b.length), b]);
}
function pbBool(f: number, v: boolean) { return pbUint32(f, v ? 1 : 0); }

function mumbleFrame(type: number, ...fields: Buffer[]): Buffer {
  const payload = Buffer.concat(fields);
  const hdr = Buffer.alloc(6);
  hdr.writeUInt16BE(type, 0);
  hdr.writeUInt32BE(payload.length, 2);
  return Buffer.concat([hdr, payload]);
}

// Simple protobuf decoder: returns Map<fieldNum, Buffer|number>
function pbDecode(buf: Buffer): Map<number, Buffer | number | string> {
  const result = new Map<number, Buffer | number | string>();
  let i = 0;
  while (i < buf.length) {
    let tag = 0, shift = 0;
    let b: number;
    do { b = buf[i++]; tag |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const wire = tag & 0x7;
    const field = tag >> 3;
    if (wire === 0) {
      let v = 0; shift = 0;
      do { b = buf[i++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      result.set(field, v);
    } else if (wire === 2) {
      let len = 0; shift = 0;
      do { b = buf[i++]; len |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      const data = buf.slice(i, i + len);
      result.set(field, data.toString('utf8'));
      i += len;
    } else break; // unsupported wire type — stop
  }
  return result;
}

// ─── Per-rider Mumble connection ──────────────────────────────────────────────
export class MumbleUserConnection extends EventEmitter {
  private socket: tls.TLSSocket | null = null;
  private buf = Buffer.alloc(0);
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  public connected = false;
  public session = 0;
  public username: string;

  constructor(username: string) {
    super();
    this.username = username;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Mumble connect timeout')), 10_000);

      this.socket = tls.connect(
        { host: MUMBLE_HOST, port: MUMBLE_PORT, rejectUnauthorized: false },
        () => {
          clearTimeout(timeout);
          logger.info({ username: this.username }, 'Mumble TLS connected');
          // Send Version
          this.send(mumbleFrame(MT.Version,
            pbUint32(1, 0x00010300), // 1.3.0
            pbString(2, 'MetroEast RideLink'),
            pbString(3, 'RN'),
            pbString(4, '1.0'),
          ));
          // Send Authenticate
          this.send(mumbleFrame(MT.Authenticate,
            pbString(1, this.username),
            pbString(2, ''),           // no password
            pbBool(7, true),           // opus = true
          ));
        },
      );

      this.socket.on('data', (chunk: Buffer) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        this.drainFrames();
      });

      this.socket.on('error', (err) => {
        logger.warn({ err, username: this.username }, 'Mumble socket error');
        this.connected = false;
        this.emit('error', err);
        reject(err);
      });

      this.socket.on('close', () => {
        logger.info({ username: this.username }, 'Mumble socket closed');
        this.connected = false;
        if (this.pingTimer) clearInterval(this.pingTimer);
        this.emit('close');
      });

      // Resolve on ServerSync (means authenticated)
      this.once('serverSync', () => {
        this.connected = true;
        clearTimeout(timeout);
        // Start ping every 15s
        this.pingTimer = setInterval(() => {
          const now = BigInt(Date.now());
          // Encode uint64 timestamp manually (low 32 bits sufficient for ping)
          this.send(mumbleFrame(MT.Ping, pbUint32(1, Number(now & 0xffffffffn))));
        }, 15_000);
        resolve();
      });
    });
  }

  /** Send audio frame (opus) through TCP tunnel */
  sendAudio(opusData: Buffer) {
    if (!this.connected || !this.socket) return;
    // UDPTunnel wraps the voice packet: 1-byte voice type + session varint + opus data
    // Voice type: 0x60 = opus normal voice (talking state 0b011 | type 0b00 | target 0)
    const header = Buffer.concat([Buffer.from([0x60]), encodeVarint(this.session)]);
    // Opus packet: length-prefixed
    const lenBuf = encodeVarint(opusData.length);
    const packet = Buffer.concat([header, lenBuf, opusData]);
    this.send(mumbleFrame(MT.UDPTunnel, packet));
  }

  disconnect() {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.socket?.destroy();
    this.socket = null;
    this.connected = false;
  }

  private send(buf: Buffer) {
    try { this.socket?.write(buf); } catch (e) { /* ignore write errors */ }
  }

  private drainFrames() {
    while (this.buf.length >= 6) {
      const type = this.buf.readUInt16BE(0);
      const len = this.buf.readUInt32BE(2);
      if (this.buf.length < 6 + len) break;
      const payload = this.buf.slice(6, 6 + len);
      this.buf = this.buf.slice(6 + len);
      this.handleMessage(type, payload);
    }
  }

  private handleMessage(type: number, payload: Buffer) {
    switch (type) {
      case MT.ServerSync: {
        const fields = pbDecode(payload);
        this.session = (fields.get(1) as number) ?? 0;
        const welcome = fields.get(3) as string ?? '';
        this.emit('serverSync', { session: this.session, welcome });
        break;
      }
      case MT.Reject: {
        const fields = pbDecode(payload);
        const reason = fields.get(2) as string ?? 'Unknown';
        logger.warn({ username: this.username, reason }, 'Mumble reject');
        this.emit('rejected', reason);
        break;
      }
      case MT.UserState: {
        const fields = pbDecode(payload);
        this.emit('userState', {
          session: fields.get(1) as number,
          name: fields.get(3) as string,
          channelId: fields.get(5) as number,
        });
        break;
      }
      case MT.UserRemove: {
        const fields = pbDecode(payload);
        this.emit('userRemove', { session: fields.get(1) as number });
        break;
      }
      case MT.UDPTunnel:
        // Incoming audio from other users — relay to group via socket event
        this.emit('audio', payload);
        break;
      case MT.TextMessage: {
        const fields = pbDecode(payload);
        this.emit('textMessage', { message: fields.get(5) as string });
        break;
      }
    }
  }
}

// ─── Group-level Mumble manager ────────────────────────────────────────────────
export class MumbleManager {
  // inviteCode → Map<userId, MumbleUserConnection>
  private groups = new Map<string, Map<string, MumbleUserConnection>>();

  async connectUser(inviteCode: string, userId: string, username: string): Promise<MumbleUserConnection> {
    if (!this.groups.has(inviteCode)) this.groups.set(inviteCode, new Map());
    const group = this.groups.get(inviteCode)!;

    // Disconnect old connection for same userId if exists
    const existing = group.get(userId);
    if (existing) { existing.disconnect(); group.delete(userId); }

    const conn = new MumbleUserConnection(username);
    group.set(userId, conn);

    try {
      await conn.connect();
      logger.info({ inviteCode, userId, username }, 'Mumble user connected');
    } catch (err) {
      logger.warn({ err, username }, 'Mumble user failed to connect');
      group.delete(userId);
      conn.disconnect();
      throw err;
    }

    conn.once('close', () => group.delete(userId));
    return conn;
  }

  disconnectUser(inviteCode: string, userId: string) {
    this.groups.get(inviteCode)?.get(userId)?.disconnect();
    this.groups.get(inviteCode)?.delete(userId);
  }

  getConnection(inviteCode: string, userId: string): MumbleUserConnection | undefined {
    return this.groups.get(inviteCode)?.get(userId);
  }

  getGroupSize(inviteCode: string): number {
    return this.groups.get(inviteCode)?.size ?? 0;
  }
}

export const mumbleManager = new MumbleManager();
