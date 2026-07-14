/**
 * RideLinkMap (native) — full-featured group map with:
 *  - Live rider markers and breadcrumb routes
 *  - Destination search with Google Places autocomplete (host only)
 *  - Multiple route options with ETA and fuel-efficiency badge
 *  - Active route preferences strip (Avoid Tolls / Highways / Ferries / Eco)
 *  - Route preferences panel (Avoid Tolls, Avoid Highways, Avoid Ferries, Prefer Fuel-Efficient)
 *  - Turn-by-turn navigation panel
 *  - Real-time rerouting banner
 *  - Waypoint support
 *  - Heading-aware camera tracking during navigation (tilt + auto-follow)
 *  - GPS accuracy badge
 *
 * Layout contract:
 *  - All bottom-anchored elements offset by (TAB_BAR_H + insets.bottom) so they
 *    never hide behind the floating tab bar.
 *  - The search overlay is full-screen with the input at the TOP so the keyboard
 *    never obscures the predictions list.
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
  View, Text, Pressable, StyleSheet, TextInput,
  FlatList, ActivityIndicator, ScrollView, Platform,
  Modal, Switch,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { GroupMember, SharedRoute } from '@/context/AppContext';
import { useNavigation } from '@/context/NavigationContext';
import type { NavDestination, PlacePrediction, RoutePreferences } from '@/context/NavigationContext';

// Height of the bottom tab bar per platform (not including safe area inset)
const TAB_BAR_H = Platform.select({ ios: 49, android: 56, web: 64, default: 56 })!;

// Map maneuver strings → Ionicons names
function maneuverIcon(maneuver: string): keyof typeof Ionicons.glyphMap {
  switch (maneuver) {
    case 'turn-right':
    case 'turn-sharp-right': return 'arrow-forward';
    case 'turn-left':
    case 'turn-sharp-left': return 'arrow-back';
    case 'roundabout-right': return 'arrow-redo';
    case 'roundabout-left': return 'arrow-undo';
    case 'uturn-right':
    case 'uturn-left': return 'return-up-back';
    case 'merge': return 'git-merge';
    case 'fork-right':
    case 'fork-left': return 'git-branch';
    case 'ramp-right':
    case 'ramp-left': return 'trending-up';
    default: return 'arrow-up';
  }
}

// ── Helper sub-components ────────────────────────────────────────────────────

function PrefRow({
  icon, label, description, value, onToggle, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  description?: string;
  value: boolean;
  onToggle: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable style={[styles.prefRow, { borderBottomColor: colors.border }]} onPress={onToggle}>
      <View style={[styles.prefIconWrap, { backgroundColor: colors.primary + '18' }]}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={styles.prefLabelCol}>
        <Text style={[styles.prefLabel, { color: colors.foreground }]}>{label}</Text>
        {!!description && (
          <Text style={[styles.prefDescription, { color: colors.mutedForeground }]}>{description}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: colors.border, true: colors.primary + '88' }}
        thumbColor={value ? colors.primary : '#9CA3AF'}
        ios_backgroundColor={colors.border}
      />
    </Pressable>
  );
}

function PrefChip({
  icon, label, colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.prefChip, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '44' }]}>
      <Ionicons name={icon} size={10} color={colors.primary} />
      <Text style={[styles.prefChipText, { color: colors.primary }]}>{label}</Text>
    </View>
  );
}

// ── Props ────────────────────────────────────────────────────────────────────

interface Props {
  connectedRiders: GroupMember[];
  btCount: number;
  netCount: number;
  offlineCount: number;
  sharedRoutes: SharedRoute[];
  isSharingRoute: boolean;
  onToggleShareRoute: () => void;
  isLeader: boolean;
}

const DEFAULT_REGION = { latitude: 0, longitude: 0, latitudeDelta: 60, longitudeDelta: 60 };

// ── Main component ───────────────────────────────────────────────────────────

export default function RideLinkMap({
  connectedRiders, btCount, netCount, offlineCount,
  sharedRoutes, isSharingRoute, onToggleShareRoute, isLeader,
}: Props) {
  const colors = useColors();
  const mapRef = useRef<MapView>(null);
  const { bottom: bottomInset, top: topInset } = useSafeAreaInsets();
  const safeBottom = TAB_BAR_H + bottomInset;

  const [region, setRegion] = useState(DEFAULT_REGION);
  const [prefsVisible, setPrefsVisible] = useState(false);
  // trackingMode: when true the camera auto-follows the rider with heading tilt
  const [trackingMode, setTrackingMode] = useState(false);
  const initializedRef = useRef(false);

  // Search overlay (host only): 'closed' | 'destination' | 'waypoint'
  const [searchMode, setSearchMode] = useState<'closed' | 'destination' | 'waypoint'>('closed');
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<TextInput>(null);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    // Live location — sourced from NavigationContext, no local state needed
    userLocation,
    currentHeading,
    snappedLocation,
    gpsAccuracy,
    // Navigation
    destination, waypoints, routeOptions, selectedRouteIndex,
    currentStepIndex, isNavigating, isRerouting, isFetchingRoutes,
    remainingDistanceText, remainingTimeText,
    // Route preferences
    routePreferences, updateRoutePreferences,
    // Search
    searchPredictions, isSearching,
    searchPlaces, clearPredictions, getPlaceDetails,
    // Actions
    setGroupDestination, clearGroupDestination,
    addWaypoint, removeWaypoint,
    selectRoute, startNavigation, stopNavigation,
  } = useNavigation();

  // ── Initial map position: animate once when userLocation first arrives ──────
  useEffect(() => {
    if (!userLocation || initializedRef.current) return;
    initializedRef.current = true;
    const r = {
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
      latitudeDelta: 0.015,
      longitudeDelta: 0.015,
    };
    setRegion(r);
    mapRef.current?.animateToRegion(r, 800);
  }, [userLocation]);

  // ── Fit route polyline into view when routes load ────────────────────────────
  useEffect(() => {
    if (isNavigating) return; // don't override camera during navigation
    const route = routeOptions[selectedRouteIndex];
    if (!route || route.polylinePoints.length === 0) return;

    const pts = route.polylinePoints;
    const stride = Math.max(1, Math.floor(pts.length / 60));
    const coords = pts.filter((_, i) => i % stride === 0);
    const last = pts[pts.length - 1];
    if (coords[coords.length - 1] !== last) coords.push(last);

    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 80, right: 40, bottom: 300 + safeBottom, left: 40 },
      animated: true,
    });
  }, [routeOptions, selectedRouteIndex, isNavigating]);

  // ── Enable tracking mode when navigation starts ──────────────────────────────
  useEffect(() => {
    if (isNavigating) {
      setTrackingMode(true);
    } else {
      setTrackingMode(false);
    }
  }, [isNavigating]);

  // ── Camera tracking: follow rider with heading tilt during navigation ────────
  useEffect(() => {
    if (!trackingMode || !isNavigating) return;
    const pos = snappedLocation ?? userLocation;
    if (!pos) return;
    mapRef.current?.animateCamera(
      {
        center: { latitude: pos.latitude, longitude: pos.longitude },
        heading: currentHeading,
        pitch: 30,
        zoom: 17,
        altitude: 300,
      },
      { duration: 1000 },
    );
  }, [trackingMode, isNavigating, userLocation, snappedLocation, currentHeading]);

  // Focus input when search opens
  useEffect(() => {
    if (searchMode !== 'closed') {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [searchMode]);

  // ── Search handlers ─────────────────────────────────────────────────────────
  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!text.trim()) { clearPredictions(); return; }
    searchDebounceRef.current = setTimeout(() => searchPlaces(text, userLocation), 350);
  }, [searchPlaces, clearPredictions, userLocation]);

  const closeSearch = useCallback(() => {
    setSearchMode('closed');
    setSearchQuery('');
    clearPredictions();
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
  }, [clearPredictions]);

  const handleSelectPrediction = useCallback(async (pred: PlacePrediction) => {
    const dest = await getPlaceDetails(pred.placeId);
    if (!dest) return;
    if (searchMode === 'waypoint') {
      addWaypoint(dest);
    } else {
      setGroupDestination(dest);
    }
    closeSearch();
  }, [getPlaceDetails, searchMode, addWaypoint, setGroupDestination, closeSearch]);

  // ── Map helpers ─────────────────────────────────────────────────────────────
  const recenter = () => {
    const pos = isNavigating ? (snappedLocation ?? userLocation) : userLocation;
    if (!pos) return;
    if (isNavigating) {
      // Re-enable tracking mode so the camera follows again after a manual pan
      setTrackingMode(true);
    } else {
      const r = { ...pos, latitudeDelta: 0.015, longitudeDelta: 0.015 };
      mapRef.current?.animateToRegion(r, 600);
    }
  };

  const connectionColor = (type: string) => {
    if (type === 'bluetooth') return colors.success;
    if (type === 'network') return colors.network;
    return colors.offline;
  };

  const liveRiders = connectedRiders.filter(r =>
    r.connectionType !== 'offline' &&
    r.latitude !== 0 && r.longitude !== 0 &&
    Date.now() - r.lastSeen < 60_000,
  );

  const selectedRoute = routeOptions[selectedRouteIndex];
  const currentStep = selectedRoute?.steps[currentStepIndex];
  const nextStep = selectedRoute?.steps[currentStepIndex + 1];
  const panelVisible = !isNavigating && !isFetchingRoutes && routeOptions.length > 0 && !!destination;

  const hasActivePrefs =
    routePreferences.avoidTolls ||
    routePreferences.avoidHighways ||
    routePreferences.avoidFerries ||
    routePreferences.preferFuelEfficient;

  // Index of the shortest-distance (most fuel-efficient) route
  const fuelEfficientIdx = routeOptions.length > 1
    ? routeOptions.reduce((bestIdx, r, i) => r.distanceMeters < routeOptions[bestIdx].distanceMeters ? i : bestIdx, 0)
    : -1;

  // GPS accuracy colour
  const gpsColor =
    gpsAccuracy == null ? colors.mutedForeground
    : gpsAccuracy < 10 ? '#22C55E'
    : gpsAccuracy < 50 ? '#F59E0B'
    : '#EF4444';

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <View style={StyleSheet.absoluteFill}>

      {/* ── Map ── */}
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        region={region}
        onRegionChangeComplete={setRegion}
        onPanDrag={() => {
          // User dragged the map — disengage auto-tracking so the camera stops fighting them
          if (trackingMode) setTrackingMode(false);
        }}
        showsUserLocation
        showsCompass
        showsTraffic={isNavigating}
      >
        {/* Rider markers */}
        {liveRiders.map(rider => (
          <Marker
            key={rider.id}
            coordinate={{ latitude: rider.latitude, longitude: rider.longitude }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={rider.nickname}
            description={rider.speed > 0 ? `${rider.speed} km/h` : 'Live'}
          >
            <View style={styles.markerWrap}>
              <View style={[styles.riderMarker, { backgroundColor: connectionColor(rider.connectionType) }]}>
                <Text style={styles.markerInitial}>{rider.nickname.charAt(0)}</Text>
              </View>
              <View style={[styles.markerLabel, { backgroundColor: colors.card + 'EE', borderColor: colors.border }]}>
                <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.markerName, { color: colors.foreground }]} numberOfLines={1}>{rider.nickname}</Text>
              </View>
            </View>
          </Marker>
        ))}

        {/* Breadcrumb routes */}
        {sharedRoutes.map(route => (
          <Polyline
            key={route.riderId}
            coordinates={route.points.map(p => ({ latitude: p.lat, longitude: p.lng }))}
            strokeColor={route.color}
            strokeWidth={3}
            lineDashPattern={[4, 4]}
          />
        ))}

        {/* Navigation route options */}
        {routeOptions.map((route, i) => (
          <Polyline
            key={`route-${i}`}
            coordinates={route.polylinePoints}
            strokeColor={i === selectedRouteIndex ? '#FF4D00' : '#6B7280'}
            strokeWidth={i === selectedRouteIndex ? 5 : 3}
            zIndex={i === selectedRouteIndex ? 2 : 1}
          />
        ))}

        {/* Destination marker */}
        {destination && (
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            anchor={{ x: 0.5, y: 1 }}
            title={destination.name}
            description={destination.address}
          >
            <View style={styles.destMarkerWrap}>
              <View style={[styles.destMarker, { backgroundColor: colors.primary }]}>
                <Ionicons name="flag" size={14} color="#fff" />
              </View>
              <View style={[styles.destPinTail, { backgroundColor: colors.primary }]} />
            </View>
          </Marker>
        )}

        {/* Waypoint markers */}
        {waypoints.map((wp, i) => (
          <Marker
            key={wp.id}
            coordinate={{ latitude: wp.lat, longitude: wp.lng }}
            anchor={{ x: 0.5, y: 0.5 }}
            title={`Stop ${i + 1}: ${wp.name}`}
          >
            <View style={[styles.waypointMarker, { backgroundColor: colors.card, borderColor: colors.primary }]}>
              <Text style={[styles.waypointNum, { color: colors.primary }]}>{i + 1}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* ── Rerouting banner (top) ── */}
      {isRerouting && (
        <View style={[styles.reroutingBanner, { backgroundColor: colors.primary, top: topInset }]}>
          <ActivityIndicator size="small" color="#fff" />
          <Text style={styles.reroutingText}>Rerouting…</Text>
        </View>
      )}

      {/* ── Top overlay: stats + destination chip + GPS accuracy ── */}
      {!isNavigating && (
        <View style={[styles.topOverlay, { top: topInset + 12 }]}>
          <View style={styles.topRow}>
            <View style={[styles.statsBar, { backgroundColor: colors.card + 'EE', borderColor: colors.border }]}>
              <View style={styles.statItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.success }]} />
                <Text style={[styles.statLabel, { color: colors.foreground }]}>{btCount} BLE</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.network }]} />
                <Text style={[styles.statLabel, { color: colors.foreground }]}>{netCount} NET</Text>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.offline }]} />
                <Text style={[styles.statLabel, { color: colors.foreground }]}>{offlineCount} OFF</Text>
              </View>
            </View>

            {/* GPS accuracy badge */}
            {gpsAccuracy !== null && (
              <View style={[styles.gpsBadge, { backgroundColor: gpsColor + '22', borderColor: gpsColor + '66' }]}>
                <Ionicons name="location" size={10} color={gpsColor} />
                <Text style={[styles.gpsBadgeText, { color: gpsColor }]}>±{Math.round(gpsAccuracy)}m</Text>
              </View>
            )}
          </View>

          {destination && (
            <View style={[styles.destChip, { backgroundColor: colors.card + 'EE', borderColor: colors.border }]}>
              <Ionicons name="navigate" size={12} color={colors.primary} />
              <Text style={[styles.destChipText, { color: colors.foreground }]} numberOfLines={1}>
                {destination.name}
              </Text>
              {!!remainingTimeText && (
                <Text style={[styles.destChipEta, { color: colors.primary }]}>{remainingTimeText}</Text>
              )}
            </View>
          )}
        </View>
      )}

      {/* ── Navigation: GPS accuracy + heading badge ── */}
      {isNavigating && gpsAccuracy !== null && (
        <View style={[styles.navGpsBadge, { backgroundColor: colors.card + 'DD', borderColor: colors.border, top: topInset + 12 }]}>
          <Ionicons name="location" size={11} color={gpsColor} />
          <Text style={[styles.gpsBadgeText, { color: gpsColor }]}>±{Math.round(gpsAccuracy)}m</Text>
          {trackingMode && (
            <>
              <View style={[styles.navGpsDivider, { backgroundColor: colors.border }]} />
              <Ionicons name="compass" size={11} color={colors.primary} />
              <Text style={[styles.gpsBadgeText, { color: colors.primary }]}>{Math.round(currentHeading)}°</Text>
            </>
          )}
        </View>
      )}

      {/* ── Route preferences button (above recenter) ── */}
      <Pressable
        style={[styles.prefsBtn, {
          backgroundColor: hasActivePrefs ? colors.primary : colors.card,
          borderColor: hasActivePrefs ? colors.primary : colors.border,
          bottom: safeBottom + 64,
        }]}
        onPress={() => setPrefsVisible(true)}
      >
        <Ionicons
          name="options-outline"
          size={20}
          color={hasActivePrefs ? '#fff' : colors.primary}
        />
      </Pressable>

      {/* ── Recenter / tracking button ── */}
      <Pressable
        style={[styles.recenterBtn, {
          backgroundColor: trackingMode && isNavigating ? colors.primary : colors.card,
          borderColor: trackingMode && isNavigating ? colors.primary : colors.border,
          bottom: safeBottom + 12,
        }]}
        onPress={recenter}
      >
        <Ionicons
          name={trackingMode && isNavigating ? 'navigate' : 'locate'}
          size={22}
          color={trackingMode && isNavigating ? '#fff' : colors.primary}
        />
      </Pressable>

      {/* ── Share-route toggle ── */}
      {!panelVisible && !isNavigating && (
        <Pressable
          style={[
            styles.shareRouteBtn,
            {
              backgroundColor: isSharingRoute ? colors.primary : colors.card,
              borderColor: colors.border,
              bottom: safeBottom + 8,
            },
          ]}
          onPress={onToggleShareRoute}
        >
          <Ionicons
            name={isSharingRoute ? 'trail-sign' : 'trail-sign-outline'}
            size={16}
            color={isSharingRoute ? '#fff' : colors.primary}
          />
          <Text style={[styles.shareRouteText, { color: isSharingRoute ? '#fff' : colors.foreground }]}>
            {isSharingRoute ? 'Sharing Route' : 'Share My Route'}
          </Text>
        </Pressable>
      )}

      {/* ── Host: Set Destination FAB ── */}
      {isLeader && !destination && !isNavigating && (
        <Pressable
          style={[styles.setDestFab, { backgroundColor: colors.primary, bottom: safeBottom + 66 }]}
          onPress={() => setSearchMode('destination')}
        >
          <Ionicons name="navigate" size={18} color="#fff" />
          <Text style={styles.setDestFabText}>Set Group Destination</Text>
        </Pressable>
      )}

      {/* ── Fetching routes spinner ── */}
      {isFetchingRoutes && (
        <View style={[styles.fetchingBadge, { backgroundColor: colors.card + 'EE', bottom: safeBottom + 20 }]}>
          <ActivityIndicator size="small" color={colors.primary} />
          <Text style={[styles.fetchingText, { color: colors.foreground }]}>Getting routes…</Text>
        </View>
      )}

      {/* ── Route options + host controls panel ── */}
      {panelVisible && (
        <View style={[
          styles.bottomPanel,
          { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: safeBottom + 8 },
        ]}>
          <View style={styles.panelHandle} />

          {/* Destination header */}
          <View style={styles.destHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.panelTitle, { color: colors.foreground }]} numberOfLines={1}>
                {destination!.name}
              </Text>
              {!!destination!.address && (
                <Text style={[styles.panelSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                  {destination!.address}
                </Text>
              )}
            </View>
            {/* Host quick actions */}
            {isLeader && (
              <View style={styles.leaderActions}>
                <Pressable
                  style={[styles.iconBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setSearchMode('waypoint')}
                  hitSlop={6}
                >
                  <Ionicons name="add" size={16} color={colors.primary} />
                </Pressable>
                <Pressable
                  style={[styles.iconBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={() => setSearchMode('destination')}
                  hitSlop={6}
                >
                  <Ionicons name="search" size={16} color={colors.foreground} />
                </Pressable>
                <Pressable
                  style={[styles.iconBtn, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}
                  onPress={clearGroupDestination}
                  hitSlop={6}
                >
                  <Ionicons name="trash" size={16} color="#EF4444" />
                </Pressable>
              </View>
            )}
          </View>

          {/* Active preferences strip */}
          {hasActivePrefs && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.activePrefsRow}>
              {routePreferences.avoidTolls && <PrefChip icon="cash-outline" label="No Tolls" colors={colors} />}
              {routePreferences.avoidHighways && <PrefChip icon="speedometer-outline" label="No Highways" colors={colors} />}
              {routePreferences.avoidFerries && <PrefChip icon="boat-outline" label="No Ferries" colors={colors} />}
              {routePreferences.preferFuelEfficient && <PrefChip icon="leaf-outline" label="Eco Route" colors={colors} />}
            </ScrollView>
          )}

          {/* Waypoints strip */}
          {waypoints.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.wpStrip}>
              {waypoints.map((wp, i) => (
                <View key={wp.id} style={[styles.wpChip, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={[styles.wpChipNum, { color: colors.primary }]}>{i + 1}</Text>
                  <Text style={[styles.wpChipName, { color: colors.foreground }]} numberOfLines={1}>{wp.name}</Text>
                  {isLeader && (
                    <Pressable onPress={() => removeWaypoint(wp.id)} hitSlop={8}>
                      <Ionicons name="close" size={12} color={colors.mutedForeground} />
                    </Pressable>
                  )}
                </View>
              ))}
            </ScrollView>
          )}

          {/* Route cards */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.routesRow}>
            {routeOptions.map((route, i) => {
              const isSelected = i === selectedRouteIndex;
              const isEco = routePreferences.preferFuelEfficient && i === fuelEfficientIdx && routeOptions.length > 1;
              return (
                <Pressable
                  key={i}
                  style={[
                    styles.routeCard,
                    {
                      backgroundColor: isSelected ? colors.primary + '1A' : colors.background,
                      borderColor: isSelected ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => selectRoute(i)}
                >
                  <View style={styles.routeCardHeader}>
                    <Text
                      style={[styles.routeCardSummary, { color: isSelected ? colors.primary : colors.mutedForeground }]}
                      numberOfLines={1}
                    >
                      {route.summary || `Route ${i + 1}`}
                    </Text>
                    {isEco && (
                      <View style={[styles.ecoBadge, { backgroundColor: '#22C55E22', borderColor: '#22C55E55' }]}>
                        <Ionicons name="leaf" size={9} color="#22C55E" />
                        <Text style={styles.ecoBadgeText}>ECO</Text>
                      </View>
                    )}
                  </View>
                  <Text style={[styles.routeCardTime, { color: isSelected ? colors.primary : colors.foreground }]}>
                    {route.durationText}
                  </Text>
                  <Text style={[styles.routeCardDist, { color: colors.mutedForeground }]}>
                    {route.distanceText}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Start navigation */}
          <Pressable style={[styles.startNavBtn, { backgroundColor: colors.primary }]} onPress={startNavigation}>
            <Ionicons name="navigate" size={18} color="#fff" />
            <Text style={styles.startNavBtnText}>Start Navigation</Text>
          </Pressable>
        </View>
      )}

      {/* ── Turn-by-turn navigation panel ── */}
      {isNavigating && selectedRoute && currentStep && (
        <View style={[
          styles.navPanel,
          { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: safeBottom + 4 },
        ]}>
          {/* Current step */}
          <View style={styles.navCurrentRow}>
            <View style={[styles.navManeuverBox, { backgroundColor: colors.primary }]}>
              <Ionicons name={maneuverIcon(currentStep.maneuver)} size={28} color="#fff" />
            </View>
            <View style={styles.navInstructionCol}>
              <Text style={[styles.navInstruction, { color: colors.foreground }]} numberOfLines={2}>
                {currentStep.instruction}
              </Text>
              <Text style={[styles.navStepDist, { color: colors.mutedForeground }]}>
                {currentStep.distanceText}
              </Text>
            </View>
          </View>

          {/* Next step preview */}
          {nextStep && (
            <View style={[styles.navNextRow, { borderTopColor: colors.border }]}>
              <Ionicons name={maneuverIcon(nextStep.maneuver)} size={14} color={colors.mutedForeground} />
              <Text style={[styles.navNextText, { color: colors.mutedForeground }]} numberOfLines={1}>
                {'  Then: '}{nextStep.instruction}
              </Text>
            </View>
          )}

          {/* ETA + End button */}
          <View style={[styles.navEtaRow, { borderTopColor: colors.border }]}>
            <View style={styles.navEtaItem}>
              <Ionicons name="time-outline" size={14} color={colors.primary} />
              <Text style={[styles.navEtaValue, { color: colors.foreground }]}>
                {remainingTimeText || selectedRoute.durationText}
              </Text>
            </View>
            <View style={styles.navEtaItem}>
              <Ionicons name="map-outline" size={14} color={colors.primary} />
              <Text style={[styles.navEtaValue, { color: colors.foreground }]}>
                {remainingDistanceText || selectedRoute.distanceText}
              </Text>
            </View>
            <Pressable
              style={[styles.endNavBtn, { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}
              onPress={stopNavigation}
            >
              <Text style={styles.endNavText}>End</Text>
            </Pressable>
          </View>

          {/* Destination footer */}
          <View style={[styles.navDestRow, { borderTopColor: colors.border }]}>
            <Ionicons name="flag-outline" size={12} color={colors.mutedForeground} />
            <Text style={[styles.navDestName, { color: colors.mutedForeground }]} numberOfLines={1}>
              {'  '}{destination?.name}
            </Text>
            {snappedLocation && (
              <View style={[styles.snapBadge, { backgroundColor: '#22C55E22', borderColor: '#22C55E55' }]}>
                <Ionicons name="git-merge-outline" size={9} color="#22C55E" />
                <Text style={styles.snapBadgeText}>On Road</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Route Preferences modal ── */}
      <Modal
        visible={prefsVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPrefsVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setPrefsVisible(false)} />
        <View style={[
          styles.prefsSheet,
          { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: safeBottom + 16 },
        ]}>
          <View style={styles.panelHandle} />

          {/* Header */}
          <View style={styles.prefsHeader}>
            <View style={[styles.prefsIconWrap, { backgroundColor: colors.primary + '18' }]}>
              <Ionicons name="options" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.prefsTitle, { color: colors.foreground }]}>Route Preferences</Text>
              <Text style={[styles.prefsSub, { color: colors.mutedForeground }]}>
                Applied automatically to all route calculations
              </Text>
            </View>
            <Pressable onPress={() => setPrefsVisible(false)} hitSlop={12}>
              <Ionicons name="close" size={22} color={colors.mutedForeground} />
            </Pressable>
          </View>

          {/* Preference rows */}
          <PrefRow
            icon="cash-outline"
            label="Avoid Tolls"
            description="Routes will not use toll roads"
            value={routePreferences.avoidTolls}
            onToggle={() => updateRoutePreferences({ avoidTolls: !routePreferences.avoidTolls })}
            colors={colors}
          />
          <PrefRow
            icon="speedometer-outline"
            label="Avoid Highways"
            description="Routes will prefer local roads"
            value={routePreferences.avoidHighways}
            onToggle={() => updateRoutePreferences({ avoidHighways: !routePreferences.avoidHighways })}
            colors={colors}
          />
          <PrefRow
            icon="boat-outline"
            label="Avoid Ferries"
            description="Routes will avoid ferry crossings"
            value={routePreferences.avoidFerries}
            onToggle={() => updateRoutePreferences({ avoidFerries: !routePreferences.avoidFerries })}
            colors={colors}
          />
          <PrefRow
            icon="leaf-outline"
            label="Prefer Fuel-Efficient"
            description="Shortest-distance route is shown first"
            value={routePreferences.preferFuelEfficient}
            onToggle={() => updateRoutePreferences({ preferFuelEfficient: !routePreferences.preferFuelEfficient })}
            colors={colors}
          />

          {/* Save note */}
          <Text style={[styles.prefsSaveNote, { color: colors.mutedForeground }]}>
            Preferences are saved automatically. If a group destination is active, routes will recalculate immediately.
          </Text>
        </View>
      </Modal>

      {/* ── Search overlay (full-screen, input at top) ── */}
      {searchMode !== 'closed' && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, zIndex: 40 }]}>
          {/* Header */}
          <View style={[styles.searchHeader, { paddingTop: topInset + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <Pressable onPress={closeSearch} hitSlop={12}>
              <Ionicons name="arrow-back" size={22} color={colors.foreground} />
            </Pressable>
            <Text style={[styles.searchTitle, { color: colors.foreground }]}>
              {searchMode === 'waypoint' ? 'Add a Stop' : 'Set Destination'}
            </Text>
          </View>

          {/* Search input */}
          <View style={[styles.searchInputWrap, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
            <View style={[styles.searchInputRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Ionicons name="search" size={16} color={colors.mutedForeground} />
              <TextInput
                ref={searchInputRef}
                style={[styles.searchInput, { color: colors.foreground }]}
                placeholder={searchMode === 'waypoint' ? 'Search for a stop…' : 'Search for a destination…'}
                placeholderTextColor={colors.mutedForeground}
                value={searchQuery}
                onChangeText={handleSearchChange}
                returnKeyType="search"
                autoCorrect={false}
                autoCapitalize="none"
              />
              {searchQuery.length > 0 && (
                <Pressable onPress={() => handleSearchChange('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
            </View>
          </View>

          {/* Predictions list */}
          {isSearching ? (
            <View style={styles.searchCenter}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : searchPredictions.length > 0 ? (
            <FlatList
              data={searchPredictions}
              keyExtractor={item => item.placeId}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="none"
              contentContainerStyle={{ paddingBottom: safeBottom + 8 }}
              renderItem={({ item }) => (
                <Pressable
                  style={[styles.predItem, { borderBottomColor: colors.border }]}
                  onPress={() => handleSelectPrediction(item)}
                >
                  <View style={[styles.predIcon, { backgroundColor: colors.primary + '1A' }]}>
                    <Ionicons name="location" size={14} color={colors.primary} />
                  </View>
                  <View style={styles.predText}>
                    <Text style={[styles.predMain, { color: colors.foreground }]} numberOfLines={1}>
                      {item.mainText}
                    </Text>
                    {!!item.secondaryText && (
                      <Text style={[styles.predSub, { color: colors.mutedForeground }]} numberOfLines={1}>
                        {item.secondaryText}
                      </Text>
                    )}
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                </Pressable>
              )}
            />
          ) : searchQuery.length >= 2 ? (
            <View style={styles.searchCenter}>
              <Ionicons name="search-outline" size={40} color={colors.mutedForeground} style={{ marginBottom: 10 }} />
              <Text style={[styles.noResults, { color: colors.mutedForeground }]}>No results for "{searchQuery}"</Text>
            </View>
          ) : (
            <View style={styles.searchCenter}>
              <Ionicons name="map-outline" size={40} color={colors.mutedForeground} style={{ marginBottom: 10 }} />
              <Text style={[styles.searchHint, { color: colors.mutedForeground }]}>
                {searchMode === 'waypoint'
                  ? 'Search for a place to add as a stop along the route.'
                  : 'Search for a city, address, or landmark to set as the group destination.'}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // ── Rider markers ──
  markerWrap: { alignItems: 'center', gap: 3 },
  riderMarker: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  markerInitial: { fontFamily: 'Inter_700Bold', fontSize: 11, color: '#fff' },
  markerLabel: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1, maxWidth: 90 },
  liveDot: { width: 5, height: 5, borderRadius: 3 },
  markerName: { fontFamily: 'Inter_600SemiBold', fontSize: 9 },

  // ── Destination / waypoint markers ──
  destMarkerWrap: { alignItems: 'center' },
  destMarker: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#fff' },
  destPinTail: { width: 4, height: 8, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
  waypointMarker: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  waypointNum: { fontFamily: 'Inter_700Bold', fontSize: 11 },

  // ── Top overlay ──
  topOverlay: { position: 'absolute', left: 0, right: 0, alignItems: 'center', gap: 6 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statsBar: { flexDirection: 'row', alignItems: 'center', borderRadius: 30, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 8, gap: 12 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  divider: { width: 1, height: 14 },
  destChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, maxWidth: 280 },
  destChipText: { fontFamily: 'Inter_600SemiBold', fontSize: 12, flex: 1 },
  destChipEta: { fontFamily: 'Inter_700Bold', fontSize: 12 },

  // ── GPS accuracy badge ──
  gpsBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, borderWidth: 1 },
  gpsBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.3 },
  navGpsBadge: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, borderWidth: 1 },
  navGpsDivider: { width: 1, height: 12, marginHorizontal: 2 },

  // ── Rerouting banner ──
  reroutingBanner: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 10, zIndex: 20 },
  reroutingText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' },

  // ── Map action buttons (right column) ──
  prefsBtn: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  recenterBtn: { position: 'absolute', right: 16, width: 44, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  shareRouteBtn: { position: 'absolute', left: 16, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  shareRouteText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },

  // ── Set Destination FAB ──
  setDestFab: { position: 'absolute', alignSelf: 'center', left: 70, right: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 28, paddingVertical: 14 },
  setDestFabText: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff' },

  // ── Fetching badge ──
  fetchingBadge: { position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 24 },
  fetchingText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  // ── Route options bottom panel ──
  bottomPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    paddingHorizontal: 16, paddingTop: 10, gap: 10,
  },
  panelHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#6B7280', alignSelf: 'center', marginBottom: 4 },
  destHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  panelTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  panelSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },

  // ── Active preferences strip ──
  activePrefsRow: { flexGrow: 0 },
  prefChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, marginRight: 6 },
  prefChipText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.4 },

  // ── Eco badge on route card ──
  ecoBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  ecoBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 8, color: '#22C55E', letterSpacing: 0.5 },

  // ── Snap-to-road badge in nav panel ──
  snapBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 6, borderWidth: 1, marginLeft: 'auto' },
  snapBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 8, color: '#22C55E', letterSpacing: 0.4 },

  // ── Host quick-action icon buttons ──
  leaderActions: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingTop: 2 },
  iconBtn: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

  // ── Waypoints strip ──
  wpStrip: { flexGrow: 0 },
  wpChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 14, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6, marginRight: 8 },
  wpChipNum: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  wpChipName: { fontFamily: 'Inter_600SemiBold', fontSize: 12, maxWidth: 100 },

  // ── Route cards ──
  routesRow: { flexGrow: 0 },
  routeCard: { borderRadius: 12, borderWidth: 1.5, paddingHorizontal: 14, paddingVertical: 10, marginRight: 10, minWidth: 130, gap: 2 },
  routeCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'nowrap' },
  routeCardSummary: { fontFamily: 'Inter_600SemiBold', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, flex: 1 },
  routeCardTime: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  routeCardDist: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  // ── Start nav ──
  startNavBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14 },
  startNavBtnText: { fontFamily: 'Inter_700Bold', fontSize: 15, color: '#fff' },

  // ── Turn-by-turn nav panel ──
  navPanel: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
  },
  navCurrentRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  navManeuverBox: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  navInstructionCol: { flex: 1, gap: 2 },
  navInstruction: { fontFamily: 'Inter_700Bold', fontSize: 17, lineHeight: 22 },
  navStepDist: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  navNextRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  navNextText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  navEtaRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 16 },
  navEtaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  navEtaValue: { fontFamily: 'Inter_700Bold', fontSize: 14 },
  endNavBtn: { marginLeft: 'auto', borderRadius: 10, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 7 },
  endNavText: { fontFamily: 'Inter_700Bold', fontSize: 13, color: '#EF4444' },
  navDestRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth },
  navDestName: { fontFamily: 'Inter_400Regular', fontSize: 12, flex: 1 },

  // ── Route Preferences modal ──
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  prefsSheet: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1,
    paddingTop: 12, paddingHorizontal: 0,
  },
  prefsHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 20, paddingBottom: 16,
  },
  prefsIconWrap: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  prefsTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  prefsSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 20, paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  prefIconWrap: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  prefLabelCol: { flex: 1 },
  prefLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 15 },
  prefDescription: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  prefsSaveNote: {
    fontFamily: 'Inter_400Regular', fontSize: 12,
    paddingHorizontal: 20, paddingTop: 14, paddingBottom: 4,
    lineHeight: 18,
  },

  // ── Search (full-screen) ──
  searchHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchTitle: { fontFamily: 'Inter_700Bold', fontSize: 17 },
  searchInputWrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16, paddingVertical: 10,
  },
  searchInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1,
    paddingHorizontal: 14, paddingVertical: 10,
  },
  searchInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15, padding: 0 },
  predItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 13, paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  predIcon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  predText: { flex: 1 },
  predMain: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  predSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  searchCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 8 },
  noResults: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  searchHint: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center', lineHeight: 20 },
});
