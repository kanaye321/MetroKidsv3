import React, { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Pressable,
  Platform, KeyboardAvoidingView, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { useApp, AVATAR_COLORS } from '@/context/AppContext';
import { useColors } from '@/hooks/useColors';

export default function AuthScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login, loginAsGuest } = useApp();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter your name.');
      return;
    }
    setError('');
    setLoading(true);
    const profile = {
      id: Date.now().toString(),
      name: trimmed,
      nickname: trimmed.split(' ')[0],
      motorcycle: '',
      emergencyContact: '',
      avatarColor: AVATAR_COLORS[Math.floor(trimmed.charCodeAt(0) % AVATAR_COLORS.length)],
    };
    await login(profile);
    setLoading(false);
    router.replace('/(tabs)');
  };

  const handleGuest = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    await loginAsGuest();
    setLoading(false);
    router.replace('/(tabs)');
  };

  return (
    <LinearGradient
      colors={['#0A0D14', '#131823', '#0A0D14']}
      style={StyleSheet.absoluteFill}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scroll,
            { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand */}
          <View style={styles.brandSection}>
            <Image
              source={require('../assets/images/metroeast-logo.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={[styles.tagline, { color: colors.mutedForeground }]}>
              Ride Together. Stay Connected.
            </Text>
          </View>

          {/* Form */}
          <View style={styles.form}>
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: colors.destructive + '22', borderColor: colors.destructive + '44' }]}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
              </View>
            ) : null}

            <View style={[styles.inputWrap, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <Ionicons name="person-outline" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Your name"
                placeholderTextColor={colors.mutedForeground}
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoCorrect={false}
                returnKeyType="go"
                onSubmitEditing={handleLogin}
              />
            </View>

            <Pressable
              style={({ pressed }) => [styles.primaryBtn, { backgroundColor: colors.primary, opacity: pressed ? 0.85 : 1 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={styles.primaryBtnText}>Get Started</Text>
              )}
            </Pressable>

            {/* Divider */}
            <View style={styles.divider}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            <Pressable onPress={handleGuest} disabled={loading} style={({ pressed }) => [styles.guestBtn, { opacity: pressed ? 0.7 : 1, borderColor: colors.border }]}>
              <Ionicons name="person-circle-outline" size={18} color={colors.mutedForeground} />
              <Text style={[styles.guestText, { color: colors.mutedForeground }]}>
                Continue as <Text style={{ color: colors.primary }}>Guest Rider</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: 28, justifyContent: 'center', gap: 32 },
  brandSection: { alignItems: 'center', gap: 12 },
  logo: { width: 280, height: 80 },
  tagline: { fontFamily: 'Inter_400Regular', fontSize: 14, textAlign: 'center' },
  form: { gap: 12 },
  errorBox: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, borderRadius: 10, borderWidth: 1 },
  errorText: { fontFamily: 'Inter_400Regular', fontSize: 13, flex: 1 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12, borderWidth: 1 },
  input: { flex: 1, fontFamily: 'Inter_400Regular', fontSize: 15 },
  primaryBtn: { paddingVertical: 16, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  primaryBtnText: { fontFamily: 'Inter_700Bold', fontSize: 16, color: '#FFFFFF', letterSpacing: 0.3 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1 },
  dividerText: { fontFamily: 'Inter_400Regular', fontSize: 12 },
  guestBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, borderWidth: 1 },
  guestText: { fontFamily: 'Inter_400Regular', fontSize: 14 },
});
