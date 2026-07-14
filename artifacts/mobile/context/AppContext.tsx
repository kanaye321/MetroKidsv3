/**
 * AppContext — authentication, groups, and real-time rider presence via Socket.IO.
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Platform } from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSocket } from './SocketContext';
import { requestNotificationPermission } from '@/lib/notifications';

export type ConnectionType = 'bluetooth' | 'network' | 'offline';

export interface RiderProfile {
  id: string;
  name: string;
  nickname: string;
  motorcycle: string;
  emergencyContact: string;
  avatarColor: string;
}

export interface GroupMember {
  id: string;
  name: string;
  nickname: string;
  motorcycle: string;
  connectionType: ConnectionType;
  lastSeen: number;
  latitude: number;
  longitude: number;
  speed: number;
  heading: number;
  avatarColor: string;
  speaking?: boolean;
}

export interface RideGroup {
  id: string;
  name: string;
  /** All riders with host privileges — ordered, first entry is the group creator. */
  hostIds: string[];
  inviteCode: string;
}

export interface SharedRoute {
  riderId: string;
  nickname: string;
  color: string;
  points: { lat: number; lng: number }[];
}

interface AppContextType {
  isLoading: boolean;
  isAuthenticated: boolean;
  currentUser: RiderProfile | null;
  rideGroup: RideGroup | null;
  connectionType: ConnectionType;
  bluetoothEnabled: boolean;
  connectedRiders: GroupMember[];
  serverConnected: boolean;
  sharedRoutes: SharedRoute[];
  login: (profile: RiderProfile) => Promise<void>;
  loginAsGuest: () => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (updates: Partial<RiderProfile>) => Promise<void>;
  createGroup: (name: string) => Promise<void>;
  joinGroup: (code: string) => Promise<boolean>;
  leaveGroup: () => Promise<void>;
  addHost: (userId: string) => void;
  removeHost: (userId: string) => void;
  toggleBluetooth: () => void;
  broadcastLocation: (lat: number, lng: number, speed: number, heading: number) => void;
}

const AppContext = createContext<AppContextType>({} as AppContextType);
export const AVATAR_COLORS = ['#3B82F6', '#A855F7', '#22C55E', '#F59E0B', '#EC4899', '#06B6D4'];

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { socket, connected: serverConnected } = useSocket();

  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<RiderProfile | null>(null);
  const [rideGroup, setRideGroup] = useState<RideGroup | null>(null);
  const [connectionType, setConnectionTypeState] = useState<ConnectionType>('network');
  const [bluetoothEnabled, setBluetoothEnabled] = useState(true);
  const [connectedRiders, setConnectedRiders] = useState<GroupMember[]>([]);
  const [sharedRoutes, setSharedRoutes] = useState<SharedRoute[]>([]);
  const presenceWatcherRef = useRef<Location.LocationSubscription | null>(null);

  // ── Load persisted auth/group ─────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [userStr, groupStr] = await Promise.all([
          AsyncStorage.getItem('@rl_user'),
          AsyncStorage.getItem('@rl_group'),
        ]);
        if (userStr) { setCurrentUser(JSON.parse(userStr)); setIsAuthenticated(true); }
        if (groupStr) {
          const parsed = JSON.parse(groupStr);
          // Migrate old leaderId-based format → hostIds array
          if (parsed.leaderId && !parsed.hostIds) {
            parsed.hostIds = [parsed.leaderId];
            delete parsed.leaderId;
            AsyncStorage.setItem('@rl_group', JSON.stringify(parsed)).catch(() => {});
          }
          setRideGroup(parsed);
        }
      } catch {}
      setIsLoading(false);
    })();
  }, []);

  // ── Re-join group on socket reconnect ────────────────────────────────────
  useEffect(() => {
    if (!socket || !serverConnected || !currentUser || !rideGroup) return;
    socket.emit('group:join', {
      code: rideGroup.inviteCode,
      userId: currentUser.id,
      userProfile: currentUser,
    });
  }, [socket, serverConnected, currentUser?.id]);

  // ── Socket event listeners ────────────────────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onCreated = ({ group }: { group: RideGroup }) => {
      setRideGroup(group);
      AsyncStorage.setItem('@rl_group', JSON.stringify(group)).catch(() => {});
      setConnectedRiders([]);
    };

    const onJoined = ({ group, riders }: { group: RideGroup; riders: GroupMember[] }) => {
      setRideGroup(group);
      AsyncStorage.setItem('@rl_group', JSON.stringify(group)).catch(() => {});
      // Exclude self from rider list
      setConnectedRiders(riders.filter(r => r.id !== currentUser?.id));
    };

    const onError = ({ message }: { message: string }) => {
      console.warn('[Socket] group error:', message);
      // Server restarted and wiped in-memory groups — clear stale local state
      // so the user is taken back to the "Join / Create" screen automatically.
      if (message.startsWith('No group with code')) {
        setRideGroup(null);
        setConnectedRiders([]);
        AsyncStorage.removeItem('@rl_group').catch(() => {});
      }
    };

    const onRidersUpdate = ({ riders }: { riders: GroupMember[] }) => {
      setConnectedRiders(riders.filter(r => r.id !== currentUser?.id));
    };

    const onRiderLocation = ({ riderId, lat, lng, speed, heading }: any) => {
      setConnectedRiders(prev => prev.map(r =>
        r.id === riderId
          ? { ...r, latitude: lat, longitude: lng, speed, heading, lastSeen: Date.now() }
          : r,
      ));
    };

    const onVoiceSpeaking = ({ riderId, speaking }: { riderId: string; speaking: boolean }) => {
      setConnectedRiders(prev => prev.map(r =>
        r.id === riderId ? { ...r, speaking } : r,
      ));
    };

    // Shared routes (opt-in breadcrumb trails other riders broadcast) — snapshot on join,
    // then incremental updates/clears as riders toggle sharing on/off.
    const onRouteSnapshot = ({ routes }: { routes: SharedRoute[] }) => {
      setSharedRoutes(routes.filter(r => r.riderId !== currentUser?.id));
    };
    const onRouteUpdate = ({ riderId, points, color, nickname }: { riderId: string; points: { lat: number; lng: number }[]; color: string; nickname: string }) => {
      if (riderId === currentUser?.id) return;
      setSharedRoutes(prev => {
        const others = prev.filter(r => r.riderId !== riderId);
        return [...others, { riderId, points, color, nickname }];
      });
    };
    const onRouteCleared = ({ riderId }: { riderId: string }) => {
      setSharedRoutes(prev => prev.filter(r => r.riderId !== riderId));
    };

    const onHostsUpdated = ({ hostIds }: { hostIds: string[] }) => {
      setRideGroup(prev => {
        if (!prev) return prev;
        const updated = { ...prev, hostIds };
        AsyncStorage.setItem('@rl_group', JSON.stringify(updated)).catch(() => {});
        return updated;
      });
    };

    socket.on('group:created', onCreated);
    socket.on('group:joined', onJoined);
    socket.on('group:error', onError);
    socket.on('riders:update', onRidersUpdate);
    socket.on('rider:location', onRiderLocation);
    socket.on('voice:speaking', onVoiceSpeaking);
    socket.on('route:snapshot', onRouteSnapshot);
    socket.on('route:update', onRouteUpdate);
    socket.on('route:cleared', onRouteCleared);
    socket.on('group:hosts:updated', onHostsUpdated);

    return () => {
      socket.off('group:created', onCreated);
      socket.off('group:joined', onJoined);
      socket.off('group:error', onError);
      socket.off('riders:update', onRidersUpdate);
      socket.off('rider:location', onRiderLocation);
      socket.off('voice:speaking', onVoiceSpeaking);
      socket.off('route:snapshot', onRouteSnapshot);
      socket.off('route:update', onRouteUpdate);
      socket.off('route:cleared', onRouteCleared);
      socket.off('group:hosts:updated', onHostsUpdated);
    };
  }, [socket, currentUser?.id]);

  // ── Continuous presence broadcast ─────────────────────────────────────────
  // Keeps connectedRiders' lat/lng fresh on everyone else's map while a rider is simply in
  // the group and using the app — not just during a ride or an SOS. Lower accuracy/frequency
  // than active ride tracking (RideContext) since this only needs to be "good enough for a
  // dot on the map", not turn-by-turn.
  useEffect(() => {
    if (Platform.OS === 'web' || !socket || !serverConnected || !currentUser || !rideGroup) return;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || cancelled) return;
      try {
        presenceWatcherRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, timeInterval: 4000, distanceInterval: 8 },
          (loc) => {
            if (loc.coords.accuracy != null && loc.coords.accuracy > 30) return;
            socket.emit('rider:location', {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              speed: loc.coords.speed != null && loc.coords.speed >= 0 ? Math.round(loc.coords.speed * 3.6) : 0,
              heading: loc.coords.heading ?? 0,
            });
          }
        );
      } catch {}
    })();

    return () => {
      cancelled = true;
      presenceWatcherRef.current?.remove();
      presenceWatcherRef.current = null;
    };
  }, [socket, serverConnected, currentUser?.id, rideGroup?.inviteCode]);

  // ── Notifications ─────────────────────────────────────────────────────────
  // Ask for the OS notification permission once a rider is signed in (covers both a
  // fresh login and reopening the app with a persisted session). Requesting is a no-op
  // if the user already granted or already denied it — no repeat prompts.
  useEffect(() => {
    if (!isAuthenticated || Platform.OS === 'web') return;
    requestNotificationPermission().catch(() => {});
  }, [isAuthenticated]);

  // ── Auth ──────────────────────────────────────────────────────────────────
  const login = async (profile: RiderProfile) => {
    await AsyncStorage.setItem('@rl_user', JSON.stringify(profile));
    setCurrentUser(profile);
    setIsAuthenticated(true);
  };

  const loginAsGuest = async () => {
    const profile: RiderProfile = {
      id: Date.now().toString(),
      name: 'Guest Rider',
      nickname: 'Rider',
      motorcycle: '',
      emergencyContact: '',
      avatarColor: AVATAR_COLORS[0],
    };
    await login(profile);
  };

  const logout = async () => {
    socket?.emit('group:leave');
    await AsyncStorage.multiRemove(['@rl_user', '@rl_group']);
    setCurrentUser(null); setIsAuthenticated(false);
    setRideGroup(null); setConnectedRiders([]);
  };

  const updateProfile = async (updates: Partial<RiderProfile>) => {
    if (!currentUser) return;
    const updated = { ...currentUser, ...updates };
    await AsyncStorage.setItem('@rl_user', JSON.stringify(updated));
    setCurrentUser(updated);
  };

  // ── Group management ──────────────────────────────────────────────────────
  const createGroup = useCallback(async (name: string) => {
    if (!currentUser) return;
    if (!socket || !serverConnected) {
      // Offline fallback — generate local group
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      const group: RideGroup = { id: Date.now().toString(), name, hostIds: [currentUser.id], inviteCode: code };
      await AsyncStorage.setItem('@rl_group', JSON.stringify(group));
      setRideGroup(group); setConnectedRiders([]);
      return;
    }
    socket.emit('group:create', { name, userId: currentUser.id, userProfile: currentUser });
  }, [socket, serverConnected, currentUser]);

  const joinGroup = useCallback(async (code: string): Promise<boolean> => {
    if (!currentUser) return false;
    if (!socket || !serverConnected) {
      const group: RideGroup = { id: Date.now().toString(), name: 'Ride Group', hostIds: [], inviteCode: code.toUpperCase() };
      await AsyncStorage.setItem('@rl_group', JSON.stringify(group));
      setRideGroup(group); setConnectedRiders([]);
      return true;
    }
    socket.emit('group:join', { code, userId: currentUser.id, userProfile: currentUser });
    return true;
  }, [socket, serverConnected, currentUser]);

  const leaveGroup = useCallback(async () => {
    socket?.emit('group:leave');
    await AsyncStorage.removeItem('@rl_group');
    setRideGroup(null); setConnectedRiders([]);
  }, [socket]);

  const addHost = useCallback((userId: string) => {
    socket?.emit('group:host:add', { targetUserId: userId });
  }, [socket]);

  const removeHost = useCallback((userId: string) => {
    socket?.emit('group:host:remove', { targetUserId: userId });
  }, [socket]);

  const broadcastLocation = useCallback((lat: number, lng: number, speed: number, heading: number) => {
    socket?.emit('rider:location', { lat, lng, speed, heading });
  }, [socket]);

  const toggleBluetooth = () => {
    setBluetoothEnabled(prev => {
      const next = !prev;
      setConnectionTypeState(next ? 'bluetooth' : 'network');
      return next;
    });
  };

  return (
    <AppContext.Provider value={{
      isLoading, isAuthenticated, currentUser, rideGroup,
      connectionType, bluetoothEnabled, connectedRiders, serverConnected, sharedRoutes,
      login, loginAsGuest, logout, updateProfile,
      createGroup, joinGroup, leaveGroup, addHost, removeHost, toggleBluetooth, broadcastLocation,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
