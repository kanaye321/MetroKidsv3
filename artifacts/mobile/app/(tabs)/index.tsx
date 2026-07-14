import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  Modal, TextInput, Platform, Alert, Image,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons, Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useColors } from '@/hooks/useColors';
import { useApp } from '@/context/AppContext';
import { useRide } from '@/context/RideContext';
import { SOSButton } from '@/components/SOSButton';

const WEB_TAB_BAR = 64;
const IOS_TAB_BAR = 49;
const ANDROID_TAB_BAR = 56;

// ── Quick action card ──────────────────────────────────────────────────────────
function QuickAction({
  icon, label, sublabel, color, onPress,
}: { icon: any; label: string; sublabel: string; color: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.qaCard, { backgroundColor: colors.card, borderColor: colors.border, opacity: pressed ? 0.75 : 1 }]}
    >
      <View style={[styles.qaIcon, { backgroundColor: color + '22' }]}>
        <Ionicons name={icon} size={22} color={color} />
      </View>
      <Text style={[styles.qaLabel, { color: colors.foreground }]}>{label}</Text>
      <Text style={[styles.qaSub, { color: colors.mutedForeground }]}>{sublabel}</Text>
    </Pressable>
  );
}

// ── Rider row ────────────────────────────────────────────────────────────────
function RiderRow({
  rider,
  isHost,
  canMakeHost,
  onMakeHost,
}: {
  rider: any;
  isHost: boolean;
  canMakeHost: boolean;
  onMakeHost: () => void;
}) {
  const colors = useColors();
  const connColor = rider.connectionType === 'bluetooth' ? colors.success
    : rider.connectionType === 'network' ? colors.network : colors.offline;
  const connIcon = rider.connectionType === 'bluetooth' ? 'bluetooth'
    : rider.connectionType === 'network' ? 'wifi' : 'cloud-offline-outline';
  const isStale = Date.now() - rider.lastSeen > 30_000;

  return (
    <View style={[
      styles.riderRow,
      {
        backgroundColor: colors.card,
        borderColor: isHost ? colors.primary + 'AA' : rider.speaking ? colors.primary + '66' : colors.border,
        borderWidth: isHost || rider.speaking ? 1.5 : 1,
      },
    ]}>
      {/* Avatar */}
      <View style={[styles.riderAvatar, { backgroundColor: rider.avatarColor + '22', borderColor: rider.avatarColor }]}>
        <Text style={[styles.riderInitial, { color: rider.avatarColor }]}>{(rider.nickname || rider.name || 'R').charAt(0)}</Text>
        {rider.speaking && <View style={[styles.speakPip, { backgroundColor: colors.primary }]} />}
      </View>

      {/* Name + meta */}
      <View style={styles.riderInfo}>
        <View style={styles.riderNameRow}>
          <Text style={[styles.riderName, { color: colors.foreground }]}>{rider.nickname || rider.name}</Text>
          {isHost && (
            <View style={[styles.hostBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '55' }]}>
              <Ionicons name="star" size={9} color={colors.primary} />
              <Text style={[styles.hostBadgeText, { color: colors.primary }]}>HOST</Text>
            </View>
          )}
        </View>
        <Text style={[styles.riderSub, { color: colors.mutedForeground }]} numberOfLines={1}>
          {rider.motorcycle || 'Rider'}{rider.speed > 2 ? `  ·  ${Math.round(rider.speed)} km/h` : ''}
        </Text>
      </View>

      {/* Right side */}
      <View style={styles.riderRight}>
        <View style={[styles.connPill, { backgroundColor: connColor + '22' }]}>
          <Ionicons name={connIcon as any} size={10} color={connColor} />
          <Text style={[styles.connText, { color: connColor }]}>
            {rider.connectionType === 'bluetooth' ? 'BLE' : rider.connectionType === 'network' ? 'NET' : 'OFFLINE'}
          </Text>
        </View>
        {isStale && <Ionicons name="time-outline" size={12} color={colors.mutedForeground} style={{ marginTop: 3 }} />}
        {canMakeHost && (
          <Pressable
            style={[styles.makeHostBtn, { backgroundColor: colors.primary + '15', borderColor: colors.primary + '44' }]}
            onPress={onMakeHost}
            hitSlop={6}
          >
            <Ionicons name="star-outline" size={11} color={colors.primary} />
            <Text style={[styles.makeHostText, { color: colors.primary }]}>Make Host</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { currentUser, rideGroup, connectionType, connectedRiders, serverConnected, createGroup, joinGroup, leaveGroup, addHost, removeHost } = useApp();
  const iAmHost = !!rideGroup && !!currentUser && (rideGroup.hostIds ?? []).includes(currentUser.id);

  const confirmToggleHost = (rider: any) => {
    const isAlreadyHost = (rideGroup?.hostIds ?? []).includes(rider.id);
    if (isAlreadyHost) {
      Alert.alert(
        'Remove Host',
        `Remove ${rider.nickname || rider.name} as a host? They will no longer be able to set the group destination.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove Host',
            style: 'destructive',
            onPress: () => {
              removeHost(rider.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
          },
        ],
      );
    } else {
      Alert.alert(
        'Make Host',
        `Give ${rider.nickname || rider.name} host access? They will be able to set the group navigation destination.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Make Host',
            onPress: () => {
              addHost(rider.id);
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            },
          },
        ],
      );
    }
  };
  const { stats, isRiding } = useRide();

  const [showModal, setShowModal] = useState(false);
  const [action, setAction] = useState<'create' | 'join'>('create');
  const [input, setInput] = useState('');

  const tabH = Platform.select({ web: WEB_TAB_BAR, ios: IOS_TAB_BAR, android: ANDROID_TAB_BAR, default: 0 }) as number;
  const bottomPad = Platform.OS === 'web' ? tabH : tabH + insets.bottom;
  const topPad = Platform.OS === 'web' ? WEB_TAB_BAR + 3 : insets.top;

  const initials = currentUser?.name?.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase() ?? 'R';
  const onlineRiders = connectedRiders.filter(r => r.connectionType !== 'offline');

  const openAction = (a: 'create' | 'join') => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAction(a); setInput(''); setShowModal(true);
  };

  const handleGroupAction = async () => {
    if (!input.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (action === 'create') await createGroup(input.trim());
    else await joinGroup(input.trim());
    setInput(''); setShowModal(false);
  };

  const handleLeave = () => {
    Alert.alert('Leave Group', 'Leave the current ride group?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leaveGroup() },
    ]);
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: bottomPad }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: topPad + 6 }]}>
        <Image source={require('../../assets/images/metroeast-logo.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.headerRight}>
          {/* Server connection dot */}
          <View style={[styles.serverDot, { backgroundColor: serverConnected ? colors.success : colors.offline }]} />
          {/* Avatar */}
          <View style={[styles.avatar, {
            backgroundColor: (currentUser?.avatarColor ?? colors.primary) + '22',
            borderColor: currentUser?.avatarColor ?? colors.border,
          }]}>
            <Text style={[styles.avatarText, { color: currentUser?.avatarColor ?? colors.foreground }]}>{initials}</Text>
          </View>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >

        {/* ── Hero: Group Card or Join CTA ── */}
        {rideGroup ? (
          <LinearGradient
            colors={['#1a1006', '#0A0D14']}
            style={[styles.heroCard, { borderColor: colors.primary + '44' }]}
          >
            {/* Top row */}
            <View style={styles.heroTop}>
              <View style={styles.groupMeta}>
                <View style={[styles.groupDot, { backgroundColor: colors.primary }]} />
                <Text style={[styles.groupTitle, { color: colors.foreground }]}>{rideGroup.name}</Text>
              </View>
              <Pressable onPress={handleLeave} hitSlop={10}>
                <Ionicons name="exit-outline" size={20} color={colors.destructive} />
              </Pressable>
            </View>

            {/* Code + rider count */}
            <View style={styles.heroMid}>
              <View style={[styles.codeBadge, { backgroundColor: colors.primary + '22', borderColor: colors.primary + '44' }]}>
                <Ionicons name="key-outline" size={11} color={colors.primary} />
                <Text style={[styles.codeText, { color: colors.primary }]}>{rideGroup.inviteCode}</Text>
              </View>
              <View style={[styles.riderCountBadge, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Ionicons name="people" size={12} color={colors.foreground} />
                <Text style={[styles.riderCountText, { color: colors.foreground }]}>{onlineRiders.length + 1} online</Text>
              </View>
            </View>

            {/* Ride stats strip */}
            <View style={[styles.statsStrip, { borderTopColor: colors.primary + '22' }]}>
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: isRiding ? colors.primary : colors.mutedForeground }]}>
                  {isRiding ? `${stats.currentSpeed}` : '—'}
                </Text>
                <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>km/h</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{stats.distance.toFixed(1)}</Text>
                <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>km</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{connectedRiders.filter(r => r.connectionType === 'bluetooth').length}</Text>
                <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>BLE</Text>
              </View>
              <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
              <View style={styles.statItem}>
                <Text style={[styles.statVal, { color: colors.foreground }]}>{connectedRiders.filter(r => r.connectionType === 'network').length}</Text>
                <Text style={[styles.statLbl, { color: colors.mutedForeground }]}>NET</Text>
              </View>
            </View>
          </LinearGradient>
        ) : (
          /* No group CTA */
          <View style={[styles.noGroupCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.noGroupInner}>
              <Ionicons name="people-outline" size={32} color={colors.primary} />
              <View>
                <Text style={[styles.noGroupTitle, { color: colors.foreground }]}>No Active Group</Text>
                <Text style={[styles.noGroupSub, { color: colors.mutedForeground }]}>Create or join a ride group to get started</Text>
              </View>
            </View>
            <View style={styles.groupBtnRow}>
              <Pressable style={[styles.groupBtn, { backgroundColor: colors.primary }]} onPress={() => openAction('create')}>
                <Ionicons name="add-circle-outline" size={16} color="#fff" />
                <Text style={styles.groupBtnText}>Create Group</Text>
              </Pressable>
              <Pressable style={[styles.groupBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]} onPress={() => openAction('join')}>
                <Ionicons name="enter-outline" size={16} color={colors.foreground} />
                <Text style={[styles.groupBtnText, { color: colors.foreground }]}>Join Group</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ── Quick Actions ── */}
        <View style={styles.qaRow}>
          <QuickAction icon="map-outline" label="Map" sublabel="Live positions" color={colors.success}
            onPress={() => router.push('/(tabs)/map')} />
          <QuickAction icon="mic-outline" label="Voice" sublabel={`mumble · ${rideGroup ? 'active' : 'off'}`} color={colors.primary}
            onPress={() => router.push('/(tabs)/voice')} />
          <QuickAction icon="chatbubbles-outline" label="Chat" sublabel={rideGroup ? 'Group chat' : 'No group'} color={colors.network}
            onPress={() => router.push('/(tabs)/chat')} />
        </View>

        {/* ── Riders ── */}
        {connectedRiders.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[styles.sectionTitle, { color: colors.mutedForeground }]}>RIDERS IN GROUP</Text>
              <View style={[styles.countBadge, { backgroundColor: colors.primary + '22' }]}>
                <Text style={[styles.countText, { color: colors.primary }]}>{connectedRiders.length}</Text>
              </View>
            </View>
            <View style={styles.riderList}>
              {connectedRiders.map(r => (
                <RiderRow
                  key={r.id}
                  rider={r}
                  isHost={(rideGroup?.hostIds ?? []).includes(r.id)}
                  canMakeHost={iAmHost}
                  onMakeHost={() => confirmToggleHost(r)}
                />
              ))}
            </View>
          </View>
        )}

        {/* ── Connection status ── */}
        <View style={[styles.connectionRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.connectionItem}>
            <View style={[styles.connIndicator, { backgroundColor: serverConnected ? colors.success : colors.offline }]} />
            <Text style={[styles.connLabel, { color: colors.mutedForeground }]}>Server</Text>
            <Text style={[styles.connValue, { color: serverConnected ? colors.success : colors.offline }]}>
              {serverConnected ? 'Connected' : 'Offline'}
            </Text>
          </View>
          <View style={[styles.connSep, { backgroundColor: colors.border }]} />
          <View style={styles.connectionItem}>
            <Ionicons name="radio-outline" size={12} color={colors.mutedForeground} />
            <Text style={[styles.connLabel, { color: colors.mutedForeground }]}>Voice</Text>
            <Text style={[styles.connValue, { color: colors.mutedForeground }]}>flash.redmumble.eu</Text>
          </View>
        </View>

      </ScrollView>

      {/* ── SOS ── */}
      <View style={[styles.sosFloat, { bottom: bottomPad + 12 }]}>
        <SOSButton />
      </View>

      {/* ── Group Modal ── */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowModal(false)}>
          <KeyboardAvoidingView behavior="padding" style={styles.modalKav}>
            <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                {action === 'create' ? 'Create Ride Group' : 'Join Ride Group'}
              </Text>
              <Text style={[styles.modalSub, { color: colors.mutedForeground }]}>
                {action === 'create'
                  ? 'Give your group a name. An invite code will be generated.'
                  : 'Enter the 6-character invite code from the group leader.'}
              </Text>
              <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
                <Ionicons name={action === 'create' ? 'people-outline' : 'key-outline'} size={16} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.modalInput, { color: colors.foreground }]}
                  placeholder={action === 'create' ? 'Group name, e.g. Sunday Riders' : 'Invite code, e.g. AB3XYZ'}
                  placeholderTextColor={colors.mutedForeground}
                  value={input}
                  onChangeText={setInput}
                  autoCapitalize={action === 'join' ? 'characters' : 'words'}
                  autoFocus
                  returnKeyType="go"
                  onSubmitEditing={handleGroupAction}
                />
              </View>
              {!serverConnected && (
                <View style={[styles.offlineWarn, { backgroundColor: '#F59E0B22', borderColor: '#F59E0B44' }]}>
                  <Ionicons name="warning-outline" size={13} color="#F59E0B" />
                  <Text style={[styles.offlineWarnText, { color: '#F59E0B' }]}>
                    Server offline — group will work locally on this device only.
                  </Text>
                </View>
              )}
              <View style={styles.modalBtns}>
                <Pressable style={[styles.modalCancelBtn, { borderColor: colors.border }]} onPress={() => setShowModal(false)}>
                  <Text style={[styles.modalCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
                </Pressable>
                <Pressable style={[styles.modalConfirmBtn, { backgroundColor: input.trim() ? colors.primary : colors.muted }]} onPress={handleGroupAction} disabled={!input.trim()}>
                  <Text style={[styles.modalConfirmText, { color: input.trim() ? '#fff' : colors.mutedForeground }]}>
                    {action === 'create' ? 'Create' : 'Join'}
                  </Text>
                </Pressable>
              </View>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Header
  header: { paddingHorizontal: 20, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logo: { width: 160, height: 44 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  serverDot: { width: 8, height: 8, borderRadius: 4 },
  avatar: { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: 'Inter_700Bold', fontSize: 13 },

  scroll: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 100, gap: 14 },

  // Hero group card
  heroCard: { borderRadius: 18, borderWidth: 1, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  groupMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupDot: { width: 8, height: 8, borderRadius: 4 },
  groupTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  heroMid: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingBottom: 14 },
  codeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  codeText: { fontFamily: 'Inter_700Bold', fontSize: 13, letterSpacing: 1 },
  riderCountBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1 },
  riderCountText: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },

  // Stats strip
  statsStrip: { flexDirection: 'row', borderTopWidth: 1, paddingVertical: 12, paddingHorizontal: 16 },
  statItem: { flex: 1, alignItems: 'center', gap: 2 },
  statVal: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  statLbl: { fontFamily: 'Inter_400Regular', fontSize: 10, letterSpacing: 0.5 },
  statDivider: { width: 1, marginVertical: 4 },

  // No group card
  noGroupCard: { borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', padding: 20, gap: 14 },
  noGroupInner: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  noGroupTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  noGroupSub: { fontFamily: 'Inter_400Regular', fontSize: 13, marginTop: 2 },
  groupBtnRow: { flexDirection: 'row', gap: 10 },
  groupBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 12, borderRadius: 12 },
  groupBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 14, color: '#fff' },

  // Quick actions
  qaRow: { flexDirection: 'row', gap: 10 },
  qaCard: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 14, gap: 6, alignItems: 'center' },
  qaIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  qaLabel: { fontFamily: 'Inter_600SemiBold', fontSize: 13 },
  qaSub: { fontFamily: 'Inter_400Regular', fontSize: 10, textAlign: 'center' },

  // Section
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 11, letterSpacing: 1 },
  countBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 },
  countText: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  riderList: { gap: 8 },

  // Rider row
  riderRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14 },
  riderAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 2, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  riderInitial: { fontFamily: 'Inter_700Bold', fontSize: 15 },
  speakPip: { position: 'absolute', bottom: -1, right: -1, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: '#0A0D14' },
  riderInfo: { flex: 1 },
  riderNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  riderName: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  hostBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, borderWidth: 1 },
  hostBadgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  riderSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 1 },
  riderRight: { alignItems: 'flex-end', gap: 4 },
  connPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10 },
  connText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  makeHostBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  makeHostText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.3 },

  // Connection row
  connectionRow: { flexDirection: 'row', borderRadius: 14, borderWidth: 1, padding: 12 },
  connectionItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  connIndicator: { width: 7, height: 7, borderRadius: 4 },
  connLabel: { fontFamily: 'Inter_400Regular', fontSize: 11 },
  connValue: { fontFamily: 'Inter_600SemiBold', fontSize: 11, flex: 1 },
  connSep: { width: 1, marginVertical: 2, marginHorizontal: 8 },

  // SOS
  sosFloat: { position: 'absolute', right: 20 },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  modalKav: { justifyContent: 'flex-end' },
  modalCard: { borderTopLeftRadius: 24, borderTopRightRadius: 24, borderWidth: 1, padding: 24, paddingBottom: 36, gap: 14 },
  modalHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#ffffff22', alignSelf: 'center', marginBottom: 4 },
  modalTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  modalSub: { fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 20 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 14, borderRadius: 14, borderWidth: 1 },
  modalInput: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15 },
  offlineWarn: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, borderWidth: 1 },
  offlineWarnText: { fontFamily: 'Inter_400Regular', fontSize: 12, flex: 1, lineHeight: 17 },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, borderWidth: 1, alignItems: 'center' },
  modalCancelText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
  modalConfirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  modalConfirmText: { fontFamily: 'Inter_600SemiBold', fontSize: 14 },
});
