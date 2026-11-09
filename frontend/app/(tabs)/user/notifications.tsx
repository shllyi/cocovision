// frontend/app/(tabs)/user/notifications.tsx
// Backend (mounted at /notifications, Authorization: Bearer <user_id>):
//   GET /notifications                 -> { notifications: [{ id, type, title, message, data, is_read, created_at }] }
//   PUT /notifications/read-all
//   PUT /notifications/{id}/read

import React, { useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { NGROK_URL } from '../../../constants/config';
import { authHeaders } from '../../../constants/session';

const API = `${NGROK_URL}/notifications`;
const HEADERS = { 'ngrok-skip-browser-warning': 'true' };

const TYPE_INFO: Record<string, { icon: any; color: string }> = {
  login_device: { icon: 'shield-checkmark', color: '#dc2626' },
  role_change: { icon: 'ribbon', color: '#7c3aed' },
  profile_update: { icon: 'person-circle', color: '#16a34a' },
  price_update: { icon: 'trending-up', color: '#0ea5e9' },
  copra_price: { icon: 'cash', color: '#f59e0b' },
  waste_price: { icon: 'leaf', color: '#15803d' },
};

async function getUserId(): Promise<string | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    if (!raw) return null;
    const u = JSON.parse(raw);
    const id = u.id ?? u._id ?? u.user_id ?? u.userId;
    return id ? String(id) : null;
  } catch { return null; }
}

async function api(path: string, uid: string, method = 'GET') {
  const res = await fetch(`${API}${path}`, { method, headers: { ...HEADERS, ...(await authHeaders()) } });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `HTTP ${res.status}`);
  return data;
}

// created_at is timezone-aware ("+00:00"), so Date parses it directly.
function ago(ts: any): string {
  const d = new Date(String(ts).replace(/(\.\d{3})\d+/, '$1'));
  if (isNaN(d.getTime())) return '';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)}d ago`;
  return d.toLocaleDateString();
}

export default function NotificationsScreen() {
  const [uid, setUid] = useState<string | null>(null);
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [markingAll, setMarkingAll] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const id = await getUserId();
      setUid(id);
      if (!id) { setItems([]); return; }
      const d = await api('', id);
      setItems(d.notifications || []);
    } catch (e: any) {
      setError(e?.message || 'Could not load notifications.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const unread = items.filter((n) => !n.is_read).length;
  const shown = filter === 'unread' ? items.filter((n) => !n.is_read) : items;

  const open = async (n: any) => {
    if (!n.is_read && uid) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: true } : x)));   // optimistic
      try { await api(`/${n.id}/read`, uid, 'PUT'); }
      catch { setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, is_read: false } : x))); }
    }
    if (n.type === 'price_update' || n.type === 'copra_price') router.push('/(tabs)/public/prediction');
    else if (n.type === 'waste_price') router.push('/(tabs)/public/waste-solutions');
    else if (n.type === 'profile_update' || n.type === 'role_change') router.push('/(tabs)/user/profile');
  };

  const markAll = async () => {
    if (!uid || markingAll || unread === 0) return;
    setMarkingAll(true);
    const before = items;
    setItems((prev) => prev.map((x) => ({ ...x, is_read: true })));
    try { await api('/read-all', uid, 'PUT'); }
    catch (e: any) { setItems(before); setError(e?.message || 'Could not mark all as read.'); }
    finally { setMarkingAll(false); }
  };

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor="#16a34a" />}
      >
        <LinearGradient colors={['#052e16', '#166534', '#1a7d3f']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.header}>
          <TouchableOpacity onPress={() => router.replace('/(tabs)')} style={s.backBtn} activeOpacity={0.8}>
            <Ionicons name="arrow-back" size={20} color="#fff" />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Notifications</Text>
            <Text style={s.headerSub}>{unread > 0 ? `${unread} unread` : 'All caught up'}</Text>
          </View>
          {unread > 0 && (
            <TouchableOpacity style={s.markAll} onPress={markAll} disabled={markingAll} activeOpacity={0.85}>
              <Ionicons name="checkmark-done" size={16} color="#166534" />
              <Text style={s.markAllText}>Read all</Text>
            </TouchableOpacity>
          )}
        </LinearGradient>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#16a34a" />
        ) : !uid ? (
          <View style={s.card}>
            <Ionicons name="lock-closed-outline" size={36} color="#16a34a" style={{ alignSelf: 'center' }} />
            <Text style={s.cardTitle}>Login required</Text>
            <Text style={s.cardText}>Log in to see your notifications.</Text>
            <TouchableOpacity style={s.primaryBtn} onPress={() => router.push('/(auth)/login')} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Go to login</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={s.body}>
            <View style={s.tabs}>
              {([['all', 'All'], ['unread', 'Unread']] as const).map(([k, lab]) => (
                <TouchableOpacity key={k} style={[s.tab, filter === k && s.tabOn]} onPress={() => setFilter(k)} activeOpacity={0.85}>
                  <Text style={[s.tabText, filter === k && s.tabTextOn]}>{lab}{k === 'unread' && unread > 0 ? ` (${unread})` : ''}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {!!error && <Text style={s.errorText}>{error}</Text>}
            {shown.length === 0 && !error && (
              <View style={s.emptyBox}>
                <Ionicons name="notifications-off-outline" size={36} color="#cbd5e1" />
                <Text style={s.empty}>{filter === 'unread' ? 'No unread notifications.' : 'No notifications yet.'}</Text>
              </View>
            )}

            {shown.map((n) => {
              const info = TYPE_INFO[n.type] ?? { icon: 'notifications', color: '#64748b' };
              return (
                <TouchableOpacity key={n.id} style={[s.item, !n.is_read && s.itemUnread]} onPress={() => open(n)} activeOpacity={0.85}>
                  <View style={[s.iconWrap, { backgroundColor: info.color + '1f' }]}>
                    <Ionicons name={info.icon} size={20} color={info.color} />
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={s.itemTop}>
                      <Text style={[s.itemTitle, !n.is_read && { color: '#0f172a' }]} numberOfLines={2}>{n.title}</Text>
                      {!n.is_read && <View style={s.dot} />}
                    </View>
                    <Text style={s.itemMsg}>{n.message}</Text>
                    <Text style={s.time}>{ago(n.created_at)}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
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
    paddingHorizontal: 16, paddingVertical: 16, borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  backBtn: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(255,255,255,0.2)', justifyContent: 'center', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '800' },
  headerSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  markAll: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', paddingHorizontal: 12, height: 34, borderRadius: 17 },
  markAllText: { color: '#166534', fontWeight: '800', fontSize: 12 },

  body: { width: '92%', maxWidth: 640, marginTop: 14, gap: 10 },
  card: {
    width: '92%', maxWidth: 560, marginTop: 16, backgroundColor: '#fff', borderRadius: 18, padding: 18,
    borderWidth: 1, borderColor: '#e2e8f0', gap: 8,
  },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#0f172a', textAlign: 'center' },
  cardText: { fontSize: 13, color: '#64748b', textAlign: 'center' },

  tabs: { flexDirection: 'row', backgroundColor: '#dcfce7', borderRadius: 14, padding: 4 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11 },
  tabOn: { backgroundColor: '#16a34a' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#166534' },
  tabTextOn: { color: '#fff' },

  errorText: { color: '#b91c1c', fontSize: 12 },
  emptyBox: { alignItems: 'center', gap: 8, marginTop: 30 },
  empty: { fontSize: 14, color: '#94a3b8' },

  item: {
    flexDirection: 'row', gap: 12, backgroundColor: '#fff', borderRadius: 16, padding: 12,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  itemUnread: { borderColor: '#86efac', backgroundColor: '#f7fff9' },
  iconWrap: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  itemTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  itemTitle: { flex: 1, fontSize: 14, fontWeight: '800', color: '#334155' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#16a34a', marginTop: 5 },
  itemMsg: { fontSize: 13, color: '#475569', lineHeight: 19 },
  time: { fontSize: 11, color: '#94a3b8', marginTop: 2 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#16a34a', height: 48, borderRadius: 24, paddingHorizontal: 22, marginTop: 6,
  },
  primaryBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});