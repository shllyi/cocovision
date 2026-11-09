import React, { useEffect, useState } from 'react';
import { Platform, View, ActivityIndicator, StyleSheet } from 'react-native';
import { Redirect } from 'expo-router';
import { getSession } from '../constants/session';
import WelcomeScreen from './welcome';

export default function Index() {
  // Web landing page: Always index (/(tabs))
  if (Platform.OS === 'web') {
    return <Redirect href="/(tabs)" />;
  }

  // Mobile landing page: Check if user is logged in
  const [checking, setChecking] = useState(true);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    let alive = true;
    getSession()
      .then((session) => {
        if (!alive) return;
        const hasSession = Boolean(
          session && (session.id || session._id || session.user_id || session.token || session.email || session.username || Object.keys(session).length > 0)
        );
        setIsLoggedIn(hasSession);
        setChecking(false);
      })
      .catch(() => {
        if (!alive) return;
        setIsLoggedIn(false);
        setChecking(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  if (checking) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#46652A" />
      </View>
    );
  }

  // If user is already logged in on mobile, bypass welcome and land directly on tabs
  if (isLoggedIn) {
    return <Redirect href="/(tabs)" />;
  }

  // Guest / not logged-in mobile users see the welcome screen
  return <WelcomeScreen />;
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    backgroundColor: '#F5E6D3',
    justifyContent: 'center',
    alignItems: 'center',
  },
});
