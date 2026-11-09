// frontend/app/(tabs)/public/prediction.tsx
// Market prices + forecasts, copra prices by region, how-it-works, admin tools.
// Backend (router prefix is /prediction, no extra mount prefix):
//   GET  /prediction/prices          -> { prices[], last_updated, total_products }
//   GET  /prediction/copra-prices    -> { success, data, message }
//   GET  /prediction/explanation
//   POST /prediction/sync?user_id=             (admin)
//   POST /prediction/upload-copra-image        (admin, multipart: files[], user_id)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView,
  ActivityIndicator, RefreshControl, Animated, Easing, Pressable, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { useFocusEffect } from 'expo-router/react-navigation';
import axios from 'axios';
import { NGROK_URL } from '../../../constants/config';

// ───────────────────────── design tokens (same palette as the home page) ─────────────────────────
const C = {
  forest: '#2F4A1E',
  moss: '#46652A',
  hill: '#3A5A22',
  lime: '#8A9F27',
  cream: '#F5E6D3',
  paper: '#FBF4EA',
  ink: '#1F3012',
  leaf: '#DDE5B5',
  sand: '#EBD7BC',
  body: '#4A5A3C',
};
const UP = '#15803d';
const DOWN = '#b91c1c';
const FLAT = '#6b6b5a';
const ND = Platform.OS !== 'web';
const DISPLAY: any = { fontWeight: '900', letterSpacing: -0.5 };

const SOFT_SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 10px 24px rgba(31, 48, 18, 0.16)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 };

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

// ───────────────────────── data helpers (unchanged behaviour) ─────────────────────────
const API = `${NGROK_URL}/prediction`;
const HEADERS = { 'ngrok-skip-browser-warning': 'true' };

async function getSession(): Promise<any | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function getJson(path: string) {
  const res = await fetch(`${API}${path}`, { headers: HEADERS });
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }
  if (!res.ok) throw new Error(typeof data?.detail === 'string' ? data.detail : `HTTP ${res.status}`);
  return data;
}

const peso = (n: any) => (typeof n === 'number' && isFinite(n) ? `₱${n.toFixed(2)}` : '—');

function trendInfo(t: any): { icon: any; color: string; label: string; tint: string } {
  const v = String(t || '').toLowerCase();
  if (v.includes('up') || v.includes('rise') || v.includes('increas')) return { icon: 'trending-up', color: UP, label: 'Going up', tint: '#DDF0DF' };
  if (v.includes('down') || v.includes('fall') || v.includes('decreas')) return { icon: 'trending-down', color: DOWN, label: 'Going down', tint: '#FBE3E0' };
  return { icon: 'remove', color: FLAT, label: 'Steady', tint: C.paper };
}

function confColor(c: any) {
  const v = String(c || '').toLowerCase();
  if (v.includes('high')) return UP;
  if (v.includes('med')) return C.lime;
  return '#8a8a7a';
}

function confLevel(c: any) {
  const v = String(c || '').toLowerCase();
  if (v.includes('high')) return 3;
  if (v.includes('med')) return 2;
  return 1;
}

function fmtDate(v: any) {
  if (!v) return '';
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? String(v) : d.toLocaleString();
}

const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).toLowerCase();

// ───────────────────────── animation + ui helpers ─────────────────────────
function useLoop(duration = 1400, delay = 0) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (REDUCE) return;
    const l = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  return v;
}

// Small entrance. Used when a tab opens or a card expands, not on every block.
function Pop({ children, style }: any) {
  const a = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    Animated.spring(a, { toValue: 1, friction: 8, tension: 70, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: a,
      transform: [
        { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
        { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) },
      ],
    }]}>
      {children}
    </Animated.View>
  );
}

// Chunky button with a solid edge underneath. Presses down like a real key.
const TONES: Record<string, { bg: string; edge: string; fg: string; border?: string }> = {
  primary: { bg: C.moss, edge: C.forest, fg: C.cream },
  light: { bg: C.paper, edge: '#CDB48E', fg: C.ink, border: '#CDB48E' },
  leaf: { bg: C.leaf, edge: '#A3B168', fg: C.ink },
};

function PressBtn({ label, icon, onPress, disabled = false, tone = 'light', style, radius = 20, busy = false }: any) {
  const t = TONES[tone];
  const EDGE = 6;
  const y = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.timing(y, { toValue: v, duration: 90, useNativeDriver: ND }).start();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPressIn={() => to(EDGE - 2)}
      onPressOut={() => to(0)}
      style={[{ opacity: disabled ? 0.5 : 1 }, style, Platform.OS === 'web' ? ({ cursor: disabled ? 'default' : 'pointer' } as any) : null]}
    >
      <View style={{ paddingBottom: EDGE }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: EDGE, bottom: 0, backgroundColor: t.edge, borderRadius: radius }} />
        <Animated.View style={{
          backgroundColor: t.bg, borderRadius: radius, minHeight: 56,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 12,
          borderWidth: t.border ? 2 : 0, borderColor: t.border,
          transform: [{ translateY: y }],
        }}>
          {busy ? <ActivityIndicator color={t.fg} size="small" /> : <Ionicons name={icon} size={22} color={t.fg} />}
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '900', flexShrink: 1 }}>{label}</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

function SwayLeaf({ style, size, color, delay = 0, tilt = 10 }: any) {
  const v = useLoop(2400, delay);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute' }, style, {
      transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: [`${-tilt}deg`, `${tilt}deg`] }) }],
    }]}>
      <Ionicons name="leaf" size={size} color={color} />
    </Animated.View>
  );
}

function SectionHead({ title, sub }: { title: string; sub?: string }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={[DISPLAY, { fontSize: 28, lineHeight: 32, color: C.forest }]}>{title}</Text>
      {sub ? <Text style={{ fontSize: 17, lineHeight: 24, color: C.body, fontWeight: '600', marginTop: 4 }}>{sub}</Text> : null}
    </View>
  );
}

// Three leaves: more filled leaves = more confident.
function ConfMeter({ level, color }: { level: number; color: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 3 }}>
      {[1, 2, 3].map((n) => (
        <Ionicons key={n} name="leaf" size={20} color={n <= level ? color : 'rgba(31,48,18,0.18)'} />
      ))}
    </View>
  );
}

function ConfRow({ value }: { value: any }) {
  return (
    <View style={s.confRow}>
      <ConfMeter level={confLevel(value)} color={confColor(value)} />
      <Text style={s.confText}>Confidence: <Text style={{ fontWeight: '900', color: C.ink }}>{String(value)}</Text></Text>
    </View>
  );
}

// One forecast number, with an arrow showing whether it is above or below today.
function FcBox({ label, value, base, tone = C.paper }: { label: string; value: any; base?: any; tone?: string }) {
  let arrow: any = null;
  if (typeof value === 'number' && typeof base === 'number' && isFinite(value) && isFinite(base) && value !== base) {
    arrow = value > base
      ? <Ionicons name="arrow-up" size={16} color={UP} />
      : <Ionicons name="arrow-down" size={16} color={DOWN} />;
  }
  return (
    <View style={[s.fcBox, { backgroundColor: tone }]}>
      <Text style={s.fcLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, marginTop: 2 }}>
        <Text style={s.fcValue}>{peso(value)}</Text>
        {arrow}
      </View>
    </View>
  );
}

// Vertical bar that grows into place (chart).
function GrowBar({ target, color, delay }: { target: number; color: string; delay: number }) {
  const a = useRef(new Animated.Value(REDUCE ? target : 0)).current;
  useEffect(() => {
    if (REDUCE) { a.setValue(target); return; }
    Animated.timing(a, { toValue: target, duration: 500, delay, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [target]);
  return <Animated.View style={{ width: '100%', borderRadius: 4, backgroundColor: color, height: a }} />;
}

// Horizontal bar: how this price compares with the highest one.
function HBar({ pct, color }: { pct: number; color: string }) {
  const a = useRef(new Animated.Value(REDUCE ? pct : 0)).current;
  useEffect(() => {
    if (REDUCE) { a.setValue(pct); return; }
    Animated.timing(a, { toValue: pct, duration: 650, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [pct]);
  return (
    <View style={s.hTrack}>
      <Animated.View style={[s.hFill, { backgroundColor: color, width: a.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
    </View>
  );
}

// History (dark green) + forecast (light green) bars. Prices barely move, so scale from min to max.
function MiniChart({ points }: { points: { price: number; type: string }[] }) {
  if (!points.length) return <Text style={s.noFc}>Not enough history for a chart.</Text>;
  const vals = points.map((p) => p.price);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  return (
    <View style={s.chartWrap}>
      <View style={s.chartRow}>
        {points.map((p, i) => (
          <View key={i} style={s.chartCol}>
            <GrowBar
              target={10 + ((p.price - lo) / span) * 90}
              color={p.type === 'forecast' ? C.lime : C.moss}
              delay={Math.min(i, 30) * 14}
            />
          </View>
        ))}
      </View>
      <View style={s.legendRow}>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.moss }]} /><Text style={s.legendText}>Past prices</Text></View>
        <View style={s.legendItem}><View style={[s.legendDot, { backgroundColor: C.lime }]} /><Text style={s.legendText}>Forecast</Text></View>
      </View>
      <Text style={s.metaDark}>Lowest {peso(lo)}. Highest {peso(hi)}.</Text>
    </View>
  );
}

// Low / middle / high ruler. The marker slides to the middle price when it appears.
function Ruler({ pos }: { pos: number }) {
  const a = useRef(new Animated.Value(REDUCE ? pos : 0)).current;
  useEffect(() => {
    if (REDUCE) { a.setValue(pos); return; }
    Animated.timing(a, { toValue: pos, duration: 900, delay: 300, easing: Easing.out(Easing.back(1.4)), useNativeDriver: false }).start();
  }, [pos]);
  return (
    <View style={s.rangeTrack}>
      <Animated.View style={[s.rangeMark, { left: a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }]} />
    </View>
  );
}

// ───────────────────────── price row (tap to open) ─────────────────────────
function PriceRow({ p, maxPrice, chartFor, chartLoading, chartError, chartPoints, onChart }: any) {
  const [open, setOpen] = useState(false);
  const rot = useRef(new Animated.Value(0)).current;
  const sc = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.timing(rot, { toValue: open ? 1 : 0, duration: REDUCE ? 0 : 220, useNativeDriver: ND }).start();
  }, [open]);
  const go = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();

  const t = trendInfo(p.trend);
  const hasForecast = typeof p.forecast_7_day === 'number';
  const id = String(p.id);
  const pct = typeof p.trend_percent === 'number' ? `${p.trend_percent > 0 ? '+' : ''}${p.trend_percent.toFixed(1)}%` : '';
  const rel = maxPrice > 0 && typeof p.price === 'number' ? Math.max(4, (p.price / maxPrice) * 100) : 0;

  return (
    <Animated.View style={[s.priceCard, open && s.priceCardOpen, { transform: [{ scale: sc }] }]}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        onPressIn={() => go(0.985)}
        onPressOut={() => go(1)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${p.name}. ${peso(p.price)} per ${p.unit}. ${t.label}. Tap to ${open ? 'close' : 'open'} details.`}
        style={[{ padding: 16 }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
      >
        <View style={s.cardTop}>
          <View style={{ flex: 1 }}>
            <Text style={s.prodName}>{p.name}</Text>
            <Text style={s.prodUnit}>per {p.unit}</Text>
          </View>
          <Text style={s.price}>{peso(p.price)}</Text>
        </View>

        <View style={s.barLine}>
          <View style={{ flex: 1 }}>
            <HBar pct={rel} color={C.moss} />
          </View>
          <View style={[s.trendPill, { backgroundColor: t.color }]}>
            <Ionicons name={t.icon} size={16} color="#fff" />
            <Text style={s.trendPillText}>{t.label}{pct ? `  ${pct}` : ''}</Text>
          </View>
        </View>

        <View style={s.openRow}>
          <Text style={s.openText}>{open ? 'Hide forecast' : 'See forecast'}</Text>
          <Animated.View style={{ transform: [{ rotate: rot.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
            <Ionicons name="chevron-down" size={22} color={C.forest} />
          </Animated.View>
        </View>
      </Pressable>

      {open && (
        <Pop style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 14 }}>
          {hasForecast ? (
            <View>
              <Text style={s.miniHead}>Expected price</Text>
              <View style={s.fcRow}>
                <FcBox label="In 7 days" value={p.forecast_7_day} base={p.price} tone={C.cream} />
                <FcBox label="In 14 days" value={p.forecast_14_day} base={p.price} tone={C.cream} />
                <FcBox label="In 30 days" value={p.forecast_30_day} base={p.price} tone={C.cream} />
              </View>
            </View>
          ) : (
            <Text style={s.noFc}>Forecast needs 5 or more synced price records.</Text>
          )}

          {!!p.confidence && <ConfRow value={p.confidence} />}
          {!!p.advice && (
            <View style={s.adviceBox}>
              <Ionicons name="bulb" size={22} color={C.forest} />
              <Text style={s.advice}>{p.advice}</Text>
            </View>
          )}

          <PressBtn
            tone="primary"
            icon={chartFor === id ? 'chevron-up' : 'stats-chart'}
            label={chartFor === id ? 'Hide chart' : 'Show price chart'}
            onPress={() => onChart(id)}
          />
          {chartFor === id && (
            chartLoading ? <ActivityIndicator color={C.moss} /> :
            chartError ? <Text style={s.noFc}>{chartError}</Text> :
            <MiniChart points={chartPoints} />
          )}
        </Pop>
      )}
    </Animated.View>
  );
}

// ───────────────────────── screen ─────────────────────────
export default function PredictionScreen() {
  const [tab, setTab] = useState<'prices' | 'copra' | 'how'>('prices');
  const [sort, setSort] = useState<'default' | 'high' | 'rising'>('default');
  const [copraHigh, setCopraHigh] = useState(false);
  const [openRegion, setOpenRegion] = useState('');

  const [prices, setPrices] = useState<any[]>([]);
  const [updated, setUpdated] = useState('');
  const [copra, setCopra] = useState<any>(null);
  const [copraMsg, setCopraMsg] = useState('');
  const [how, setHow] = useState<any>(null);
  const [insights, setInsights] = useState<any>(null);
  const [copraPred, setCopraPred] = useState<any>(null);
  const [chartFor, setChartFor] = useState('');
  const [chartPoints, setChartPoints] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState('');

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [session, setSession] = useState<any>(null);
  const [busy, setBusy] = useState('');
  const [info, setInfo] = useState('');

  const [segW, setSegW] = useState(0);
  const segX = useRef(new Animated.Value(0)).current;

  const isAdmin = session?.role === 'admin';
  const uid = session ? String(session.id ?? session._id ?? session.user_id ?? '') : '';

  const load = useCallback(async () => {
    setError('');
    try {
      setSession(await getSession());
      const [p, c, h, ins, cp] = await Promise.allSettled([
        getJson('/prices'), getJson('/copra-prices'), getJson('/explanation'),
        getJson('/insights'), getJson('/copra-predictions'),
      ]);
      if (ins.status === 'fulfilled' && ins.value?.insights) setInsights(ins.value.insights);
      if (cp.status === 'fulfilled') setCopraPred(cp.value);
      if (p.status === 'fulfilled') {
        setPrices(p.value.prices || []);
        setUpdated(p.value.last_updated || '');
      } else {
        setError(p.reason?.message || 'Could not load prices.');
      }
      if (c.status === 'fulfilled') {
        setCopra(c.value.success ? c.value.data : null);
        setCopraMsg(c.value.success ? '' : (c.value.message || c.value.error || 'No copra data.'));
      }
      if (h.status === 'fulfilled') setHow(h.value);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleChart = async (productId: string) => {
    if (chartFor === productId) { setChartFor(''); return; }
    setChartFor(productId);
    setChartPoints([]);
    setChartError('');
    setChartLoading(true);
    try {
      const d = await getJson(`/chart/${encodeURIComponent(productId)}?days=30&forecast_days=7`);
      if (d?.error) throw new Error('Not enough synced history for a chart yet (need 2+ records).');
      setChartPoints(d?.chart_data?.all_points || []);
    } catch (e: any) {
      setChartError(e?.message || 'Could not load chart.');
    } finally {
      setChartLoading(false);
    }
  };

  const sync = async () => {
    if (!uid || busy) return;
    setBusy('sync'); setInfo('');
    try {
      const res = await axios.post(`${API}/sync`, null, {
        params: { user_id: uid }, headers: HEADERS, validateStatus: () => true, timeout: 60000,
      });
      const d = res.data;
      if (res.status >= 200 && res.status < 300 && d?.success) {
        setInfo(d.message || 'Synced.');
        load();
      } else {
        setInfo(typeof d?.detail === 'string' ? d.detail : d?.error || `Sync failed (${res.status})`);
      }
    } catch (e: any) {
      setInfo(e?.message || 'Sync failed.');
    } finally { setBusy(''); }
  };

  const uploadCopra = async () => {
    if (!uid || busy) return;
    const pick = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 5, quality: 0.9,
    });
    if (pick.canceled) return;
    setBusy('upload'); setInfo('');
    try {
      const form = new FormData();
      form.append('user_id', uid);
      for (let i = 0; i < pick.assets.length; i++) {
        const a = pick.assets[i];
        const name = a.fileName || `copra_${i}.jpg`;
        const type = a.mimeType || 'image/jpeg';
        if (Platform.OS === 'web') {
          const blob = await (await fetch(a.uri)).blob();
          form.append('files', blob, name);
        } else {
          form.append('files', { uri: a.uri, name, type } as any);
        }
      }
      // axios (XHR): Expo's fetch rejects { uri, name, type } parts. OCR can be slow.
      const res = await axios.post(`${API}/upload-copra-image`, form, {
        headers: { ...HEADERS, 'Content-Type': 'multipart/form-data' },
        transformRequest: (d) => d, validateStatus: () => true, timeout: 180000,
      });
      const d = res.data;
      if (res.status >= 200 && res.status < 300 && d?.success) {
        setInfo(`${d.message} (confidence ${d.confidence_score})`);
        load();
      } else {
        setInfo(typeof d?.detail === 'string' ? d.detail : d?.message || `Upload failed (${res.status})`);
      }
    } catch (e: any) {
      setInfo(e?.message || 'Upload failed.');
    } finally { setBusy(''); }
  };

  // ── derived ──
  const copraRows: any[] = Array.isArray(copra) ? copra : (copra?.prices || []);
  const copraDate = Array.isArray(copra) ? '' : copra?.date;
  const farmVals = copraRows.map((r) => r.farmgate_price).filter((n) => typeof n === 'number' && isFinite(n));
  const maxFarm = farmVals.length ? Math.max(...farmVals) : 0;
  const shownCopra = copraHigh
    ? [...copraRows].sort((a, b) => (b.farmgate_price || 0) - (a.farmgate_price || 0))
    : copraRows;

  const sortedPrices = [...prices];
  if (sort === 'high') sortedPrices.sort((a, b) => (b.price || 0) - (a.price || 0));
  else if (sort === 'rising') sortedPrices.sort((a, b) => (b.trend_percent || 0) - (a.trend_percent || 0));
  const maxPrice = Math.max(0, ...prices.map((p) => (typeof p.price === 'number' ? p.price : 0)));

  const tabKeys: Array<'prices' | 'copra' | 'how'> = ['prices', 'copra', 'how'];
  const tabLabels = { prices: 'Prices', copra: 'Copra', how: 'How it works' };
  const segItemW = segW ? (segW - 8) / 3 : 0;
  useEffect(() => {
    Animated.spring(segX, { toValue: tabKeys.indexOf(tab) * segItemW, friction: 8, tension: 120, useNativeDriver: ND }).start();
  }, [tab, segItemW]);

  const range = insights?.price_range;
  const medianPos = range && typeof range.max === 'number' && typeof range.min === 'number' && range.max > range.min
    ? Math.max(0, Math.min(1, (range.median - range.min) / (range.max - range.min)))
    : 0.5;

  const sorts: Array<{ k: 'default' | 'high' | 'rising'; label: string; icon: any }> = [
    { k: 'default', label: 'Usual order', icon: 'list' },
    { k: 'high', label: 'Highest price', icon: 'arrow-up' },
    { k: 'rising', label: 'Rising most', icon: 'trending-up' },
  ];

  // ───────────────────────── render ─────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        style={{ backgroundColor: C.cream }}
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.cream} colors={[C.forest]} />}
      >
        {/* hero */}
        <View style={s.hero}>
          <View style={s.hillA} pointerEvents="none" />
          <View style={s.hillB} pointerEvents="none" />
          <SwayLeaf style={{ right: 70, bottom: 42 }} size={30} color={C.leaf} tilt={12} />
          <SwayLeaf style={{ right: 22, bottom: 38 }} size={38} color={C.lime} tilt={9} delay={600} />
          <View style={s.heroText}>
            <Text style={[DISPLAY, s.title]}>Market prices</Text>
            <Text style={s.subtitle}>See what coconut products sell for today, and where prices may go next.</Text>
          </View>
        </View>

        {/* sliding tabs */}
        <View style={[s.wrap, s.segCard]}>
          <View style={s.segTrack} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
            {segW > 0 && <Animated.View style={[s.segThumb, { width: segItemW, transform: [{ translateX: segX }] }]} />}
            {tabKeys.map((k) => (
              <Pressable key={k} style={[s.segItem, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]} onPress={() => setTab(k)}
                accessibilityRole="button" accessibilityState={{ selected: tab === k }} accessibilityLabel={tabLabels[k]}>
                <Text style={{ fontWeight: '900', fontSize: 16, color: tab === k ? C.cream : C.ink }}>{tabLabels[k]}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* admin tools */}
        {isAdmin && (
          <View style={[s.wrap, s.adminCard]}>
            <Text style={s.adminTitle}>Admin tools</Text>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <PressBtn style={{ flex: 1 }} tone="leaf" icon="sync" label="Sync prices" onPress={sync} disabled={!!busy} busy={busy === 'sync'} />
              <PressBtn style={{ flex: 1 }} tone="light" icon="cloud-upload" label="Upload copra" onPress={uploadCopra} disabled={!!busy} busy={busy === 'upload'} />
            </View>
            {!!info && <Text style={s.infoText}>{info}</Text>}
          </View>
        )}

        {loading ? (
          <View style={{ alignItems: 'center', marginTop: 50, gap: 12 }}>
            <ActivityIndicator size="large" color={C.moss} />
            <Text style={{ color: C.body, fontWeight: '700', fontSize: 18 }}>Loading prices…</Text>
          </View>
        ) : tab === 'prices' ? (
          <Pop key="prices" style={[s.wrap, { marginTop: 22 }]}>
            {!!updated && (
              <View style={s.updatedPill}>
                <Ionicons name="time" size={18} color={C.forest} />
                <Text style={s.updatedText}>Last updated {fmtDate(updated)}</Text>
              </View>
            )}

            {!!insights && (
              <View style={s.snapCard}>
                <Text style={s.snapKicker}>Average price today</Text>
                <Text style={[DISPLAY, { color: C.cream, fontSize: 54, lineHeight: 58 }]}>{peso(insights.average_price)}</Text>

                <View style={s.snapRow}>
                  <View style={[s.snapBox, { backgroundColor: '#DDF0DF' }]}>
                    <Ionicons name="trending-up" size={26} color={UP} />
                    <View>
                      <Text style={[DISPLAY, { fontSize: 30, lineHeight: 32, color: UP }]}>{insights.trending_up ?? 0}</Text>
                      <Text style={s.snapLabel}>going up</Text>
                    </View>
                  </View>
                  <View style={[s.snapBox, { backgroundColor: '#FBE3E0' }]}>
                    <Ionicons name="trending-down" size={26} color={DOWN} />
                    <View>
                      <Text style={[DISPLAY, { fontSize: 30, lineHeight: 32, color: DOWN }]}>{insights.trending_down ?? 0}</Text>
                      <Text style={s.snapLabel}>going down</Text>
                    </View>
                  </View>
                </View>

                {!!range && (
                  <View style={{ marginTop: 24 }}>
                    <Ruler pos={medianPos} />
                    <View style={s.rangeLabels}>
                      <Text style={s.rangeText}>Low {peso(range.min)}</Text>
                      <Text style={[s.rangeText, { color: C.leaf }]}>Middle {peso(range.median)}</Text>
                      <Text style={s.rangeText}>High {peso(range.max)}</Text>
                    </View>
                  </View>
                )}

                <View style={s.hiLo}>
                  <Text style={s.hiLoText}><Text style={{ color: C.leaf }}>Most expensive: </Text>{insights.highest_priced}</Text>
                  <Text style={s.hiLoText}><Text style={{ color: C.leaf }}>Cheapest: </Text>{insights.lowest_priced}</Text>
                </View>
              </View>
            )}

            {!!error && (
              <View style={[s.errorBox, { marginTop: 16 }]}>
                <Ionicons name="warning" size={22} color="#9A1B12" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            {prices.length > 0 && (
              <View style={{ marginTop: 30 }}>
                <SectionHead title="Products" sub="Tap a product to see its forecast. The bar shows its price next to the highest one." />
                <View style={s.sortRow}>
                  {sorts.map((o) => {
                    const on = sort === o.k;
                    return (
                      <Pressable key={o.k} onPress={() => setSort(o.k)} accessibilityRole="button" accessibilityState={{ selected: on }}
                        accessibilityLabel={`Sort: ${o.label}`}
                        style={[s.sortChip, on && { backgroundColor: C.forest }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}>
                        <Ionicons name={o.icon} size={18} color={on ? C.cream : C.forest} />
                        <Text style={[s.sortText, { color: on ? C.cream : C.ink }]}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ gap: 12, marginTop: 16 }}>
                  {sortedPrices.map((p, i) => (
                    <PriceRow
                      key={p.id ?? i}
                      p={p}
                      maxPrice={maxPrice}
                      chartFor={chartFor}
                      chartLoading={chartLoading}
                      chartError={chartError}
                      chartPoints={chartPoints}
                      onChart={toggleChart}
                    />
                  ))}
                </View>
              </View>
            )}
            {prices.length === 0 && !error && <Text style={s.empty}>No prices available.</Text>}
          </Pop>
        ) : tab === 'copra' ? (
          <Pop key="copra" style={[s.wrap, { marginTop: 22 }]}>
            {!!copraDate && (
              <View style={s.updatedPill}>
                <Ionicons name="calendar" size={18} color={C.forest} />
                <Text style={s.updatedText}>As of {fmtDate(copraDate)}</Text>
              </View>
            )}
            <SectionHead title="Copra by region" sub="What buyers are paying near you" />
            {copraRows.length === 0 && <Text style={s.empty}>{copraMsg || 'No copra price data yet.'}</Text>}
            {copraRows.length > 0 && (
              <>
                <View style={s.sortRow}>
                  {[{ v: false, label: 'Region order', icon: 'list' }, { v: true, label: 'Highest farmgate', icon: 'arrow-up' }].map((o) => {
                    const on = copraHigh === o.v;
                    return (
                      <Pressable key={o.label} onPress={() => setCopraHigh(o.v)} accessibilityRole="button" accessibilityState={{ selected: on }}
                        style={[s.sortChip, on && { backgroundColor: C.forest }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}>
                        <Ionicons name={o.icon as any} size={18} color={on ? C.cream : C.forest} />
                        <Text style={[s.sortText, { color: on ? C.cream : C.ink }]}>{o.label}</Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={s.table}>
                  <View style={s.tHead}>
                    <Text style={[s.th, { flex: 1.4 }]}>Region</Text>
                    <Text style={s.th}>Farmgate</Text>
                    <Text style={s.th}>Millgate</Text>
                  </View>
                  {shownCopra.map((r, i) => {
                    const best = maxFarm > 0 && r.farmgate_price === maxFarm;
                    return (
                      <View key={`${r.region}-${i}`} style={[s.tRow, i % 2 === 1 && { backgroundColor: C.cream }, best && { backgroundColor: C.leaf }]}>
                        <View style={{ flex: 1.4 }}>
                          <Text style={[s.td, { fontWeight: '900' }]} numberOfLines={2}>{r.region}</Text>
                          {best && (
                            <View style={s.bestTag}>
                              <Ionicons name="leaf" size={14} color={C.forest} />
                              <Text style={s.bestText}>Highest</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.td}>{peso(r.farmgate_price)}</Text>
                        <Text style={s.td}>{peso(r.millgate_price)}</Text>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            <View style={{ marginTop: 34 }}>
              <SectionHead title="Forecast by region" sub="Tap a region to open it" />
              {!copraPred?.success ? (
                <Text style={s.noFc}>{copraPred?.message || 'Upload at least 2 copra price images to see forecasts.'}</Text>
              ) : (
                <>
                  <Text style={[s.metaDark, { marginBottom: 12 }]}>
                    Based on {copraPred.data_points} upload{copraPred.data_points === 1 ? '' : 's'}. Straight-line trend, 7 and 14 days ahead.
                  </Text>
                  <View style={{ gap: 12 }}>
                    {(copraPred.predictions || []).map((r: any) => {
                      const open = openRegion === r.region;
                      return (
                        <View key={r.region} style={[s.priceCard, open && { backgroundColor: C.leaf, borderColor: C.moss }]}>
                          <Pressable
                            onPress={() => setOpenRegion(open ? '' : r.region)}
                            accessibilityRole="button"
                            accessibilityState={{ expanded: open }}
                            accessibilityLabel={`${r.region} forecast. Tap to ${open ? 'close' : 'open'}.`}
                            style={[{ padding: 16 }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                          >
                            <View style={s.cardTop}>
                              <View style={{ flex: 1, gap: 6 }}>
                                <Text style={s.prodName}>{r.region}</Text>
                                <ConfMeter level={confLevel(r.confidence)} color={confColor(r.confidence)} />
                              </View>
                              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={26} color={C.forest} />
                            </View>
                          </Pressable>
                          {open && (
                            <Pop style={{ paddingHorizontal: 16, paddingBottom: 16, gap: 16 }}>
                              {([['Farmgate', r.current_farmgate, r.predicted_farmgate_7d, r.predicted_farmgate_14d, r.farmgate_trend],
                                 ['Millgate', r.current_millgate, r.predicted_millgate_7d, r.predicted_millgate_14d, r.millgate_trend]] as const).map(([lab, now, p7, p14, tr]) => {
                                const t = trendInfo(tr);
                                return (
                                  <View key={lab} style={{ gap: 8 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                      <Text style={[s.miniHead, { marginBottom: 0 }]}>{lab}</Text>
                                      <View style={[s.trendPill, { backgroundColor: t.color, marginTop: 0 }]}>
                                        <Ionicons name={t.icon} size={16} color="#fff" />
                                        <Text style={s.trendPillText}>{t.label}</Text>
                                      </View>
                                    </View>
                                    <View style={s.fcRow}>
                                      <FcBox label="Today" value={now} tone={C.paper} />
                                      <FcBox label="In 7 days" value={p7} base={now} tone={C.paper} />
                                      <FcBox label="In 14 days" value={p14} base={now} tone={C.paper} />
                                    </View>
                                  </View>
                                );
                              })}
                            </Pop>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </>
              )}
            </View>
          </Pop>
        ) : (
          <Pop key="how" style={[s.wrap, { marginTop: 22 }]}>
            {!how ? <Text style={s.empty}>Could not load explanation.</Text> : (
              <>
                <View style={s.snapCard}>
                  <Text style={[DISPLAY, { color: C.cream, fontSize: 28, lineHeight: 32 }]}>{how.title}</Text>
                  <Text style={{ color: C.leaf, fontSize: 17, lineHeight: 26, fontWeight: '600', marginTop: 10 }}>{how.summary}</Text>
                </View>

                <View style={{ marginTop: 30 }}>
                  <SectionHead title="Step by step" sub="How we get from prices to a forecast" />
                  <View style={{ position: 'relative' }}>
                    <View style={s.stepLine} />
                    {(how.workflow || []).map((w: any) => (
                      <View key={w.step} style={s.stepRow}>
                        <View style={s.stepNum}><Text style={[DISPLAY, { fontSize: 22, color: C.ink }]}>{w.step}</Text></View>
                        <View style={s.stepCard}>
                          <Text style={s.prodName}>{w.title}</Text>
                          <Text style={[s.advice, { marginTop: 4 }]}>{w.description}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </View>

                {!!how.confidence_levels && (
                  <View style={{ marginTop: 30 }}>
                    <SectionHead title="Confidence levels" sub="How sure the forecast is" />
                    <View style={s.table}>
                      {Object.entries(how.confidence_levels).map(([k, v], i) => (
                        <View key={k} style={[s.guideRow, i > 0 && { borderTopWidth: 1.5, borderTopColor: C.sand }]}>
                          <ConfMeter level={confLevel(k)} color={confColor(k)} />
                          <View style={{ flex: 1 }}>
                            <Text style={[DISPLAY, { fontSize: 20, color: C.ink }]}>{cap(k)}</Text>
                            <Text style={[s.advice, { marginTop: 2 }]}>{String(v)}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>
                )}
              </>
            )}
          </Pop>
        )}

        <View style={{ height: 200 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ───────────────────────── styles ─────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.forest },
  scroll: { alignItems: 'center' },
  wrap: { width: '92%', maxWidth: 680 },

  hero: {
    width: '100%', height: 184, backgroundColor: C.forest, overflow: 'hidden',
    borderBottomLeftRadius: 56, borderBottomRightRadius: 18,
  },
  hillA: { position: 'absolute', width: 460, height: 460, borderRadius: 230, backgroundColor: C.moss, left: -150, bottom: -405 },
  hillB: { position: 'absolute', width: 400, height: 400, borderRadius: 200, backgroundColor: C.hill, right: -150, bottom: -355 },
  heroText: { paddingHorizontal: 22, paddingTop: 16, maxWidth: 520 },
  title: { fontSize: 34, lineHeight: 38, color: C.cream },
  subtitle: { fontSize: 18, lineHeight: 26, color: C.leaf, fontWeight: '600', marginTop: 6 },

  segCard: {
    marginTop: -48, zIndex: 2, backgroundColor: C.paper, borderRadius: 32, padding: 6, borderWidth: 2, borderColor: C.sand,
  },
  segTrack: { flexDirection: 'row', borderRadius: 26 },
  segThumb: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: C.forest, borderRadius: 26 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, minHeight: 54 },

  adminCard: {
    marginTop: 18, backgroundColor: C.forest, padding: 18,
    borderTopLeftRadius: 14, borderTopRightRadius: 34, borderBottomRightRadius: 14, borderBottomLeftRadius: 34,
  },
  adminTitle: { color: C.leaf, fontWeight: '900', fontSize: 18 },
  infoText: { color: C.cream, fontSize: 16, lineHeight: 23, fontWeight: '600', marginTop: 12 },

  updatedPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: C.leaf,
    borderRadius: 20, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 16,
  },
  updatedText: { fontSize: 15, fontWeight: '800', color: C.forest },

  snapCard: {
    backgroundColor: C.forest, padding: 22,
    borderTopLeftRadius: 38, borderTopRightRadius: 14, borderBottomRightRadius: 38, borderBottomLeftRadius: 14,
  },
  snapKicker: { color: C.leaf, fontWeight: '700', fontSize: 17 },
  snapRow: { flexDirection: 'row', gap: 12, marginTop: 18 },
  snapBox: { flex: 1, borderRadius: 20, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  snapLabel: { fontSize: 16, fontWeight: '800', color: C.ink },
  rangeTrack: { height: 12, borderRadius: 6, backgroundColor: C.moss },
  rangeMark: {
    position: 'absolute', top: -6, width: 10, height: 24, borderRadius: 5, backgroundColor: C.cream, marginLeft: -5,
  },
  rangeLabels: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, gap: 6, flexWrap: 'wrap' },
  rangeText: { color: C.cream, fontSize: 15, fontWeight: '800' },
  hiLo: { marginTop: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(245,230,211,0.25)', gap: 6 },
  hiLoText: { color: C.cream, fontSize: 16, lineHeight: 22, fontWeight: '700' },

  sortRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  sortChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.leaf, borderRadius: 24,
    paddingHorizontal: 16, minHeight: 50,
  },
  sortText: { fontSize: 16, fontWeight: '900' },

  empty: { fontSize: 18, color: C.body, textAlign: 'center', marginTop: 24, fontWeight: '600' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FDE7E4', borderWidth: 2, borderColor: '#F3B7B0', borderRadius: 18, padding: 14,
  },
  errorText: { flex: 1, color: '#9A1B12', fontSize: 16, fontWeight: '700', lineHeight: 22 },

  priceCard: { backgroundColor: C.paper, borderRadius: 22, borderWidth: 2, borderColor: C.sand, overflow: 'hidden' },
  priceCardOpen: { borderColor: C.moss },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  prodName: { fontSize: 22, lineHeight: 27, fontWeight: '900', color: C.ink },
  prodUnit: { fontSize: 16, color: C.body, fontWeight: '600', marginTop: 2 },
  price: { fontSize: 28, fontWeight: '900', color: C.forest, letterSpacing: -0.5 },
  barLine: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 12 },
  hTrack: { height: 12, borderRadius: 6, backgroundColor: C.sand, overflow: 'hidden' },
  hFill: { height: 12, borderRadius: 6 },
  trendPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  trendPillText: { color: '#fff', fontWeight: '900', fontSize: 15 },
  openRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginTop: 10 },
  openText: { fontSize: 16, fontWeight: '800', color: C.forest },

  miniHead: { fontSize: 17, fontWeight: '900', color: C.ink, marginBottom: 8 },
  fcRow: { flexDirection: 'row', gap: 8 },
  fcBox: { flex: 1, borderRadius: 16, paddingVertical: 10, paddingHorizontal: 6, alignItems: 'center' },
  fcLabel: { fontSize: 14, color: C.body, fontWeight: '700' },
  fcValue: { fontSize: 17, fontWeight: '900', color: C.forest },
  noFc: { fontSize: 16, color: C.body, fontStyle: 'italic', lineHeight: 23 },
  confRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  confText: { flex: 1, fontSize: 16, color: C.body, fontWeight: '700' },
  adviceBox: {
    flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: C.cream, borderRadius: 18, padding: 14,
  },
  advice: { flex: 1, fontSize: 17, color: C.body, lineHeight: 25, fontWeight: '600' },
  metaDark: { fontSize: 16, color: C.body, fontWeight: '600' },

  chartWrap: { backgroundColor: C.cream, borderRadius: 18, padding: 14, gap: 10 },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', height: 110, gap: 2 },
  chartCol: { flex: 1, justifyContent: 'flex-end' },
  legendRow: { flexDirection: 'row', gap: 18 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 14, height: 14, borderRadius: 4 },
  legendText: { fontSize: 15, fontWeight: '700', color: C.ink },

  table: { marginTop: 14, backgroundColor: C.paper, borderRadius: 22, borderWidth: 2, borderColor: C.sand, overflow: 'hidden' },
  tHead: { flexDirection: 'row', backgroundColor: C.forest, paddingVertical: 14, paddingHorizontal: 16 },
  th: { flex: 1, fontSize: 16, fontWeight: '900', color: C.cream },
  tRow: { flexDirection: 'row', paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', minHeight: 60 },
  td: { flex: 1, fontSize: 17, color: C.ink, fontWeight: '700' },
  bestTag: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  bestText: { fontSize: 14, fontWeight: '900', color: C.forest },

  stepLine: { position: 'absolute', left: 24, top: 26, bottom: 40, width: 4, borderRadius: 2, backgroundColor: C.sand },
  stepRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginBottom: 14 },
  stepNum: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: C.cream,
  },
  stepCard: {
    flex: 1, backgroundColor: C.paper, borderRadius: 20, borderWidth: 2, borderColor: C.sand, padding: 16,
  },
  guideRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, paddingHorizontal: 16, minHeight: 80 },
});