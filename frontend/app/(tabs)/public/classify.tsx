// frontend/app/(tabs)/public/classify.tsx
// Live coconut scanner: camera preview + frame loop -> POST /classify/frame -> box overlay.
// Save = freeze last frame -> full dual-model pass -> Cloudinary -> /classify/save-scan.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, Image,
  ActivityIndicator, Alert, Animated, Easing, Pressable, AccessibilityInfo, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { File } from 'expo-file-system';
import { NGROK_URL } from '../../../constants/config';
import axios from 'axios';
import { authHeaders } from '../../../constants/session';

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
const ND = Platform.OS !== 'web';
const DISPLAY: any = { fontWeight: '900', letterSpacing: -0.5 };

const SOFT_SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 10px 24px rgba(31, 48, 18, 0.18)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 };

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

// ───────────────────────── constants ─────────────────────────
const HEADERS = { 'ngrok-skip-browser-warning': 'true' };

// One colour for every stage. Stages are told apart by name; only the small mix bar uses shades of the same green.
const STAGE_COLOR = C.moss;
const STAGES: Record<string, { name: string; hint: string; color: string; tint: string; shade: string }> = {
  malauhog: { name: 'Malauhog', hint: 'Buko juice stage', color: STAGE_COLOR, tint: C.leaf, shade: '#A9BF5A' },
  malakanin: { name: 'Malakanin', hint: 'Soft meat stage', color: STAGE_COLOR, tint: C.leaf, shade: '#6E9433' },
  niyog: { name: 'Niyog', hint: 'Mature stage', color: STAGE_COLOR, tint: C.leaf, shade: '#2F4A1E' },
};
const stageOf = (label: string) =>
  STAGES[label] || { name: label, hint: '', color: STAGE_COLOR, tint: C.leaf, shade: STAGE_COLOR };

// ───────────────────────── helpers ─────────────────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const deleteFile = (uri?: string | null) => {
  if (!uri || Platform.OS === 'web') return;
  try { new File(uri).delete(); } catch { /* cache file, ignore */ }
};

async function appendFile(form: FormData, field: string, uri: string, name: string) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    form.append(field, blob, name);
  } else {
    form.append(field, { uri, name, type: 'image/jpeg' } as any);
  }
}

function parseJson(text: string, status: number) {
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }
  if (status < 200 || status >= 300) {
    const d = data?.detail;
    throw new Error(typeof d === 'string' ? d : `HTTP ${status}`);
  }
  return data;
}

async function readJson(res: Response) {
  return parseJson(await res.text(), res.status);
}

// Multipart upload through axios (XHR). Expo's fetch rejects { uri, name, type } parts.
async function postForm(url: string, form: FormData, extra: Record<string, string> = {}) {
  const res = await axios.post(url, form, {
    headers: { ...HEADERS, ...extra, 'Content-Type': 'multipart/form-data' },
    transformRequest: (d) => d,
    transformResponse: (r) => r,
    validateStatus: () => true,
    timeout: 30000,
  });
  const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
  return parseJson(text, res.status);
}

async function postFrame(uri: string, fast: boolean) {
  const form = new FormData();
  await appendFile(form, 'file', uri, 'frame.jpg');
  return postForm(`${NGROK_URL}/classify/frame?fast=${fast}`, form);
}

async function getUserId(): Promise<string | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    if (!raw) return null;
    const u = JSON.parse(raw);
    const id = u.id ?? u._id ?? u.user_id ?? u.userId;
    if (!id) console.log('[classify] session has no id field. keys:', Object.keys(u));
    return id ? String(id) : null;
  } catch { return null; }
}

// Android only: choose a small 4:3 picture size (about 640 px wide) so uploads stay light.
function pickPictureSize(sizes?: string[]): string | undefined {
  if (!sizes?.length) return undefined;
  const parsed = sizes
    .map((s) => { const m = s.match(/^(\d+)x(\d+)$/); return m ? { s, w: +m[1], h: +m[2] } : null; })
    .filter(Boolean) as { s: string; w: number; h: number }[];
  const four3 = parsed.filter((p) => Math.abs(p.w / p.h - 4 / 3) < 0.02);
  const up = four3.filter((p) => p.w >= 640).sort((a, b) => a.w - b.w)[0];
  const down = four3.filter((p) => p.w < 640).sort((a, b) => b.w - a.w)[0];
  return (up || down)?.s;
}

const iou = (a: number[], b: number[]) => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return ua > 0 ? inter / ua : 0;
};

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

// Small entrance used only for things that appear because the person did something.
function Pop({ children, style }: any) {
  const a = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    Animated.spring(a, { toValue: 1, friction: 8, tension: 70, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: a,
      transform: [{ scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }],
    }]}>
      {children}
    </Animated.View>
  );
}

// Chunky button with a solid edge underneath. Presses down like a real key.
const TONES: Record<string, { bg: string; edge: string; fg: string; border?: string }> = {
  primary: { bg: C.moss, edge: C.forest, fg: C.cream },
  danger: { bg: '#B83A2B', edge: '#7E2318', fg: '#FFFFFF' },
  light: { bg: C.paper, edge: '#CDB48E', fg: C.ink, border: '#CDB48E' },
  leaf: { bg: C.leaf, edge: '#A3B168', fg: C.ink },
};

function PressBtn({ label, icon, onPress, disabled = false, tone = 'light', style, radius = 20, big = false }: any) {
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
      style={[{ opacity: disabled ? 0.45 : 1 }, style, Platform.OS === 'web' ? ({ cursor: disabled ? 'default' : 'pointer' } as any) : null]}
    >
      <View style={{ paddingBottom: EDGE }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: EDGE, bottom: 0, backgroundColor: t.edge, borderRadius: radius }} />
        <Animated.View style={{
          backgroundColor: t.bg, borderRadius: radius, minHeight: big ? 72 : 58,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 16,
          borderWidth: t.border ? 2 : 0, borderColor: t.border,
          transform: [{ translateY: y }],
        }}>
          <Ionicons name={icon} size={big ? 30 : 24} color={t.fg} />
          <Text style={{ color: t.fg, fontSize: big ? 22 : 18, fontWeight: '900', flexShrink: 1 }}>{label}</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

// Leaf that sways gently.
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

// Step marker for the Aim / Scan / Read tracker.
function StepNode({ icon, label, state }: { icon: any; label: string; state: 'done' | 'active' | 'todo' }) {
  const sc = useRef(new Animated.Value(1)).current;
  const halo = useLoop(900);
  useEffect(() => {
    Animated.spring(sc, { toValue: state === 'active' ? 1.12 : 1, friction: 5, tension: 110, useNativeDriver: ND }).start();
  }, [state]);
  const bg = state === 'done' ? C.moss : state === 'active' ? C.lime : C.sand;
  const fg = state === 'done' ? C.cream : C.ink;
  return (
    <View style={{ width: 76, alignItems: 'center' }}>
      <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
        {state === 'active' && !REDUCE && (
          <Animated.View pointerEvents="none" style={{
            position: 'absolute', width: 54, height: 54, borderRadius: 27, borderWidth: 3, borderColor: C.lime,
            opacity: halo.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
            transform: [{ scale: halo.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
          }} />
        )}
        <Animated.View style={{
          width: 46, height: 46, borderRadius: 23, backgroundColor: bg, alignItems: 'center', justifyContent: 'center',
          transform: [{ scale: sc }],
        }}>
          <Ionicons name={state === 'done' ? 'checkmark' : icon} size={24} color={fg} />
        </Animated.View>
      </View>
      <Text style={{ marginTop: 4, fontSize: 16, fontWeight: state === 'todo' ? '700' : '900', color: state === 'todo' ? C.body : C.ink }}>
        {label}
      </Text>
    </View>
  );
}

function StepLink({ on }: { on: boolean }) {
  const a = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(a, { toValue: on ? 1 : 0, duration: REDUCE ? 0 : 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [on]);
  return (
    <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: C.sand, marginTop: 25, marginHorizontal: -8, overflow: 'hidden' }}>
      <Animated.View style={{ height: 6, backgroundColor: C.moss, width: a.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
    </View>
  );
}

// Four viewfinder corners drawn over the frame.
function Corners({ color = C.cream }: { color?: string }) {
  const c = (v: 'top' | 'bottom', h: 'left' | 'right') => ({
    position: 'absolute' as const, [v]: 16, [h]: 16, width: 30, height: 30, borderColor: color,
    [v === 'top' ? 'borderTopWidth' : 'borderBottomWidth']: 4,
    [h === 'left' ? 'borderLeftWidth' : 'borderRightWidth']: 4,
    borderRadius: 8, opacity: 0.9,
  } as any);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={c('top', 'left')} /><View style={c('top', 'right')} />
      <View style={c('bottom', 'left')} /><View style={c('bottom', 'right')} />
    </View>
  );
}

// Light line sweeping over the frame while live scanning.
function ScanLine({ height }: { height: number }) {
  const v = useLoop(1800);
  if (REDUCE || !height) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left: 14, right: 14, top: 0, height: 3, borderRadius: 2,
        backgroundColor: C.lime, opacity: 0.85,
        transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [14, Math.max(14, height - 18)] }) }],
      }}
    />
  );
}

// Confidence bar that glides to its value.
function ConfBar({ pct, color }: { pct: number; color: string }) {
  const a = useRef(new Animated.Value(REDUCE ? pct : 0)).current;
  useEffect(() => {
    if (REDUCE) { a.setValue(pct); return; }
    Animated.timing(a, { toValue: pct, duration: 450, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [pct]);
  return (
    <View style={s.barTrack}>
      <Animated.View style={[s.barFill, { backgroundColor: color, width: a.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]} />
    </View>
  );
}

// The big count bounces whenever the number changes.
function CountNum({ value }: { value: number }) {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (REDUCE) return;
    a.setValue(0.8);
    Animated.spring(a, { toValue: 1, friction: 5, tension: 120, useNativeDriver: ND }).start();
  }, [value]);
  return (
    <Animated.Text style={[DISPLAY, { fontSize: 78, lineHeight: 82, color: C.cream, transform: [{ scale: a }] }]}>
      {value}
    </Animated.Text>
  );
}

// One coconut in the result list. Tap to open the details and mark it on the camera.
function DetRow({ d, i, active, dim, live, onPress }: any) {
  const st = stageOf(d.shownLabel);
  const o = d.original_model?.primary;
  const c = d.custom_model?.primary;
  const disagree = !live && o && c && o.label !== c.label;
  const pct = c ? Math.round(c.confidence * 100) : 0;
  const sc = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();
  return (
    <Animated.View style={{ opacity: dim ? 0.4 : 1, transform: [{ scale: sc }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={() => go(0.98)}
        onPressOut={() => go(1)}
        accessibilityRole="button"
        accessibilityLabel={`Coconut ${i + 1}, ${st.name}, ${pct} percent`}
        accessibilityState={{ expanded: active }}
        style={[
          s.row,
          { backgroundColor: st.tint, borderColor: active ? st.color : 'transparent' },
          Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
        ]}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[s.rowNum, { backgroundColor: st.color }]}>
            <Text style={s.rowNumText}>{i + 1}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.rowTitle}>{st.name}</Text>
            <Text style={s.rowHint}>{st.hint}</Text>
          </View>
          {c && <Text style={[DISPLAY, { fontSize: 26, color: C.ink }]}>{pct}%</Text>}
          <Ionicons name={active ? 'chevron-up' : 'chevron-down'} size={24} color={C.ink} />
        </View>
        {active && c && (
          <View style={{ marginTop: 4 }}>
            <ConfBar pct={pct} color={st.color} />
            {!live && o && (
              <View style={{ marginTop: 12, gap: 4 }}>
                <Text style={s.rowMeta}>Custom model: {stageOf(c.label).name}, {pct}%</Text>
                <Text style={s.rowMeta}>Original model: {stageOf(o.label).name}, {Math.round(o.confidence * 100)}%</Text>
              </View>
            )}
            {disagree && (
              <View style={s.warnPill}>
                <Ionicons name="alert-circle" size={20} color="#8A4B08" />
                <Text style={s.rowWarn}>The two models disagree. Try a closer, clearer shot.</Text>
              </View>
            )}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

// ───────────────────────── screen ─────────────────────────
export default function ClassifyScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const [focused, setFocused] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>(undefined);

  const [live, setLive] = useState(false);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [frameUri, setFrameUri] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [aspect, setAspect] = useState(Platform.OS === 'web' ? 4 / 3 : 3 / 4);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [stats, setStats] = useState({ ms: 0, fps: 0 });
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [focusStage, setFocusStage] = useState<string | null>(null);
  const [focusIdx, setFocusIdx] = useState<number | null>(null);

  const liveRef = useRef(false);
  const loopIdRef = useRef(0);
  const histRef = useRef<{ box: number[]; labels: string[] }[]>([]);
  const prevUriRef = useRef<string | null>(null);

  const pulse = useLoop(900);
  const { width: winW, height: winH } = useWindowDimensions();
  const fw = Math.min(Math.min(winW * 0.92, 620), winH * 0.5 * aspect);

  // ── label smoothing: majority vote over the last 5 frames, boxes matched by IoU ──
  const smooth = (dets: any[]) => {
    const prev = histRef.current;
    const used = new Set<number>();
    const next: { box: number[]; labels: string[] }[] = [];
    const out = dets.map((d) => {
      const label = d.custom_model.primary.label;
      let bi = -1, best = 0.3;
      prev.forEach((p, i) => {
        if (used.has(i)) return;
        const v = iou(p.box, d.box);
        if (v > best) { best = v; bi = i; }
      });
      const labels = bi >= 0 ? [...prev[bi].labels, label].slice(-5) : [label];
      if (bi >= 0) used.add(bi);
      next.push({ box: d.box, labels });
      const counts: Record<string, number> = {};
      labels.forEach((l) => { counts[l] = (counts[l] || 0) + 1; });
      const shownLabel = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      return { ...d, shownLabel };
    });
    histRef.current = next;
    return out;
  };

  const plain = (dets: any[]) =>
    dets.map((d) => ({ ...d, shownLabel: d.custom_model.primary.label }));

  const applyResult = (data: any, uri: string, ownsFile: boolean, smoothing: boolean) => {
    const shown = smoothing ? smooth(data.detections || []) : plain(data.detections || []);
    setResult({ ...data, shown });
    const sz = data.image_size;
    if (sz?.width && sz?.height) setAspect(sz.width / sz.height);
    setFrameUri(uri);
    if (ownsFile) {
      if (prevUriRef.current && prevUriRef.current !== uri) deleteFile(prevUriRef.current);
      prevUriRef.current = uri;
    }
  };

  // ── stop camera loop when the screen loses focus ──
  const stopLive = useCallback(() => {
    liveRef.current = false;
    setLive(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => {
        setFocused(false);
        setCameraReady(false);
        stopLive();
      };
    }, [stopLive])
  );

  // ── the live loop: one frame in flight at a time, never queued ──
  const runLoop = useCallback(async () => {
    const id = ++loopIdRef.current;
    let lastEnd = Date.now();
    while (liveRef.current && loopIdRef.current === id) {
      try {
        const photo = await cameraRef.current?.takePictureAsync({
          quality: 0.4, skipProcessing: true, shutterSound: false, exif: false, base64: false,
        } as any);
        if (!photo) { await sleep(200); continue; }
        if (!liveRef.current || loopIdRef.current !== id) { deleteFile(photo.uri); break; }

        const data = await postFrame(photo.uri, true);
        if (!liveRef.current || loopIdRef.current !== id) { deleteFile(photo.uri); break; }

        applyResult(data, photo.uri, true, true);
        const now = Date.now();
        setStats({ ms: data.ms ?? 0, fps: 1000 / Math.max(1, now - lastEnd) });
        lastEnd = now;
        setError('');
      } catch (e: any) {
        setError(e?.message || 'Frame failed');
        await sleep(1000);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    liveRef.current = live;
    if (live && cameraReady && !photoUri) runLoop();
    return () => { liveRef.current = false; };
  }, [live, cameraReady, photoUri, runLoop]);

  const onCameraReady = async () => {
    setCameraReady(true);
    if (Platform.OS === 'android') {
      try {
        const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
        const pick = pickPictureSize(sizes);
        if (pick) setPictureSize(pick);
      } catch { /* keep default size */ }
    }
  };

  // ── actions ──
  const toggleLive = () => {
    setError('');
    if (live) { stopLive(); return; }
    histRef.current = [];
    setResult(null);
    setFocusIdx(null);
    setLive(true);
  };

  const pickFromGallery = async () => {
    stopLive();
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (res.canceled || !res.assets?.[0]?.uri) return;
    const uri = res.assets[0].uri;
    setPhotoUri(uri);
    setResult(null);
    setFocusIdx(null);
    setError('');
    setAnalyzing(true);
    try {
      histRef.current = [];
      const data = await postFrame(uri, false);
      applyResult(data, uri, false, false);
    } catch (e: any) {
      setError(e?.message || 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  };

  const backToCamera = () => {
    setPhotoUri(null);
    setResult(null);
    setFrameUri(null);
    setFocusIdx(null);
    setError('');
    histRef.current = [];
  };

  const saveScan = async () => {
    if (!frameUri || saving) return;
    const uid = await getUserId();
    if (!uid) {
      Alert.alert('Login required', 'Please log in to save scans.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Login', onPress: () => router.push('/(auth)/login') },
      ]);
      return;
    }
    stopLive();
    setSaving(true);
    setError('');
    try {
      const full = await postFrame(frameUri, false); // both models, full detail
      setResult({ ...full, shown: plain(full.detections || []) });
      if (!full.count) { Alert.alert('Nothing to save', 'No coconuts detected in this frame.'); return; }

      const form = new FormData();
      await appendFile(form, 'file', frameUri, 'scan.jpg');
      const up = await postForm(`${NGROK_URL}/classify/upload-image`, form, {
        ...(await authHeaders()),
      });

      await readJson(await fetch(`${NGROK_URL}/classify/save-scan`, {
        method: 'POST',
        headers: { ...HEADERS, 'Content-Type': 'application/json', Authorization: `Bearer ${uid}` },
        body: JSON.stringify({
          image_url: up.image_url,
          detections: full.detections,
          total_count: full.count,
          image_width: full.image_size?.width,
          image_height: full.image_size?.height,
        }),
      }));
      Alert.alert('Saved', `Scan with ${full.count} coconut(s) saved to your history.`);
    } catch (e: any) {
      setError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  // ── derived ──
  const shown: any[] = result?.shown || [];
  const sx = result?.image_size?.width ? stage.w / result.image_size.width : 1;
  const sy = result?.image_size?.height ? stage.h / result.image_size.height : 1;
  const tally: Record<string, number> = {};
  shown.forEach((d) => { tally[d.shownLabel] = (tally[d.shownLabel] || 0) + 1; });
  const canSave = !!frameUri && shown.length > 0 && !saving && !analyzing;
  const hasCamera = !!permission?.granted || !!photoUri;
  const dimmed = (label: string, i: number) =>
    (!!focusStage && focusStage !== label) || (focusIdx !== null && focusIdx !== i);

  const stepNow = live || analyzing || saving ? 2 : shown.length > 0 ? 3 : 1;
  const stepState = (n: number): 'done' | 'active' | 'todo' =>
    n < stepNow ? 'done' : n === stepNow ? 'active' : 'todo';

  const status = saving
    ? { color: C.lime, text: 'Saving your scan…' }
    : analyzing
      ? { color: C.lime, text: 'Checking your photo…' }
      : live
        ? { color: '#E5503F', text: 'Scanning live. Hold the phone steady.' }
        : photoUri
          ? { color: C.moss, text: 'Photo loaded. Results are below.' }
          : cameraReady
            ? { color: C.moss, text: 'Camera is ready. Press Start scanning.' }
            : { color: '#C9A24A', text: 'Starting the camera…' };

  // ───────────────────────── render ─────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView style={{ backgroundColor: C.cream }} contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        {/* hero: a field at sunrise */}
        <View style={s.hero}>
          <View style={s.hillA} pointerEvents="none" />
          <View style={s.hillB} pointerEvents="none" />
          <SwayLeaf style={{ right: 70, bottom: 42 }} size={30} color={C.leaf} tilt={12} />
          <SwayLeaf style={{ right: 22, bottom: 38 }} size={38} color={C.lime} tilt={9} delay={600} />
          <View style={s.heroText}>
            <Text style={[DISPLAY, s.title]}>Scan a coconut</Text>
            <Text style={s.subtitle}>Point the camera at your coconuts. The grade shows right on the screen.</Text>
          </View>
        </View>

        {/* three steps */}
        <View style={[s.wrap, s.stepsCard]}>
          <StepNode icon="camera" label="Aim" state={stepState(1)} />
          <StepLink on={stepNow > 1} />
          <StepNode icon="scan" label="Scan" state={stepState(2)} />
          <StepLink on={stepNow > 2} />
          <StepNode icon="eye" label="Read" state={stepState(3)} />
        </View>

        {/* camera permission */}
        {!permission && !photoUri ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={C.moss} size="large" />
        ) : !permission?.granted && !photoUri ? (
          <View style={[s.wrap, { marginTop: 22 }]}>
            <View style={s.permCard}>
              <View style={s.permIcon}>
                <Ionicons name="camera" size={36} color={C.ink} />
              </View>
              <Text style={[DISPLAY, s.permTitle]}>We need your camera</Text>
              <Text style={s.permBody}>
                Allow the camera to scan coconuts as you walk, or choose a photo you already took.
              </Text>
              <PressBtn tone="primary" icon="checkmark-circle" label="Allow camera" onPress={requestPermission} big style={{ marginTop: 20, alignSelf: 'stretch' }} />
              <PressBtn tone="light" icon="images" label="Choose a photo" onPress={pickFromGallery} style={{ marginTop: 10, alignSelf: 'stretch' }} />
            </View>
          </View>
        ) : null}

        {/* frame: preview or uploaded photo, with box overlay */}
        {hasCamera && (
          <View style={[s.wrap, { marginTop: 22 }]}>
            <View style={[s.frameShadow, SOFT_SHADOW, { width: fw, alignSelf: 'center' }]}>
              <View
                style={[s.frame, { aspectRatio: aspect }]}
                onLayout={(e) => setStage({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
              >
                {photoUri ? (
                  <Image source={{ uri: photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                ) : focused ? (
                  <CameraView
                    ref={cameraRef}
                    style={StyleSheet.absoluteFill}
                    facing="back"
                    animateShutter={false}
                    pictureSize={pictureSize}
                    onCameraReady={onCameraReady}
                  />
                ) : null}

                <Corners color={live ? C.lime : C.cream} />
                {live && <ScanLine height={stage.h} />}

                {shown.map((d, i) => {
                  const [x1, y1, x2, y2] = d.box;
                  const st = stageOf(d.shownLabel);
                  const same = d.custom_model.primary.label === d.shownLabel;
                  const conf = Math.round(d.custom_model.primary.confidence * 100);
                  const top = y1 * sy;
                  const dim = dimmed(d.shownLabel, i);
                  const picked = focusIdx === i;
                  return (
                    <Pressable
                      key={i}
                      disabled={live}
                      onPress={() => setFocusIdx(picked ? null : i)}
                      accessibilityRole="button"
                      accessibilityLabel={`Coconut ${i + 1}, ${st.name}`}
                      style={{
                        position: 'absolute', left: x1 * sx, top, width: (x2 - x1) * sx, height: (y2 - y1) * sy,
                        borderWidth: dim ? 2 : picked ? 6 : 4, borderColor: st.color, borderRadius: 12,
                        opacity: dim ? 0.25 : 1,
                      }}
                    >
                      <View style={[s.chip, { backgroundColor: st.color, top: top < 28 ? 0 : -28 }]}>
                        <Text style={s.chipText}>{i + 1}  {st.name}{same ? ` ${conf}%` : ''}</Text>
                      </View>
                    </Pressable>
                  );
                })}

                {live && (
                  <View style={s.liveBadge}>
                    <Animated.View style={[s.liveDot, { transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.35] }) }] }]} />
                    <Text style={s.liveText}>LIVE  {stats.fps.toFixed(1)} fps  {stats.ms} ms</Text>
                  </View>
                )}
                {(analyzing || saving) && (
                  <View style={s.overlayBusy}>
                    <ActivityIndicator color={C.cream} size="large" />
                    <Text style={s.busyText}>{saving ? 'Saving your scan…' : 'Checking your photo…'}</Text>
                  </View>
                )}
              </View>
            </View>

            {/* status line */}
            <View style={s.statusRow}>
              <View style={[s.statusDot, { backgroundColor: status.color }]} />
              <Text style={s.statusText}>{status.text}</Text>
            </View>
          </View>
        )}

        {/* controls */}
        {hasCamera && (
          <View style={[s.wrap, { marginTop: 14 }]}>
            {photoUri ? (
              <PressBtn big tone="primary" icon="camera" label="Back to camera" onPress={backToCamera} radius={26} />
            ) : (
              <PressBtn
                big
                tone={live ? 'danger' : 'primary'}
                icon={live ? 'stop-circle' : 'scan'}
                label={live ? 'Stop scanning' : 'Start scanning'}
                onPress={toggleLive}
                disabled={!cameraReady}
                radius={26}
              />
            )}
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <PressBtn style={{ flex: 1 }} tone="light" icon="images" label="Photo" onPress={pickFromGallery} />
              <PressBtn style={{ flex: 1 }} tone="leaf" icon="bookmark" label="Save scan" onPress={saveScan} disabled={!canSave} />
            </View>
          </View>
        )}

        {/* stage filter */}
        {hasCamera && (
          <View style={[s.wrap, { marginTop: 26 }]}>
            <Text style={s.filterLabel}>Tap a stage to show only that stage on the camera</Text>
            <View style={s.filterRow}>
              {Object.entries(STAGES).map(([key, st]) => {
                const on = focusStage === key;
                const n = tally[key] || 0;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setFocusStage(on ? null : key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={`${st.name}, ${st.hint}`}
                    style={[
                      s.filterChip,
                      { borderColor: st.color, backgroundColor: on ? st.color : C.paper },
                      Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
                    ]}
                  >
                    <Text style={[s.filterName, { color: on ? '#fff' : C.ink }]}>{st.name}</Text>
                    <Text style={[s.filterHint, { color: on ? '#fff' : C.body }]}>{st.hint}</Text>
                    {n > 0 && (
                      <View style={[s.filterCount, { backgroundColor: on ? '#fff' : st.color }]}>
                        <Text style={{ color: on ? st.color : '#fff', fontWeight: '900', fontSize: 15 }}>{n}</Text>
                      </View>
                    )}
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {!!error && (
          <Pop style={[s.wrap, { marginTop: 16 }]}>
            <View style={s.errorBox}>
              <Ionicons name="warning" size={24} color="#9A1B12" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          </Pop>
        )}

        {/* results */}
        {result && (
          <View style={[s.wrap, { marginTop: 30 }]}>
            <View style={s.countCard}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 14 }}>
                <CountNum value={shown.length} />
                <Text style={[DISPLAY, { color: C.cream, fontSize: 25, lineHeight: 30, paddingBottom: 10, flex: 1 }]}>
                  {shown.length === 1 ? 'coconut found' : 'coconuts found'}
                </Text>
              </View>
              {shown.length === 0 && (
                <Text style={s.countEmpty}>
                  {live ? 'Move closer or find better light.' : 'Try another photo with the coconuts closer and clearer.'}
                </Text>
              )}
              {shown.length > 0 && (
                <View style={s.mixBar}>
                  {Object.entries(tally).map(([label, n]) => (
                    <View key={label} style={{ flex: n, backgroundColor: stageOf(label).shade }} />
                  ))}
                </View>
              )}
              {Object.keys(tally).length > 0 && (
                <View style={s.tallyRow}>
                  {Object.entries(tally).map(([label, n]) => {
                    const st = stageOf(label);
                    const on = focusStage === label;
                    return (
                      <Pressable
                        key={label}
                        onPress={() => setFocusStage(on ? null : label)}
                        accessibilityRole="button"
                        style={[s.tally, on && { backgroundColor: '#fff' }]}
                      >
                        <View style={[s.tallyDot, { backgroundColor: st.shade }]} />
                        <Text style={s.tallyText}>{n} {st.name}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            {shown.length > 0 && (
              <>
                <Text style={s.listHint}>Tap a coconut to see more and find it on the picture.</Text>
                <View style={{ gap: 12, marginTop: 10 }}>
                  {shown.map((d, i) => (
                    <DetRow
                      key={i}
                      d={d}
                      i={i}
                      live={live}
                      active={focusIdx === i}
                      dim={dimmed(d.shownLabel, i)}
                      onPress={() => setFocusIdx(focusIdx === i ? null : i)}
                    />
                  ))}
                </View>
              </>
            )}
          </View>
        )}

        {/* stage guide: a ripening path */}
        <View style={[s.wrap, { marginTop: 40 }]}>
          <Text style={[DISPLAY, s.sectionTitle]}>How coconuts ripen</Text>
          <Text style={s.sectionSub}>The box color on the camera tells you the stage.</Text>
          <View style={s.path}>
            <View style={s.pathLine} />
            {Object.entries(STAGES).map(([key, st], i) => {
              const size = 46 + i * 12;
              return (
                <View key={key} style={s.pathRow}>
                  <View style={{ width: 80, alignItems: 'center' }}>
                    <View style={{
                      width: size, height: size, borderRadius: size / 2, backgroundColor: st.shade,
                      alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: C.cream,
                    }}>
                      <Ionicons name="leaf" size={22 + i * 6} color="#fff" />
                    </View>
                  </View>
                  <View style={[s.pathCard, { backgroundColor: st.tint, borderLeftColor: st.color }]}>
                    <Text style={s.pathName}>{st.name}</Text>
                    <Text style={s.pathHint}>{st.hint}</Text>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        <View style={{ height: 200 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ───────────────────────── styles ─────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.forest },
  scroll: { alignItems: 'center' },
  wrap: { width: '92%', maxWidth: 620 },

  hero: {
    width: '100%', height: 184, backgroundColor: C.forest, overflow: 'hidden',
    borderBottomLeftRadius: 56, borderBottomRightRadius: 18,
  },
  hillA: {
    position: 'absolute', width: 460, height: 460, borderRadius: 230, backgroundColor: C.moss,
    left: -150, bottom: -405,
  },
  hillB: {
    position: 'absolute', width: 400, height: 400, borderRadius: 200, backgroundColor: C.hill,
    right: -150, bottom: -355,
  },
  heroText: { paddingHorizontal: 22, paddingTop: 16, maxWidth: 520 },
  title: { fontSize: 34, lineHeight: 38, color: C.cream },
  subtitle: { fontSize: 18, lineHeight: 26, color: C.leaf, fontWeight: '600', marginTop: 6 },

  stepsCard: {
    marginTop: -48, zIndex: 2, backgroundColor: C.paper, borderRadius: 28, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center',
    borderWidth: 2, borderColor: C.sand,
  },

  permCard: {
    backgroundColor: C.forest, padding: 24, alignItems: 'center',
    borderTopLeftRadius: 40, borderTopRightRadius: 14, borderBottomRightRadius: 40, borderBottomLeftRadius: 14,
  },
  permIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },
  permTitle: { color: C.cream, fontSize: 26, marginTop: 16, textAlign: 'center' },
  permBody: { color: C.leaf, fontWeight: '600', fontSize: 17, lineHeight: 25, marginTop: 8, textAlign: 'center' },

  frameShadow: {
    borderTopLeftRadius: 44, borderTopRightRadius: 16, borderBottomRightRadius: 44, borderBottomLeftRadius: 16,
    backgroundColor: C.forest,
  },
  frame: {
    width: '100%', backgroundColor: C.ink, overflow: 'hidden',
    borderTopLeftRadius: 44, borderTopRightRadius: 16, borderBottomRightRadius: 44, borderBottomLeftRadius: 16,
    borderWidth: 4, borderColor: C.forest,
  },
  chip: { position: 'absolute', left: -3, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 9 },
  chipText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  liveBadge: {
    position: 'absolute', top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(31,48,18,0.78)', paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#ef4444' },
  liveText: { color: C.cream, fontSize: 13, fontWeight: '800' },
  overlayBusy: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(31,48,18,0.65)',
    justifyContent: 'center', alignItems: 'center', gap: 10,
  },
  busyText: { color: C.cream, fontWeight: '800', fontSize: 18 },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingHorizontal: 6, minHeight: 32 },
  statusDot: { width: 14, height: 14, borderRadius: 7 },
  statusText: { flex: 1, fontSize: 17, fontWeight: '800', color: C.ink },

  filterLabel: { fontSize: 17, fontWeight: '800', color: C.body, marginBottom: 12 },
  filterRow: { flexDirection: 'row', gap: 8 },
  filterChip: {
    flex: 1, flexBasis: 0, borderWidth: 3, borderRadius: 20, paddingHorizontal: 6, paddingVertical: 10, minHeight: 78,
    justifyContent: 'center', alignItems: 'center',
  },
  filterName: { fontSize: 17, fontWeight: '900', textAlign: 'center' },
  filterHint: { fontSize: 14, fontWeight: '600', marginTop: 2, textAlign: 'center' },
  filterCount: {
    position: 'absolute', top: -12, right: 4, minWidth: 30, height: 30, borderRadius: 15,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6,
  },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FDE7E4', borderWidth: 2, borderColor: '#F3B7B0', borderRadius: 18, padding: 14,
  },
  errorText: { flex: 1, color: '#9A1B12', fontSize: 17, fontWeight: '700', lineHeight: 23 },

  countCard: {
    backgroundColor: C.forest, padding: 22,
    borderTopLeftRadius: 14, borderTopRightRadius: 40, borderBottomRightRadius: 14, borderBottomLeftRadius: 40,
  },
  countEmpty: { color: C.leaf, fontSize: 17, lineHeight: 25, fontWeight: '600', marginTop: 4 },
  mixBar: { flexDirection: 'row', height: 16, borderRadius: 8, overflow: 'hidden', marginTop: 12, gap: 3 },
  tallyRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 14 },
  tally: {
    flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 18, minHeight: 44,
    paddingHorizontal: 14, paddingVertical: 8, backgroundColor: C.cream,
  },
  tallyDot: { width: 14, height: 14, borderRadius: 7 },
  tallyText: { fontSize: 17, fontWeight: '800', color: C.ink },

  listHint: { fontSize: 16, color: C.body, fontWeight: '700', marginTop: 18 },
  row: { borderRadius: 22, borderWidth: 3, padding: 16 },
  rowNum: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  rowNumText: { color: '#fff', fontWeight: '900', fontSize: 19 },
  rowTitle: { fontSize: 22, lineHeight: 26, fontWeight: '900', color: C.ink },
  rowHint: { fontSize: 16, fontWeight: '600', color: C.body, marginTop: 1 },
  rowMeta: { fontSize: 16, color: C.body, fontWeight: '700' },
  barTrack: { height: 12, borderRadius: 6, backgroundColor: 'rgba(31,48,18,0.12)', marginTop: 12, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6 },
  warnPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8DFAE', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 10, marginTop: 12,
  },
  rowWarn: { fontSize: 16, color: '#6E3A05', fontWeight: '800', flexShrink: 1 },

  sectionTitle: { fontSize: 30, lineHeight: 34, color: C.forest },
  sectionSub: { fontSize: 17, lineHeight: 24, color: C.body, fontWeight: '600', marginTop: 4 },
  path: { marginTop: 20, position: 'relative' },
  pathLine: {
    position: 'absolute', left: 38, top: 30, bottom: 30, width: 4, borderRadius: 2, backgroundColor: C.sand,
  },
  pathRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  pathCard: { flex: 1, borderRadius: 18, borderLeftWidth: 8, paddingHorizontal: 16, paddingVertical: 14, minHeight: 76, justifyContent: 'center' },
  pathName: { fontSize: 22, lineHeight: 26, fontWeight: '900', color: C.ink },
  pathHint: { fontSize: 16, color: C.body, fontWeight: '600', marginTop: 2 },
});