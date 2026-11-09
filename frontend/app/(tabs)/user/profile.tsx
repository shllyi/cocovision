// frontend/app/(tabs)/user/profile.tsx
// View/edit profile + logout. Backend: PUT /auth/update (multipart)
//   fields: user_id, fullName, email, phoneNumber, location, profileImage (optional file)
// Session lives in key "user_session" (SecureStore on native, localStorage on web).

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView, Image,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import axios from 'axios';
import { NGROK_URL } from '../../../constants/config';
import { authHeaders } from '../../../constants/session';

const HEADERS = { 'ngrok-skip-browser-warning': 'true' };
const KEY = 'user_session';

async function readSession(): Promise<any | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem(KEY)
      : await SecureStore.getItemAsync(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
async function writeSession(u: any) {
  try {
    const raw = JSON.stringify(u);
    if (Platform.OS === 'web') localStorage.setItem(KEY, raw);
    else await SecureStore.setItemAsync(KEY, raw);
  } catch {}
}
async function clearSession() {
  try {
    if (Platform.OS === 'web') localStorage.removeItem(KEY);
    else await SecureStore.deleteItemAsync(KEY);
  } catch {}
}

function errorText(data: any, status: number): string {
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((e: any) => e?.msg || 'Invalid input').join(', ');
  return `HTTP ${status}`;
}

function Avatar({ uri, name, size }: { uri?: string | null; name?: string; size: number }) {
  const r = size / 2;
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r, backgroundColor: '#e2e8f0' }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: '#15803d', justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: size * 0.42 }}>{(name || 'U').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function ProfileScreen() {
  const [user, setUser] = useState<any>(null);
  const [checked, setChecked] = useState(false);

  const [editing, setEditing] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [location, setLocation] = useState('');
  const [newImage, setNewImage] = useState<ImagePicker.ImagePickerAsset | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [okMsg, setOkMsg] = useState('');

  useFocusEffect(useCallback(() => {
    readSession().then((u) => {
      if (u && !(u.id ?? u._id ?? u.user_id)) console.log('[profile] session has no id. keys:', Object.keys(u));
      setUser(u);
      setChecked(true);
    });
  }, []));

  const uid = user ? String(user.id ?? user._id ?? user.user_id ?? '') : '';

  const startEdit = () => {
    setFullName(user?.fullName || '');
    setPhone(user?.phoneNumber || '');
    setLocation(user?.location || '');
    setNewImage(null);
    setError('');
    setOkMsg('');
    setEditing(true);
  };

  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7,
    });
    if (!res.canceled) setNewImage(res.assets[0]);
  };

  const save = async () => {
    if (!fullName.trim() || saving || !uid) return;
    setSaving(true);
    setError('');
    try {
      const form = new FormData();
      form.append('user_id', uid);
      form.append('fullName', fullName.trim());
      form.append('email', user.email || '');
      form.append('phoneNumber', phone.trim());
      form.append('location', location.trim());
      if (newImage) {
        const name = newImage.fileName || 'profile.jpg';
        const type = newImage.mimeType || 'image/jpeg';
        if (Platform.OS === 'web') {
          const blob = await (await fetch(newImage.uri)).blob();
          form.append('profileImage', blob, name);
        } else {
          form.append('profileImage', { uri: newImage.uri, name, type } as any);
        }
      }

      // axios (XHR): Expo's fetch rejects { uri, name, type } parts.
      const res = await axios.put(`${NGROK_URL}/auth/update`, form, {
        headers: { ...HEADERS, ...(await authHeaders()), 'Content-Type': 'multipart/form-data' },
        transformRequest: (d) => d,
        validateStatus: () => true,
        timeout: 60000,
      });
      if (res.status < 200 || res.status >= 300) throw new Error(errorText(res.data, res.status));

      const d = res.data;
      const merged = {
        ...user,
        id: d.id ?? uid,
        fullName: d.fullName,
        email: d.email ?? user.email,
        role: d.role ?? user.role,
        location: d.location,
        phoneNumber: d.phoneNumber,
        profileImage: d.profileImage,
      };
      await writeSession(merged);
      setUser(merged);
      setEditing(false);
      setNewImage(null);
      setOkMsg('Profile updated.');
    } catch (e: any) {
      setError(e?.message || 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  const doLogout = async () => {
    await clearSession();
    setUser(null);
    router.replace('/(tabs)');
  };
  const logout = () => {
    if (Platform.OS === 'web') { doLogout(); return; }
    Alert.alert('Log out', 'Log out of CocoVision?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: doLogout },
    ]);
  };

  const shownImage = newImage?.uri ?? user?.profileImage;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <LinearGradient colors={['#052e16', '#166534', '#1a7d3f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.header}>
          <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={s.backBtn} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <Text style={s.headerTitle}>My Profile</Text>
        </LinearGradient>

        {!checked ? (
          <ActivityIndicator style={{ marginTop: 40 }} color="#16a34a" />
        ) : !user ? (
          <View style={s.card}>
            <Ionicons name="lock-closed-outline" size={36} color="#16a34a" style={{ alignSelf: 'center' }} />
            <Text style={s.cardTitle}>Login required</Text>
            <Text style={s.cardText}>Please log in to see your profile.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.push('/(auth)/login')} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Go to login</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.card}>
            <View style={s.avatarWrap}>
              <Avatar uri={shownImage} name={user.fullName} size={96} />
              {editing && (
                <TouchableOpacity style={s.camBtn} onPress={pickImage} activeOpacity={0.85}>
                  <Ionicons name="camera" size={16} color="#fff" />
                </TouchableOpacity>
              )}
            </View>

            {!editing ? (
              <>
                <Text style={s.name}>{user.fullName || 'No name'}</Text>
                <View style={s.roleBadge}>
                  <Text style={s.roleText}>{String(user.role || 'user').toUpperCase()}</Text>
                </View>

                <View style={s.infoRow}>
                  <Ionicons name="mail-outline" size={18} color="#16a34a" />
                  <Text style={s.infoText}>{user.email}</Text>
                </View>
                <View style={s.infoRow}>
                  <Ionicons name="call-outline" size={18} color="#16a34a" />
                  <Text style={s.infoText}>{user.phoneNumber || 'No phone number'}</Text>
                </View>
                <View style={s.infoRow}>
                  <Ionicons name="location-outline" size={18} color="#16a34a" />
                  <Text style={s.infoText}>{user.location || 'No location'}</Text>
                </View>

                {!!okMsg && <Text style={s.okText}>{okMsg}</Text>}

                <TouchableOpacity style={s.primaryBtn} onPress={startEdit} activeOpacity={0.85}>
                  <Ionicons name="create-outline" size={18} color="#fff" />
                  <Text style={s.primaryBtnText}>Edit profile</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.logoutBtn} onPress={logout} activeOpacity={0.85}>
                  <Ionicons name="log-out-outline" size={18} color="#dc2626" />
                  <Text style={s.logoutText}>Log out</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.label}>Full name</Text>
                <TextInput style={s.input} value={fullName} onChangeText={setFullName} placeholder="Full name" placeholderTextColor="#9ca3af" />

                <Text style={s.label}>Email</Text>
                <TextInput style={[s.input, s.inputDisabled]} value={user.email} editable={false} />
                <Text style={s.hint}>Email cannot be changed.</Text>

                <Text style={s.label}>Phone number</Text>
                <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="09XX XXX XXXX" placeholderTextColor="#9ca3af" />

                <Text style={s.label}>Location</Text>
                <TextInput style={s.input} value={location} onChangeText={setLocation} placeholder="City / Province" placeholderTextColor="#9ca3af" />

                {!!error && (
                  <View style={s.errorBox}>
                    <Ionicons name="warning-outline" size={16} color="#b91c1c" />
                    <Text style={s.errorText}>{error}</Text>
                  </View>
                )}

                <View style={s.row}>
                  <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]} onPress={() => setEditing(false)} disabled={saving} activeOpacity={0.85}>
                    <Text style={s.secondaryBtnText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.primaryBtn, { flex: 1, marginTop: 0 }, (!fullName.trim() || saving) && { opacity: 0.5 }]}
                    onPress={save}
                    disabled={!fullName.trim() || saving}
                    activeOpacity={0.85}
                  >
                    {saving ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryBtnText}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        )}

        <View style={{ height: 200 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0fdf4' },
  scroll: { alignItems: 'center' },
  header: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  backBtn: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },

  card: {
    width: '92%', maxWidth: 560, marginTop: 16, backgroundColor: '#fff', borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: '#e2e8f0', gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  cardText: { fontSize: 13, color: '#64748b', textAlign: 'center', marginBottom: 6 },

  avatarWrap: { alignSelf: 'center', marginBottom: 4 },
  camBtn: {
    position: 'absolute', right: 0, bottom: 0, width: 32, height: 32, borderRadius: 16,
    backgroundColor: '#16a34a', borderWidth: 2, borderColor: '#fff', justifyContent: 'center', alignItems: 'center',
  },
  name: { fontSize: 22, fontWeight: '900', color: '#0f172a', textAlign: 'center' },
  roleBadge: {
    alignSelf: 'center', backgroundColor: '#dcfce7', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 3, marginBottom: 6,
  },
  roleText: { fontSize: 11, fontWeight: '800', color: '#166534', letterSpacing: 0.5 },
  infoRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#f8fafc',
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11,
  },
  infoText: { flex: 1, fontSize: 14, color: '#334155' },
  okText: { color: '#15803d', fontSize: 13, textAlign: 'center', fontWeight: '700' },

  label: { fontSize: 13, fontWeight: '700', color: '#166534', marginTop: 6 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#0f172a',
  },
  inputDisabled: { backgroundColor: '#f1f5f9', color: '#94a3b8' },
  hint: { fontSize: 11, color: '#94a3b8' },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6,
    backgroundColor: '#fef2f2', borderWidth: 1, borderColor: '#fecaca', borderRadius: 12, padding: 12,
  },
  errorText: { flex: 1, color: '#b91c1c', fontSize: 12 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', height: 48, borderRadius: 24, paddingHorizontal: 22, marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    alignItems: 'center', justifyContent: 'center', height: 48, borderRadius: 24,
    borderWidth: 1.5, borderColor: '#16a34a', backgroundColor: '#fff',
  },
  secondaryBtnText: { color: '#16a34a', fontWeight: '700', fontSize: 15 },
  logoutBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: '#fecaca', backgroundColor: '#fff',
  },
  logoutText: { color: '#dc2626', fontWeight: '700', fontSize: 15 },
});