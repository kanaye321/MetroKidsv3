import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { GroupMember, SharedRoute } from '@/context/AppContext';
import { ConnectionBadge } from '@/components/ConnectionBadge';

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

// Web fallback — react-native-maps is not supported on web.
export default function RideLinkMap({ connectedRiders, btCount, netCount, offlineCount }: Props) {
  const colors = useColors();

  return (
    <View style={[styles.container, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Ionicons name="map-outline" size={40} color={colors.mutedForeground} />
      <Text style={[styles.title, { color: colors.foreground }]}>Map view on mobile</Text>
      <Text style={[styles.sub, { color: colors.mutedForeground }]}>
        Scan the QR code in the preview bar to open in Expo Go and see the live rider map.
      </Text>
      <View style={[styles.summary, { borderTopColor: colors.border }]}>
        <View style={styles.stat}>
          <View style={[styles.dot, { backgroundColor: colors.success }]} />
          <Text style={[styles.statText, { color: colors.foreground }]}>{btCount} via BLE</Text>
        </View>
        <View style={styles.stat}>
          <View style={[styles.dot, { backgroundColor: colors.network }]} />
          <Text style={[styles.statText, { color: colors.foreground }]}>{netCount} via Network</Text>
        </View>
        <View style={styles.stat}>
          <View style={[styles.dot, { backgroundColor: colors.offline }]} />
          <Text style={[styles.statText, { color: colors.foreground }]}>{offlineCount} Offline</Text>
        </View>
      </View>
      {connectedRiders.length > 0 && (
        <View style={[styles.riderList, { borderTopColor: colors.border }]}>
          {connectedRiders.map(r => (
            <View key={r.id} style={styles.riderRow}>
              <View style={[styles.avatar, { backgroundColor: r.avatarColor + '22', borderColor: r.avatarColor }]}>
                <Text style={[styles.avatarText, { color: r.avatarColor }]}>{r.nickname.charAt(0)}</Text>
              </View>
              <Text style={[styles.riderName, { color: colors.foreground }]}>{r.nickname}</Text>
              <ConnectionBadge type={r.connectionType} size="sm" />
              {r.connectionType !== 'offline' && (
                <Text style={[styles.speed, { color: colors.primary }]}>{r.speed} km/h</Text>
              )}
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, margin: 16, borderRadius: 16, borderWidth: 1, padding: 28, alignItems: 'center', gap: 10 },
  title: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  sub: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center' },
  summary: { width: '100%', borderTopWidth: 1, paddingTop: 14, gap: 8 },
  stat: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statText: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  riderList: { width: '100%', borderTopWidth: 1, paddingTop: 14, gap: 10 },
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  riderName: { fontFamily: 'Inter_600SemiBold', fontSize: 14, flex: 1 },
  speed: { fontFamily: 'Inter_700Bold', fontSize: 14 },
});
