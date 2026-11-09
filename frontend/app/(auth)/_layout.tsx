import { Stack } from 'expo-router';

export default function AuthLayout() {
  // This tells Expo to treat the auth folder as a stack of screens
  return <Stack screenOptions={{ headerShown: false }} />;
}