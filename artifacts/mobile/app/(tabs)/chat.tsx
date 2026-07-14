import React, { useState, useCallback, useMemo } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  TextInput, Platform, Alert, Image, Linking, ActivityIndicator, Modal,
  ScrollView, Dimensions,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import { useColors } from '@/hooks/useColors';
import { useChat, ChatMessage } from '@/context/ChatContext';
import { useApp, GroupMember } from '@/context/AppContext';
import { RiderCard } from '@/components/RiderCard';

const WEB_TAB_BAR_HEIGHT = 64;
const IOS_TAB_BAR_HEIGHT = 49;
const ANDROID_TAB_BAR_HEIGHT = 56;

// Common riding/group-chat emoji, grouped by category for the picker.
const EMOJI_CATEGORIES: { label: string; emojis: string[] }[] = [
  {
    label: 'Reactions',
    emojis: ['👍', '👎', '🤙', '✌️', '👊', '🙏', '💪', '👌', '🙌', '🤝', '❤️', '💯', '🔥', '⚡', '🎉'],
  },
  {
    label: 'Faces',
    emojis: ['😀', '😂', '😎', '😅', '😬', '😴', '🤔', '😮', '😢', '😡', '🥳', '😤', '🤣', '🙂', '😇'],
  },
  {
    label: 'Riding',
    emojis: ['🏍️', '🛣️', '⛽', '🔧', '🗺️', '📍', '⚠️', '🚨', '🏁', '🛞', '🪖', '🧤', '🧥', '⏱️', '📸'],
  },
  {
    label: 'Weather',
    emojis: ['☀️', '⛅', '🌧️', '⛈️', '🌫️', '💨', '❄️', '🌡️', '🌅', '🌙'],
  },
];

// ── Static map tile URL (OpenStreetMap) ───────────────────────────────────────
function staticMapUrl(lat: number, lng: number, w = 280, h = 160) {
  return `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=15&size=${w}x${h}&markers=${lat},${lng},red`;
}

function openInMaps(lat: number, lng: number) {
  const url = Platform.select({
    ios: `maps:?ll=${lat},${lng}&q=Location`,
    android: `geo:${lat},${lng}?q=${lat},${lng}`,
    default: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=15`,
  })!;
  Linking.openURL(url);
}

// ── Transport icon ─────────────────────────────────────────────────────────────
function TransportIcon({ transport }: { transport: 'bluetooth' | 'network' }) {
  const colors = useColors();
  return (
    <Ionicons
      name={transport === 'bluetooth' ? 'bluetooth' : 'wifi'}
      size={9}
      color={transport === 'bluetooth' ? colors.success : colors.network}
    />
  );
}

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, myId, onImagePress }: { msg: ChatMessage; myId: string; onImagePress: (uri: string) => void }) {
  const colors = useColors();
  const isMe = msg.senderId === myId;
  const time = new Date(msg.timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

  const renderContent = () => {
    switch (msg.type) {

      // ── Location: show static map tile ──────────────────────────────────
      case 'location': {
        const hasCoords = msg.latitude != null && msg.longitude != null;
        return (
          <View style={styles.locationCard}>
            {hasCoords ? (
              <Pressable onPress={() => openInMaps(msg.latitude!, msg.longitude!)} style={styles.mapThumb}>
                <Image
                  source={{ uri: staticMapUrl(msg.latitude!, msg.longitude!) }}
                  style={styles.mapImage}
                  resizeMode="cover"
                />
                {/* pin overlay */}
                <View style={styles.mapPinOverlay} pointerEvents="none">
                  <Ionicons name="location" size={22} color={colors.primary} style={{ textShadowColor: '#000', textShadowRadius: 4 }} />
                </View>
                <View style={[styles.openMapsBtn, { backgroundColor: '#00000099' }]}>
                  <Ionicons name="navigate" size={10} color="#fff" />
                  <Text style={styles.openMapsBtnText}>Open in Maps</Text>
                </View>
              </Pressable>
            ) : null}
            <View style={styles.locationMeta}>
              <Ionicons name="location" size={13} color={isMe ? '#ffffffcc' : colors.primary} />
              <Text style={[styles.locationAddress, { color: isMe ? '#ffffffee' : colors.foreground }]} numberOfLines={2}>
                {msg.address || msg.content || 'Shared location'}
              </Text>
            </View>
          </View>
        );
      }

      // ── SOS: red alert card with map ─────────────────────────────────────
      case 'sos': {
        const hasCoords = msg.latitude != null && msg.longitude != null;
        return (
          <View style={styles.sosCard}>
            <View style={styles.sosHeader}>
              <Ionicons name="alert-circle" size={18} color="#fff" />
              <Text style={styles.sosTitle}>🚨 SOS ALERT</Text>
            </View>
            {hasCoords && (
              <Pressable onPress={() => openInMaps(msg.latitude!, msg.longitude!)} style={[styles.mapThumb, { marginTop: 6 }]}>
                <Image
                  source={{ uri: staticMapUrl(msg.latitude!, msg.longitude!) }}
                  style={styles.mapImage}
                  resizeMode="cover"
                />
                <View style={styles.mapPinOverlay} pointerEvents="none">
                  <Ionicons name="location" size={22} color="#EF4444" style={{ textShadowColor: '#000', textShadowRadius: 4 }} />
                </View>
                <View style={[styles.openMapsBtn, { backgroundColor: '#00000099' }]}>
                  <Ionicons name="navigate" size={10} color="#fff" />
                  <Text style={styles.openMapsBtnText}>Open in Maps</Text>
                </View>
              </Pressable>
            )}
            <Text style={styles.sosBody} numberOfLines={4}>
              {msg.content.replace('🚨 ', '').replace(/^SOS — /, '')}
            </Text>
          </View>
        );
      }

      // ── Image ────────────────────────────────────────────────────────────
      case 'image': {
        if (!msg.imageBase64 || msg.imageBase64 === '[image]') {
          return (
            <View style={styles.imagePlaceholder}>
              <Ionicons name="image-outline" size={24} color={isMe ? '#ffffff88' : colors.mutedForeground} />
              <Text style={[styles.imagePlaceholderText, { color: isMe ? '#ffffff88' : colors.mutedForeground }]}>Photo</Text>
            </View>
          );
        }
        return (
          <Pressable onPress={() => onImagePress(msg.imageBase64!)}>
            <Image
              source={{ uri: msg.imageBase64 }}
              style={styles.chatImage}
              resizeMode="cover"
            />
          </Pressable>
        );
      }

      // ── Voice note ───────────────────────────────────────────────────────
      case 'voiceNote':
        return (
          <View style={styles.voiceNote}>
            <Ionicons name="mic" size={14} color={isMe ? '#fff' : colors.foreground} />
            <View style={styles.waveform}>
              {[3, 6, 9, 5, 8, 4, 7, 6, 4, 8, 5, 6, 3].map((h, i) => (
                <View key={i} style={[styles.waveBar, { height: h * 2, backgroundColor: isMe ? '#ffffff88' : colors.mutedForeground }]} />
              ))}
            </View>
            <Text style={[styles.voiceDuration, { color: isMe ? '#ffffffcc' : colors.mutedForeground }]}>
              0:{(msg.durationSec ?? 0).toString().padStart(2, '0')}
            </Text>
          </View>
        );

      // ── Text ─────────────────────────────────────────────────────────────
      default:
        return (
          <Text style={[styles.msgText, { color: isMe ? '#fff' : colors.foreground }]}>
            {msg.content}
          </Text>
        );
    }
  };

  // SOS and image messages get different bubble styling
  const isFullWidth = msg.type === 'location' || msg.type === 'sos' || msg.type === 'image';

  return (
    <View style={[styles.bubbleWrapper, isMe && styles.bubbleWrapperMe]}>
      {!isMe && (
        <View style={[styles.senderAvatar, { backgroundColor: msg.avatarColor + '22', borderColor: msg.avatarColor }]}>
          <Text style={[styles.senderInitial, { color: msg.avatarColor }]}>{msg.senderNickname.charAt(0)}</Text>
        </View>
      )}
      <View style={[styles.bubbleContent, isFullWidth && styles.bubbleContentWide]}>
        {!isMe && (
          <Text style={[styles.senderName, { color: msg.avatarColor }]}>{msg.senderNickname}</Text>
        )}
        <View style={[
          styles.bubble,
          msg.type === 'sos'
            ? { backgroundColor: '#DC2626', borderColor: '#991B1B', borderWidth: 1 }
            : isMe
              ? { backgroundColor: colors.primary }
              : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1 },
          isFullWidth && styles.bubbleFullWidth,
          (msg.type === 'location' || msg.type === 'sos') && styles.bubblePadless,
          msg.type === 'image' && styles.bubbleImageless,
        ]}>
          {renderContent()}
        </View>
        <View style={[styles.metaRow, isMe && styles.metaRowMe]}>
          <TransportIcon transport={msg.transport} />
          <Text style={[styles.timeText, { color: colors.mutedForeground }]}>{time}</Text>
        </View>
      </View>
    </View>
  );
}

// ── Main screen ────────────────────────────────────────────────────────────────
export default function ChatScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { messages, sendMessage, sendLocation, sendImage, isSendingImage, setChatFocused } = useChat();
  const { rideGroup, connectedRiders, currentUser, connectionType } = useApp();
  const [input, setInput] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [emojiCategory, setEmojiCategory] = useState(0);
  const [showMembers, setShowMembers] = useState(false);
  const [viewerImage, setViewerImage] = useState<string | null>(null);

  // "You" as a GroupMember-shaped row so it can share RiderCard with everyone else.
  const selfMember: GroupMember | null = useMemo(() => {
    if (!currentUser) return null;
    return {
      id: currentUser.id,
      name: currentUser.name,
      nickname: currentUser.nickname,
      motorcycle: currentUser.motorcycle,
      connectionType,
      lastSeen: Date.now(),
      latitude: 0,
      longitude: 0,
      speed: 0,
      heading: 0,
      avatarColor: currentUser.avatarColor,
    };
  }, [currentUser, connectionType]);

  const memberList: GroupMember[] = selfMember ? [selfMember, ...connectedRiders] : connectedRiders;

  const topPad = Platform.OS === 'web' ? WEB_TAB_BAR_HEIGHT + 3 : insets.top;
  const tabBarHeight = Platform.select({
    web: WEB_TAB_BAR_HEIGHT,
    ios: IOS_TAB_BAR_HEIGHT,
    android: ANDROID_TAB_BAR_HEIGHT,
    default: 0,
  }) as number;
  const tabBarPad = Platform.OS === 'web' ? tabBarHeight : tabBarHeight + insets.bottom;

  const reversed = [...messages].reverse();

  const handleSend = () => {
    if (!input.trim()) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    sendMessage(input.trim());
    setInput('');
  };

  const handleShareLocation = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (Platform.OS === 'web') {
      Alert.alert('Location', 'Location sharing requires the mobile app.');
      return;
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Location Required', 'Allow location access to share your position with the group.');
      return;
    }
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      await sendLocation(loc.coords.latitude, loc.coords.longitude);
    } catch {
      Alert.alert('Error', 'Could not get your location. Please try again.');
    }
  }, [sendLocation]);

  const handlePickImage = useCallback(async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await sendImage();
  }, [sendImage]);

  const handleToggleEmoji = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowEmoji(v => !v);
  }, []);

  const handleInsertEmoji = useCallback((emoji: string) => {
    setInput(v => v + emoji);
  }, []);

  const myId = currentUser?.id ?? '';

  // Suppress new-message notifications while this screen is on-screen.
  useFocusEffect(
    useCallback(() => {
      setChatFocused(true);
      return () => setChatFocused(false);
    }, [setChatFocused])
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingBottom: tabBarPad }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPad + 8, borderBottomColor: colors.border }]}>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            {rideGroup?.name ?? 'Group Chat'}
          </Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {connectedRiders.length > 0 ? `${connectedRiders.length} riders online` : 'No active group'}
          </Text>
        </View>
        <View style={styles.headerRight}>
          <Pressable
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setShowMembers(true); }}
            style={({ pressed }) => [styles.membersBtn, { backgroundColor: colors.muted, opacity: pressed ? 0.7 : 1 }]}
            hitSlop={6}
          >
            <Ionicons name="people" size={14} color={colors.foreground} />
            <Text style={[styles.membersBtnText, { color: colors.foreground }]}>{memberList.length}</Text>
          </Pressable>
          <View style={[styles.btBadge, { backgroundColor: colors.success + '22' }]}>
            <Ionicons name="bluetooth" size={12} color={colors.success} />
            <Text style={[styles.badgeText, { color: colors.success }]}>MESH</Text>
          </View>
        </View>
      </View>

      {/* Members modal */}
      <Modal visible={showMembers} animationType="slide" transparent onRequestClose={() => setShowMembers(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setShowMembers(false)}>
          <Pressable style={[styles.membersSheet, { backgroundColor: colors.background, paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <View style={styles.membersHandle} />
            <View style={styles.membersHeader}>
              <Text style={[styles.membersTitle, { color: colors.foreground }]}>
                Group Members ({memberList.length})
              </Text>
              <Pressable onPress={() => setShowMembers(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={colors.mutedForeground} />
              </Pressable>
            </View>
            {rideGroup && (
              <Text style={[styles.membersSub, { color: colors.mutedForeground }]}>
                {rideGroup.name} · Code {rideGroup.inviteCode}
              </Text>
            )}
            <FlatList
              data={memberList}
              keyExtractor={m => m.id}
              contentContainerStyle={{ gap: 8, paddingTop: 12 }}
              renderItem={({ item }) => (
                <RiderCard
                  rider={item}
                  compact
                  badge={(rideGroup?.hostIds ?? []).includes(item.id) ? 'Host' : item.id === currentUser?.id ? 'You' : undefined}
                />
              )}
              ListEmptyComponent={
                <Text style={[styles.membersSub, { color: colors.mutedForeground, textAlign: 'center', paddingVertical: 20 }]}>
                  No one else has joined yet.
                </Text>
              }
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Fullscreen image viewer (pinch to zoom) */}
      <Modal visible={!!viewerImage} animationType="fade" transparent onRequestClose={() => setViewerImage(null)}>
        <View style={styles.viewerBackdrop}>
          <Pressable style={styles.viewerCloseBtn} onPress={() => setViewerImage(null)} hitSlop={10}>
            <Ionicons name="close" size={28} color="#fff" />
          </Pressable>
          <ScrollView
            style={styles.flex}
            contentContainerStyle={styles.viewerScrollContent}
            maximumZoomScale={4}
            minimumZoomScale={1}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            centerContent
          >
            {viewerImage && (
              <Image
                source={{ uri: viewerImage }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
            )}
          </ScrollView>
        </View>
      </Modal>

      <KeyboardAvoidingView style={styles.flex} behavior="padding" keyboardVerticalOffset={0}>
        {messages.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="chatbubbles-outline" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No messages yet</Text>
            <Text style={[styles.emptySub, { color: colors.mutedForeground }]}>
              Messages from your ride group appear here.{'\n'}Share your location or a photo to get started.
            </Text>
          </View>
        ) : (
          <FlatList
            data={reversed}
            keyExtractor={m => m.id}
            renderItem={({ item }) => <MessageBubble msg={item} myId={myId} onImagePress={setViewerImage} />}
            inverted
            contentContainerStyle={[styles.listContent, { paddingBottom: 8 }]}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Emoji picker panel */}
        {showEmoji && (
          <View style={[styles.emojiPanel, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
            <View style={styles.emojiTabs}>
              {EMOJI_CATEGORIES.map((cat, i) => (
                <Pressable
                  key={cat.label}
                  onPress={() => setEmojiCategory(i)}
                  style={[styles.emojiTab, emojiCategory === i && { backgroundColor: colors.primary + '22', borderColor: colors.primary }]}
                >
                  <Text style={[styles.emojiTabText, { color: emojiCategory === i ? colors.primary : colors.mutedForeground }]}>
                    {cat.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <FlatList
              data={EMOJI_CATEGORIES[emojiCategory].emojis}
              keyExtractor={(e, i) => `${e}_${i}`}
              numColumns={8}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => handleInsertEmoji(item)}
                  style={({ pressed }) => [styles.emojiKey, { opacity: pressed ? 0.5 : 1 }]}
                  hitSlop={4}
                >
                  <Text style={styles.emojiKeyText}>{item}</Text>
                </Pressable>
              )}
            />
          </View>
        )}

        {/* Input bar */}
        <View style={[styles.inputBar, {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          paddingBottom: 8,
        }]}>
          {/* Location button */}
          <Pressable
            onPress={handleShareLocation}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={6}
          >
            <Ionicons name="location-outline" size={22} color={colors.primary} />
          </Pressable>

          {/* Image picker button */}
          <Pressable
            onPress={handlePickImage}
            disabled={isSendingImage}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed || isSendingImage ? 0.6 : 1 }]}
            hitSlop={6}
          >
            {isSendingImage
              ? <ActivityIndicator size={18} color={colors.primary} />
              : <Ionicons name="image-outline" size={22} color={colors.primary} />
            }
          </Pressable>

          {/* Emoji picker toggle */}
          <Pressable
            onPress={handleToggleEmoji}
            style={({ pressed }) => [styles.iconBtn, { opacity: pressed ? 0.6 : 1 }]}
            hitSlop={6}
          >
            <Ionicons name={showEmoji ? 'happy' : 'happy-outline'} size={22} color={showEmoji ? colors.primary : colors.mutedForeground} />
          </Pressable>

          {/* Text input */}
          <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="Message…"
              placeholderTextColor={colors.mutedForeground}
              value={input}
              onChangeText={setInput}
              multiline
              maxLength={500}
              returnKeyType="send"
              onSubmitEditing={handleSend}
            />
          </View>

          {/* Send button */}
          <Pressable
            onPress={handleSend}
            style={({ pressed }) => [
              styles.sendBtn,
              { backgroundColor: input.trim() ? colors.primary : colors.muted, opacity: pressed ? 0.8 : 1 },
            ]}
          >
            <Ionicons name="send" size={18} color={input.trim() ? '#fff' : colors.mutedForeground} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },

  // Header
  header: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  headerTitle: { fontFamily: 'Inter_700Bold', fontSize: 18 },
  headerSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },
  headerRight: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  btBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 20 },
  badgeText: { fontFamily: 'Inter_700Bold', fontSize: 9, letterSpacing: 0.5 },
  membersBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 20 },
  membersBtnText: { fontFamily: 'Inter_700Bold', fontSize: 12 },

  // Members modal
  modalBackdrop: { flex: 1, backgroundColor: '#00000088', justifyContent: 'flex-end' },
  membersSheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 16, paddingTop: 10, maxHeight: '75%' },
  membersHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#ffffff33', alignSelf: 'center', marginBottom: 12 },
  membersHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  membersTitle: { fontFamily: 'Inter_700Bold', fontSize: 16 },
  membersSub: { fontFamily: 'Inter_400Regular', fontSize: 12, marginTop: 2 },

  // Empty state
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  emptyTitle: { fontFamily: 'Inter_600SemiBold', fontSize: 16 },
  emptySub: { fontFamily: 'Inter_400Regular', fontSize: 13, textAlign: 'center', lineHeight: 20 },

  // List
  listContent: { paddingHorizontal: 12, paddingTop: 8, gap: 4 },

  // Bubble wrapper
  bubbleWrapper: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, marginBottom: 4 },
  bubbleWrapperMe: { flexDirection: 'row-reverse' },
  senderAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0, alignSelf: 'flex-end' },
  senderInitial: { fontFamily: 'Inter_700Bold', fontSize: 11 },
  bubbleContent: { maxWidth: '75%', gap: 3 },
  bubbleContentWide: { maxWidth: '85%' },
  senderName: { fontFamily: 'Inter_600SemiBold', fontSize: 11, marginLeft: 2 },

  // Bubble
  bubble: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleFullWidth: { paddingHorizontal: 0, paddingVertical: 0 },
  bubblePadless: { overflow: 'hidden' },
  bubbleImageless: { overflow: 'hidden', paddingHorizontal: 0, paddingVertical: 0 },

  // Text message
  msgText: { fontFamily: 'Inter_400Regular', fontSize: 14, lineHeight: 20 },

  // Voice note
  voiceNote: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  waveform: { flexDirection: 'row', alignItems: 'center', gap: 1.5 },
  waveBar: { width: 2, borderRadius: 1 },
  voiceDuration: { fontFamily: 'Inter_400Regular', fontSize: 11 },

  // Location card
  locationCard: { borderRadius: 14, overflow: 'hidden' },
  mapThumb: { width: '100%', height: 140, position: 'relative', backgroundColor: '#1a1a2e' },
  mapImage: { width: '100%', height: '100%' },
  mapPinOverlay: { position: 'absolute', top: '50%', left: '50%', transform: [{ translateX: -11 }, { translateY: -22 }] },
  openMapsBtn: { position: 'absolute', bottom: 6, right: 6, flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10 },
  openMapsBtnText: { fontFamily: 'Inter_600SemiBold', fontSize: 10, color: '#fff' },
  locationMeta: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingHorizontal: 10, paddingVertical: 8 },
  locationAddress: { fontFamily: 'Inter_400Regular', fontSize: 12, flex: 1, lineHeight: 17 },

  // SOS card
  sosCard: { borderRadius: 14, overflow: 'hidden', padding: 10 },
  sosHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sosTitle: { fontFamily: 'Inter_700Bold', fontSize: 14, color: '#fff', letterSpacing: 0.5 },
  sosBody: { fontFamily: 'Inter_400Regular', fontSize: 12, color: '#ffffffdd', marginTop: 4, lineHeight: 18 },

  // Image
  chatImage: { width: 220, height: 160, borderRadius: 14 },
  imagePlaceholder: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8 },
  imagePlaceholderText: { fontFamily: 'Inter_400Regular', fontSize: 12 },

  // Fullscreen image viewer
  viewerBackdrop: { flex: 1, backgroundColor: '#000000ee' },
  viewerCloseBtn: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 6 },
  viewerScrollContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: Dimensions.get('window').width, height: Dimensions.get('window').height * 0.8 },

  // Meta row (time + transport)
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 2 },
  metaRowMe: { flexDirection: 'row-reverse', marginLeft: 0, marginRight: 2 },
  timeText: { fontFamily: 'Inter_400Regular', fontSize: 10 },

  // Emoji picker
  emojiPanel: { borderTopWidth: 1, paddingVertical: 6, paddingHorizontal: 6, maxHeight: 220 },
  emojiTabs: { flexDirection: 'row', gap: 6, paddingHorizontal: 4, paddingBottom: 6 },
  emojiTab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: 'transparent' },
  emojiTabText: { fontFamily: 'Inter_600SemiBold', fontSize: 11 },
  emojiKey: { flex: 1, aspectRatio: 1, alignItems: 'center', justifyContent: 'center' },
  emojiKeyText: { fontSize: 22 },

  // Input bar
  inputBar: { borderTopWidth: 1, paddingHorizontal: 10, paddingTop: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  iconBtn: { padding: 6, alignSelf: 'flex-end' },
  inputWrap: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 120 },
  input: { fontFamily: 'Inter_400Regular', fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
});
