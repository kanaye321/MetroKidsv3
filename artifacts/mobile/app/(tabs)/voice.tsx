/**
 * Voice screen — PTT and Open Mic with real-time Mumble voice gateway.
 * Audio is relayed through the MetroEast API server → Mumble server.
 * Mumble: flash.redmumble.eu:64787  (username = rider's assigned name)
 */
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Platform, ScrollView, Alert } from 'react-native';
import Animated, {
  useSharedValue, useAnimatedStyle,
  withRepeat, withSequence, withTiming, cancelAnimation, Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Audio, InterruptionModeIOS, InterruptionModeAndroid } from 'expo-av';
// Recording format/encoder enums live under the `Audio` namespace (unlike InterruptionMode*,
// which are top-level exports) — Audio.AndroidOutputFormat, Audio.IOSOutputFormat, etc.
// Use the legacy FileSystem API — it keeps cacheDirectory/writeAsStringAsync/EncodingType,
// which the new expo-file-system v19 default export replaced with a class-based API.
import * as FileSystem from 'expo-file-system/legacy';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { useSocket } from '@/context/SocketContext';
import { ConnectionBadge } from '@/components/ConnectionBadge';

const WEB_TAB_BAR_HEIGHT = 64;
const IOS_TAB_BAR_HEIGHT = 49;
const ANDROID_TAB_BAR_HEIGHT = 56;
const MUMBLE_SERVER = 'flash.redmumble.eu:64787';
const CHUNK_MS = 900; // continuous audio is sliced into short chunks so Open Mic streams in near-real-time
// Software noise gate: chunks whose average recorded level stays below this (dBFS, 0 = loudest,
// -160 = silence) are treated as background noise/room hiss rather than speech and never sent.
const NOISE_GATE_DB = -38;
// Adaptive noise floor sits this many dB above the quietest recent metering samples.
const NOISE_FLOOR_MARGIN_DB = 8;
// After playback ends, keep the mic muted briefly so speaker bleed doesn't get re-transmitted.
const ECHO_COOLDOWN_MS = 350;

type VoiceMode = 'ptt' | 'openmic';

// Speech-tuned recording options — mono, moderate sample rate, real AAC (not the LOW_QUALITY
// preset's AMR_NB/MIN-quality codecs, which sound muffled/garbled for voice chat).
const VOICE_RECORDING_OPTIONS: Audio.RecordingOptions = {
  isMeteringEnabled: true, // needed for the noise gate below
  android: {
    extension: '.m4a',
    outputFormat: Audio.AndroidOutputFormat.MPEG_4,
    audioEncoder: Audio.AndroidAudioEncoder.AAC,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
  },
  ios: {
    extension: '.m4a',
    outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
    audioQuality: Audio.IOSAudioQuality.HIGH,
    sampleRate: 22050,
    numberOfChannels: 1,
    bitRate: 64000,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: {
    mimeType: 'audio/webm',
    bitsPerSecond: 64000,
  },
};

// ── Pure-JS base64 encode (no extra deps, works with RN ArrayBuffers) ──────────
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    result += chars[bytes[i] >> 2];
    result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    result += chars[((bytes[i + 1] & 15) << 2) | (bytes[i + 2] >> 6)];
    result += chars[bytes[i + 2] & 63];
  }
  const rem = bytes.length - i;
  if (rem === 1) {
    result += chars[bytes[i] >> 2];
    result += chars[(bytes[i] & 3) << 4];
    result += '==';
  } else if (rem === 2) {
    result += chars[bytes[i] >> 2];
    result += chars[((bytes[i] & 3) << 4) | (bytes[i + 1] >> 4)];
    result += chars[(bytes[i + 1] & 15) << 2];
    result += '=';
  }
  return result;
}

// ── Pure-JS base64 decode (counterpart to arrayBufferToBase64 above) ───────────
function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/=+$/, '');
  const byteLength = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(byteLength);
  let byteIndex = 0;
  for (let i = 0; i + 3 < clean.length; i += 4) {
    const c0 = chars.indexOf(clean[i]);
    const c1 = chars.indexOf(clean[i + 1]);
    const c2 = i + 2 < clean.length ? chars.indexOf(clean[i + 2]) : -1;
    const c3 = i + 3 < clean.length ? chars.indexOf(clean[i + 3]) : -1;
    bytes[byteIndex++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0) bytes[byteIndex++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 >= 0) bytes[byteIndex++] = ((c2 & 3) << 6) | c3;
  }
  return bytes.buffer;
}

// Lets the mic record and voice playback run at the same time, on both platforms.
async function configureSimultaneousAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    interruptionModeIOS: InterruptionModeIOS.MixWithOthers,
    shouldDuckAndroid: true,
    interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
  });
}

// ── Rider card ─────────────────────────────────────────────────────────────────
function RiderIntercomCard({ nickname, avatarColor, connectionType, isSpeaking, isCurrentUser }: {
  nickname: string; avatarColor: string; connectionType: 'bluetooth' | 'network' | 'offline';
  isSpeaking?: boolean; isCurrentUser?: boolean;
}) {
  const colors = useColors();
  const glow = useSharedValue(0);

  useEffect(() => {
    if (isSpeaking) {
      glow.value = withRepeat(
        withSequence(withTiming(1, { duration: 400 }), withTiming(0.3, { duration: 400 })),
        -1, false,
      );
    } else { cancelAnimation(glow); glow.value = withTiming(0, { duration: 200 }); }
  }, [isSpeaking]);

  const cardStyle = useAnimatedStyle(() => ({
    borderColor: isSpeaking ? `rgba(255,77,0,${0.4 + glow.value * 0.6})` : isCurrentUser ? colors.primary + '55' : colors.border,
    borderWidth: isSpeaking ? 2 : isCurrentUser ? 1.5 : 1,
  }));

  return (
    <Animated.View style={[styles.riderCard, { backgroundColor: colors.card }, cardStyle]}>
      <View style={[styles.riderAvatar, { backgroundColor: avatarColor + '22', borderColor: avatarColor }]}>
        <Text style={[styles.riderInitial, { color: avatarColor }]}>{nickname.charAt(0)}</Text>
      </View>
      <View style={[styles.onlineDot, {
        backgroundColor: connectionType === 'bluetooth' ? colors.success : connectionType === 'network' ? colors.network : colors.offline,
      }]} />
      {isSpeaking && <View style={[styles.speakBadge, { backgroundColor: colors.primary }]}><Ionicons name="mic" size={8} color="#fff" /></View>}
      <Text style={[styles.riderName, { color: colors.foreground }]} numberOfLines={1}>{isCurrentUser ? 'You' : nickname}</Text>
      {connectionType !== 'offline' ? <ConnectionBadge type={connectionType} size="sm" /> : <Text style={[styles.offlineLabel, { color: colors.offline }]}>Offline</Text>}
    </Animated.View>
  );
}

// ── Waveform ───────────────────────────────────────────────────────────────────
function LiveWaveform({ color }: { color: string }) {
  const hs = [4, 10, 16, 22, 18, 26, 14, 20, 8, 24, 12, 18, 6];
  return (
    <View style={styles.waveform}>
      {hs.map((h, i) => {
        const a = useSharedValue(4);
        useEffect(() => {
          const t = setTimeout(() => {
            a.value = withRepeat(withSequence(withTiming(h, { duration: 200 + i * 20, easing: Easing.inOut(Easing.ease) }), withTiming(4, { duration: 200 + i * 20 })), -1, false);
          }, i * 60);
          return () => { clearTimeout(t); cancelAnimation(a); a.value = withTiming(4, { duration: 100 }); };
        }, []);
        return <Animated.View key={i} style={[styles.waveBar, useAnimatedStyle(() => ({ height: a.value })), { backgroundColor: color }]} />;
      })}
    </View>
  );
}

// ── Pulse rings ────────────────────────────────────────────────────────────────
function PulseRings({ active, color }: { active: boolean; color: string }) {
  const r1 = useSharedValue(0), r2 = useSharedValue(0);
  useEffect(() => {
    if (active) {
      r1.value = withRepeat(withSequence(withTiming(0.55, { duration: 500 }), withTiming(0.15, { duration: 500 })), -1, false);
      r2.value = withRepeat(withSequence(withTiming(0.28, { duration: 800 }), withTiming(0.05, { duration: 800 })), -1, false);
    } else { cancelAnimation(r1); cancelAnimation(r2); r1.value = withTiming(0, { duration: 250 }); r2.value = withTiming(0, { duration: 250 }); }
  }, [active]);
  return (
    <>
      <Animated.View style={[styles.ring, { borderColor: color + '99' }, useAnimatedStyle(() => ({ opacity: r2.value }))]} />
      <Animated.View style={[styles.ring, { borderColor: color + 'cc', transform: [{ scale: 0.82 }] }, useAnimatedStyle(() => ({ opacity: r1.value }))]} />
    </>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function VoiceScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, rideGroup, connectedRiders } = useApp();
  const { socket } = useSocket();

  const [mode, setMode] = useState<VoiceMode>('ptt');
  const [channel, setChannel] = useState<'bluetooth' | 'network'>('bluetooth');
  const [isPttActive, setIsPttActive] = useState(false);
  const [isLive, setIsLive] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [liveDuration, setLiveDuration] = useState(0);
  const [mumbleConnected, setMumbleConnected] = useState(false);
  const [mumbleError, setMumbleError] = useState('');
  const [mumbleUsers, setMumbleUsers] = useState(0);
  const [noiseRemoval, setNoiseRemoval] = useState(true);
  const [echoRemoval, setEchoRemoval] = useState(true);
  const [recordingRef] = useState<{ current: Audio.Recording | null }>({ current: null });
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isTransmittingRef = useRef(false);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const echoCooldownUntilRef = useRef(0);
  const noiseFloorRef = useRef(NOISE_GATE_DB);
  const currentSoundRef = useRef<Audio.Sound | null>(null);
  const meteringSamplesRef = useRef<number[]>([]);

  const tabH = Platform.select({ web: WEB_TAB_BAR_HEIGHT, ios: IOS_TAB_BAR_HEIGHT, android: ANDROID_TAB_BAR_HEIGHT, default: 0 }) as number;
  const topPad = Platform.OS === 'web' ? WEB_TAB_BAR_HEIGHT + 3 : insets.top;
  const bottomPad = Platform.OS === 'web' ? tabH : tabH + insets.bottom;

  // PTT scale
  const pttScale = useSharedValue(1);
  const pttScaleStyle = useAnimatedStyle(() => ({ transform: [{ scale: pttScale.value }] }));

  // ── Mumble socket events ──────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;
    const onMumbleStatus = ({ connected, error, channelUsers }: any) => {
      setMumbleConnected(!!connected);
      setMumbleError(error ?? '');
      setMumbleUsers(channelUsers ?? 0);
    };
    socket.on('mumble:status', onMumbleStatus);
    return () => { socket.off('mumble:status', onMumbleStatus); };
  }, [socket]);

  // Auto-connect to Mumble when in a group
  useEffect(() => {
    if (socket && rideGroup) {
      socket.emit('voice:join');
    }
    return () => {
      if (socket) socket.emit('voice:leave');
    };
  }, [socket, rideGroup?.inviteCode]);

  // Adaptive noise floor — track the quietest recent metering so the gate can rise above
  // engine/wind hiss without clipping normal speech.
  const updateNoiseFloor = (samples: number[]) => {
    if (!samples.length) return;
    const chunkMin = Math.min(...samples);
    noiseFloorRef.current = Math.min(
      noiseFloorRef.current * 0.92 + chunkMin * 0.08,
      chunkMin,
    );
  };

  const passesNoiseGate = (avgDb: number) => {
    if (!noiseRemoval) return true;
    const adaptiveThreshold = Math.max(
      NOISE_GATE_DB,
      noiseFloorRef.current + NOISE_FLOOR_MARGIN_DB,
    );
    return avgDb >= adaptiveThreshold;
  };

  const isEchoBlocked = () => {
    if (!echoRemoval) return false;
    return isPlayingRef.current || Date.now() < echoCooldownUntilRef.current;
  };
  const requestAudioPermission = async (): Promise<boolean> => {
    if (Platform.OS === 'web') return false;
    const { status } = await Audio.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Microphone Required', 'Allow microphone access to use voice communication.');
      return false;
    }
    return true;
  };

  // Records one short chunk, then (while still transmitting) immediately starts the next —
  // this is what makes Open Mic a continuous stream instead of one clip sent at the end.
  // Reading the finished chunk off disk and sending it over the socket happens in the
  // background (sendChunk, fire-and-forget) so the *next* recording starts with essentially
  // no gap — waiting on that I/O before restarting the mic was dropping audio between chunks
  // and is what made speech sound choppy/unclear even after playback started working.
  const recordOneChunk = async () => {
    meteringSamplesRef.current = [];
    try {
      await configureSimultaneousAudioMode();
      const { recording } = await Audio.Recording.createAsync(VOICE_RECORDING_OPTIONS);
      recording.setProgressUpdateInterval(100);
      recording.setOnRecordingStatusUpdate((status) => {
        if (typeof status.metering === 'number') meteringSamplesRef.current.push(status.metering);
      });
      recordingRef.current = recording;
    } catch (e) { console.warn('Recording error:', e); return; }

    chunkTimerRef.current = setTimeout(async () => {
      const rec = recordingRef.current;
      recordingRef.current = null;
      if (rec) {
        try {
          const avgDb = meteringSamplesRef.current.length
            ? meteringSamplesRef.current.reduce((a, b) => a + b, 0) / meteringSamplesRef.current.length
            : NOISE_GATE_DB - 1; // no samples captured — treat as silence, don't send
          updateNoiseFloor(meteringSamplesRef.current);
          await rec.stopAndUnloadAsync();
          sendChunk(rec.getURI(), avgDb);
        } catch (e) { console.warn('Stop recording error:', e); }
      }
      if (isTransmittingRef.current) await recordOneChunk();
    }, CHUNK_MS);
  };

  // Reads a finished chunk's audio file and relays it over the socket. Runs detached from
  // the record loop above so it never delays starting the next chunk.
  // Gates the send in two ways: a noise gate (skip chunks quieter than NOISE_GATE_DB — ambient
  // engine/wind/road hiss instead of speech) and a half-duplex check (skip while we're actively
  // playing back someone else's audio, since transmitting then would let the phone speaker's
  // output get picked back up by the mic as echo — real acoustic echo cancellation needs a
  // native audio pipeline, so this walkie-talkie-style "don't talk over playback" is the
  // practical mitigation available without one).
  const sendChunk = (uri: string | null, avgDb?: number) => {
    if (!uri || !socket) return;
    if (avgDb != null && !passesNoiseGate(avgDb)) return;
    if (isEchoBlocked()) return;
    (async () => {
      try {
        const response = await fetch(uri);
        const blob = await response.blob();
        const reader = new FileReader();
        reader.onload = () => {
          const buf = reader.result as ArrayBuffer;
          // Sent as base64 text, not the raw ArrayBuffer — Socket.IO's polling transport
          // (used in this dev workspace on every platform, see SocketContext.tsx) encodes
          // binary payloads via a Blob internally, which React Native's Blob polyfill
          // can't build from an ArrayBuffer. Text sidesteps that entirely.
          if (buf && buf.byteLength > 0) socket.emit('voice:audio', arrayBufferToBase64(buf));
        };
        reader.readAsArrayBuffer(blob);
      } catch (e) { console.warn('Send chunk error:', e); }
    })();
  };

  // Stops recording immediately (used when ending transmission) and sends whatever was
  // captured so far (skipping the noise gate — an explicit PTT release/end-broadcast tail is
  // usually intentional speech, and is short enough not to matter either way).
  const flushChunk = async () => {
    const rec = recordingRef.current;
    if (!rec) return;
    recordingRef.current = null;
    try {
      await rec.stopAndUnloadAsync();
      sendChunk(rec.getURI());
    } catch (e) { console.warn('Stop recording error:', e); }
  };

  const startTransmission = useCallback(async () => {
    if (!await requestAudioPermission()) return;
    isTransmittingRef.current = true;
    await recordOneChunk();
  }, []);

  const stopTransmission = useCallback(async () => {
    isTransmittingRef.current = false;
    if (chunkTimerRef.current) { clearTimeout(chunkTimerRef.current); chunkTimerRef.current = null; }
    await flushChunk();
  }, []);

  // ── Voice playback (received chunks from other riders / Mumble) ───────────
  const playNextInQueue = useCallback(async () => {
    if (isPlayingRef.current) return;
    const chunk = playQueueRef.current.shift();
    if (!chunk) return;
    isPlayingRef.current = true;
    const fileUri = `${FileSystem.cacheDirectory}rl_voice_${Date.now()}_${Math.random().toString(36).slice(2)}.m4a`;
    try {
      await configureSimultaneousAudioMode();
      const base64 = arrayBufferToBase64(chunk);
      await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
      const { sound } = await Audio.Sound.createAsync({ uri: fileUri }, { shouldPlay: true });
      currentSoundRef.current = sound;
      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.isLoaded && status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
          isPlayingRef.current = false;
          echoCooldownUntilRef.current = Date.now() + ECHO_COOLDOWN_MS;
          playNextInQueue();
        }
      });
    } catch (e) {
      console.warn('Voice playback error:', e);
      FileSystem.deleteAsync(fileUri, { idempotent: true }).catch(() => {});
      isPlayingRef.current = false;
      playNextInQueue();
    }
  }, []);

  useEffect(() => {
    if (!socket) return;
    // Audio arrives as a base64 string (see server RideSocket.ts and sendChunk above) —
    // decode it back to bytes before queuing for playback.
    const onIncomingAudio = (payload: string) => {
      if (!payload || typeof payload !== 'string') return;
      const buf = base64ToArrayBuffer(payload);
      if (!buf.byteLength) return;
      // Cap the backlog so a spotty connection can't build up a long lag of stale audio.
      if (playQueueRef.current.length >= 6) playQueueRef.current.shift();
      playQueueRef.current.push(buf);
      playNextInQueue();
    };
    socket.on('voice:audio', onIncomingAudio);
    return () => { socket.off('voice:audio', onIncomingAudio); };
  }, [socket, playNextInQueue]);

  // ── PTT ───────────────────────────────────────────────────────────────────
  const startPtt = useCallback(async () => {
    setIsPttActive(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    pttScale.value = withTiming(0.93, { duration: 100 });
    socket?.emit('voice:speaking', { speaking: true });
    await startTransmission();
  }, [socket, startTransmission]);

  const stopPtt = useCallback(async () => {
    setIsPttActive(false);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    pttScale.value = withTiming(1, { duration: 150 });
    socket?.emit('voice:speaking', { speaking: false });
    await stopTransmission();
  }, [socket, stopTransmission]);

  // ── Open Mic ──────────────────────────────────────────────────────────────
  const toggleLive = useCallback(async () => {
    if (isLive) {
      setIsLive(false); setIsMuted(false); setLiveDuration(0);
      if (timerRef.current) clearInterval(timerRef.current);
      socket?.emit('voice:speaking', { speaking: false });
      await stopTransmission();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    } else {
      setIsLive(true); setLiveDuration(0);
      timerRef.current = setInterval(() => setLiveDuration(d => d + 1), 1000);
      socket?.emit('voice:speaking', { speaking: true });
      await startTransmission();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [isLive, socket, startTransmission, stopTransmission]);

  const toggleMute = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const next = !isMuted;
    setIsMuted(next);
    socket?.emit('voice:speaking', { speaking: !next });
    // Open Mic + muted must actually stop sending audio, and resume streaming on unmute.
    if (next) await stopTransmission();
    else if (isLive) await startTransmission();
  }, [isMuted, isLive, socket, startTransmission, stopTransmission]);

  const switchMode = useCallback(async (m: VoiceMode) => {
    if (m === mode) return;
    if (isLive) { setIsLive(false); setLiveDuration(0); if (timerRef.current) clearInterval(timerRef.current); }
    if (isPttActive) { setIsPttActive(false); pttScale.value = 1; }
    socket?.emit('voice:speaking', { speaking: false });
    await stopTransmission();
    setMode(m);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [mode, isLive, isPttActive, socket, stopTransmission]);

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (chunkTimerRef.current) clearTimeout(chunkTimerRef.current);
    isTransmittingRef.current = false;
    currentSoundRef.current?.unloadAsync().catch(() => {});
  }, []);

  const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const onlineRiders = connectedRiders.filter(r => r.connectionType !== 'offline');
  const isTransmitting = mode === 'ptt' ? isPttActive : (isLive && !isMuted);

  // ── No group state ─────────────────────────────────────────────────────────
  if (!rideGroup) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          <Text style={[styles.title, { color: colors.foreground }]}>Intercom</Text>
        </View>
        <View style={[styles.noGroupState, { paddingBottom: bottomPad + 80 }]}>
          <View style={[styles.noGroupIcon, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="radio-outline" size={38} color={colors.mutedForeground} />
          </View>
          <Text style={[styles.noGroupTitle, { color: colors.foreground }]}>No Active Group</Text>
          <Text style={[styles.noGroupSub, { color: colors.mutedForeground }]}>
            Join or create a ride group to use the group intercom.
          </Text>
          <Pressable style={[styles.goHomeBtn, { backgroundColor: colors.primary }]} onPress={() => router.replace('/(tabs)')}>
            <Ionicons name="people-outline" size={18} color="#fff" />
            <Text style={styles.goHomeBtnText}>Go to Home to Join a Group</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: bottomPad }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.title, { color: colors.foreground }]}>Intercom</Text>
          <Text style={[styles.groupName, { color: colors.mutedForeground }]}>{rideGroup.name} · {connectedRiders.length + 1} riders</Text>
        </View>
        {/* Channel toggle */}
        <View style={[styles.channelToggle, { backgroundColor: colors.muted, borderColor: colors.border }]}>
          <Pressable onPress={() => setChannel('bluetooth')} style={[styles.channelBtn, channel === 'bluetooth' && { backgroundColor: colors.success + '33' }]}>
            <Ionicons name="bluetooth" size={13} color={channel === 'bluetooth' ? colors.success : colors.mutedForeground} />
            <Text style={[styles.channelText, { color: channel === 'bluetooth' ? colors.success : colors.mutedForeground }]}>BLE</Text>
          </Pressable>
          <Pressable onPress={() => setChannel('network')} style={[styles.channelBtn, channel === 'network' && { backgroundColor: colors.network + '33' }]}>
            <Ionicons name="wifi" size={13} color={channel === 'network' ? colors.network : colors.mutedForeground} />
            <Text style={[styles.channelText, { color: channel === 'network' ? colors.network : colors.mutedForeground }]}>NET</Text>
          </Pressable>
        </View>
      </View>

      {/* Mumble status bar */}
      <View style={[styles.mumbleBar, {
        backgroundColor: mumbleConnected ? colors.success + '11' : colors.card,
        borderBottomColor: mumbleConnected ? colors.success + '33' : colors.border,
      }]}>
        <View style={[styles.mumbleDot, { backgroundColor: mumbleConnected ? colors.success : (mumbleError ? colors.destructive : colors.offline) }]} />
        <Text style={[styles.mumbleText, { color: mumbleConnected ? colors.success : colors.mutedForeground }]}>
          {mumbleConnected
            ? `Voice server connected · ${mumbleUsers} on channel`
            : mumbleError || `Connecting to ${MUMBLE_SERVER}…`}
        </Text>
        <Text style={[styles.mumbleServer, { color: colors.mutedForeground }]} numberOfLines={1}>{MUMBLE_SERVER}</Text>
      </View>

      {/* Mode toggle */}
      <View style={[styles.modeBar, { backgroundColor: colors.muted }]}>
        <Pressable onPress={() => switchMode('ptt')} style={[styles.modeBtn, mode === 'ptt' && { backgroundColor: colors.card }]}>
          <Ionicons name="hand-left-outline" size={15} color={mode === 'ptt' ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.modeBtnText, { color: mode === 'ptt' ? colors.primary : colors.mutedForeground }]}>Push to Talk</Text>
        </Pressable>
        <Pressable onPress={() => switchMode('openmic')} style={[styles.modeBtn, mode === 'openmic' && { backgroundColor: colors.card }]}>
          <Ionicons name="radio-outline" size={15} color={mode === 'openmic' ? colors.primary : colors.mutedForeground} />
          <Text style={[styles.modeBtnText, { color: mode === 'openmic' ? colors.primary : colors.mutedForeground }]}>Open Mic</Text>
        </Pressable>
      </View>

      {/* Audio processing toggles */}
      <View style={styles.audioToggles}>
        <Pressable
          onPress={() => { setNoiseRemoval(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={[styles.audioToggle, {
            backgroundColor: noiseRemoval ? colors.success + '18' : colors.card,
            borderColor: noiseRemoval ? colors.success + '55' : colors.border,
          }]}
        >
          <Ionicons name={noiseRemoval ? 'volume-mute' : 'volume-mute-outline'} size={14} color={noiseRemoval ? colors.success : colors.mutedForeground} />
          <Text style={[styles.audioToggleText, { color: noiseRemoval ? colors.success : colors.mutedForeground }]}>Noise Removal</Text>
        </Pressable>
        <Pressable
          onPress={() => { setEchoRemoval(v => !v); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); }}
          style={[styles.audioToggle, {
            backgroundColor: echoRemoval ? colors.network + '18' : colors.card,
            borderColor: echoRemoval ? colors.network + '55' : colors.border,
          }]}
        >
          <Ionicons name={echoRemoval ? 'repeat' : 'repeat-outline'} size={14} color={echoRemoval ? colors.network : colors.mutedForeground} />
          <Text style={[styles.audioToggleText, { color: echoRemoval ? colors.network : colors.mutedForeground }]}>Echo Removal</Text>
        </Pressable>
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Rider grid */}
        {connectedRiders.length > 0 ? (
          <View style={styles.riderGrid}>
            {currentUser && (
              <RiderIntercomCard nickname={currentUser.nickname || currentUser.name} avatarColor={currentUser.avatarColor}
                connectionType="network" isSpeaking={isTransmitting} isCurrentUser />
            )}
            {connectedRiders.map(r => (
              <RiderIntercomCard key={r.id} nickname={r.nickname} avatarColor={r.avatarColor}
                connectionType={r.connectionType} isSpeaking={r.speaking} />
            ))}
          </View>
        ) : (
          <View style={[styles.waitingBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="person-circle-outline" size={28} color={colors.mutedForeground} />
            <Text style={[styles.waitingText, { color: colors.mutedForeground }]}>
              Waiting for riders — share code <Text style={{ color: colors.primary, fontFamily: 'Inter_700Bold' }}>{rideGroup.inviteCode}</Text>
            </Text>
          </View>
        )}

        {/* Status banner */}
        <View style={[styles.statusBanner, {
          backgroundColor: isTransmitting ? colors.primary + '1a' : (isLive && isMuted) ? '#EF444411' : colors.card,
          borderColor: isTransmitting ? colors.primary + '88' : (isLive && isMuted) ? '#EF444444' : colors.border,
        }]}>
          {isTransmitting ? (
            <><LiveWaveform color={colors.primary} />
              <Text style={[styles.statusText, { color: colors.primary }]}>
                {mode === 'openmic' ? '● OPEN MIC' : '● BROADCASTING'} · {onlineRiders.length} RIDER{onlineRiders.length !== 1 ? 'S' : ''}
              </Text></>
          ) : isLive && isMuted ? (
            <><Ionicons name="mic-off" size={18} color="#EF4444" />
              <Text style={[styles.statusText, { color: '#EF4444' }]}>MUTED · TAP MIC TO UNMUTE</Text></>
          ) : (
            <><View style={styles.standbyDots}>{[0, 1, 2].map(i => <View key={i} style={[styles.standbyDot, { backgroundColor: colors.mutedForeground + '55' }]} />)}</View>
              <Text style={[styles.statusText, { color: colors.mutedForeground }]}>
                {onlineRiders.length > 0 ? `${onlineRiders.length} rider${onlineRiders.length !== 1 ? 's' : ''} on channel` : 'Waiting for riders…'}
              </Text></>
          )}
        </View>

        {/* PTT MODE */}
        {mode === 'ptt' && (
          <View style={styles.controlArea}>
            <PulseRings active={isPttActive} color={colors.primary} />
            <Animated.View style={pttScaleStyle}>
              <Pressable onPressIn={startPtt} onPressOut={stopPtt}
                style={[styles.mainBtn, {
                  backgroundColor: isPttActive ? colors.primary : colors.card,
                  borderColor: isPttActive ? colors.primary : colors.border,
                  shadowColor: isPttActive ? colors.primary : 'transparent',
                }]}
              >
                <Ionicons name={isPttActive ? 'mic' : 'mic-outline'} size={46} color={isPttActive ? '#fff' : colors.mutedForeground} />
                <Text style={[styles.mainBtnLabel, { color: isPttActive ? '#fff' : colors.mutedForeground }]}>
                  {isPttActive ? 'RELEASE' : 'HOLD TO TALK'}
                </Text>
              </Pressable>
            </Animated.View>
            <Text style={[styles.modeHint, { color: colors.mutedForeground }]}>
              Hold while speaking. Audio is relayed to all group riders{mumbleConnected ? ' + Mumble channel' : ''}.
            </Text>
          </View>
        )}

        {/* OPEN MIC MODE */}
        {mode === 'openmic' && (
          <View style={styles.controlArea}>
            {isLive && (
              <View style={[styles.liveTimer, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '55' }]}>
                <View style={styles.liveDot} />
                <Text style={[styles.liveTimerText, { color: colors.primary }]}>LIVE  {fmt(liveDuration)}</Text>
              </View>
            )}
            <PulseRings active={isLive && !isMuted} color={colors.primary} />
            <Pressable onPress={toggleLive} style={[styles.mainBtn, {
              backgroundColor: isLive ? '#EF4444' : colors.primary,
              borderColor: isLive ? '#EF4444' : colors.primary,
              shadowColor: isLive ? '#EF4444' : colors.primary,
              shadowOpacity: 0.35, shadowRadius: 18,
            }]}>
              <Ionicons name={isLive ? 'stop-circle' : 'radio'} size={46} color="#fff" />
              <Text style={[styles.mainBtnLabel, { color: '#fff' }]}>{isLive ? 'END BROADCAST' : 'GO LIVE'}</Text>
            </Pressable>
            {isLive && (
              <Pressable onPress={toggleMute} style={[styles.muteBtn, {
                backgroundColor: isMuted ? '#EF444422' : colors.card,
                borderColor: isMuted ? '#EF4444' : colors.border,
              }]}>
                <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={20} color={isMuted ? '#EF4444' : colors.foreground} />
                <Text style={[styles.muteBtnText, { color: isMuted ? '#EF4444' : colors.foreground }]}>
                  {isMuted ? 'Muted — tap to unmute' : 'Tap to mute'}
                </Text>
              </Pressable>
            )}
            <Text style={[styles.modeHint, { color: colors.mutedForeground }]}>
              {isLive
                ? 'Your mic is open to all group riders. Tap mute to silence temporarily.'
                : 'Tap GO LIVE to start hands-free broadcasting to your group.'}
            </Text>
          </View>
        )}

        {connectedRiders.filter(r => r.connectionType === 'offline').length > 0 && (
          <Text style={[styles.offlineNote, { color: colors.offline }]}>
            {connectedRiders.filter(r => r.connectionType === 'offline').length} rider(s) offline
          </Text>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  title: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  groupName: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  channelToggle: { flexDirection: 'row', borderRadius: 20, borderWidth: 1, padding: 2, gap: 2 },
  channelBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 18 },
  channelText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  mumbleBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  mumbleDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  mumbleText: { fontFamily: 'Inter_400Regular', fontSize: 11, flex: 1 },
  mumbleServer: { fontFamily: 'Inter_400Regular', fontSize: 10 },
  modeBar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 16, borderRadius: 14, padding: 4, gap: 4 },
  modeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 10 },
  modeBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  audioToggles: { flexDirection: 'row', marginHorizontal: 16, marginTop: 8, gap: 8 },
  audioToggle: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  audioToggleText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingBottom: 40, gap: 14 },
  riderGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  riderCard: { width: '47%', borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, position: 'relative' },
  riderAvatar: { width: 48, height: 48, borderRadius: 24, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  riderInitial: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  onlineDot: { position: 'absolute', top: 10, right: 10, width: 10, height: 10, borderRadius: 5 },
  speakBadge: { position: 'absolute', top: 8, left: 10, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  riderName: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  offlineLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  waitingBox: { borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', padding: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  waitingText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1, lineHeight: 20 },
  statusBanner: { borderRadius: 14, borderWidth: 1, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', gap: 8 },
  statusText: { fontFamily: 'Inter_700Bold', fontSize: 11, letterSpacing: 1.2 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 32 },
  waveBar: { width: 3, borderRadius: 2 },
  standbyDots: { flexDirection: 'row', gap: 5 },
  standbyDot: { width: 6, height: 6, borderRadius: 3 },
  controlArea: { alignItems: 'center', gap: 16, paddingVertical: 8 },
  ring: { position: 'absolute', width: 160, height: 160, borderRadius: 80, borderWidth: 2 },
  mainBtn: { width: 160, height: 160, borderRadius: 80, borderWidth: 2, alignItems: 'center', justifyContent: 'center', gap: 8, shadowOffset: { width: 0, height: 0 }, shadowRadius: 20, elevation: 10 },
  mainBtnLabel: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1.5 },
  modeHint: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', maxWidth: 260, lineHeight: 18 },
  liveTimer: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, borderWidth: 1 },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF4D00' },
  liveTimerText: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 1 },
  muteBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, borderWidth: 1.5 },
  muteBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  offlineNote: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center' },
  noGroupState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 14 },
  noGroupIcon: { width: 80, height: 80, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  noGroupTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  noGroupSub: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 22 },
  goHomeBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14, marginTop: 6 },
  goHomeBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#fff' },
});
