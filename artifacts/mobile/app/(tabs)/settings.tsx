import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable, Switch,
  TextInput, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { useChat } from '@/context/ChatContext';
import { useTheme, ThemeMode } from '@/context/ThemeContext';

function ThemeSwitcher() {
  const colors = useColors();
  const { themeMode, setThemeMode } = useTheme();
  const options: { mode: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { mode: 'light', label: 'Light', icon: 'sunny-outline' },
    { mode: 'dark', label: 'Dark', icon: 'moon-outline' },
    { mode: 'system', label: 'System', icon: 'phone-portrait-outline' },
  ];

  return (
    <View style={[styles.themeRow, { backgroundColor: colors.card }]}>
      {options.map(opt => {
        const active = themeMode === opt.mode;
        return (
          <Pressable
            key={opt.mode}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setThemeMode(opt.mode); }}
            style={[
              styles.themeOption,
              { backgroundColor: active ? colors.primary + '1c' : 'transparent', borderColor: active ? colors.primary : colors.border },
            ]}
          >
            <Ionicons name={opt.icon} size={18} color={active ? colors.primary : colors.mutedForeground} />
            <Text style={[styles.themeOptionText, { color: active ? colors.primary : colors.mutedForeground }]}>{opt.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SettingRow({
  icon, label, value, onToggle, onPress, danger = false,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value?: boolean;
  onToggle?: (v: boolean) => void;
  onPress?: () => void;
  danger?: boolean;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.settingRow, { backgroundColor: colors.card, opacity: pressed && onPress ? 0.75 : 1 }]}
    >
      <View style={[styles.iconBox, { backgroundColor: (danger ? colors.destructive : colors.primary) + '22' }]}>
        <Ionicons name={icon} size={18} color={danger ? colors.destructive : colors.primary} />
      </View>
      <Text style={[styles.rowLabel, { color: danger ? colors.destructive : colors.foreground }]}>{label}</Text>
      {onToggle !== undefined && value !== undefined ? (
        <Switch
          value={value}
          onValueChange={v => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onToggle(v); }}
          trackColor={{ false: colors.muted, true: colors.primary + '88' }}
          thumbColor={value ? colors.primary : colors.mutedForeground}
        />
      ) : (
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      )}
    </Pressable>
  );
}

function SectionHeader({ title }: { title: string }) {
  const colors = useColors();
  return <Text style={[styles.sectionHeader, { color: colors.mutedForeground }]}>{title}</Text>;
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, bluetoothEnabled, toggleBluetooth, updateProfile, logout } = useApp();
  const { clearMessages } = useChat();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(currentUser?.name ?? '');
  const [nickname, setNickname] = useState(currentUser?.nickname ?? '');
  const [motorcycle, setMotorcycle] = useState(currentUser?.motorcycle ?? '');
  const [emergency, setEmergency] = useState(currentUser?.emergencyContact ?? '');
  const [battSaver, setBattSaver] = useState(false);
  const [autoJoin, setAutoJoin] = useState(true);
  const [networkFallback, setNetworkFallback] = useState(true);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const initials = currentUser?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? 'R';

  const handleSaveProfile = async () => {
    await updateProfile({ name: name.trim() || 'Rider', nickname: nickname.trim() || 'Rider', motorcycle: motorcycle.trim(), emergencyContact: emergency.trim() });
    setEditing(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleLogout = () => {
    Alert.alert('Sign Out', 'Are you sure you want to sign out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign Out', style: 'destructive', onPress: async () => { await logout(); router.replace('/auth'); } },
    ]);
  };

  const handleClearChat = () => {
    Alert.alert('Clear Chat', 'Clear all chat history?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => { clearMessages(); Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success); } },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: insets.bottom + 90 }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.pageTitle, { color: colors.foreground }]}>Settings</Text>

        {/* Profile */}
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.profileAvatar, { backgroundColor: currentUser?.avatarColor + '22' ?? colors.muted, borderColor: currentUser?.avatarColor ?? colors.border }]}>
            <Text style={[styles.profileInitials, { color: currentUser?.avatarColor ?? colors.foreground }]}>{initials}</Text>
          </View>
          {editing ? (
            <View style={styles.editForm}>
              {[
                { val: name, set: setName, label: 'Full name', cap: 'words' as const },
                { val: nickname, set: setNickname, label: 'Nickname', cap: 'words' as const },
                { val: motorcycle, set: setMotorcycle, label: 'Motorcycle', cap: 'words' as const },
                { val: emergency, set: setEmergency, label: 'Emergency contact', cap: 'none' as const },
              ].map(f => (
                <View key={f.label} style={[styles.editInput, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                  <TextInput
                    style={[styles.editText, { color: colors.foreground }]}
                    value={f.val}
                    onChangeText={f.set}
                    placeholder={f.label}
                    placeholderTextColor={colors.mutedForeground}
                    autoCapitalize={f.cap}
                  />
                </View>
              ))}
              <View style={styles.editBtns}>
                <Pressable style={[styles.editBtn, { borderColor: colors.border, borderWidth: 1 }]} onPress={() => setEditing(false)}>
                  <Text style={[styles.editBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.editBtn, { backgroundColor: colors.primary }]} onPress={handleSaveProfile}>
                  <Text style={[styles.editBtnText, { color: '#fff' }]}>Save</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <View style={styles.profileInfo}>
              <Text style={[styles.profileName, { color: colors.foreground }]}>{currentUser?.name ?? 'Rider'}</Text>
              <Text style={[styles.profileSub, { color: colors.mutedForeground }]}>
                {currentUser?.nickname ? `"${currentUser.nickname}"` : ''} {currentUser?.motorcycle ? `· ${currentUser.motorcycle}` : ''}
              </Text>
              {currentUser?.emergencyContact ? (
                <Text style={[styles.profileEmerg, { color: colors.warning }]}>
                  <Ionicons name="alert-circle-outline" size={12} /> {currentUser.emergencyContact}
                </Text>
              ) : null}
              <Pressable style={[styles.editProfileBtn, { borderColor: colors.border }]} onPress={() => setEditing(true)}>
                <Ionicons name="pencil-outline" size={14} color={colors.primary} />
                <Text style={[styles.editProfileBtnText, { color: colors.primary }]}>Edit Profile</Text>
              </Pressable>
            </View>
          )}
        </View>

        {/* Appearance */}
        <SectionHeader title="APPEARANCE" />
        <ThemeSwitcher />

        {/* Connection */}
        <SectionHeader title="CONNECTION" />
        <View style={[styles.group, { borderColor: colors.border }]}>
          <SettingRow icon="bluetooth" label="Bluetooth Priority" value={bluetoothEnabled} onToggle={toggleBluetooth} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingRow icon="wifi" label="Network Fallback" value={networkFallback} onToggle={setNetworkFallback} />
        </View>

        {/* Ride */}
        <SectionHeader title="RIDE" />
        <View style={[styles.group, { borderColor: colors.border }]}>
          <SettingRow icon="battery-half-outline" label="Battery Saver Mode" value={battSaver} onToggle={setBattSaver} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <SettingRow icon="enter-outline" label="Auto-Join Last Group" value={autoJoin} onToggle={setAutoJoin} />
        </View>

        {/* App */}
        <SectionHeader title="APP" />
        <View style={[styles.group, { borderColor: colors.border }]}>
          <SettingRow icon="chatbubble-outline" label="Clear Chat History" onPress={handleClearChat} />
        </View>

        {/* Account */}
        <SectionHeader title="ACCOUNT" />
        <View style={[styles.group, { borderColor: colors.border }]}>
          <SettingRow icon="log-out-outline" label="Sign Out" onPress={handleLogout} danger />
        </View>

        {/* Version */}
        <Text style={[styles.version, { color: colors.mutedForeground }]}>MetroEast RideLink v1.0.0</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 8 },
  pageTitle: { fontFamily: 'Inter_700Bold', fontSize: 22, marginBottom: 6 },
  profileCard: { borderRadius: 14, borderWidth: 1, padding: 16, flexDirection: 'row', gap: 14, alignItems: 'flex-start' },
  profileAvatar: { width: 56, height: 56, borderRadius: 28, borderWidth: 2, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  profileInitials: { fontFamily: 'Inter_700Bold', fontSize: 20 },
  profileInfo: { flex: 1, gap: 3 },
  profileName: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  profileSub: { fontFamily: 'Inter_400Regular', fontSize: 13 },
  profileEmerg: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  editProfileBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, marginTop: 6, alignSelf: 'flex-start' },
  editProfileBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  editForm: { flex: 1, gap: 8 },
  editInput: { borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9 },
  editText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
  editBtns: { flexDirection: 'row', gap: 8 },
  editBtn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  editBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  sectionHeader: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1, marginTop: 8, marginBottom: 2 },
  group: { borderRadius: 14, borderWidth: 1, overflow: 'hidden' },
  themeRow: { flexDirection: 'row', gap: 8, borderRadius: 14, padding: 6 },
  themeOption: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 12, borderRadius: 10, borderWidth: 1.5 },
  themeOptionText: { fontFamily: 'Inter_600SemiBold', fontSize: 12 },
  settingRow: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconBox: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontFamily: 'Inter_400Regular', fontSize: 15, flex: 1 },
  divider: { height: 1, marginLeft: 58 },
  version: { fontFamily: 'Inter_400Regular', fontSize: 12, textAlign: 'center', paddingVertical: 8 },
});
