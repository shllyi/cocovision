// frontend/app/(tabs)/public/acoustic.tsx
// Live acoustic scanner. Records back-to-back ~3 s chunks while you tap the coconut,
// sends each to POST /acoustic/live, and smooths the result over the last 5 tap chunks.
// Needs: npx expo install expo-audio   (plus the plugin in app.json, see instructions)
//
// UI only was redesigned. All recording / upload / smoothing logic is unchanged.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Platform, ScrollView, ActivityIndicator,
  Animated, Easing, Pressable, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import {
  useAudioRecorder, useAudioRecorderState, RecordingPresets,
  requestRecordingPermissionsAsync, setAudioModeAsync,
} from 'expo-audio';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import axios from 'axios';
import { NGROK_URL } from '../../../constants/config';

// ───────────────────────── design tokens (same palette as the classify page) ─────────────────────────
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
  husk: '#8B6A43',
  shell: '#5C3F22',
};
const ND = Platform.OS !== 'web';
const DISPLAY: any = { fontWeight: '900', letterSpacing: -0.5 };

const SOFT_SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 10px 24px rgba(31, 48, 18, 0.18)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 5 };

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

// ───────────────────────── constants (unchanged) ─────────────────────────
const API = `${NGROK_URL}/acoustic`;
const HEADERS = { 'ngrok-skip-browser-warning': 'true' };
const CHUNK_MS = 3000;       // length of each recording slice
const SMOOTH_N = 5;          // tap chunks averaged for the headline result
const TRUST_N = 3;           // tap chunks before the result is considered steady
const STAGES = ['malauhog', 'malakanin'] as const;

const STAGE_INFO: Record<string, { label: string; sub: string; color: string; tint: string; shade: string }> = {
  malauhog: { label: 'Malauhog', sub: 'Young buko, juice stage', color: C.moss, tint: C.leaf, shade: '#A9BF5A' },
  malakanin: { label: 'Malakanin', sub: 'Soft meat stage', color: C.moss, tint: C.leaf, shade: '#5E8A2C' },
};

// Hoisted so the recorder is not recreated on every render.
const REC_OPTIONS = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22050,
  numberOfChannels: 1,
  isMeteringEnabled: true,
};

type ModelKey = 'own_dataset_augmented_model' | 'internet_sourced_model';

function avgProbs(history: any[], key: ModelKey): Record<string, number> | null {
  const rows = history.map((h) => h[key]?.probabilities).filter(Boolean);
  if (!rows.length) return null;
  const out: Record<string, number> = {};
  for (const st of STAGES) out[st] = rows.reduce((s, r) => s + (r[st] ?? 0), 0) / rows.length;
  const total = STAGES.reduce((s, st) => s + out[st], 0) || 1;
  for (const st of STAGES) out[st] /= total;
  return out;
}

function top(p: Record<string, number> | null) {
  if (!p) return null;
  const stage = STAGES.reduce((best, st) => (p[st] > p[best] ? st : best), STAGES[0]);
  return { stage, conf: p[stage] };
}

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

// Step marker for the Hold / Tap / Read tracker.
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

// Sound ripple that spreads outward from the coconut while listening.
function Ripple({ delay = 0, size }: { delay?: number; size: number }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (REDUCE) return;
    const l = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration: 2200, easing: Easing.out(Easing.cubic), useNativeDriver: ND }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  if (REDUCE) return null;
  return (
    <Animated.View pointerEvents="none" style={{
      position: 'absolute', width: size, height: size, borderRadius: size / 2, borderWidth: 4, borderColor: C.lime,
      opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
      transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] }) }],
    }} />
  );
}

// A coconut drawn from plain shapes. It squishes every time a tap is heard.
function Coconut({ size, thump, listening }: { size: number; thump: number; listening: boolean }) {
  const sc = useRef(new Animated.Value(1)).current;
  const sway = useLoop(1600);
  useEffect(() => {
    if (!thump || REDUCE) return;
    Animated.sequence([
      Animated.timing(sc, { toValue: 0.86, duration: 70, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
      Animated.spring(sc, { toValue: 1, friction: 3, tension: 160, useNativeDriver: ND }),
    ]).start();
  }, [thump]);
  const eye = size * 0.13;
  return (
    <Animated.View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: C.husk,
      borderWidth: 5, borderColor: C.shell, alignItems: 'center', justifyContent: 'center',
      transform: [
        { scale: sc },
        ...(listening && !REDUCE
          ? [{ rotate: sway.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] }) }]
          : []),
      ],
    }}>
      {/* husk highlight */}
      <View style={{
        position: 'absolute', top: size * 0.12, left: size * 0.16, width: size * 0.26, height: size * 0.12,
        borderRadius: 20, backgroundColor: 'rgba(245,230,211,0.35)', transform: [{ rotate: '-30deg' }],
      }} />
      {/* the three eyes */}
      <View style={{ position: 'absolute', top: size * 0.3, flexDirection: 'row', gap: eye * 0.55 }}>
        <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: C.shell }} />
        <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: C.shell, marginTop: eye * 0.9 }} />
        <View style={{ width: eye, height: eye, borderRadius: eye / 2, backgroundColor: C.shell }} />
      </View>
    </Animated.View>
  );
}

// Level meter built like a row of leaves of growing height.
function LevelMeter({ level, active }: { level: number; active: boolean }) {
  const N = 14;
  return (
    <View style={s.meterRow} accessibilityLabel="Sound level">
      {Array.from({ length: N }).map((_, i) => {
        const lit = active && (i + 1) / N <= level + 0.04;
        return (
          <View
            key={i}
            style={{
              width: 12, height: 14 + i * 2.6, borderRadius: 6,
              backgroundColor: lit ? (i > N * 0.78 ? '#C9A24A' : C.lime) : C.sand,
            }}
          />
        );
      })}
    </View>
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

// The big percentage bounces whenever the number changes.
function BigNum({ value }: { value: number }) {
  const a = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (REDUCE) return;
    a.setValue(0.85);
    Animated.spring(a, { toValue: 1, friction: 5, tension: 120, useNativeDriver: ND }).start();
  }, [value]);
  return (
    <Animated.Text style={[DISPLAY, { fontSize: 64, lineHeight: 68, color: C.cream, transform: [{ scale: a }] }]}>
      {value}%
    </Animated.Text>
  );
}

// One probability row inside the per-model panel.
function ProbBars({ p }: { p: Record<string, number> }) {
  return (
    <View style={{ gap: 12 }}>
      {STAGES.map((st) => {
        const pct = Math.round((p[st] ?? 0) * 100);
        return (
          <View key={st}>
            <View style={s.barLabelRow}>
              <Text style={s.barLabel}>{STAGE_INFO[st].label}</Text>
              <Text style={s.barLabel}>{pct}%</Text>
            </View>
            <ConfBar pct={pct} color={STAGE_INFO[st].shade} />
          </View>
        );
      })}
    </View>
  );
}

// Row in the "how to tap" guide.
function GuideRow({ icon, title, body, i }: { icon: any; title: string; body: string; i: number }) {
  const size = 50 + i * 6;
  return (
    <View style={s.pathRow}>
      <View style={{ width: 80, alignItems: 'center' }}>
        <View style={{
          width: size, height: size, borderRadius: size / 2, backgroundColor: i === 1 ? C.moss : C.lime,
          alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: C.cream,
        }}>
          <Ionicons name={icon} size={24 + i * 3} color="#fff" />
        </View>
      </View>
      <View style={s.pathCard}>
        <Text style={s.pathName}>{title}</Text>
        <Text style={s.pathHint}>{body}</Text>
      </View>
    </View>
  );
}

// ───────────────────────── screen ─────────────────────────
export default function AcousticScreen() {
  const recorder = useAudioRecorder(REC_OPTIONS);
  const recState = useAudioRecorderState(recorder, 100);

  const [listening, setListening] = useState(false);
  const [permission, setPermission] = useState<boolean | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [last, setLast] = useState<any>(null);
  const [status, setStatus] = useState('Press Start, then tap the coconut.');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [showModels, setShowModels] = useState(false);
  const [thump, setThump] = useState(0);

  const loopId = useRef(0);
  const inFlight = useRef(false);

  // ── upload one chunk ──
  const sendChunk = useCallback(async (uri: string) => {
    if (inFlight.current) return;            // drop chunk if server still busy: keeps latency low
    inFlight.current = true;
    setSending(true);
    try {
      const form = new FormData();
      if (Platform.OS === 'web') {
        const blob = await (await fetch(uri)).blob();
        form.append('file', blob, 'tap.webm');
      } else {
        form.append('file', { uri, name: 'tap.m4a', type: 'audio/m4a' } as any);
      }
      // axios (XHR): Expo's fetch rejects { uri, name, type } parts.
      const res = await axios.post(`${API}/live`, form, {
        headers: { ...HEADERS, 'Content-Type': 'multipart/form-data' },
        transformRequest: (d) => d, validateStatus: () => true, timeout: 20000,
      });
      if (res.status < 200 || res.status >= 300) {
        const d = res.data?.detail;
        throw new Error(typeof d === 'string' ? d : `HTTP ${res.status}`);
      }
      const r = res.data;
      setError('');
      setLast(r);
      if (r.tap_detected) {
        setHistory((h) => [...h, r].slice(-SMOOTH_N));
        setThump((n) => n + 1);
        setStatus(`Tap detected (${r.taps} tap${r.taps === 1 ? '' : 's'}). Keep tapping.`);
      } else {
        setStatus('No tap heard. Tap the coconut near the phone mic.');
      }
    } catch (e: any) {
      setError(e?.message || 'Could not reach the server.');
    } finally {
      inFlight.current = false;
      setSending(false);
    }
  }, []);

  // ── record back-to-back chunks until stopped ──
  const runLoop = useCallback(async (id: number) => {
    while (loopId.current === id) {
      try {
        await recorder.prepareToRecordAsync();
        recorder.record();
        await new Promise((r) => setTimeout(r, CHUNK_MS));
        if (!recorder.isRecording) break;
        await recorder.stop();
        const uri = recorder.uri;
        if (uri) sendChunk(uri);               // not awaited: next chunk starts at once
      } catch (e: any) {
        setError(e?.message || 'Recording failed.');
        break;
      }
    }
    if (loopId.current === id) {
      loopId.current++;
      setListening(false);
    }
  }, [recorder, sendChunk]);

  const start = async () => {
    setError('');
    const perm = await requestRecordingPermissionsAsync();
    setPermission(perm.granted);
    if (!perm.granted) {
      setError('Microphone permission denied. Enable it in Settings.');
      return;
    }
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    setHistory([]);
    setLast(null);
    setThump(0);
    setStatus('Listening... tap the coconut.');
    const id = ++loopId.current;
    setListening(true);
    runLoop(id);
  };

  const stop = useCallback(async () => {
    loopId.current++;
    setListening(false);
    setStatus('Stopped. Press Start to scan again.');
    try { if (recorder.isRecording) await recorder.stop(); } catch {}
    try { await setAudioModeAsync({ allowsRecording: false }); } catch {}
  }, [recorder]);

  // stop when leaving the screen
  useFocusEffect(useCallback(() => () => { stop(); }, [stop]));
  useEffect(() => () => { loopId.current++; }, []);

  // ── derived ──
  const own = avgProbs(history, 'own_dataset_augmented_model');
  const net = avgProbs(history, 'internet_sourced_model');
  const ownTop = top(own);
  const netTop = top(net);
  const headline = ownTop ?? netTop;
  const level = Math.max(0, Math.min(1, ((recState.metering ?? -60) + 60) / 60));

  const headPct = headline ? Math.round(headline.conf * 100) : 0;
  const steady = history.length >= TRUST_N;
  const sureText = !headline ? '' : headPct >= 75 ? 'Very sure' : headPct >= 55 ? 'Fairly sure' : 'Not sure yet';
  const disagree = !!(ownTop && netTop && ownTop.stage !== netTop.stage);

  const stepNow = history.length >= TRUST_N || (!listening && history.length > 0) ? 3 : listening ? 2 : 1;
  const stepState = (n: number): 'done' | 'active' | 'todo' =>
    n < stepNow ? 'done' : n === stepNow ? 'active' : 'todo';

  const dotColor = (h: any) => {
    const t = top(avgProbs([h], 'own_dataset_augmented_model') ?? avgProbs([h], 'internet_sourced_model'));
    return t ? STAGE_INFO[t.stage].shade : C.sand;
  };

  const statusDot = error ? '#B83A2B' : sending ? C.lime : listening ? '#E5503F' : C.moss;

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
            <Pressable
              onPress={() => { stop(); router.replace('/(tabs)'); }}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={[s.backBtn, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
            >
              <Ionicons name="arrow-back" size={26} color={C.cream} />
              <Text style={s.backText}>Back</Text>
            </Pressable>
            <Text style={[DISPLAY, s.title]}>Tap and listen</Text>
            <Text style={s.subtitle}>Knock on the coconut. Its sound tells how ripe it is.</Text>
          </View>
        </View>

        {/* three steps */}
        <View style={[s.wrap, s.stepsCard]}>
          <StepNode icon="hand-left" label="Hold" state={stepState(1)} />
          <StepLink on={stepNow > 1} />
          <StepNode icon="ear" label="Tap" state={stepState(2)} />
          <StepLink on={stepNow > 2} />
          <StepNode icon="eye" label="Read" state={stepState(3)} />
        </View>

        {/* the stage: coconut + ripples + controls */}
        <View style={[s.wrap, { marginTop: 22 }]}>
          <View style={[s.stageShadow, SOFT_SHADOW]}>
            <View style={s.stageBox}>
              <View style={s.coconutArea}>
                {listening && <Ripple size={150} />}
                {listening && <Ripple size={150} delay={1100} />}
                <Coconut size={150} thump={thump} listening={listening} />
              </View>

              <LevelMeter level={level} active={listening} />

              {/* the five slots: one fills for every tap chunk heard */}
              <View style={s.slotsRow} accessibilityLabel={`${history.length} of ${SMOOTH_N} tap readings collected`}>
                {Array.from({ length: SMOOTH_N }).map((_, i) => {
                  const h = history[i];
                  return (
                    <View
                      key={i}
                      style={[
                        s.slot,
                        h
                          ? { backgroundColor: dotColor(h), borderColor: C.cream }
                          : { backgroundColor: 'transparent', borderColor: 'rgba(245,230,211,0.35)' },
                      ]}
                    >
                      {h && <Ionicons name="checkmark" size={18} color={C.forest} />}
                    </View>
                  );
                })}
              </View>
              <Text style={s.slotCaption}>
                {steady
                  ? 'Steady reading. You can trust the result.'
                  : `Collect ${TRUST_N} readings for a steady result (${history.length} so far).`}
              </Text>
            </View>
          </View>

          {/* status line */}
          <View style={s.statusRow}>
            {sending
              ? <ActivityIndicator size="small" color={C.moss} />
              : <View style={[s.statusDot, { backgroundColor: statusDot }]} />}
            <Text style={s.statusText}>{status}</Text>
          </View>

          <PressBtn
            big
            tone={listening ? 'danger' : 'primary'}
            icon={listening ? 'stop-circle' : 'mic'}
            label={listening ? 'Stop listening' : 'Start listening'}
            onPress={listening ? stop : start}
            radius={26}
            style={{ marginTop: 10 }}
          />
        </View>

        {!!error && (
          <Pop style={[s.wrap, { marginTop: 16 }]}>
            <View style={s.errorBox}>
              <Ionicons name="warning" size={24} color="#9A1B12" />
              <Text style={s.errorText}>{error}</Text>
            </View>
          </Pop>
        )}
        {permission === false && !error && (
          <Pop style={[s.wrap, { marginTop: 16 }]}>
            <View style={s.errorBox}>
              <Ionicons name="mic-off" size={24} color="#9A1B12" />
              <Text style={s.errorText}>Microphone is blocked for this app. Allow it in Settings.</Text>
            </View>
          </Pop>
        )}

        {/* result */}
        <View style={[s.wrap, { marginTop: 30 }]}>
          {!headline ? (
            <View style={s.waitCard}>
              <View style={s.waitIcon}>
                <Ionicons name="hand-left" size={30} color={C.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.waitTitle}>Waiting for your taps</Text>
                <Text style={s.waitBody}>
                  Knock on the coconut 2 to 3 times, about once every second.
                </Text>
              </View>
            </View>
          ) : (
            <Pop>
              <View style={s.resultCard}>
                <Text style={s.resultKicker}>This coconut sounds like</Text>
                <Text style={[DISPLAY, s.resultStage]}>{STAGE_INFO[headline.stage].label}</Text>
                <Text style={s.resultSub}>{STAGE_INFO[headline.stage].sub}</Text>

                <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, marginTop: 14 }}>
                  <BigNum value={headPct} />
                  <Text style={[DISPLAY, { color: C.leaf, fontSize: 22, lineHeight: 28, paddingBottom: 8, flex: 1 }]}>
                    {sureText}
                  </Text>
                </View>
                <View style={s.resultTrack}>
                  <View style={[s.resultFill, { width: `${headPct}%`, backgroundColor: STAGE_INFO[headline.stage].shade }]} />
                </View>

                <Text style={s.resultMeta}>
                  Based on the last {history.length} reading{history.length === 1 ? '' : 's'}. More taps give a steadier answer.
                </Text>
              </View>
            </Pop>
          )}
        </View>

        {/* per model, opens on tap */}
        {(own || net) && (
          <View style={[s.wrap, { marginTop: 16 }]}>
            <Pressable
              onPress={() => setShowModels((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: showModels }}
              accessibilityLabel="See how each model voted"
              style={[s.modelHead, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
            >
              <View style={s.modelIcon}>
                <Ionicons name="analytics" size={24} color={C.ink} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.rowTitle}>How each model voted</Text>
                <Text style={s.rowHint}>{showModels ? 'Tap to close' : 'Tap to see the details'}</Text>
              </View>
              <Ionicons name={showModels ? 'chevron-up' : 'chevron-down'} size={26} color={C.ink} />
            </Pressable>

            {showModels && (
              <Pop style={{ gap: 12, marginTop: 12 }}>
                {own && ownTop && (
                  <View style={s.modelBox}>
                    <Text style={s.modelName}>Our own recordings</Text>
                    <ProbBars p={own} />
                  </View>
                )}
                {net && netTop && (
                  <View style={s.modelBox}>
                    <Text style={s.modelName}>Internet recordings</Text>
                    <ProbBars p={net} />
                    <Text style={s.meta}>
                      This one listens to the raw sound, so it reacts more to the exact timing of each tap.
                    </Text>
                  </View>
                )}
                {disagree && (
                  <View style={s.warnPill}>
                    <Ionicons name="alert-circle" size={22} color="#8A4B08" />
                    <Text style={s.rowWarn}>The two models disagree. Tap a few more times in a quieter spot.</Text>
                  </View>
                )}
              </Pop>
            )}
          </View>
        )}

        {/* last chunk */}
        {last && (
          <View style={[s.wrap, { marginTop: 26 }]}>
            <Text style={s.listHint}>Last reading</Text>
            <View style={s.statGrid}>
              <View style={s.stat}>
                <Ionicons name="hand-left" size={22} color={C.moss} />
                <Text style={s.statVal}>{last.tap_detected ? last.taps : 0}</Text>
                <Text style={s.statLabel}>taps heard</Text>
              </View>
              <View style={s.stat}>
                <Ionicons name="volume-high" size={22} color={C.moss} />
                <Text style={s.statVal}>{last.rms_db}</Text>
                <Text style={s.statLabel}>loudness (dB)</Text>
              </View>
              <View style={s.stat}>
                <Ionicons name="musical-notes" size={22} color={C.moss} />
                <Text style={s.statVal}>{Math.round(last.metrics?.dominant_frequency_hz ?? 0)}</Text>
                <Text style={s.statLabel}>pitch (Hz)</Text>
              </View>
              <View style={s.stat}>
                <Ionicons name="timer" size={22} color={C.moss} />
                <Text style={s.statVal}>{last.ms}</Text>
                <Text style={s.statLabel}>check time (ms)</Text>
              </View>
            </View>
          </View>
        )}

        {/* guide */}
        <View style={[s.wrap, { marginTop: 40 }]}>
          <Text style={[DISPLAY, s.sectionTitle]}>For a good reading</Text>
          <Text style={s.sectionSub}>Three small habits make the result much better.</Text>
          <View style={s.path}>
            <View style={s.pathLine} />
            <GuideRow i={0} icon="volume-mute" title="Find a quiet spot" body="Hold the coconut in one hand, with the phone mic close by." />
            <GuideRow i={1} icon="hand-left" title="Knock the same place" body="Use a knuckle at a slow, steady pace, about one tap a second." />
            <GuideRow i={2} icon="time" title="Wait for 3 readings" body="Watch the circles fill. Three or more means a steady answer." />
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
    width: '100%', height: 224, backgroundColor: C.forest, overflow: 'hidden',
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
  heroText: { paddingHorizontal: 18, paddingTop: 10, maxWidth: 520 },
  backBtn: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48,
    paddingHorizontal: 14, borderRadius: 24, backgroundColor: 'rgba(245,230,211,0.16)', marginBottom: 8,
  },
  backText: { color: C.cream, fontSize: 17, fontWeight: '800' },
  title: { fontSize: 34, lineHeight: 38, color: C.cream, paddingHorizontal: 4 },
  subtitle: { fontSize: 18, lineHeight: 26, color: C.leaf, fontWeight: '600', marginTop: 4, paddingHorizontal: 4 },

  stepsCard: {
    marginTop: -48, zIndex: 2, backgroundColor: C.paper, borderRadius: 28, paddingHorizontal: 10, paddingTop: 12, paddingBottom: 14,
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center',
    borderWidth: 2, borderColor: C.sand,
  },

  stageShadow: {
    borderTopLeftRadius: 44, borderTopRightRadius: 16, borderBottomRightRadius: 44, borderBottomLeftRadius: 16,
    backgroundColor: C.forest,
  },
  stageBox: {
    backgroundColor: C.forest, overflow: 'hidden', alignItems: 'center', paddingTop: 34, paddingBottom: 24, paddingHorizontal: 18,
    borderTopLeftRadius: 44, borderTopRightRadius: 16, borderBottomRightRadius: 44, borderBottomLeftRadius: 16,
    borderWidth: 4, borderColor: C.hill,
  },
  coconutArea: { width: 290, height: 190, alignItems: 'center', justifyContent: 'center' },
  meterRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, height: 54, marginTop: 6 },
  slotsRow: { flexDirection: 'row', gap: 12, marginTop: 20 },
  slot: {
    width: 38, height: 38, borderRadius: 19, borderWidth: 3, alignItems: 'center', justifyContent: 'center',
  },
  slotCaption: { color: C.leaf, fontSize: 16, lineHeight: 23, fontWeight: '700', marginTop: 14, textAlign: 'center' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingHorizontal: 6, minHeight: 32 },
  statusDot: { width: 14, height: 14, borderRadius: 7 },
  statusText: { flex: 1, fontSize: 17, fontWeight: '800', color: C.ink },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FDE7E4', borderWidth: 2, borderColor: '#F3B7B0', borderRadius: 18, padding: 14,
  },
  errorText: { flex: 1, color: '#9A1B12', fontSize: 17, fontWeight: '700', lineHeight: 23 },

  waitCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.paper,
    borderWidth: 2, borderColor: C.sand, borderRadius: 24, padding: 18,
  },
  waitIcon: { width: 60, height: 60, borderRadius: 30, backgroundColor: C.leaf, alignItems: 'center', justifyContent: 'center' },
  waitTitle: { fontSize: 22, lineHeight: 26, fontWeight: '900', color: C.ink },
  waitBody: { fontSize: 17, lineHeight: 24, fontWeight: '600', color: C.body, marginTop: 2 },

  resultCard: {
    backgroundColor: C.forest, padding: 22,
    borderTopLeftRadius: 14, borderTopRightRadius: 40, borderBottomRightRadius: 14, borderBottomLeftRadius: 40,
  },
  resultKicker: { color: C.leaf, fontSize: 17, fontWeight: '700' },
  resultStage: { color: C.cream, fontSize: 40, lineHeight: 46, marginTop: 2 },
  resultSub: { color: C.leaf, fontSize: 18, lineHeight: 25, fontWeight: '600' },
  resultTrack: { height: 16, borderRadius: 8, backgroundColor: 'rgba(245,230,211,0.18)', overflow: 'hidden', marginTop: 4 },
  resultFill: { height: 16, borderRadius: 8 },
  resultMeta: { color: C.leaf, fontSize: 16, lineHeight: 23, fontWeight: '600', marginTop: 14 },

  modelHead: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.leaf,
    borderRadius: 22, padding: 16, borderWidth: 3, borderColor: 'transparent',
  },
  modelIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.paper, alignItems: 'center', justifyContent: 'center' },
  modelBox: { backgroundColor: C.paper, borderRadius: 20, padding: 16, gap: 12, borderWidth: 2, borderColor: C.sand },
  modelName: { fontSize: 20, fontWeight: '900', color: C.ink },
  meta: { fontSize: 16, color: C.body, lineHeight: 23, fontWeight: '600' },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { fontSize: 17, color: C.ink, fontWeight: '800' },
  barTrack: { height: 12, borderRadius: 6, backgroundColor: 'rgba(31,48,18,0.12)', marginTop: 6, overflow: 'hidden' },
  barFill: { height: 12, borderRadius: 6 },

  rowTitle: { fontSize: 22, lineHeight: 26, fontWeight: '900', color: C.ink },
  rowHint: { fontSize: 16, fontWeight: '600', color: C.body, marginTop: 1 },
  warnPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F8DFAE', borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 10,
  },
  rowWarn: { fontSize: 16, color: '#6E3A05', fontWeight: '800', flexShrink: 1 },

  listHint: { fontSize: 20, color: C.forest, fontWeight: '900', marginBottom: 12 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  stat: {
    flexBasis: '47%', flexGrow: 1, backgroundColor: C.paper, borderRadius: 20, borderWidth: 2, borderColor: C.sand,
    paddingVertical: 14, paddingHorizontal: 14, gap: 2,
  },
  statVal: { fontSize: 28, lineHeight: 32, fontWeight: '900', color: C.ink },
  statLabel: { fontSize: 16, color: C.body, fontWeight: '700' },

  sectionTitle: { fontSize: 30, lineHeight: 34, color: C.forest },
  sectionSub: { fontSize: 17, lineHeight: 24, color: C.body, fontWeight: '600', marginTop: 4 },
  path: { marginTop: 20, position: 'relative' },
  pathLine: {
    position: 'absolute', left: 38, top: 30, bottom: 30, width: 4, borderRadius: 2, backgroundColor: C.sand,
  },
  pathRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  pathCard: {
    flex: 1, borderRadius: 18, borderLeftWidth: 8, borderLeftColor: C.moss, backgroundColor: C.leaf,
    paddingHorizontal: 16, paddingVertical: 14, minHeight: 76, justifyContent: 'center',
  },
  pathName: { fontSize: 22, lineHeight: 26, fontWeight: '900', color: C.ink },
  pathHint: { fontSize: 16, lineHeight: 22, color: C.body, fontWeight: '600', marginTop: 2 },
});