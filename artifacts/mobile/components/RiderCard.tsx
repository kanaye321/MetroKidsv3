import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ConnectionBadge } from './ConnectionBadge';
import { GroupMember } from '@/context/AppContext';

interface Props {
  rider: GroupMember;
  compact?: boolean;
  badge?: string;
}

function getInitials(name: string): string {
  return name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}

function formatLastSeen(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function RiderCard({ rider, compact = false, badge }: Props) {
  const colors = useColors();

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.avatar, { backgroundColor: rider.avatarColor + '22', borderColor: rider.avatarColor }]}>
        <Text style={[styles.initials, { color: rider.avatarColor }]}>{getInitials(rider.name)}</Text>
        <View style={[
          styles.statusDot,
          { backgroundColor: rider.connectionType === 'offline' ? colors.offline : rider.connectionType === 'bluetooth' ? colors.success : colors.network }
        ]} />
      </View>
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.nickname, { color: colors.foreground }]}>{rider.nickname}</Text>
          <ConnectionBadge type={rider.connectionType} size="sm" />
          {badge && (
            <View style={[styles.hostBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary }]}>
              <Text style={[styles.hostBadgeText, { color: colors.primary }]}>{badge}</Text>
            </View>
          )}
          {rider.speaking && (
            <Ionicons name="mic" size={12} color={colors.success} />
          )}
        </View>
        {!compact && (
          <Text style={[styles.sub, { color: colors.mutedForeground }]} numberOfLines={1}>{rider.motorcycle}</Text>
        )}
      </View>
      <View style={styles.rightSection}>
        {rider.connectionType !== 'offline' ? (
          <>
            <Text style={[styles.speed, { color: colors.primary }]}>{rider.speed}</Text>
            <Text style={[styles.speedUnit, { color: colors.mutedForeground }]}>km/h</Text>
          </>
        ) : (
          <Text style={[styles.lastSeen, { color: colors.offline }]}>{formatLastSeen(rider.lastSeen)}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    gap: 10,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    fontFamily: 'Inter_700Bold',
    fontSize: 14,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: 'absolute',
    bottom: 0,
    right: 0,
    borderWidth: 1.5,
    borderColor: '#131823',
  },
  info: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  hostBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
  },
  hostBadgeText: {
    fontFamily: 'Inter_700Bold',
    fontSize: 9,
    letterSpacing: 0.3,
  },
  nickname: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  sub: {
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
  },
  rightSection: {
    alignItems: 'flex-end',
  },
  speed: {
    fontFamily: 'Inter_700Bold',
    fontSize: 20,
    lineHeight: 24,
  },
  speedUnit: {
    fontFamily: 'Inter_400Regular',
    fontSize: 10,
  },
  lastSeen: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
  },
});
