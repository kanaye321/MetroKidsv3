/**
 * ChatContext — real-time group chat via Socket.IO, with AsyncStorage persistence.
 * Supports: text, location (with map), image, voice note, SOS.
 */
import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import { useSocket } from './SocketContext';
import { useApp } from './AppContext';
import { notifyNewMessage } from '@/lib/notifications';

export type MessageType = 'text' | 'location' | 'voiceNote' | 'sos' | 'image';
export type MessageTransport = 'bluetooth' | 'network';

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  senderNickname: string;
  avatarColor: string;
  type: MessageType;
  content: string;
  transport: MessageTransport;
  timestamp: number;
  latitude?: number;
  longitude?: number;
  address?: string;
  durationSec?: number;
  imageBase64?: string;   // data URI for image messages
}

interface ChatContextType {
  messages: ChatMessage[];
  sendMessage: (content: string, type?: MessageType) => void;
  sendLocation: (lat: number, lng: number) => Promise<void>;
  sendImage: () => Promise<void>;
  sendSOS: () => Promise<void>;
  clearMessages: () => void;
  isSendingImage: boolean;
  setChatFocused: (focused: boolean) => void;
}

function messagePreview(message: ChatMessage): string {
  switch (message.type) {
    case 'image': return '📷 Sent a photo';
    case 'location': return `📍 Shared location${message.address ? ` — ${message.address}` : ''}`;
    case 'voiceNote': return '🎤 Sent a voice note';
    case 'sos': return '🚨 SOS — needs help!';
    default: return message.content;
  }
}

const ChatContext = createContext<ChatContextType>({} as ChatContextType);

export function ChatProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const { currentUser, rideGroup } = useApp();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isSendingImage, setIsSendingImage] = useState(false);
  // Tracks whether the Chat tab is currently on-screen, so we skip notifying about
  // messages the user is already looking at. Set by the Chat screen via useFocusEffect.
  const chatFocusedRef = useRef(false);
  const setChatFocused = useCallback((focused: boolean) => { chatFocusedRef.current = focused; }, []);

  // ── Load persisted messages ───────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('@rl_chat').then(val => {
      if (val) { try { setMessages(JSON.parse(val)); } catch {} }
    });
  }, []);

  // Clear messages when group changes
  useEffect(() => {
    if (!rideGroup) { setMessages([]); AsyncStorage.removeItem('@rl_chat').catch(() => {}); }
  }, [rideGroup?.inviteCode]);

  const persist = (msgs: ChatMessage[]) => {
    // Don't persist raw base64 images (too large) — just store a placeholder
    const safe = msgs.slice(-200).map(m =>
      m.type === 'image' ? { ...m, imageBase64: '[image]' } : m,
    );
    AsyncStorage.setItem('@rl_chat', JSON.stringify(safe)).catch(() => {});
  };

  // ── Receive messages from server ──────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onMessage = ({ message }: { message: ChatMessage }) => {
      setMessages(prev => {
        if (prev.some(m => m.id === message.id)) return prev;
        const next = [...prev, message];
        persist(next);
        return next;
      });
      // Server only relays other members' messages to us (see RideSocket.ts), so any
      // message here is from someone else — pop a notification unless we're already
      // looking at the chat screen.
      if (!chatFocusedRef.current) {
        notifyNewMessage(message.senderNickname || message.senderName, messagePreview(message));
      }
    };

    socket.on('chat:message', onMessage);
    return () => { socket.off('chat:message', onMessage); };
  }, [socket]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const makeLocalId = () =>
    `local_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;

  const addLocal = (msg: ChatMessage) => {
    setMessages(prev => {
      const next = [...prev, msg];
      persist(next);
      return next;
    });
  };

  const emit = (fields: Record<string, unknown>) => {
    if (socket && rideGroup) socket.emit('chat:send', fields);
  };

  // ── Send text ─────────────────────────────────────────────────────────────
  const sendMessage = (content: string, type: MessageType = 'text') => {
    if (!currentUser) return;
    const msg: ChatMessage = {
      id: makeLocalId(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderNickname: currentUser.nickname || currentUser.name,
      avatarColor: currentUser.avatarColor,
      type, content,
      transport: 'network',
      timestamp: Date.now(),
    };
    addLocal(msg);
    emit({ content, type });
  };

  // ── Send location (with reverse geocode address) ──────────────────────────
  const sendLocation = async (lat: number, lng: number) => {
    if (!currentUser) return;

    let address = '';
    try {
      if (Platform.OS !== 'web') {
        const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (place) {
          address = [place.name, place.street, place.city, place.region]
            .filter(Boolean).join(', ');
        }
      }
    } catch {}

    const content = address || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const msg: ChatMessage = {
      id: makeLocalId(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderNickname: currentUser.nickname || currentUser.name,
      avatarColor: currentUser.avatarColor,
      type: 'location', content,
      transport: 'network',
      timestamp: Date.now(),
      latitude: lat, longitude: lng,
      address,
    };
    addLocal(msg);
    emit({ content, type: 'location', latitude: lat, longitude: lng, address });
  };

  // ── Send image ────────────────────────────────────────────────────────────
  const sendImage = async () => {
    if (!currentUser) return;
    setIsSendingImage(true);
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        setIsSendingImage(false);
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.8,
        allowsEditing: false,
      });

      if (result.canceled || !result.assets[0]) {
        setIsSendingImage(false);
        return;
      }

      const asset = result.assets[0];

      // Resize so it's max 600px on the longest side
      const maxSide = 600;
      const w = asset.width ?? maxSide;
      const h = asset.height ?? maxSide;
      const ratio = Math.min(maxSide / w, maxSide / h, 1);
      const manipulated = await ImageManipulator.manipulateAsync(
        asset.uri,
        ratio < 1 ? [{ resize: { width: Math.round(w * ratio), height: Math.round(h * ratio) } }] : [],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG, base64: true },
      );

      const imageBase64 = `data:image/jpeg;base64,${manipulated.base64}`;

      const msg: ChatMessage = {
        id: makeLocalId(),
        senderId: currentUser.id,
        senderName: currentUser.name,
        senderNickname: currentUser.nickname || currentUser.name,
        avatarColor: currentUser.avatarColor,
        type: 'image',
        content: 'Shared a photo',
        imageBase64,
        transport: 'network',
        timestamp: Date.now(),
      };
      addLocal(msg);
      emit({ content: 'Shared a photo', type: 'image', imageBase64 });
    } catch (e) {
      console.warn('sendImage error:', e);
    } finally {
      setIsSendingImage(false);
    }
  };

  // ── Send SOS ─────────────────────────────────────────────────────────────
  const sendSOS = async () => {
    if (!currentUser) return;

    let lat = 0, lng = 0, address = '';
    try {
      if (Platform.OS !== 'web') {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          lat = loc.coords.latitude;
          lng = loc.coords.longitude;
          try {
            const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
            if (place) {
              address = [place.name, place.street, place.city, place.region]
                .filter(Boolean).join(', ');
            }
          } catch {}
        }
      }
    } catch {}

    const content = `🚨 SOS — ${currentUser.nickname || currentUser.name} needs help!${address ? `\n📍 ${address}` : lat ? `\n📍 ${lat.toFixed(5)}, ${lng.toFixed(5)}` : ''}`;

    const msg: ChatMessage = {
      id: makeLocalId(),
      senderId: currentUser.id,
      senderName: currentUser.name,
      senderNickname: currentUser.nickname || currentUser.name,
      avatarColor: currentUser.avatarColor,
      type: 'sos', content,
      transport: 'network',
      timestamp: Date.now(),
      latitude: lat || undefined,
      longitude: lng || undefined,
      address: address || undefined,
    };
    addLocal(msg);
    emit({ content, type: 'sos', latitude: lat || undefined, longitude: lng || undefined, address: address || undefined });
  };

  const clearMessages = () => {
    setMessages([]);
    AsyncStorage.removeItem('@rl_chat').catch(() => {});
  };

  return (
    <ChatContext.Provider value={{
      messages, sendMessage, sendLocation, sendImage, sendSOS, clearMessages, isSendingImage, setChatFocused,
    }}>
      {children}
    </ChatContext.Provider>
  );
}

export const useChat = () => useContext(ChatContext);
