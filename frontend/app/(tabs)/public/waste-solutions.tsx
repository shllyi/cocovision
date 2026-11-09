// frontend/app/(tabs)/public/waste-solutions.tsx
// Coconut waste products catalogue + AI discovery. Backend mounted at /wasteproduct:
//   GET    /wasteproduct/all
//   POST   /wasteproduct/discover  { query, category }  -> { results[{product,explanation,tip}], ai_suggestions[], ai_powered }
//   POST   /wasteproduct/create    multipart (admin): name, description, category, price, unit, user_id, image?
//   PUT    /wasteproduct/{id}      multipart (admin): same fields, Authorization: Bearer <user_id>
//   DELETE /wasteproduct/{id}      Authorization: Bearer <user_id>

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, ScrollView, Image,
  ActivityIndicator, RefreshControl, Modal, Alert, KeyboardAvoidingView, Animated, Easing,
  Pressable, useWindowDimensions, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import axios from 'axios';
import { NGROK_URL } from '../../../constants/config';
import { authHeaders } from '../../../constants/session';

/* ════════════════════════════════════════════════════════════════════════════
   BACKEND (unchanged)
   ════════════════════════════════════════════════════════════════════════════ */
const API = `${NGROK_URL}/wasteproduct`;
const HEADERS = { 'ngrok-skip-browser-warning': 'true' };
const CATEGORIES = ['Husk', 'Shell', 'Leaves'];

async function getSession(): Promise<any | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function errorText(data: any, status: number): string {
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((e: any) => e?.msg || 'Invalid input').join(', ');
  if (d?.message) {
    const missing = Array.isArray(d.missing) && d.missing.length ? ` (${d.missing.join(', ')})` : '';
    return `${d.message}${missing}`;
  }
  return `HTTP ${status}`;
}

const peso = (n: any, unit?: string | null) =>
  typeof n === 'number' && n > 0 ? `₱${n.toFixed(2)}${unit ? ` ${unit}` : ''}` : 'Price not set';

/* ════════════════════════════════════════════════════════════════════════════
   DESIGN TOKENS – same Green Houze palette as the home feed.
   Big type, high contrast, 48px+ tap targets, gentle motion that respects
   "reduce motion".
   ════════════════════════════════════════════════════════════════════════════ */
const C = {
  forest: '#2F4A1E', moss: '#46652A', hill: '#3A5A22', lime: '#8A9F27', cream: '#F5E6D3', paper: '#FBF4EA',
  ink: '#1F3012', leaf: '#DDE5B5', sand: '#EBD7BC', body: '#4A5A3C', bark: '#6B4A2B',
};
const ND = Platform.OS !== 'web';
const FONT_DISPLAY: string | undefined = undefined; // same chunky font hook as the feed
const DISPLAY: any = { fontFamily: FONT_DISPLAY, fontWeight: '900', letterSpacing: -0.5 };

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

const ORGANIC = [
  { borderTopLeftRadius: 38, borderTopRightRadius: 14, borderBottomRightRadius: 38, borderBottomLeftRadius: 14 },
  { borderTopLeftRadius: 14, borderTopRightRadius: 38, borderBottomRightRadius: 14, borderBottomLeftRadius: 38 },
  { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderBottomRightRadius: 12, borderBottomLeftRadius: 28 },
];

// each kind of waste has its own colour, icon and a plain-words hint
const KIND: Record<string, { bg: string; fg: string; icon: any; hint: string }> = {
  Husk: { bg: C.sand, fg: C.bark, icon: 'layers', hint: 'Fiber, coir' },
  Shell: { bg: C.forest, fg: C.cream, icon: 'ellipse', hint: 'Charcoal and crafts' },
  Leaves: { bg: C.leaf, fg: C.moss, icon: 'leaf', hint: 'Weaving' },
};
const kindOf = (c: string) => {
  const v = (c || '').toLowerCase();
  if (v.includes('husk')) return KIND.Husk;
  if (v.includes('shell')) return KIND.Shell;
  if (v.includes('leaf') || v.includes('leaves')) return KIND.Leaves;
  return { bg: C.paper, fg: C.ink, icon: 'cube', hint: '' };
};

const EXAMPLES = ['Coconut husk', 'Shell charcoal', 'Leaves for weaving'];

function Txt({ size = 16, style, children, ...rest }: any) {
  return <Text {...rest} style={[{ fontSize: size, lineHeight: Math.round(size * 1.38) }, style]}>{children}</Text>;
}

/* ════════════════════════════════════════════════════════════════════════════
   ANIMATION HELPERS
   ════════════════════════════════════════════════════════════════════════════ */
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

function Pop({ index = 0, children, style }: any) {
  const a = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    Animated.spring(a, { toValue: 1, delay: Math.min(index, 8) * 70, friction: 8, tension: 60, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: a,
      transform: [
        { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) },
        { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
    }]}>
      {children}
    </Animated.View>
  );
}

const SOFT_SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 12px 28px rgba(31, 48, 18, 0.16), 0 2px 6px rgba(31, 48, 18, 0.08)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 };

/* Surface – soft organic shape, lifts on hover, sinks on press */
function Surface({ onPress, bg = C.paper, radius = 18, style, innerStyle, children, disabled = false, isStatic = false, label }: any) {
  const h = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.spring(h, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();
  const rad = typeof radius === 'number' ? { borderRadius: radius } : radius;
  const body = [{ backgroundColor: bg }, rad, SOFT_SHADOW];
  const clip = [rad, { overflow: 'hidden' as const }, innerStyle];
  if (isStatic) return <View style={style}><View style={body}><View style={clip}>{children}</View></View></View>;
  return (
    <View style={[style, disabled && { opacity: 0.4 }]}>
      <Pressable
        disabled={disabled} onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
        onPressIn={() => to(-1)} onPressOut={() => to(0)} onHoverIn={() => to(1)} onHoverOut={() => to(0)}
        style={Platform.OS === 'web' ? ({ cursor: onPress ? 'pointer' : 'default' } as any) : undefined}
      >
        <Animated.View style={[body, { transform: [
          { translateY: h.interpolate({ inputRange: [-1, 0, 1], outputRange: [0, 0, -4] }) },
          { scale: h.interpolate({ inputRange: [-1, 0, 1], outputRange: [0.98, 1, 1.01] }) },
        ] }]}>
          <View style={clip}>{children}</View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   DECOR
   ════════════════════════════════════════════════════════════════════════════ */
function Vine({ color = C.lime }: { color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
      <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: color }} />
      <Ionicons name="leaf" size={16} color={color} style={{ marginLeft: 4, transform: [{ rotate: '-20deg' }] }} />
      <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: color, marginLeft: 4, opacity: 0.6 }} />
    </View>
  );
}

function FloatingLeaf({ style, size = 30, color = C.lime, delay = 0, tilt = 12, opacity = 1 }: any) {
  const v = useLoop(2800, delay);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', opacity }, style, {
      transform: [
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: [`${-tilt}deg`, `${tilt}deg`] }) },
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) },
      ],
    }]}>
      <Ionicons name="leaf" size={size} color={color} />
    </Animated.View>
  );
}

function SectionHead({ title, sub, color = C.forest, subColor = C.body, vine = C.lime, right, size = 30 }: any) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 18, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Txt size={size} style={[DISPLAY, { color }]}>{title}</Txt>
        {sub ? <Txt size={16} style={{ color: subColor, fontWeight: '600', marginTop: 4 }}>{sub}</Txt> : null}
        <Vine color={vine} />
      </View>
      {right}
    </View>
  );
}

/* A coconut drawn from shapes, with fronds fanning out behind it. Sways gently. */
function CoconutArt({ size = 110, style }: any) {
  const v = useLoop(2600);
  const frond = (deg: number, color: string, top: number, left: number, sz: number, op = 1) => (
    <View style={{ position: 'absolute', top, left, opacity: op, transform: [{ rotate: `${deg}deg` }] }}>
      <Ionicons name="leaf" size={sz} color={color} />
    </View>
  );
  return (
    <Animated.View pointerEvents="none" style={[{ width: size * 1.7, height: size * 1.5 }, style, {
      transform: [
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] }) },
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
      ],
    }]}>
      {frond(-70, C.moss, size * 0.1, 0, size * 0.8, 0.9)}
      {frond(25, C.moss, size * 0.0, size * 0.95, size * 0.8, 0.9)}
      {frond(-20, C.lime, -size * 0.05, size * 0.45, size * 0.7, 0.85)}
      <View style={{
        position: 'absolute', bottom: 0, left: size * 0.38, width: size, height: size, borderRadius: size / 2,
        backgroundColor: C.sand, borderWidth: size * 0.06, borderColor: C.bark, alignItems: 'center', justifyContent: 'center',
      }}>
        <View style={{ flexDirection: 'row', gap: size * 0.07, marginTop: -size * 0.12 }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={{ width: size * 0.12, height: size * 0.15, borderRadius: size * 0.07, backgroundColor: C.ink, marginTop: i === 1 ? size * 0.08 : 0 }} />
          ))}
        </View>
      </View>
    </Animated.View>
  );
}

/* Loading placeholder – same footprint as a product card */
function Skeleton({ height = 280, radius, style }: any) {
  const v = useLoop(900);
  return (
    <Animated.View style={[{ height, backgroundColor: C.leaf, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0.9] }) }, radius, style]}>
      <View style={{ position: 'absolute', left: 16, right: 16, bottom: 16, gap: 10 }}>
        <View style={{ height: 18, width: '60%', borderRadius: 9, backgroundColor: C.paper, opacity: 0.8 }} />
        <View style={{ height: 12, width: '90%', borderRadius: 6, backgroundColor: C.paper, opacity: 0.6 }} />
      </View>
    </Animated.View>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   KIND TILE – big tappable category with its own colour and icon
   ════════════════════════════════════════════════════════════════════════════ */
function KindTile({ name, active, count, onPress, radius }: any) {
  const k = name === 'All' ? { bg: C.lime, fg: C.ink, icon: 'apps', hint: 'Every kind of waste' } : (KIND as any)[name];
  const wob = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!active || REDUCE) return;
    wob.setValue(0);
    Animated.spring(wob, { toValue: 1, friction: 3, tension: 120, useNativeDriver: ND }).start();
  }, [active]);
  const iconOn = name === 'Shell' ? C.cream : C.ink;
  return (
    <Surface onPress={onPress} bg={active ? k.bg : C.paper} radius={radius} label={`Show ${name}`}
      style={{ flexGrow: 1, flexBasis: 150 }} innerStyle={{ padding: 16, minHeight: 128 }}>
      <View pointerEvents="none" style={{ position: 'absolute', right: -10, bottom: -14, opacity: active ? 0.2 : 0.1 }}>
        <Ionicons name={k.icon} size={96} color={active ? k.fg : C.moss} />
      </View>
      <Animated.View style={{
        width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? 'rgba(255,255,255,0.28)' : k.bg,
        transform: [{ rotate: wob.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) }, { scale: wob.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
      }}>
        <Ionicons name={k.icon} size={25} color={active ? k.fg : iconOn} />
      </Animated.View>
      <Txt size={20} style={[DISPLAY, { color: active ? k.fg : C.ink, marginTop: 10 }]}>{name}</Txt>
      <Txt size={14} style={{ color: active ? k.fg : C.body, fontWeight: '600', opacity: 0.92 }}>{k.hint}</Txt>
      <View style={[s.countPill, { backgroundColor: active ? 'rgba(255,255,255,0.32)' : C.leaf }]}>
        <Txt size={14} style={{ fontWeight: '900', color: active ? k.fg : C.ink }}>{count}</Txt>
      </View>
    </Surface>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   PRODUCT CARD – tap to open. The first card can run wide, photo beside text.
   ════════════════════════════════════════════════════════════════════════════ */
function ProductCard({ p, index = 0, featured, horizontal, isAdmin, onEdit, onDelete, extra, width }: {
  p: any; index?: number; featured?: boolean; horizontal?: boolean; isAdmin?: boolean; onEdit?: () => void;
  onDelete?: () => void; extra?: React.ReactNode; width?: number | string;
}) {
  const [open, setOpen] = useState(false);
  const turn = useRef(new Animated.Value(0)).current;
  const toggle = () => {
    setOpen((o) => !o);
    Animated.spring(turn, { toValue: open ? 0 : 1, friction: 7, useNativeDriver: ND }).start();
  };
  const k = kindOf(p.category);
  const big = featured || horizontal;
  const imgH = featured ? 230 : 160;

  const photo = (
    <View style={horizontal ? { width: '42%', minHeight: 300 } : undefined}>
      {p.image_url ? (
        <Image source={{ uri: p.image_url }} style={horizontal ? { width: '100%', height: '100%', position: 'absolute' } : { width: '100%', height: imgH }} resizeMode="cover" />
      ) : (
        <View style={[horizontal ? { flex: 1 } : { width: '100%', height: imgH }, { backgroundColor: k.bg, alignItems: 'center', justifyContent: 'center' }]}>
          <Ionicons name={k.icon} size={big ? 72 : 48} color={k.fg} style={{ opacity: 0.5 }} />
        </View>
      )}
      <View style={[s.kindFlag, { backgroundColor: k.bg }]}>
        <Ionicons name={k.icon} size={16} color={k.fg} />
        <Txt size={14} style={{ fontWeight: '900', color: k.fg }}>{p.category}</Txt>
      </View>
      <View style={s.priceTag}>
        <Txt size={big ? 19 : 17} style={[DISPLAY, { color: C.ink }]}>{peso(p.price, p.unit)}</Txt>
      </View>
    </View>
  );

  return (
    <Pop index={index} style={{ width: width as any }}>
      <Surface onPress={toggle} bg={C.paper} radius={ORGANIC[index % 3]} label={`${p.name}. Tap to ${open ? 'close' : 'open'} details`}
        innerStyle={horizontal ? { flexDirection: 'row' } : undefined}>
        {photo}
        <View style={[{ padding: 18, gap: 6 }, horizontal && { flex: 1, justifyContent: 'center', padding: 26 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Txt size={big ? 26 : 21} style={[DISPLAY, { color: C.ink, flex: 1 }]} numberOfLines={open ? 4 : 2}>{p.name}</Txt>
            <Animated.View style={{ transform: [{ rotate: turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
              <Ionicons name="chevron-down-circle" size={32} color={C.moss} />
            </Animated.View>
          </View>
          <Txt size={17} style={{ color: C.body, fontWeight: '500' }} numberOfLines={open ? undefined : 3}>{p.description}</Txt>
          {!open && <Txt size={15} style={{ color: C.moss, fontWeight: '800', marginTop: 2 }}>Tap to read more</Txt>}
          {extra}
          {isAdmin && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
              <TouchableOpacity style={s.smallBtn} onPress={onEdit} activeOpacity={0.8} accessibilityLabel={`Edit ${p.name}`}>
                <Ionicons name="create-outline" size={20} color={C.forest} />
                <Txt size={15} style={{ fontWeight: '800', color: C.forest }}>Edit</Txt>
              </TouchableOpacity>
              <TouchableOpacity style={[s.smallBtn, { borderColor: '#e9b4a6' }]} onPress={onDelete} activeOpacity={0.8} accessibilityLabel={`Delete ${p.name}`}>
                <Ionicons name="trash-outline" size={20} color="#a63a1f" />
                <Txt size={15} style={{ fontWeight: '800', color: '#a63a1f' }}>Delete</Txt>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </Surface>
    </Pop>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   IDEA CARD – a new product idea. Steps unfold when you open it.
   ════════════════════════════════════════════════════════════════════════════ */
function IdeaCard({ sg, index }: { sg: any; index: number }) {
  const [open, setOpen] = useState(index === 0);
  return (
    <Pop index={index}>
      <Surface onPress={() => setOpen((o) => !o)} bg={C.forest} radius={ORGANIC[(index + 1) % 3]} label={`Idea: ${sg.name}`}
        innerStyle={{ padding: 20 }}>
        <FloatingLeaf style={{ top: 10, right: 12 }} size={54} color={C.moss} opacity={0.7} tilt={6} delay={index * 300} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingRight: 50 }}>
          <View style={s.ideaIcon}><Ionicons name="bulb" size={24} color={C.ink} /></View>
          <View style={{ flex: 1 }}>
            <Txt size={21} style={[DISPLAY, { color: C.cream }]}>{sg.name}</Txt>
            {!!sg.category && <Txt size={15} style={{ color: C.leaf, fontWeight: '700' }}>Made from {String(sg.category).toLowerCase()}</Txt>}
          </View>
        </View>
        <Txt size={17} style={{ color: C.cream, opacity: 0.95, marginTop: 12, fontWeight: '500' }} numberOfLines={open ? undefined : 2}>{sg.description}</Txt>

        {open ? (
          <View style={{ marginTop: 16, gap: 16 }}>
            {(sg.materials || []).length > 0 && (
              <View>
                <Txt size={16} style={{ color: C.lime, fontWeight: '900', marginBottom: 8 }}>What you need</Txt>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {sg.materials.map((m: string, j: number) => (
                    <View key={j} style={s.matChip}><Txt size={15} style={{ color: C.ink, fontWeight: '700' }}>{m}</Txt></View>
                  ))}
                </View>
              </View>
            )}
            {(sg.steps || []).length > 0 && (
              <View>
                <Txt size={16} style={{ color: C.lime, fontWeight: '900', marginBottom: 10 }}>How to make it</Txt>
                {sg.steps.map((st: string, j: number, arr: string[]) => (
                  <View key={j} style={{ flexDirection: 'row', gap: 12 }}>
                    <View style={{ alignItems: 'center' }}>
                      <View style={s.stepDot}><Txt size={16} style={[DISPLAY, { color: C.ink }]}>{j + 1}</Txt></View>
                      {j < arr.length - 1 && <View style={{ width: 3, flex: 1, minHeight: 12, backgroundColor: C.moss, marginVertical: 2, borderRadius: 2 }} />}
                    </View>
                    <Txt size={17} style={{ color: C.cream, flex: 1, paddingBottom: 14, fontWeight: '500' }}>{st}</Txt>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : (
          <View style={s.openHint}>
            <Txt size={16} style={{ fontWeight: '900', color: C.ink }}>See how to make it</Txt>
            <Ionicons name="chevron-down" size={18} color={C.ink} />
          </View>
        )}
      </Surface>
    </Pop>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   SCREEN
   ════════════════════════════════════════════════════════════════════════════ */
export default function WasteSolutionsScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const maxW = 1000;
  const bodyW = Math.min(width * 0.92, maxW);
  const cols = width >= 760 ? 2 : 1;
  const gap = 16;
  const cardW = Math.floor((bodyW - gap * (cols - 1)) / cols);

  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('All');
  const [focused, setFocused] = useState(false);

  const [ai, setAi] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const [session, setSession] = useState<any>(null);
  const isAdmin = session?.role === 'admin';
  const uid = session ? String(session.id ?? session._id ?? session.user_id ?? '') : '';

  const [showTop, setShowTop] = useState(false);
  const showTopRef = useRef(false);

  // admin form
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [fName, setFName] = useState('');
  const [fDesc, setFDesc] = useState('');
  const [fCat, setFCat] = useState('Husk');
  const [fPrice, setFPrice] = useState('');
  const [fUnit, setFUnit] = useState('');
  const [fImage, setFImage] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const scrollRef = useRef<ScrollView | null>(null);
  const aiY = useRef(0);
  const sparkle = useLoop(1000);

  const load = useCallback(async () => {
    setError('');
    try {
      setSession(await getSession());
      const res = await fetch(`${API}/all`, { headers: HEADERS });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }
      if (!res.ok || !Array.isArray(data)) throw new Error('Could not load products.');
      setProducts(data);
    } catch (e: any) {
      setError(e?.message || 'Could not load products.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const q = query.trim().toLowerCase();
  const filtered = products.filter((p) => {
    const catOk = category === 'All' || String(p.category || '').toLowerCase().includes(category.toLowerCase());
    const textOk = !q || `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(q);
    return catOk && textOk;
  });
  const countOf = (c: string) => c === 'All' ? products.length
    : products.filter((p) => String(p.category || '').toLowerCase().includes(c.toLowerCase())).length;

  const discover = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiError('');
    try {
      const res = await axios.post(`${API}/discover`, {
        query: query.trim(),
        category: category === 'All' ? null : category,
      }, { headers: HEADERS, validateStatus: () => true, timeout: 90000 });
      if (res.status < 200 || res.status >= 300) throw new Error(errorText(res.data, res.status));
      setAi(res.data);
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, aiY.current - 12), animated: true }), 120);
    } catch (e: any) {
      setAiError(e?.message || 'AI discovery failed.');
    } finally {
      setAiLoading(false);
    }
  };

  // ── admin actions ──
  const openCreate = () => {
    setEditing(null); setFName(''); setFDesc(''); setFCat('Husk'); setFPrice(''); setFUnit('');
    setFImage(null); setFormError(''); setFormOpen(true);
  };
  const openEdit = (p: any) => {
    setEditing(p); setFName(p.name || ''); setFDesc(p.description || ''); setFCat(p.category || 'Husk');
    setFPrice(typeof p.price === 'number' ? String(p.price) : ''); setFUnit(p.unit || '');
    setFImage(null); setFormError(''); setFormOpen(true);
  };
  const pickImage = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled) setFImage(res.assets[0]);
  };

  const submitForm = async () => {
    if (saving) return;
    if (!fName.trim() || !fDesc.trim() || !fCat || fPrice.trim() === '' || isNaN(Number(fPrice))) {
      setFormError('Name, description, category and a valid price are required.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const form = new FormData();
      form.append('name', fName.trim());
      form.append('description', fDesc.trim());
      form.append('category', fCat);
      form.append('price', String(Number(fPrice)));
      form.append('unit', fUnit.trim());
      if (!editing) form.append('user_id', uid);
      if (fImage) {
        const name = fImage.fileName || 'product.jpg';
        const type = fImage.mimeType || 'image/jpeg';
        if (Platform.OS === 'web') {
          const blob = await (await fetch(fImage.uri)).blob();
          form.append('image', blob, name);
        } else {
          form.append('image', { uri: fImage.uri, name, type } as any);
        }
      }
      // axios (XHR): Expo's fetch rejects { uri, name, type } parts.
      const cfg = {
        headers: { ...HEADERS, 'Content-Type': 'multipart/form-data', ...(await authHeaders()) },
        transformRequest: (d: any) => d, validateStatus: () => true, timeout: 60000,
      };
      const res = editing
        ? await axios.put(`${API}/${editing._id}`, form, cfg)
        : await axios.post(`${API}/create`, form, cfg);
      if (res.status < 200 || res.status >= 300) throw new Error(errorText(res.data, res.status));
      setFormOpen(false);
      load();
    } catch (e: any) {
      setFormError(e?.message || 'Could not save product.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (p: any) => {
    const run = async () => {
      try {
        const res = await axios.delete(`${API}/${p._id}`, {
          headers: { ...HEADERS, ...(await authHeaders()) }, validateStatus: () => true,
        });
        if (res.status < 200 || res.status >= 300) throw new Error(errorText(res.data, res.status));
        setProducts((prev) => prev.filter((x) => x._id !== p._id));
        setAi((a: any) => a ? { ...a, results: (a.results || []).filter((r: any) => r.product?._id !== p._id) } : a);
      } catch (e: any) {
        Alert.alert('Delete failed', e?.message || 'Could not delete product.');
      }
    };
    if (Platform.OS === 'web') { run(); return; }
    Alert.alert('Delete product', `Delete "${p.name}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: run },
    ]);
  };

  const onScroll = (e: any) => {
    const show = e.nativeEvent.contentOffset.y > 600;
    if (show !== showTopRef.current) { showTopRef.current = show; setShowTop(show); }
  };

  const filtersOn = category !== 'All' || !!q;

  /* ───────────────────────── UI ───────────────────────── */
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView
        ref={scrollRef}
        style={{ backgroundColor: C.cream }}
        contentContainerStyle={{ alignItems: 'center' }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={C.forest} colors={[C.forest]} />}
      >
        {/* hero */}
        <View style={s.hero}>
          <View style={s.hillA} pointerEvents="none" />
          <View style={s.hillB} pointerEvents="none" />
          <FloatingLeaf style={{ right: 70, bottom: 42 }} size={30} color={C.leaf} tilt={12} />
          <FloatingLeaf style={{ right: 22, bottom: 38 }} size={38} color={C.lime} tilt={9} delay={600} />
          <View style={s.heroText}>
            {isAdmin && (
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <TouchableOpacity style={[s.roundBtn, { backgroundColor: C.lime }]} onPress={openCreate} activeOpacity={0.85} accessibilityLabel="Add a product">
                  <Ionicons name="add" size={28} color={C.ink} />
                </TouchableOpacity>
              </View>
            )}
            <Text style={[DISPLAY, s.title]}>Waste solutions</Text>
            <Text style={s.subtitle}>Find uses and buyers for husks, shells and leaves.</Text>
          </View>
        </View>

        <View style={{ width: '92%', maxWidth: maxW, marginTop: -48, zIndex: 2 }}>
          {/* ───────── Search + AI ───────── */}
          <View style={{ marginBottom: 40 }}>
            <Surface isStatic bg={C.lime} radius={{ borderTopLeftRadius: 44, borderTopRightRadius: 44, borderBottomRightRadius: 44, borderBottomLeftRadius: 14 }}
              innerStyle={{ padding: wide ? 28 : 20 }}>
              <FloatingLeaf style={{ top: 10, right: 14 }} size={64} color={C.moss} opacity={0.35} tilt={6} />
              <FloatingLeaf style={{ bottom: 8, right: 70 }} size={36} color={C.forest} opacity={0.2} tilt={10} delay={500} />
              <Txt size={wide ? 28 : 24} style={[DISPLAY, { color: C.ink, paddingRight: 56 }]}>What waste do you have?</Txt>
              <View style={[s.searchBox, focused && { backgroundColor: C.paper, borderColor: C.forest }]}>
                <Ionicons name="search" size={24} color={C.moss} />
                <TextInput
                  style={[s.searchInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
                  placeholder="For example: coconut husk"
                  placeholderTextColor="#6f7f62"
                  value={query}
                  onChangeText={setQuery}
                  onFocus={() => setFocused(true)}
                  onBlur={() => setFocused(false)}
                  returnKeyType="search"
                  onSubmitEditing={discover}
                  accessibilityLabel="Describe the waste you have"
                />
                {!!query && (
                  <TouchableOpacity onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                    <Ionicons name="close-circle" size={26} color={C.moss} />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, marginTop: 12 }}>
                {EXAMPLES.map((ex) => (
                  <TouchableOpacity key={ex} onPress={() => setQuery(ex)} activeOpacity={0.85} style={[s.exampleChip, query === ex && { backgroundColor: C.forest }]}>
                    <Txt size={15} style={{ fontWeight: '800', color: query === ex ? C.cream : C.ink }}>{ex}</Txt>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={{ marginTop: 16 }}>
                <Surface onPress={discover} disabled={aiLoading} bg={C.forest} radius={32} label="Find ideas"
                  innerStyle={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 62, paddingHorizontal: 22 }}>
                  {aiLoading ? (
                    <ActivityIndicator color={C.cream} />
                  ) : (
                    <Animated.View style={{ transform: [{ scale: sparkle.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.2] }) }, { rotate: sparkle.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) }] }}>
                      <Ionicons name="sparkles" size={24} color={C.lime} />
                    </Animated.View>
                  )}
                  <Txt size={20} style={[DISPLAY, { color: C.cream }]}>{aiLoading ? 'Looking for ideas...' : 'Find ideas'}</Txt>
                </Surface>
              </View>
              {!!aiError && (
                <View style={s.errorBox}>
                  <Ionicons name="alert-circle" size={22} color="#a63a1f" />
                  <Txt size={15} style={{ color: '#7a2a14', fontWeight: '700', flex: 1 }}>{aiError} Check your connection and try again.</Txt>
                </View>
              )}
            </Surface>
          </View>

          {/* ───────── AI results ───────── */}
          {ai && (
            <View onLayout={(e) => { aiY.current = e.nativeEvent.layout.y + 400; }} style={{ marginBottom: 36 }}>
              <SectionHead
                title={ai.ai_powered ? 'Ideas for you' : 'Matching products'}
                sub="Based on what you typed"
                right={
                  <TouchableOpacity onPress={() => setAi(null)} style={s.clearBtn} activeOpacity={0.85} accessibilityLabel="Clear ideas">
                    <Ionicons name="close" size={18} color={C.ink} />
                    <Txt size={15} style={{ fontWeight: '800', color: C.ink }}>Clear</Txt>
                  </TouchableOpacity>
                }
              />
              {(ai.results || []).length === 0 && (
                <Txt size={17} style={{ color: C.body, fontWeight: '600' }}>No products match yet. Try the ideas below or another word.</Txt>
              )}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
                {(ai.results || []).map((r: any, i: number) => (
                  <ProductCard
                    key={r.product?._id ?? i} index={i} p={r.product} isAdmin={isAdmin} width={cardW}
                    onEdit={() => openEdit(r.product)} onDelete={() => confirmDelete(r.product)}
                    extra={
                      <View style={{ gap: 8, marginTop: 8 }}>
                        {!!r.explanation && (
                          <View style={[s.noteBox, { backgroundColor: C.leaf }]}>
                            <View style={s.noteHead}><Ionicons name="checkmark-circle" size={20} color={C.moss} /><Txt size={15} style={{ fontWeight: '900', color: C.forest }}>Why it fits</Txt></View>
                            <Txt size={16} style={{ color: C.ink, fontWeight: '500' }}>{r.explanation}</Txt>
                          </View>
                        )}
                        {!!r.tip && (
                          <View style={[s.noteBox, { backgroundColor: C.sand }]}>
                            <View style={s.noteHead}><Ionicons name="construct" size={19} color={C.bark} /><Txt size={15} style={{ fontWeight: '900', color: C.bark }}>How to process it</Txt></View>
                            <Txt size={16} style={{ color: C.ink, fontWeight: '500' }}>{r.tip}</Txt>
                          </View>
                        )}
                      </View>
                    }
                  />
                ))}
              </View>

              {(ai.ai_suggestions || []).length > 0 && (
                <View style={{ marginTop: 32 }}>
                  <SectionHead title="New product ideas" sub="Tap an idea to see the steps" size={26} />
                  <View style={{ gap: 14 }}>
                    {ai.ai_suggestions.map((sg: any, i: number) => <IdeaCard key={`${sg.name}-${i}`} sg={sg} index={i} />)}
                  </View>
                </View>
              )}
            </View>
          )}

          {/* ───────── Kinds ───────── */}
          <SectionHead title="Pick a kind of waste" sub="Tap one to filter the list" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 40 }}>
            {['All', ...CATEGORIES].map((c, i) => (
              <KindTile key={c} name={c} active={category === c} count={countOf(c)} radius={ORGANIC[i % 3]} onPress={() => setCategory(c)} />
            ))}
          </View>

          {/* ───────── Catalogue ───────── */}
          <SectionHead
            title="Products"
            sub={`${filtered.length} ${filtered.length === 1 ? 'product' : 'products'}${category !== 'All' ? ` in ${category.toLowerCase()}` : ''}${q ? ` matching “${query.trim()}”` : ''}`}
            right={
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                {filtersOn && (
                  <TouchableOpacity onPress={() => { setCategory('All'); setQuery(''); }} style={s.clearBtn} activeOpacity={0.85} accessibilityLabel="Clear filters">
                    <Ionicons name="refresh" size={17} color={C.ink} />
                    <Txt size={15} style={{ fontWeight: '800', color: C.ink }}>Clear</Txt>
                  </TouchableOpacity>
                )}
                {isAdmin && (
                  <Surface onPress={openCreate} bg={C.lime} radius={26} label="Add product"
                    innerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 50 }}>
                    <Ionicons name="add" size={22} color={C.ink} />
                    <Txt size={16} style={{ fontWeight: '900', color: C.ink }}>Add</Txt>
                  </Surface>
                )}
              </View>
            }
          />

          {loading ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} radius={ORGANIC[i % 3]} width={cardW} style={{ width: cardW }} />)}
            </View>
          ) : error ? (
            <View style={s.errorBox}>
              <Ionicons name="cloud-offline" size={28} color="#a63a1f" />
              <View style={{ flex: 1 }}>
                <Txt size={16} style={{ color: '#7a2a14', fontWeight: '800' }}>{error}</Txt>
                <Txt size={15} style={{ color: '#7a2a14' }}>Pull down to try again.</Txt>
              </View>
            </View>
          ) : filtered.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 30 }}>
              <CoconutArt size={70} />
              <Txt size={24} style={[DISPLAY, { color: C.forest, marginTop: 14, textAlign: 'center' }]}>No products found</Txt>
              <Txt size={17} style={{ color: C.body, fontWeight: '600', marginTop: 6, textAlign: 'center', maxWidth: 320 }}>
                Try another word, or choose “All” above.
              </Txt>
              {filtersOn && (
                <Surface onPress={() => { setCategory('All'); setQuery(''); }} bg={C.lime} radius={28} label="Show all products" style={{ marginTop: 18 }}
                  innerStyle={{ paddingHorizontal: 24, minHeight: 54, justifyContent: 'center' }}>
                  <Txt size={17} style={{ fontWeight: '900', color: C.ink }}>Show all products</Txt>
                </Surface>
              )}
            </View>
          ) : (
            <View key={`${category}-${q}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
              {filtered.map((p, i) => {
                const first = i === 0;
                return (
                  <ProductCard
                    key={p._id} p={p} index={i}
                    featured={first && cols === 1}
                    horizontal={first && cols === 2}
                    width={first && cols === 2 ? '100%' : cardW}
                    isAdmin={isAdmin} onEdit={() => openEdit(p)} onDelete={() => confirmDelete(p)}
                  />
                );
              })}
            </View>
          )}

          {!!session && !isAdmin && (
            <Txt size={13} style={{ color: C.body, textAlign: 'center', marginTop: 24, opacity: 0.8 }}>
              Signed in as {String(session.role || 'none')}. An admin account is needed to add products.
            </Txt>
          )}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>

      {/* back to top */}
      {showTop && (
        <Pop style={{ position: 'absolute', right: 16, bottom: 20 }}>
          <Surface onPress={() => scrollRef.current?.scrollTo({ y: 0, animated: true })} bg={C.forest} radius={30} label="Back to top"
            innerStyle={{ width: 58, height: 58, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="arrow-up" size={26} color={C.cream} />
          </Surface>
        </Pop>
      )}

      {/* ───────── Admin form ───────── */}
      <Modal visible={formOpen} animationType="slide" transparent onRequestClose={() => setFormOpen(false)}>
        <KeyboardAvoidingView style={s.modalWrap} behavior="padding">
          <View style={s.modalCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <View style={{ flex: 1 }}>
                <Txt size={26} style={[DISPLAY, { color: C.forest }]}>{editing ? 'Edit product' : 'Add a product'}</Txt>
                <Vine />
              </View>
              <TouchableOpacity onPress={() => setFormOpen(false)} style={[s.roundBtn, { backgroundColor: C.leaf }]} accessibilityLabel="Close form">
                <Ionicons name="close" size={26} color={C.ink} />
              </TouchableOpacity>
            </View>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 16 }}>
              <Txt size={16} style={s.label}>Name</Txt>
              <TextInput style={s.input} value={fName} onChangeText={setFName} placeholder="Product name" placeholderTextColor="#6f7f62" />
              <Txt size={16} style={s.label}>Description</Txt>
              <TextInput style={[s.input, { minHeight: 100 }]} value={fDesc} onChangeText={setFDesc} multiline textAlignVertical="top" placeholder="What is it and how is it used" placeholderTextColor="#6f7f62" />
              <Txt size={16} style={s.label}>Kind of waste</Txt>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {CATEGORIES.map((c) => {
                  const k = (KIND as any)[c]; const on = fCat === c;
                  return (
                    <TouchableOpacity key={c} style={[s.formChip, on && { backgroundColor: C.forest, borderColor: C.forest }]} onPress={() => setFCat(c)} activeOpacity={0.85}>
                      <Ionicons name={k.icon} size={18} color={on ? C.cream : C.moss} />
                      <Txt size={16} style={{ fontWeight: '800', color: on ? C.cream : C.forest }}>{c}</Txt>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Txt size={16} style={s.label}>Price (₱)</Txt>
                  <TextInput style={s.input} value={fPrice} onChangeText={setFPrice} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor="#6f7f62" />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt size={16} style={s.label}>Unit</Txt>
                  <TextInput style={s.input} value={fUnit} onChangeText={setFUnit} placeholder="per kg" placeholderTextColor="#6f7f62" />
                </View>
              </View>
              <Txt size={16} style={s.label}>Photo (optional)</Txt>
              <TouchableOpacity style={s.pickBox} onPress={pickImage} activeOpacity={0.85} accessibilityLabel="Choose a photo">
                {fImage || editing?.image_url ? (
                  <Image source={{ uri: fImage?.uri ?? editing?.image_url }} style={{ width: '100%', height: '100%', borderRadius: 14 }} resizeMode="cover" />
                ) : (
                  <><Ionicons name="camera" size={32} color={C.moss} /><Txt size={16} style={{ fontWeight: '800', color: C.forest }}>Choose a photo</Txt></>
                )}
              </TouchableOpacity>
              {!!formError && (
                <View style={s.errorBox}>
                  <Ionicons name="alert-circle" size={22} color="#a63a1f" />
                  <Txt size={15} style={{ color: '#7a2a14', fontWeight: '700', flex: 1 }}>{formError}</Txt>
                </View>
              )}
              <Surface onPress={submitForm} disabled={saving} bg={C.forest} radius={30} label={editing ? 'Save changes' : 'Create product'} style={{ marginTop: 8 }}
                innerStyle={{ minHeight: 60, alignItems: 'center', justifyContent: 'center' }}>
                {saving ? <ActivityIndicator color={C.cream} /> : <Txt size={19} style={[DISPLAY, { color: C.cream }]}>{editing ? 'Save changes' : 'Create product'}</Txt>}
              </Surface>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   STYLES
   ════════════════════════════════════════════════════════════════════════════ */
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.forest },
  hero: {
    width: '100%', height: 184, backgroundColor: C.forest, overflow: 'hidden',
    borderBottomLeftRadius: 56, borderBottomRightRadius: 18,
  },
  hillA: { position: 'absolute', width: 460, height: 460, borderRadius: 230, backgroundColor: C.moss, left: -150, bottom: -405 },
  hillB: { position: 'absolute', width: 400, height: 400, borderRadius: 200, backgroundColor: C.hill, right: -150, bottom: -355 },
  heroText: { paddingHorizontal: 22, paddingTop: 16, maxWidth: 520 },
  title: { fontSize: 34, lineHeight: 38, color: C.cream },
  subtitle: { fontSize: 18, lineHeight: 26, color: C.leaf, fontWeight: '600', marginTop: 6 },
  roundBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(245,230,211,0.16)', alignItems: 'center', justifyContent: 'center' },

  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.cream, borderRadius: 30,
    borderWidth: 2, borderColor: 'transparent', paddingHorizontal: 18, minHeight: 60, marginTop: 16,
  },
  searchInput: { flex: 1, fontSize: 18, color: C.ink, fontWeight: '600', paddingVertical: 8, minHeight: 44 },
  exampleChip: { backgroundColor: C.cream, borderRadius: 22, paddingHorizontal: 16, minHeight: 46, justifyContent: 'center' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fde3d8', borderRadius: 16,
    borderWidth: 2, borderColor: '#e9b4a6', padding: 14, marginTop: 12,
  },
  clearBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.lime, borderRadius: 22, paddingHorizontal: 14, minHeight: 46 },

  countPill: { position: 'absolute', top: 14, right: 14, minWidth: 32, height: 32, borderRadius: 16, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },

  kindFlag: { position: 'absolute', top: 12, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 6 },
  priceTag: {
    position: 'absolute', bottom: 12, right: 12, backgroundColor: C.lime, borderRadius: 14,
    paddingHorizontal: 14, paddingVertical: 6, transform: [{ rotate: '-3deg' }],
  },
  smallBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 48,
    borderRadius: 24, borderWidth: 2, borderColor: C.leaf, backgroundColor: C.cream,
  },
  noteBox: { borderRadius: 14, padding: 12, gap: 4 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  ideaIcon: { width: 46, height: 46, borderRadius: 23, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },
  matChip: { backgroundColor: C.leaf, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7 },
  stepDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },
  openHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: 14,
    backgroundColor: C.lime, borderRadius: 22, paddingHorizontal: 16, minHeight: 46,
  },

  modalWrap: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(31,48,18,0.55)' },
  modalCard: {
    backgroundColor: C.paper, borderTopLeftRadius: 38, borderTopRightRadius: 14, padding: 20, maxHeight: '90%', gap: 8,
    width: '100%', maxWidth: 640, alignSelf: 'center',
  },
  label: { fontWeight: '800', color: C.forest, marginTop: 6 },
  input: {
    backgroundColor: C.cream, borderWidth: 2, borderColor: C.leaf, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 12, fontSize: 17, color: C.ink, fontWeight: '600', minHeight: 52,
  },
  formChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, minHeight: 50, borderRadius: 25,
    borderWidth: 2, borderColor: C.leaf, backgroundColor: C.cream,
  },
  pickBox: {
    height: 130, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed', borderColor: C.moss,
    backgroundColor: C.cream, justifyContent: 'center', alignItems: 'center', gap: 4,
  },
});