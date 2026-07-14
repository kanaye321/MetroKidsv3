import React, { createContext, useContext, useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Alert, Platform } from 'react-native';
import { useSocket } from './SocketContext';

export interface RideStats {
  currentSpeed: number;
  avgSpeed: number;
  maxSpeed: number;
  distance: number;   // km
  duration: number;   // seconds
  elevation: number;  // meters gained
}

export interface RideRecord {
  id: string;
  date: string;
  distance: number;
  avgSpeed: number;
  maxSpeed: number;
  duration: number;
  elevation: number;
}

interface RideContextType {
  isRiding: boolean;
  stats: RideStats;
  rideHistory: RideRecord[];
  isSharingRoute: boolean;
  startRide: () => Promise<void>;
  stopRide: () => Promise<void>;
  toggleRouteSharing: () => void;
}

const RideContext = createContext<RideContextType>({} as RideContextType);

const DEFAULT_STATS: RideStats = {
  currentSpeed: 0,
  avgSpeed: 0,
  maxSpeed: 0,
  distance: 0,
  duration: 0,
  elevation: 0,
};

// GPS accuracy tuning — see startRide() watcher for how these are applied.
const MAX_HORIZONTAL_ACCURACY_M = 20;    // discard fixes worse than this (noisy/low-confidence)
const MIN_MOVEMENT_KM = 0.002;           // 2m — below typical GPS jitter while stationary
const MAX_PLAUSIBLE_SPEED_KMH = 220;     // reject a jump implying a faster speed as a spurious fix
const MIN_VERTICAL_ACCURACY_M = 10;      // only trust altitude deltas when vertical accuracy is this good
const SPEED_SMOOTH_ALPHA = 0.35;         // EMA weight for live speed display (higher = more responsive)

// Haversine distance between two GPS points in km
function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ROUTE_SHARE_THROTTLE_MS = 4000;

export function RideProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const [isRiding, setIsRiding] = useState(false);
  const [stats, setStats] = useState<RideStats>({ ...DEFAULT_STATS });
  const [rideHistory, setRideHistory] = useState<RideRecord[]>([]);
  const [isSharingRoute, setIsSharingRoute] = useState(false);

  const statsRef = useRef<RideStats>({ ...DEFAULT_STATS });
  const watcherRef = useRef<Location.LocationSubscription | null>(null);
  const durationRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevPosRef = useRef<{ lat: number; lng: number; alt: number | null; vAcc: number | null; ts: number } | null>(null);
  const breadcrumbsRef = useRef<{ lat: number; lng: number }[]>([]);
  const isSharingRouteRef = useRef(false);
  const lastRouteShareRef = useRef(0);
  const routeShareWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const smoothedSpeedRef = useRef(0);

  const appendBreadcrumb = (lat: number, lng: number) => {
    breadcrumbsRef.current.push({ lat, lng });
    if (isSharingRouteRef.current && socket) {
      const now = Date.now();
      if (now - lastRouteShareRef.current > ROUTE_SHARE_THROTTLE_MS) {
        lastRouteShareRef.current = now;
        socket.emit('route:share', { points: breadcrumbsRef.current });
      }
    }
  };

  const stopRouteShareWatcher = () => {
    routeShareWatcherRef.current?.remove();
    routeShareWatcherRef.current = null;
  };

  const startRouteShareWatcher = async () => {
    if (Platform.OS === 'web' || routeShareWatcherRef.current) return;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      routeShareWatcherRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          if (loc.coords.accuracy != null && loc.coords.accuracy > MAX_HORIZONTAL_ACCURACY_M) return;
          appendBreadcrumb(loc.coords.latitude, loc.coords.longitude);
        },
      );
    } catch {}
  };

  const toggleRouteSharing = () => {
    const next = !isSharingRouteRef.current;
    isSharingRouteRef.current = next;
    setIsSharingRoute(next);
    if (next) {
      breadcrumbsRef.current = [];
      lastRouteShareRef.current = 0;
      if (!watcherRef.current) startRouteShareWatcher();
    } else {
      breadcrumbsRef.current = [];
      socket?.emit('route:clear');
      if (!watcherRef.current) stopRouteShareWatcher();
    }
  };

  useEffect(() => {
    AsyncStorage.getItem('@rl_history').then(val => {
      if (val) {
        try { setRideHistory(JSON.parse(val)); } catch {}
      }
    });
  }, []);

  const startRide = async () => {
    // Request location permission
    if (Platform.OS !== 'web') {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Location Required',
          'Allow location access so RideLink can track your speed and distance.',
          [{ text: 'OK' }]
        );
        return;
      }
    }

    // Reset all state
    statsRef.current = { ...DEFAULT_STATS };
    prevPosRef.current = null;
    breadcrumbsRef.current = [];
    lastRouteShareRef.current = 0;
    smoothedSpeedRef.current = 0;
    setStats({ ...DEFAULT_STATS });
    setIsRiding(true);

    // Duration counter — ticks every second
    durationRef.current = setInterval(() => {
      statsRef.current = { ...statsRef.current, duration: statsRef.current.duration + 1 };
      setStats({ ...statsRef.current });
    }, 1000);

    // GPS watcher — updates speed, distance, elevation
    if (Platform.OS !== 'web') {
      try {
        watcherRef.current = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 500,
            distanceInterval: 1,
          },
          (loc) => {
            const { latitude, longitude, speed, altitude, accuracy, altitudeAccuracy } = loc.coords;
            const ts = loc.timestamp ?? Date.now();

            // Discard low-confidence fixes outright rather than letting them corrupt distance/speed.
            if (accuracy != null && accuracy > MAX_HORIZONTAL_ACCURACY_M) return;

            // Prefer device-reported GPS speed; fall back to distance/time-derived speed.
            let rawSpeedKmh = speed != null && speed >= 0
              ? speed * 3.6
              : 0;

            let distanceDelta = 0;
            if (prevPosRef.current) {
              const rawDelta = haversineKm(
                prevPosRef.current.lat, prevPosRef.current.lng,
                latitude, longitude
              );
              const elapsedHours = Math.max(ts - prevPosRef.current.ts, 1) / 3_600_000;
              const impliedSpeedKmh = rawDelta / elapsedHours;

              if (rawDelta < MIN_MOVEMENT_KM) {
                distanceDelta = 0;
                rawSpeedKmh = 0;
              } else if (impliedSpeedKmh > MAX_PLAUSIBLE_SPEED_KMH) {
                distanceDelta = 0;
              } else {
                distanceDelta = rawDelta;
                if (speed == null || speed < 0) rawSpeedKmh = impliedSpeedKmh;
              }
            }

            // Smooth live speed for a stable readout while keeping GPS responsiveness.
            const speedKmh = Math.round(
              smoothedSpeedRef.current * (1 - SPEED_SMOOTH_ALPHA) + rawSpeedKmh * SPEED_SMOOTH_ALPHA,
            );
            smoothedSpeedRef.current = speedKmh;

            const distance = statsRef.current.distance + distanceDelta;
            const maxSpeed = Math.max(statsRef.current.maxSpeed, speedKmh);
            const durationHours = statsRef.current.duration / 3600;
            const avgSpeed = durationHours > 0 ? Math.round(distance / durationHours) : 0;

            let elevation = statsRef.current.elevation;
            const vAccOk = altitudeAccuracy == null || altitudeAccuracy <= MIN_VERTICAL_ACCURACY_M;
            if (
              vAccOk &&
              altitude != null &&
              prevPosRef.current?.alt != null &&
              altitude > prevPosRef.current.alt
            ) {
              elevation += altitude - prevPosRef.current.alt;
            }

            // Only advance prevPos when the fix was actually trusted for distance, so a
            // rejected spurious jump doesn't become the new baseline for the next comparison.
            if (distanceDelta > 0 || !prevPosRef.current) {
              prevPosRef.current = { lat: latitude, lng: longitude, alt: altitude ?? null, vAcc: altitudeAccuracy ?? null, ts };
            } else {
              prevPosRef.current = { ...prevPosRef.current, ts };
            }

            const next: RideStats = {
              ...statsRef.current,
              currentSpeed: speedKmh,
              avgSpeed,
              maxSpeed,
              distance,
              elevation: Math.max(0, elevation),
            };
            statsRef.current = next;
            setStats({ ...next });

            // Route sharing — append every trusted fix to the breadcrumb trail.
            appendBreadcrumb(latitude, longitude);
          }
        );
        if (isSharingRouteRef.current) stopRouteShareWatcher();
      } catch {
        // Location unavailable — duration timer still runs
      }
    }
  };

  const stopRide = async () => {
    if (durationRef.current) {
      clearInterval(durationRef.current);
      durationRef.current = null;
    }
    if (watcherRef.current) {
      watcherRef.current.remove();
      watcherRef.current = null;
    }
    setIsRiding(false);
    if (isSharingRouteRef.current) {
      isSharingRouteRef.current = false;
      setIsSharingRoute(false);
      breadcrumbsRef.current = [];
      socket?.emit('route:clear');
    }
    stopRouteShareWatcher();

    const s = statsRef.current;
    if (s.duration >= 5) {
      const record: RideRecord = {
        id: Date.now().toString(),
        date: new Date().toISOString(),
        distance: s.distance,
        avgSpeed: s.avgSpeed,
        maxSpeed: s.maxSpeed,
        duration: s.duration,
        elevation: Math.round(s.elevation),
      };
      const updated = [record, ...rideHistory].slice(0, 30);
      setRideHistory(updated);
      await AsyncStorage.setItem('@rl_history', JSON.stringify(updated));
    }

    statsRef.current = { ...DEFAULT_STATS };
    setStats({ ...DEFAULT_STATS });
  };

  return (
    <RideContext.Provider value={{ isRiding, stats, rideHistory, isSharingRoute, startRide, stopRide, toggleRouteSharing }}>
      {children}
    </RideContext.Provider>
  );
}

export const useRide = () => useContext(RideContext);
