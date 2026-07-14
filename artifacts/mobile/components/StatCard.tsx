import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

interface Props {
  icon: keyof typeof Ionicons.glyphMap;
  value: string;
  label: string;
  iconColor?: string;
  accent?: boolean;
}

export function StatCard({ icon, value, label, iconColor, accent = false }: Props) {
  const colors = useColors();
  const ic = iconColor ?? (accent ? colors.primary : colors.mutedForeground);

  return (
    <View style={[
      styles.card,
      { backgroundColor: colors.card, borderColor: accent ? colors.primary + '44' : colors.border },
      accent && { borderWidth: 1.5 },
    ]}>
      <Ionicons name={icon} size={18} color={ic} />
      <Text style={[styles.value, { color: colors.foreground }]} numberOfLines={1}>{value}</Text>
      <Text style={[styles.label, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    paddingHorizontal: 8,
    borderRadius: 12,
    borderWidth: 1,
    gap: 4,
    minWidth: 80,
  },
  value: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18,
    lineHeight: 22,
  },
  label: {
    fontFamily: 'Inter_400Regular',
    fontSize: 11,
    textAlign: 'center',
  },
});
