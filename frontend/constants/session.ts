import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export async function getSession(): Promise<any | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Spread into any fetch/axios headers. Falls back to the id for sessions saved before the token existed.
export async function authHeaders(extra: Record<string, string> = {}) {
  const s = await getSession();
  const bearer = s?.token ?? s?.id ?? s?._id ?? s?.user_id ?? s?.userId;
  return {
    'ngrok-skip-browser-warning': 'true',
    ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
    ...extra,
  };
}