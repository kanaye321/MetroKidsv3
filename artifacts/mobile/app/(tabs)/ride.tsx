import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useRide, RideRecord } from '@/context/RideContext';

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
}

function RideHistoryCard({ record }: { record: RideRecord }) {
  const colors = useColors();
  return (
    <View style={[styles.histCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.histRow}>
        <View>
          <Text style={[styles.histDate, { color: colors.foreground }]}>{formatDate(record.date)}</Text>
          <Text style={[styles.histDuration, { color: colors.mutedForeground }]}>{formatDuration(record.duration)}</Text>
        </View>
        <View style={styles.histStats}>
          <Text style={[styles.histStatVal, { color: colors.primary }]}>{record.distance.toFixed(1)}</Text>
          <Text style={[styles.histStatLabel, { color: colors.mutedForeground }]}>km</Text>
        </View>
        <View style={styles.histStats}>
          <Text style={[styles.histStatVal, { color: colors.foreground }]}>{record.avgSpeed}</Text>
          <Text style={[styles.histStatLabel, { color: colors.mutedForeground }]}>avg</Text>
        </View>
        <View style={styles.histStats}>
          <Text style={[styles.histStatVal, { color: colors.foreground }]}>{record.maxSpeed}</Text>
          <Text style={[styles.histStatLabel, { color: colors.mutedForeground }]}>max</Text>
        </View>
      </View>
    </View>
  );
}

export default function RideScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { isRiding, stats, rideHistory, startRide, stopRide } = useRide();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const handleToggle = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    if (isRiding) stopRide(); else startRide();
  };

  // Speed arc (0-120 km/h → 0-1)
  const speedFrac = Math.min(stats.currentSpeed / 120, 1);
  const arcColor = speedFrac < 0.5 ? colors.success : speedFrac < 0.8 ? colors.warning : colors.destructive;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.pageHeader}>
          <Text style={[styles.pageTitle, { color: colors.foreground }]}>Ride Tracker</Text>
          {isRiding && (
            <View style={[styles.liveBadge, { backgroundColor: colors.destructive + '22', borderColor: colors.destructive + '44' }]}>
              <View style={[styles.liveDot, { backgroundColor: colors.destructive }]} />
              <Text style={[styles.liveText, { color: colors.destructive }]}>LIVE</Text>
            </View>
          )}
        </View>

        {/* Speedometer */}
        <View style={[styles.speedo, { backgroundColor: colors.card, borderColor: isRiding ? arcColor + '66' : colors.border }]}>
          <View style={styles.speedCenter}>
            <Text style={[styles.speedValue, { color: isRiding ? arcColor : colors.mutedForeground }]}>
              {stats.currentSpeed}
            </Text>
            <Text style={[styles.speedUnit, { color: colors.mutedForeground }]}>km/h</Text>
          </View>
          {/* Speed bar */}
          <View style={[styles.speedBarBg, { backgroundColor: colors.muted }]}>
            <View style={[styles.speedBarFill, { width: `${speedFrac * 100}%` as any, backgroundColor: arcColor }]} />
          </View>
        </View>

        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="navigate-outline" size={16} color={colors.primary} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{stats.distance.toFixed(2)}</Text>
            <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>km</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="time-outline" size={16} color={colors.primary} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{formatDuration(stats.duration)}</Text>
            <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>time</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="trending-up-outline" size={16} color={colors.primary} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{stats.avgSpeed}</Text>
            <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>avg km/h</Text>
          </View>
          <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Ionicons name="flash-outline" size={16} color={colors.warning} />
            <Text style={[styles.statVal, { color: colors.foreground }]}>{stats.maxSpeed}</Text>
            <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>max km/h</Text>
          </View>
        </View>

        {/* Elevation */}
        <View style={[styles.elevRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Ionicons name="arrow-up-circle-outline" size={18} color={colors.success} />
          <Text style={[styles.elevLabel, { color: colors.mutedForeground }]}>Elevation gain</Text>
          <Text style={[styles.elevVal, { color: colors.foreground }]}>{stats.elevation.toFixed(0)} m</Text>
        </View>

        {/* Start/Stop Button */}
        <Pressable
          style={({ pressed }) => [
            styles.rideBtn,
            {
              backgroundColor: isRiding ? colors.destructive : colors.primary,
              opacity: pressed ? 0.85 : 1,
            },
          ]}
          onPress={handleToggle}
        >
          <Ionicons name={isRiding ? 'stop-circle' : 'play-circle'} size={26} color="#fff" />
          <Text style={styles.rideBtnText}>{isRiding ? 'Stop Ride' : 'Start Ride'}</Text>
        </Pressable>

        {/* Ride History */}
        {rideHistory.length > 0 && (
          <View style={styles.historySection}>
            <Text style={[styles.historyTitle, { color: colors.mutedForeground }]}>RIDE HISTORY</Text>
            {rideHistory.map(r => <RideHistoryCard key={r.id} record={r} />)}
          </View>
        )}

        {rideHistory.length === 0 && !isRiding && (
          <View style={[styles.emptyHistory, { borderColor: colors.border }]}>
            <Ionicons name="bicycle-outline" size={32} color={colors.mutedForeground} />
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>No rides recorded yet</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  pageHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pageTitle: { fontFamily: 'Inter_700Bold', fontSize: 22 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 1 },
  speedo: { borderRadius: 18, borderWidth: 2, padding: 28, alignItems: 'center', gap: 16 },
  speedCenter: { alignItems: 'center' },
  speedValue: { fontFamily: 'Inter_700Bold', fontSize: 64, lineHeight: 68, letterSpacing: -2 },
  speedUnit: { fontFamily: 'Inter_600SemiBold', fontSize: 16, marginTop: -4 },
  speedBarBg: { width: '100%', height: 6, borderRadius: 3, overflow: 'hidden' },
  speedBarFill: { height: '100%', borderRadius: 3 },
  statsRow: { flexDirection: 'row', gap: 8 },
  statBox: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, alignItems: 'center', gap: 3 },
  statVal: { fontFamily: 'Inter_700Bold', fontSize: 16, lineHeight: 20 },
  statLbl: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },
  elevRow: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, padding: 14 },
  elevLabel: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  elevVal: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  rideBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 17, borderRadius: 16 },
  rideBtnText: { fontFamily: 'Inter_700Bold', fontSize: 17, color: '#fff', letterSpacing: 0.3 },
  historySection: { gap: 8 },
  historyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1 },
  histCard: { borderRadius: 12, borderWidth: 1, padding: 14 },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  histDate: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  histDuration: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  histStats: { flex: 1, alignItems: 'center' },
  histStatVal: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  histStatLabel: { fontFamily: 'Inter_400Regular', fontSize: 10, marginTop: 1 },
  emptyHistory: { alignItems: 'center', paddingVertical: 32, gap: 8, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed' },
  emptyText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
