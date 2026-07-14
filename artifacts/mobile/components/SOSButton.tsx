import React, { useRef, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, Alert } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  withSequence,
  cancelAnimation,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useColors } from '@/hooks/useColors';
import { useChat } from '@/context/ChatContext';

const HOLD_MS = 2000;

export function SOSButton() {
  const colors = useColors();
  const { sendSOS } = useChat();
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activated = useRef(false);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  const startPulse = () => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.5, { duration: 700, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 700 }),
      ),
      -1, false,
    );
    opacity.value = withRepeat(
      withSequence(withTiming(0, { duration: 700 }), withTiming(0.6, { duration: 700 })),
      -1, false,
    );
  };

  const stopPulse = () => {
    cancelAnimation(scale);
    cancelAnimation(opacity);
    scale.value = withTiming(1, { duration: 200 });
    opacity.value = withTiming(1, { duration: 200 });
  };

  const handlePressIn = useCallback(() => {
    activated.current = false;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    startPulse();
    holdTimer.current = setTimeout(async () => {
      activated.current = true;
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      stopPulse();

      // Send SOS chat message + start live location broadcast
      await sendSOS();

      Alert.alert(
        '🚨 SOS Sent',
        'Your emergency alert has been posted to the group chat. No calls were made.',
        [{ text: 'OK', style: 'destructive' }],
      );
    }, HOLD_MS);
  }, [sendSOS]);

  const handlePressOut = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    if (!activated.current) stopPulse();
  }, []);

  return (
    <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} style={styles.wrapper}>
      <Animated.View style={[styles.ring, { borderColor: colors.destructive }, ringStyle]} />
      <View style={[styles.button, { backgroundColor: colors.destructive }]}>
        <Text style={styles.label}>SOS</Text>
        <Text style={[styles.sub, { color: '#ffffff99' }]}>HOLD</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: 72, height: 72,
    alignItems: 'center', justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 72, height: 72,
    borderRadius: 36, borderWidth: 2,
  },
  button: {
    width: 64, height: 64,
    borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  label: {
    fontFamily: 'Inter_700Bold',
    fontSize: 18, color: '#FFFFFF', letterSpacing: 1,
  },
  sub: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: 8, letterSpacing: 1,
  },
});
