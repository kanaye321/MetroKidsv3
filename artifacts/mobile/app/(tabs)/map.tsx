import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { useRide } from '@/context/RideContext';
import { useNavigation } from '@/context/NavigationContext';
import RideLinkMap from '@/components/RideLinkMap';

export default function MapScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { connectedRiders, rideGroup, sharedRoutes, currentUser } = useApp();
  const { isSharingRoute, toggleRouteSharing } = useRide();
  const { destination } = useNavigation();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const btCount = connectedRiders.filter(r => r.connectionType === 'bluetooth').length;
  const netCount = connectedRiders.filter(r => r.connectionType === 'network').length;
  const offlineCount = connectedRiders.filter(r => r.connectionType === 'offline').length;

  // Current user is the leader if they created/own the group
  const isLeader = Boolean(rideGroup && currentUser && rideGroup.hostIds?.includes(currentUser.id));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header — hidden while navigating to maximise map space */}
      {!destination && (
        <View style={[styles.header, { paddingTop: topPad + 8 }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Group Map</Text>
          {rideGroup && (
            <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
              {connectedRiders.length} rider{connectedRiders.length !== 1 ? 's' : ''} · {rideGroup.name}
            </Text>
          )}
        </View>
      )}

      {/* Map (native) or fallback list (web) */}
      <View style={styles.mapArea}>
        <RideLinkMap
          connectedRiders={connectedRiders}
          btCount={btCount}
          netCount={netCount}
          offlineCount={offlineCount}
          sharedRoutes={sharedRoutes}
          isSharingRoute={isSharingRoute}
          onToggleShareRoute={toggleRouteSharing}
          isLeader={isLeader}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: 20, paddingBottom: 10 },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  headerSub: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  mapArea: { flex: 1 },
});
