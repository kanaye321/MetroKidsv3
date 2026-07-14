/**
 * NavigationContext — destination search, turn-by-turn navigation,
 * real-time rerouting, route preferences, and high-accuracy location tracking.
 *
 * Architecture:
 *  - Host emits nav:destination:set → server broadcasts to all riders
 *  - Each rider fetches their own route from Google Directions API (client-side)
 *  - Navigation progress runs entirely on-device
 *  - Background High-accuracy watcher always on; upgrades to BestForNavigation during nav
 *  - Route snapping: raw GPS projected onto nearest polyline segment (within 40 m)
 *  - Heading: GPS track heading when speed > 1.5 m/s, compass otherwise
 *  - Route preferences (avoid tolls/highways/ferries, prefer fuel-efficient) persisted
 *    to AsyncStorage and applied to every Directions API call automatically
 */
import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSocket } from './SocketContext';
import { useApp } from './AppContext';

const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY ?? '';
const DIRECTIONS_BASE = 'https://maps.googleapis.com/maps/api/directions/json';
const PLACES_AUTOCOMPLETE_URL = 'https://maps.googleapis.com/maps/api/place/autocomplete/json';
const PLACE_DETAILS_URL = 'https://maps.googleapis.com/maps/api/place/details/json';

const OFF_ROUTE_THRESHOLD_M = 50;
const OFF_ROUTE_REROUTE_DELAY_MS = 8_000;
const ARRIVAL_THRESHOLD_M = 30;
const STEP_ADVANCE_THRESHOLD_M = 25;
const SNAP_THRESHOLD_M = 40; // snap-to-road within 40 m of the active polyline

// ─── Public types ──────────────────────────────────────────────────────────────

export interface RoutePreferences {
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
  preferFuelEfficient: boolean;
}

const DEFAULT_PREFS: RoutePreferences = {
  avoidTolls: false,
  avoidHighways: false,
  avoidFerries: false,
  preferFuelEfficient: false,
};

export interface NavDestination {
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
}

export interface NavWaypoint extends NavDestination {
  id: string;
}

export interface RouteStep {
  instruction: string;
  maneuver: string;
  distanceText: string;
  distanceMeters: number;
  durationText: string;
  durationSeconds: number;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}

export interface RouteOption {
  summary: string;
  polylinePoints: { latitude: number; longitude: number }[];
  steps: RouteStep[];
  durationText: string;
  durationSeconds: number;
  distanceText: string;
  distanceMeters: number;
}

export interface PlacePrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
}

interface NavigationContextType {
  // Live location (shared with map component)
  userLocation: { latitude: number; longitude: number } | null;
  currentHeading: number;
  snappedLocation: { latitude: number; longitude: number } | null;
  gpsAccuracy: number | null;

  // Navigation state
  destination: NavDestination | null;
  waypoints: NavWaypoint[];
  routeOptions: RouteOption[];
  selectedRouteIndex: number;
  currentStepIndex: number;
  isNavigating: boolean;
  isRerouting: boolean;
  isFetchingRoutes: boolean;
  remainingDistanceText: string;
  remainingTimeText: string;

  // Route preferences
  routePreferences: RoutePreferences;
  updateRoutePreferences: (prefs: Partial<RoutePreferences>) => void;

  // Search
  searchPredictions: PlacePrediction[];
  isSearching: boolean;
  searchPlaces: (query: string, userLocation?: { latitude: number; longitude: number } | null) => Promise<void>;
  clearPredictions: () => void;
  getPlaceDetails: (placeId: string) => Promise<NavDestination | null>;

  // Host actions (emit socket events + local optimistic update)
  setGroupDestination: (dest: NavDestination, wps?: NavWaypoint[]) => void;
  clearGroupDestination: () => void;
  addWaypoint: (wp: NavDestination) => void;
  removeWaypoint: (id: string) => void;

  // Rider actions (local only)
  selectRoute: (index: number) => void;
  startNavigation: () => void;
  stopNavigation: () => void;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const poly: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let b: number, shift = 0, result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = 0; result = 0;
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    poly.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return poly;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function nearPolyline(
  lat: number, lng: number,
  points: { latitude: number; longitude: number }[],
  thresholdM: number,
): boolean {
  for (const p of points) {
    if (distanceM(lat, lng, p.latitude, p.longitude) <= thresholdM) return true;
  }
  return false;
}

/**
 * Project (lat, lng) onto the nearest segment of the polyline using perpendicular
 * projection. Returns the snapped coordinate if within thresholdM, otherwise null.
 */
function snapToPolyline(
  lat: number, lng: number,
  points: { latitude: number; longitude: number }[],
  thresholdM: number,
): { latitude: number; longitude: number } | null {
  let bestDist = Infinity;
  let best: { latitude: number; longitude: number } | null = null;

  for (let i = 0; i < points.length - 1; i++) {
    const ax = points[i].longitude, ay = points[i].latitude;
    const bx = points[i + 1].longitude, by = points[i + 1].latitude;
    const dx = bx - ax, dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((lng - ax) * dx + (lat - ay) * dy) / lenSq));
    const projLat = ay + t * dy;
    const projLng = ax + t * dx;
    const d = distanceM(lat, lng, projLat, projLng);
    if (d < bestDist) { bestDist = d; best = { latitude: projLat, longitude: projLng }; }
  }

  return bestDist <= thresholdM ? best : null;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const NavigationContext = createContext<NavigationContextType>({} as NavigationContextType);

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const { socket } = useSocket();
  const { currentUser, rideGroup } = useApp();

  // ── Live location state ─────────────────────────────────────────────────────
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [currentHeading, setCurrentHeading] = useState(0);
  const [snappedLocation, setSnappedLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [gpsAccuracy, setGpsAccuracy] = useState<number | null>(null);

  // ── Navigation state ────────────────────────────────────────────────────────
  const [destination, setDestination] = useState<NavDestination | null>(null);
  const [waypoints, setWaypoints] = useState<NavWaypoint[]>([]);
  const [routeOptions, setRouteOptions] = useState<RouteOption[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isNavigating, setIsNavigating] = useState(false);
  const [isRerouting, setIsRerouting] = useState(false);
  const [isFetchingRoutes, setIsFetchingRoutes] = useState(false);
  const [remainingDistanceText, setRemainingDistanceText] = useState('');
  const [remainingTimeText, setRemainingTimeText] = useState('');
  const [searchPredictions, setSearchPredictions] = useState<PlacePrediction[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // ── Route preferences ───────────────────────────────────────────────────────
  const [routePreferences, setRoutePreferences] = useState<RoutePreferences>(DEFAULT_PREFS);

  // ── Refs (avoid stale closures in async location callbacks) ─────────────────
  const bgSubRef = useRef<Location.LocationSubscription | null>(null);
  const navWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const headingSubRef = useRef<{ remove: () => void } | null>(null);
  const offRouteStartRef = useRef<number | null>(null);
  const destRef = useRef<NavDestination | null>(null);
  const waypointsRef = useRef<NavWaypoint[]>([]);
  const routeOptionsRef = useRef<RouteOption[]>([]);
  const selIdxRef = useRef(0);
  const stepIdxRef = useRef(0);
  const isNavRef = useRef(false);
  // prefsRef lets fetchRoutes read the current prefs without being a dep
  const prefsRef = useRef<RoutePreferences>(DEFAULT_PREFS);
  // Latest compass reading used when GPS heading isn't available
  const compassHeadingRef = useRef(-1);

  // Keep refs in sync with state
  useEffect(() => { destRef.current = destination; }, [destination]);
  useEffect(() => { waypointsRef.current = waypoints; }, [waypoints]);
  useEffect(() => { routeOptionsRef.current = routeOptions; }, [routeOptions]);
  useEffect(() => { selIdxRef.current = selectedRouteIndex; }, [selectedRouteIndex]);
  useEffect(() => { stepIdxRef.current = currentStepIndex; }, [currentStepIndex]);
  useEffect(() => { isNavRef.current = isNavigating; }, [isNavigating]);

  // ── Load persisted preferences ──────────────────────────────────────────────
  useEffect(() => {
    AsyncStorage.getItem('@rl_nav_prefs').then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as Partial<RoutePreferences>;
        const merged = { ...DEFAULT_PREFS, ...saved };
        setRoutePreferences(merged);
        prefsRef.current = merged;
      } catch {}
    });
  }, []);

  // ── Always-on background location watcher (High accuracy, ~1.5 s / 3 m) ───
  const startBgWatcher = useCallback(async () => {
    if (Platform.OS === 'web' || bgSubRef.current) return;
    try {
      bgSubRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1500, distanceInterval: 3 },
        (loc) => {
          const { latitude, longitude, accuracy, heading } = loc.coords;
          setUserLocation({ latitude, longitude });
          setGpsAccuracy(accuracy ?? null);
          // Use GPS track heading when moving
          if (heading != null && heading >= 0) setCurrentHeading(heading);
        },
      );
    } catch {}
  }, []);

  // ── Permission request + initial fix + always-on watchers ──────────────────
  useEffect(() => {
    if (Platform.OS === 'web') return;
    let hdgSub: { remove: () => void } | null = null;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      // Fast initial position
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
        setGpsAccuracy(loc.coords.accuracy ?? null);
      } catch {}

      await startBgWatcher();

      // Compass heading watcher — used when speed is too low for GPS heading
      try {
        hdgSub = await Location.watchHeadingAsync((hdg) => {
          const h = hdg.trueHeading >= 0 ? hdg.trueHeading : hdg.magHeading;
          if (h >= 0) compassHeadingRef.current = h;
        });
        headingSubRef.current = hdgSub;
      } catch {}
    })();

    return () => {
      bgSubRef.current?.remove();
      bgSubRef.current = null;
      hdgSub?.remove();
    };
  }, [startBgWatcher]);

  // ── Fetch directions from Google (reads prefsRef for avoid params) ──────────
  const fetchRoutes = useCallback(async (
    origin: { lat: number; lng: number },
    dest: NavDestination,
    wps: NavWaypoint[],
  ): Promise<RouteOption[]> => {
    if (!GOOGLE_MAPS_KEY) return [];

    const prefs = prefsRef.current;
    const avoids = ([
      prefs.avoidTolls ? 'tolls' : null,
      prefs.avoidHighways ? 'highways' : null,
      prefs.avoidFerries ? 'ferries' : null,
    ] as (string | null)[]).filter((v): v is string => v !== null);
    const avoidParam = avoids.length > 0 ? `&avoid=${avoids.join('|')}` : '';

    const wpParam = wps.length > 0
      ? `&waypoints=optimize:true|${wps.map(w => `${w.lat},${w.lng}`).join('|')}`
      : '';

    const url =
      `${DIRECTIONS_BASE}?origin=${origin.lat},${origin.lng}` +
      `&destination=${dest.lat},${dest.lng}${wpParam}${avoidParam}` +
      `&alternatives=true&mode=driving&key=${GOOGLE_MAPS_KEY}`;

    try {
      const res = await fetch(url);
      const data = await res.json();
      if (data.status !== 'OK' || !Array.isArray(data.routes) || data.routes.length === 0) return [];

      let routes: RouteOption[] = data.routes.slice(0, 3).map((route: any): RouteOption => {
        const totalDuration = route.legs.reduce((s: number, l: any) => s + (l.duration?.value ?? 0), 0);
        const totalDistance = route.legs.reduce((s: number, l: any) => s + (l.distance?.value ?? 0), 0);
        const steps: RouteStep[] = route.legs.flatMap((l: any) =>
          l.steps.map((step: any): RouteStep => ({
            instruction: stripHtml(step.html_instructions ?? ''),
            maneuver: step.maneuver ?? '',
            distanceText: step.distance?.text ?? '',
            distanceMeters: step.distance?.value ?? 0,
            durationText: step.duration?.text ?? '',
            durationSeconds: step.duration?.value ?? 0,
            startLat: step.start_location.lat,
            startLng: step.start_location.lng,
            endLat: step.end_location.lat,
            endLng: step.end_location.lng,
          }))
        );
        return {
          summary: route.summary || 'Route',
          polylinePoints: decodePolyline(route.overview_polyline.points),
          steps,
          durationText: formatDuration(totalDuration),
          durationSeconds: totalDuration,
          distanceText: formatDistance(totalDistance),
          distanceMeters: totalDistance,
        };
      });

      // Fuel-efficient: put shortest-distance route first so it's pre-selected
      if (prefs.preferFuelEfficient && routes.length > 1) {
        routes = [...routes].sort((a, b) => a.distanceMeters - b.distanceMeters);
      }

      return routes;
    } catch {
      return [];
    }
  }, []); // uses prefsRef — no state dep needed

  // ── Refresh routes from current position ────────────────────────────────────
  const refreshRoutes = useCallback(async (
    dest: NavDestination | null,
    wps: NavWaypoint[],
  ) => {
    if (!dest) { setRouteOptions([]); return; }
    setIsFetchingRoutes(true);
    try {
      let origin: { lat: number; lng: number } | null = null;
      if (Platform.OS !== 'web') {
        try {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          origin = { lat: loc.coords.latitude, lng: loc.coords.longitude };
        } catch {}
      }
      if (!origin) return;
      const routes = await fetchRoutes(origin, dest, wps);
      setRouteOptions(routes);
      routeOptionsRef.current = routes;
      setSelectedRouteIndex(0);
      selIdxRef.current = 0;
      setCurrentStepIndex(0);
      stepIdxRef.current = 0;
      if (routes[0]) {
        setRemainingDistanceText(routes[0].distanceText);
        setRemainingTimeText(routes[0].durationText);
      }
    } finally {
      setIsFetchingRoutes(false);
    }
  }, [fetchRoutes]);

  // ── Update route preferences + auto re-fetch ────────────────────────────────
  const updateRoutePreferences = useCallback((partial: Partial<RoutePreferences>) => {
    setRoutePreferences(prev => {
      const updated = { ...prev, ...partial };
      prefsRef.current = updated; // update ref synchronously so fetchRoutes sees it immediately
      AsyncStorage.setItem('@rl_nav_prefs', JSON.stringify(updated)).catch(() => {});
      return updated;
    });
    // Re-fetch with new preferences if a destination is already set.
    // setTimeout(0) ensures prefsRef.current is updated before fetchRoutes reads it.
    const dest = destRef.current;
    const wps = waypointsRef.current;
    if (dest) {
      setTimeout(() => refreshRoutes(dest, wps), 0);
    }
  }, [refreshRoutes]);

  // ── Socket: destination events from server ────────────────────────────────
  useEffect(() => {
    if (!socket) return;

    const onDestUpdate = ({ destination: dest, waypoints: wps }: {
      destination: NavDestination;
      waypoints: NavWaypoint[];
    }) => {
      if (isNavRef.current) {
        navWatcherRef.current?.remove();
        navWatcherRef.current = null;
        isNavRef.current = false;
        setIsNavigating(false);
        startBgWatcher();
      }
      setDestination(dest);
      setWaypoints(wps ?? []);
      setRouteOptions([]);
      setCurrentStepIndex(0);
      setSelectedRouteIndex(0);
      setSnappedLocation(null);
      offRouteStartRef.current = null;
      refreshRoutes(dest, wps ?? []);
    };

    const onDestCleared = () => {
      navWatcherRef.current?.remove();
      navWatcherRef.current = null;
      isNavRef.current = false;
      setIsNavigating(false);
      setDestination(null);
      setWaypoints([]);
      setRouteOptions([]);
      setCurrentStepIndex(0);
      setSelectedRouteIndex(0);
      setSnappedLocation(null);
      setRemainingDistanceText('');
      setRemainingTimeText('');
      offRouteStartRef.current = null;
      startBgWatcher();
    };

    socket.on('nav:destination:update', onDestUpdate);
    socket.on('nav:destination:cleared', onDestCleared);
    return () => {
      socket.off('nav:destination:update', onDestUpdate);
      socket.off('nav:destination:cleared', onDestCleared);
    };
  }, [socket, refreshRoutes, startBgWatcher]);

  // ── High-accuracy nav watcher — step logic + rerouting + snapping ──────────
  const startNavWatcher = useCallback(async () => {
    if (Platform.OS === 'web' || navWatcherRef.current) return;

    // Upgrade accuracy: stop background watcher, start BestForNavigation
    bgSubRef.current?.remove();
    bgSubRef.current = null;

    try {
      navWatcherRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 1000, distanceInterval: 2 },
        async (loc) => {
          const { latitude: rawLat, longitude: rawLng, accuracy, heading, speed } = loc.coords;

          // Always update location state so the map stays live
          setUserLocation({ latitude: rawLat, longitude: rawLng });
          setGpsAccuracy(accuracy ?? null);

          // Heading: GPS track heading when moving (>1.5 m/s ≈ 5.4 km/h), compass otherwise
          if (heading != null && heading >= 0 && (speed ?? 0) > 1.5) {
            setCurrentHeading(heading);
          } else if (compassHeadingRef.current >= 0) {
            setCurrentHeading(compassHeadingRef.current);
          }

          if (!isNavRef.current) return;

          const route = routeOptionsRef.current[selIdxRef.current];
          if (!route) return;

          // Route snapping: project GPS position onto nearest polyline segment
          const snapped = snapToPolyline(rawLat, rawLng, route.polylinePoints, SNAP_THRESHOLD_M);
          setSnappedLocation(snapped);
          // Use snapped position for step logic (keeps rider on the road)
          const navLat = snapped?.latitude ?? rawLat;
          const navLng = snapped?.longitude ?? rawLng;

          const stepIdx = stepIdxRef.current;
          const step = route.steps[stepIdx];
          const lastStep = route.steps[route.steps.length - 1];

          // ── Arrival at destination ────────────────────────────────────────
          if (lastStep && distanceM(navLat, navLng, lastStep.endLat, lastStep.endLng) < ARRIVAL_THRESHOLD_M) {
            navWatcherRef.current?.remove();
            navWatcherRef.current = null;
            isNavRef.current = false;
            setIsNavigating(false);
            setCurrentStepIndex(0);
            stepIdxRef.current = 0;
            setSnappedLocation(null);
            setRemainingDistanceText('Arrived');
            setRemainingTimeText('');
            startBgWatcher(); // resume low-power tracking
            return;
          }

          // ── Step advancement ──────────────────────────────────────────────
          if (step && distanceM(navLat, navLng, step.endLat, step.endLng) < STEP_ADVANCE_THRESHOLD_M) {
            const nextIdx = Math.min(stepIdx + 1, route.steps.length - 1);
            stepIdxRef.current = nextIdx;
            setCurrentStepIndex(nextIdx);
            offRouteStartRef.current = null;
            const remSteps = route.steps.slice(nextIdx);
            setRemainingTimeText(formatDuration(remSteps.reduce((s, st) => s + st.durationSeconds, 0)));
            setRemainingDistanceText(formatDistance(remSteps.reduce((s, st) => s + st.distanceMeters, 0)));
            return;
          }

          // ── Off-route detection → reroute after sustained delay ───────────
          const onRoute = nearPolyline(navLat, navLng, route.polylinePoints, OFF_ROUTE_THRESHOLD_M);
          if (!onRoute) {
            if (!offRouteStartRef.current) {
              offRouteStartRef.current = Date.now();
            } else if (Date.now() - offRouteStartRef.current > OFF_ROUTE_REROUTE_DELAY_MS) {
              offRouteStartRef.current = null;
              setIsRerouting(true);
              const dest = destRef.current;
              const wps = waypointsRef.current;
              if (dest) {
                try {
                  const newRoutes = await fetchRoutes({ lat: rawLat, lng: rawLng }, dest, wps);
                  if (newRoutes.length > 0) {
                    setRouteOptions(newRoutes);
                    routeOptionsRef.current = newRoutes;
                    selIdxRef.current = 0;
                    stepIdxRef.current = 0;
                    setSelectedRouteIndex(0);
                    setCurrentStepIndex(0);
                    setSnappedLocation(null);
                    setRemainingDistanceText(newRoutes[0].distanceText);
                    setRemainingTimeText(newRoutes[0].durationText);
                  }
                } finally {
                  setIsRerouting(false);
                }
              }
            }
          } else {
            offRouteStartRef.current = null;
          }
        },
      );
    } catch {}
  }, [fetchRoutes, startBgWatcher]);

  // ── Host actions ───────────────────────────────────────────────────────────
  const setGroupDestination = useCallback((dest: NavDestination, wps: NavWaypoint[] = []) => {
    socket?.emit('nav:destination:set', { destination: dest, waypoints: wps });
    setDestination(dest);
    setWaypoints(wps);
    setRouteOptions([]);
    setCurrentStepIndex(0);
    setSelectedRouteIndex(0);
    refreshRoutes(dest, wps);
  }, [socket, refreshRoutes]);

  const clearGroupDestination = useCallback(() => {
    socket?.emit('nav:destination:clear');
    navWatcherRef.current?.remove();
    navWatcherRef.current = null;
    isNavRef.current = false;
    setIsNavigating(false);
    setDestination(null);
    setWaypoints([]);
    setRouteOptions([]);
    setCurrentStepIndex(0);
    setSelectedRouteIndex(0);
    setSnappedLocation(null);
    setRemainingDistanceText('');
    setRemainingTimeText('');
    startBgWatcher();
  }, [socket, startBgWatcher]);

  const addWaypoint = useCallback((wp: NavDestination) => {
    const newWp: NavWaypoint = { ...wp, id: `wp_${Date.now()}` };
    const updated = [...waypointsRef.current, newWp];
    setWaypoints(updated);
    const dest = destRef.current;
    if (dest) {
      socket?.emit('nav:destination:set', { destination: dest, waypoints: updated });
      refreshRoutes(dest, updated);
    }
  }, [socket, refreshRoutes]);

  const removeWaypoint = useCallback((id: string) => {
    const updated = waypointsRef.current.filter(w => w.id !== id);
    setWaypoints(updated);
    const dest = destRef.current;
    if (dest) {
      socket?.emit('nav:destination:set', { destination: dest, waypoints: updated });
      refreshRoutes(dest, updated);
    }
  }, [socket, refreshRoutes]);

  // ── Rider actions ──────────────────────────────────────────────────────────
  const selectRoute = useCallback((index: number) => {
    selIdxRef.current = index;
    stepIdxRef.current = 0;
    setSelectedRouteIndex(index);
    setCurrentStepIndex(0);
    const route = routeOptionsRef.current[index];
    if (route) {
      setRemainingDistanceText(route.distanceText);
      setRemainingTimeText(route.durationText);
    }
  }, []);

  const startNavigation = useCallback(() => {
    isNavRef.current = true;
    offRouteStartRef.current = null;
    setIsNavigating(true);
    startNavWatcher();
  }, [startNavWatcher]);

  const stopNavigation = useCallback(() => {
    navWatcherRef.current?.remove();
    navWatcherRef.current = null;
    isNavRef.current = false;
    offRouteStartRef.current = null;
    setIsNavigating(false);
    setCurrentStepIndex(0);
    stepIdxRef.current = 0;
    setSnappedLocation(null);
    startBgWatcher();
  }, [startBgWatcher]);

  // ── Place search ─────────────────────────────────────────────────────────
  const searchPlaces = useCallback(async (
    query: string,
    userLocation?: { latitude: number; longitude: number } | null,
  ) => {
    if (!query.trim() || !GOOGLE_MAPS_KEY) { setSearchPredictions([]); return; }
    setIsSearching(true);
    try {
      const params = new URLSearchParams({
        input: query,
        key: GOOGLE_MAPS_KEY,
        language: 'en',
        region: 'ph',
      });
      if (userLocation) {
        params.set('location', `${userLocation.latitude},${userLocation.longitude}`);
        params.set('radius', '50000');
      }
      const res = await fetch(`${PLACES_AUTOCOMPLETE_URL}?${params.toString()}`);
      const data = await res.json();
      if (data.status === 'ZERO_RESULTS') { setSearchPredictions([]); return; }
      if (data.status !== 'OK') { setSearchPredictions([]); return; }
      setSearchPredictions(
        (data.predictions ?? []).slice(0, 7).map((p: any): PlacePrediction => ({
          placeId: p.place_id,
          description: p.description,
          mainText: p.structured_formatting?.main_text ?? p.description,
          secondaryText: p.structured_formatting?.secondary_text ?? '',
        }))
      );
    } catch {
      setSearchPredictions([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const clearPredictions = useCallback(() => setSearchPredictions([]), []);

  const getPlaceDetails = useCallback(async (placeId: string): Promise<NavDestination | null> => {
    if (!GOOGLE_MAPS_KEY) return null;
    try {
      const url = `${PLACE_DETAILS_URL}?place_id=${placeId}&fields=geometry,name,formatted_address&key=${GOOGLE_MAPS_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status !== 'OK') return null;
      const r = data.result;
      return {
        placeId,
        name: r.name,
        address: r.formatted_address,
        lat: r.geometry.location.lat,
        lng: r.geometry.location.lng,
      };
    } catch {
      return null;
    }
  }, []);

  // Cleanup all watchers on unmount
  useEffect(() => () => {
    bgSubRef.current?.remove();
    navWatcherRef.current?.remove();
    headingSubRef.current?.remove();
  }, []);

  return (
    <NavigationContext.Provider value={{
      userLocation, currentHeading, snappedLocation, gpsAccuracy,
      destination, waypoints, routeOptions, selectedRouteIndex,
      currentStepIndex, isNavigating, isRerouting, isFetchingRoutes,
      remainingDistanceText, remainingTimeText,
      routePreferences, updateRoutePreferences,
      searchPredictions, isSearching,
      searchPlaces, clearPredictions, getPlaceDetails,
      setGroupDestination, clearGroupDestination, addWaypoint, removeWaypoint,
      selectRoute, startNavigation, stopNavigation,
    }}>
      {children}
    </NavigationContext.Provider>
  );
}

export const useNavigation = () => useContext(NavigationContext);
