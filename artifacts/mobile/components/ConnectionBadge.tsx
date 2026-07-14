import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { ConnectionType } from '@/context/AppContext';

interface Props {
  type: ConnectionType;
  size?: 'sm' | 'md';
}

export function ConnectionBadge({ type, size = 'sm' }: Props) {
  const colors = useColors();
  const isSm = size === 'sm';

  const config: Record<ConnectionType, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
    bluetooth: { color: colors.success, icon: 'bluetooth', label: 'BLE' },
    network: { color: colors.network, icon: 'wifi', label: 'NET' },
    offline: { color: colors.offline, icon: 'cloud-offline-outline', label: 'OFFLINE' },
  };

  const { color, icon, label } = config[type];

  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color + '44' }]}>
      <Ionicons name={icon} size={isSm ? 10 : 12} color={color} />
      <Text style={[styles.label, { color, fontSize: isSm ? 9 : 11 }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
    gap: 3,
  },
  label: {
    fontFamily: 'Inter_600SemiBold',
    letterSpacing: 0.5,
  },
});
