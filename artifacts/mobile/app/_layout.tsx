import React, { useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Feather, Ionicons } from '@expo/vector-icons';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SocketProvider } from '@/context/SocketContext';
import { AppProvider } from '@/context/AppContext';
import { NavigationProvider } from '@/context/NavigationContext';
import { RideProvider } from '@/context/RideContext';
import { ChatProvider } from '@/context/ChatContext';
import { ThemeProvider } from '@/context/ThemeContext';

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="auth" options={{ headerShown: false, animation: 'fade' }} />
    </Stack>
  );
}

export default function RootLayout() {
  // Preload icon glyph fonts alongside Inter. On Android, icons rendered before
  // @expo/vector-icons finishes async-loading fall back to the "missing glyph" box (looks like
  // an "X"). Ionicons is used throughout the app; Feather is used for the Android tab bar.
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    ...Ionicons.font,
    ...Feather.font,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <ThemeProvider>
      <SafeAreaProvider>
        <ErrorBoundary>
          <QueryClientProvider client={queryClient}>
            <SocketProvider>
              <AppProvider>
                {/*
                  NavigationProvider sits inside AppProvider (needs currentUser/rideGroup)
                  and outside RideProvider/ChatProvider (they don't need nav state).
                */}
                <NavigationProvider>
                  <RideProvider>
                    <ChatProvider>
                      <GestureHandlerRootView style={{ flex: 1 }}>
                        <KeyboardProvider>
                          <RootLayoutNav />
                        </KeyboardProvider>
                      </GestureHandlerRootView>
                    </ChatProvider>
                  </RideProvider>
                </NavigationProvider>
              </AppProvider>
            </SocketProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ThemeProvider>
  );
}
