// frontend/app/(tabs)/admin/admin.tsx
// Admin dashboard: user management. Backend (mounted at /auth):
//   GET /auth/users                      -> [{ id, fullName, email, role, location, phoneNumber,
//                                              profileImage, auth_provider, is_active,
//                                              deactivation_reason, created_at }]
//   PUT /auth/users/{id}/role   { role: 'user' | 'admin' }
//   PUT /auth/users/{id}/status { is_active: boolean, reason?: string }

import React, { useCallback, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView, Image,
  ActivityIndicator, RefreshControl, Modal, Alert, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { NGROK_URL } from '../../../constants/config';
import AdminAnalytics from '../../../components/AdminAnalytics';
import { authHeaders } from '../../../constants/session';

const API = `${NGROK_URL}/auth`;
const HEADERS = { 'ngrok-skip-browser-warning': 'true' };

async function getSession(): Promise<any | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function api(path: string, uid: string, init?: RequestInit) {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      ...HEADERS,
      ...(await authHeaders()),
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(typeof d === 'string' ? d : `HTTP ${res.status}`);
  }
  return data;
}

// created_at comes from utcnow() with no zone, so append Z.
function joined(ts: any) {
  if (!ts) return '';
  const s = /[zZ]|[+-]\d{2}:?\d{2}$/.test(String(ts)) ? String(ts) : `${ts}Z`;
  const d = new Date(s.replace(/(\.\d{3})\d+/, '$1'));
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString();
}

function Avatar({ uri, name }: { uri?: string | null; name?: string }) {
  if (uri) return <Image source={{ uri }} style={s.avatar} />;
  return (
    <View style={[s.avatar, { backgroundColor: '#15803d', justifyContent: 'center', alignItems: 'center' }]}>
      <Text style={{ color: '#fff', fontWeight: '900', fontSize: 17 }}>{(name || 'U').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

type Filter = 'all' | 'admin' | 'user' | 'inactive';

export default function AdminScreen() {
  const [session, setSession] = useState<any>(null);
  const [checked, setChecked] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busyId, setBusyId] = useState('');
  const [tab, setTab] = useState<'users' | 'analytics'>('users');

  // deactivate modal
  const [target, setTarget] = useState<any>(null);
  const [reason, setReason] = useState('');

  const uid = session ? String(session.id ?? session._id ?? session.user_id ?? '') : '';
  const isAdmin = session?.role === 'admin';

  const load = useCallback(async () => {
    setError('');
    try {
      const sess = await getSession();
      setSession(sess);
      setChecked(true);
      if (sess?.role !== 'admin') { setLoading(false); setRefreshing(false); return; }
      const id = String(sess.id ?? sess._id ?? sess.user_id ?? '');
      const data = await api('/users', id);
      if (!Array.isArray(data)) throw new Error('Unexpected response.');
      setUsers(data);
    } catch (e: any) {
      setError(e?.message || 'Could not load users.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const patch = (id: string, fields: any) =>
    setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, ...fields } : u)));

  const changeRole = (u: any) => {
    const next = u.role === 'admin' ? 'user' : 'admin';
    const run = async () => {
      setBusyId(u.id); setError('');
      try {
        await api(`/users/${u.id}/role`, uid, { method: 'PUT', body: JSON.stringify({ role: next }) });
        patch(u.id, { role: next });
      } catch (e: any) { setError(e?.message || 'Could not change role.'); }
      finally { setBusyId(''); }
    };
    if (Platform.OS === 'web') { run(); return; }
    Alert.alert('Change role', `Make ${u.fullName || u.email} ${next === 'admin' ? 'an admin' : 'a regular user'}?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Confirm', onPress: run },
    ]);
  };

  const setActive = async (u: any, active: boolean, why?: string) => {
    setBusyId(u.id); setError('');
    try {
      await api(`/users/${u.id}/status`, uid, {
        method: 'PUT',
        body: JSON.stringify({ is_active: active, reason: active ? null : (why?.trim() || null) }),
      });
      patch(u.id, {
        is_active: active,
        deactivation_reason: active ? null : (why?.trim() || 'Account deactivated by admin'),
      });
    } catch (e: any) { setError(e?.message || 'Could not update status.'); }
    finally { setBusyId(''); }
  };

  const confirmDeactivate = async () => {
    if (!target) return;
    const u = target;
    setTarget(null);
    await setActive(u, false, reason);
    setReason('');
  };

  // derived
  const q = query.trim().toLowerCase();
  const shown = users.filter((u) => {
    const f =
      filter === 'all' ? true :
      filter === 'admin' ? u.role === 'admin' :
      filter === 'user' ? u.role !== 'admin' :
      u.is_active === false;
    const t = !q || `${u.fullName} ${u.email} ${u.location}`.toLowerCase().includes(q);
    return f && t;
  });
  const total = users.length;
  const admins = users.filter((u) => u.role === 'admin').length;
  const inactive = users.filter((u) => u.is_active === false).length;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#16a34a" />}
      >
        <LinearGradient colors={['#052e16', '#166534', '#1a7d3f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.header}>
          <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={s.backBtn} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Admin</Text>
            <Text style={s.headerSub}>Manage users and tools</Text>
          </View>
        </LinearGradient>

        {!checked || (loading && isAdmin) ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#16a34a" />
        ) : !session ? (
          <View style={s.card}>
            <Ionicons name="lock-closed-outline" size={36} color="#16a34a" style={{ alignSelf: 'center' }} />
            <Text style={s.cardTitle}>Login required</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.push('/(auth)/login')} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Go to login</Text>
            </TouchableOpacity>
          </View>
        ) : !isAdmin ? (
          <View style={s.card}>
            <Ionicons name="shield-outline" size={36} color="#dc2626" style={{ alignSelf: 'center' }} />
            <Text style={s.cardTitle}>Admins only</Text>
            <Text style={s.cardText}>Your account role is "{String(session.role || 'user')}".</Text>
          </View>
        ) : (
          <View style={s.body}>
            {/* stats */}
            <View style={s.statsRow}>
              {([['Users', total], ['Admins', admins], ['Active', total - inactive], ['Inactive', inactive]] as const).map(([lab, n]) => (
                <View key={lab} style={s.statBox}>
                  <Text style={s.statNum}>{n}</Text>
                  <Text style={s.statLab}>{lab}</Text>
                </View>
              ))}
            </View>

            {/* shortcuts */}
            <View style={s.row}>
              <TouchableOpacity style={s.shortcut} onPress={() => router.push('/(tabs)/public/prediction')} activeOpacity={0.85}>
                <Ionicons name="trending-up" size={18} color="#16a34a" />
                <Text style={s.shortcutText}>Prices and copra</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.shortcut} onPress={() => router.push('/(tabs)/public/waste-solutions')} activeOpacity={0.85}>
                <Ionicons name="leaf" size={18} color="#16a34a" />
                <Text style={s.shortcutText}>Waste products</Text>
              </TouchableOpacity>
            </View>

            {/* tabs */}
            <View style={s.tabs}>
              {([['users', 'Users'], ['analytics', 'Analytics']] as const).map(([k, lab]) => (
                <TouchableOpacity key={k} style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)} activeOpacity={0.85}>
                  <Text style={[s.tabText, tab === k && s.tabTextOn]}>{lab}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {tab === 'analytics' ? (
              <AdminAnalytics uid={uid} />
            ) : (
            <>
            {/* users */}
            <Text style={s.sectionTitle}>Users</Text>
            <View style={s.searchBox}>
              <Ionicons name="search" size={18} color="#94a3b8" />
              <TextInput
                style={s.searchInput}
                placeholder="Search name, email, location"
                placeholderTextColor="#9ca3af"
                value={query}
                onChangeText={setQuery}
              />
              {!!query && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={18} color="#cbd5e1" />
                </TouchableOpacity>
              )}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {([['all', 'All'], ['admin', 'Admins'], ['user', 'Users'], ['inactive', 'Inactive']] as const).map(([k, lab]) => (
                <TouchableOpacity key={k} style={[s.chip, filter === k && s.chipOn]} onPress={() => setFilter(k)} activeOpacity={0.85}>
                  <Text style={[s.chipText, filter === k && s.chipTextOn]}>{lab}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {!!error && <Text style={s.errorText}>{error}</Text>}
            {shown.length === 0 && !error && <Text style={s.empty}>No users found.</Text>}

            {shown.map((u) => {
              const me = u.id === uid;
              const busy = busyId === u.id;
              const inactiveU = u.is_active === false;
              return (
                <View key={u.id} style={[s.userCard, inactiveU && { opacity: 0.85, borderColor: '#fecaca' }]}>
                  <View style={s.userTop}>
                    <Avatar uri={u.profileImage} name={u.fullName} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.userName} numberOfLines={1}>{u.fullName || 'No name'}{me ? '  (you)' : ''}</Text>
                      <Text style={s.userEmail} numberOfLines={1}>{u.email}</Text>
                    </View>
                    <View style={[s.badge, u.role === 'admin' ? s.badgeAdmin : s.badgeUser]}>
                      <Text style={[s.badgeText, u.role === 'admin' ? { color: '#166534' } : { color: '#475569' }]}>
                        {String(u.role || 'user').toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <Text style={s.meta}>
                    {u.auth_provider === 'google' ? 'Google' : 'Email'} sign-in
                    {u.location ? `  ·  ${u.location}` : ''}
                    {joined(u.created_at) ? `  ·  Joined ${joined(u.created_at)}` : ''}
                  </Text>
                  {inactiveU && (
                    <Text style={s.inactiveNote}>Deactivated: {u.deactivation_reason || 'No reason provided'}</Text>
                  )}

                  <View style={s.row}>
                    <TouchableOpacity
                      style={[s.smallBtn, (me || busy) && { opacity: 0.4 }]}
                      onPress={() => changeRole(u)}
                      disabled={me || busy}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="swap-horizontal" size={15} color="#16a34a" />
                      <Text style={s.smallBtnText}>{u.role === 'admin' ? 'Make user' : 'Make admin'}</Text>
                    </TouchableOpacity>

                    {inactiveU ? (
                      <TouchableOpacity
                        style={[s.smallBtn, busy && { opacity: 0.4 }]}
                        onPress={() => setActive(u, true)}
                        disabled={busy}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="checkmark-circle-outline" size={15} color="#16a34a" />
                        <Text style={s.smallBtnText}>Activate</Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={[s.smallBtn, { borderColor: '#fecaca' }, (me || busy) && { opacity: 0.4 }]}
                        onPress={() => { setReason(''); setTarget(u); }}
                        disabled={me || busy}
                        activeOpacity={0.85}
                      >
                        <Ionicons name="ban-outline" size={15} color="#dc2626" />
                        <Text style={[s.smallBtnText, { color: '#dc2626' }]}>Deactivate</Text>
                      </TouchableOpacity>
                    )}
                    {busy && <ActivityIndicator size="small" color="#16a34a" />}
                  </View>
                </View>
              );
            })}
            </>
            )}
          </View>
        )}

        <View style={{ height: 200 }} />
      </ScrollView>

      {/* deactivate reason */}
      <Modal visible={!!target} animationType="fade" transparent onRequestClose={() => setTarget(null)}>
        <KeyboardAvoidingView style={s.modalWrap} behavior="padding">
          <View style={s.modalCard}>
            <Text style={s.sectionTitle}>Deactivate account</Text>
            <Text style={s.cardText}>
              {target?.fullName || target?.email} will not be able to log in. The reason is shown to them.
            </Text>
            <TextInput
              style={[s.input, { minHeight: 80 }]}
              value={reason}
              onChangeText={setReason}
              multiline
              textAlignVertical="top"
              placeholder="Reason (optional)"
              placeholderTextColor="#9ca3af"
              maxLength={200}
            />
            <View style={s.row}>
              <TouchableOpacity style={[s.secondaryBtn, { flex: 1 }]} onPress={() => setTarget(null)} activeOpacity={0.85}>
                <Text style={s.secondaryBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[s.dangerBtn, { flex: 1 }]} onPress={confirmDeactivate} activeOpacity={0.85}>
                <Text style={s.primaryBtnText}>Deactivate</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0fdf4' },
  scroll: { alignItems: 'center' },
  header: {
    width: '100%', flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 16, borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },

  body: { width: '92%', maxWidth: 640, marginTop: 14, gap: 12 },
  card: {
    width: '92%', maxWidth: 560, marginTop: 16, backgroundColor: '#fff', borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: '#e2e8f0', gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  cardText: { fontSize: 13, color: '#64748b', textAlign: 'center', lineHeight: 19 },

  statsRow: { flexDirection: 'row', gap: 8 },
  statBox: { flex: 1, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0', paddingVertical: 12, alignItems: 'center' },
  statNum: { fontSize: 22, fontWeight: '900', color: '#166534' },
  statLab: { fontSize: 11, color: '#64748b', fontWeight: '600' },

  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  shortcut: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 46,
    borderRadius: 23, borderWidth: 1.5, borderColor: '#16a34a', backgroundColor: '#fff',
  },
  shortcutText: { color: '#16a34a', fontWeight: '800', fontSize: 13 },

  tabs: { flexDirection: 'row', backgroundColor: '#dcfce7', borderRadius: 14, padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11 },
  tabOn: { backgroundColor: '#16a34a' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#166534' },
  tabTextOn: { color: '#fff' },

  sectionTitle: { fontSize: 17, fontWeight: '800', color: '#166534', marginTop: 4 },
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#fff', borderRadius: 14,
    borderWidth: 1, borderColor: '#e2e8f0', paddingHorizontal: 12, height: 46,
  },
  searchInput: { flex: 1, fontSize: 14, color: '#0f172a' },
  chip: { paddingHorizontal: 16, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: '#bbf7d0', backgroundColor: '#fff', justifyContent: 'center' },
  chipOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, fontWeight: '700', color: '#166534' },
  chipTextOn: { color: '#fff' },
  empty: { fontSize: 14, color: '#94a3b8', textAlign: 'center', marginTop: 12 },
  errorText: { color: '#b91c1c', fontSize: 12 },

  userCard: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 12, gap: 8 },
  userTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e2e8f0' },
  userName: { fontSize: 15, fontWeight: '800', color: '#0f172a' },
  userEmail: { fontSize: 12, color: '#64748b' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 },
  badgeAdmin: { backgroundColor: '#dcfce7' },
  badgeUser: { backgroundColor: '#f1f5f9' },
  badgeText: { fontSize: 11, fontWeight: '800' },
  meta: { fontSize: 11, color: '#94a3b8' },
  inactiveNote: { fontSize: 12, color: '#b91c1c', backgroundColor: '#fef2f2', borderRadius: 8, padding: 8 },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, height: 34,
    borderRadius: 17, borderWidth: 1.5, borderColor: '#bbf7d0', backgroundColor: '#fff',
  },
  smallBtnText: { fontSize: 12, fontWeight: '700', color: '#16a34a' },

  modalWrap: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.45)', padding: 20 },
  modalCard: { width: '100%', maxWidth: 420, backgroundColor: '#fff', borderRadius: 20, padding: 18, gap: 10 },
  input: {
    backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#0f172a',
  },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', height: 48, borderRadius: 24, paddingHorizontal: 22, marginTop: 6,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  secondaryBtn: {
    alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 23,
    borderWidth: 1.5, borderColor: '#16a34a', backgroundColor: '#fff',
  },
  secondaryBtnText: { color: '#16a34a', fontWeight: '700', fontSize: 15 },
  dangerBtn: { alignItems: 'center', justifyContent: 'center', height: 46, borderRadius: 23, backgroundColor: '#dc2626' },
});1