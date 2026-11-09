import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View, Text, Image, StyleSheet, ActivityIndicator, RefreshControl,
  TouchableOpacity, ScrollView, useWindowDimensions, Platform, Animated,
  TextInput, Linking, Pressable, Easing, AccessibilityInfo,
} from 'react-native';
import { useFocusEffect } from 'expo-router/react-navigation';
import { Ionicons } from '@expo/vector-icons';
import { router, Redirect } from 'expo-router';
import { NGROK_URL } from '../../constants/config';
import * as SecureStore from 'expo-secure-store';
import { SafeAreaView } from 'react-native-safe-area-context';

/* ════════════════════════════════════════════════════════════════════════════
   DESIGN TOKENS
   Palette comes straight from the Green Houze board: deep forest, mid green,
   lime-olive and warm cream. "leaf", "sand" and "paper" are only tints of those.
   Built for farmers (many older): big type, high contrast, 48px+ tap targets,
   gentle motion, a text-size switch, and motion that respects "reduce motion".
   ════════════════════════════════════════════════════════════════════════════ */
const C = {
  forest: '#2F4A1E',
  moss: '#46652A',
  lime: '#8A9F27',
  cream: '#F5E6D3',
  paper: '#FBF4EA',
  ink: '#1F3012',
  leaf: '#DDE5B5',
  sand: '#EBD7BC',
  body: '#4A5A3C',
};
const ND = Platform.OS !== 'web';

// Plug a chunky display font in here for the full Green Houze feel, e.g.
// `npx expo install @expo-google-fonts/bagel-fat-one expo-font` then use 'BagelFatOne_400Regular'.
const FONT_DISPLAY: string | undefined = undefined;
const DISPLAY: any = { fontFamily: FONT_DISPLAY, fontWeight: '900', letterSpacing: -0.5 };

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

const SLIDES = [
  require('../../assets/images/slide1.jpg'),
  require('../../assets/images/slide2.png'),
  require('../../assets/images/slide3.png'),
];

const ORGANIC = [
  { borderTopLeftRadius: 38, borderTopRightRadius: 14, borderBottomRightRadius: 38, borderBottomLeftRadius: 14 },
  { borderTopLeftRadius: 14, borderTopRightRadius: 38, borderBottomRightRadius: 14, borderBottomLeftRadius: 38 },
  { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderBottomRightRadius: 12, borderBottomLeftRadius: 28 },
];

const CATEGORY: Record<string, { bg: string; fg: string }> = {
  Technology: { bg: C.moss, fg: C.cream },
  Market: { bg: C.lime, fg: C.ink },
  Sustainability: { bg: C.forest, fg: C.cream },
  Innovation: { bg: C.leaf, fg: C.ink },
  News: { bg: C.sand, fg: C.ink },
};

const STEPS = [
  { icon: 'camera', title: 'Capture a photo', body: 'Take a photo of the coconut, or tap the shell near the microphone.' },
  { icon: 'checkmark-circle', title: 'View the grade', body: 'CocoVision reports the type and quality within a few seconds.' },
  { icon: 'cash', title: 'Plan your sale', body: 'Review current market prices before harvesting or selling.' },
];

function Txt({ style, children, ...rest }: any) {
  return <Text {...rest} style={style}>{children}</Text>;
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

function HoverScale({ children, style, onPress, to = 1.08, label }: any) {
  const s = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(s, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      onHoverIn={() => go(to)} onHoverOut={() => go(1)} onPressIn={() => go(0.96)} onPressOut={() => go(1)}
      style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : undefined}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   SURFACE – soft shape, diffuse shadow. Lifts on hover, sinks on press.
   `radius` is a number or an object of corner radii for the organic shapes.
   ════════════════════════════════════════════════════════════════════════════ */
const SOFT_SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 12px 28px rgba(31, 48, 18, 0.16), 0 2px 6px rgba(31, 48, 18, 0.08)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 5 };

function Surface({ onPress, bg = C.paper, radius = 18, style, innerStyle, children, disabled = false, isStatic = false, label }: any) {
  const h = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.spring(h, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();
  const rad = typeof radius === 'number' ? { borderRadius: radius } : radius;
  const body = [{ backgroundColor: bg }, rad, SOFT_SHADOW];
  const clip = [rad, { overflow: 'hidden' as const }, innerStyle];
  if (isStatic) {
    return <View style={style}><View style={body}><View style={clip}>{children}</View></View></View>;
  }
  return (
    <View style={[style, disabled && { opacity: 0.4 }]}>
      <Pressable
        disabled={disabled}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPressIn={() => to(-1)}
        onPressOut={() => to(0)}
        onHoverIn={() => to(1)}
        onHoverOut={() => to(0)}
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

/* ════════════════════════════════════════════════════════════════════════════
   DECOR – bushy edge (overlapping circles of different sizes), vine divider
   ════════════════════════════════════════════════════════════════════════════ */
function BushEdge({ color, width, height = 44, down = false }: { color: string; width: number; height?: number; down?: boolean }) {
  const bumps = useMemo(() => {
    const sizes = [64, 92, 58, 80, 104, 70, 88];
    const out: { x: number; d: number }[] = [];
    let x = -30, i = 0;
    while (x < width + 60) { const d = sizes[i % sizes.length]; out.push({ x, d }); x += d * 0.6; i++; }
    return out;
  }, [width]);
  return (
    <View pointerEvents="none" style={{ height, width: '100%', overflow: 'hidden' }}>
      {bumps.map((b, i) => {
        const vis = Math.min(height, b.d * 0.5 + (i % 3) * 4);
        return (
          <View key={i} style={{
            position: 'absolute', left: b.x, width: b.d, height: b.d, borderRadius: b.d / 2, backgroundColor: color,
            ...(down ? { top: vis - b.d } : { top: height - vis }),
          }} />
        );
      })}
      <View style={{ position: 'absolute', left: 0, right: 0, height: 6, backgroundColor: color, ...(down ? { top: 0 } : { bottom: 0 }) }} />
    </View>
  );
}

function Vine({ color = C.lime }: { color?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10 }}>
      <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: color }} />
      <Ionicons name="leaf" size={16} color={color} style={{ marginLeft: 4, transform: [{ rotate: '-20deg' }] }} />
      <View style={{ width: 10, height: 4, borderRadius: 2, backgroundColor: color, marginLeft: 4, opacity: 0.6 }} />
    </View>
  );
}

function SectionHead({ title, sub, color = C.forest, subColor = C.body, vine = C.lime, right, size = 34 }: any) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 22, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Txt style={[DISPLAY, { fontSize: size, lineHeight: Math.round(size * 1.12), color }]}>{title}</Txt>
        {sub ? <Txt style={{ color: subColor, fontWeight: '600', fontSize: 17, lineHeight: 24, marginTop: 6 }}>{sub}</Txt> : null}
        <Vine color={vine} />
      </View>
      {right}
    </View>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   SLIDE CONTROLS – arrow button with hover / press feedback
   ════════════════════════════════════════════════════════════════════════════ */
function SlideArrow({ dir, onPress, label, style }: any) {
  const s = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(s, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={6}
      onHoverIn={() => go(1.1)} onHoverOut={() => go(1)} onPressIn={() => go(0.92)} onPressOut={() => go(1)}
      style={[styles.arrowWrap, style, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
    >
      <Animated.View style={[styles.arrow, { transform: [{ scale: s }] }]}>
        <Ionicons name={dir === 'left' ? 'chevron-back' : 'chevron-forward'} size={24} color={C.forest} />
      </Animated.View>
    </Pressable>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   TOOL VISUALS (each one is alive)
   ════════════════════════════════════════════════════════════════════════════ */
function LoopBar({ min, max, dur, delay = 0, color, w = 8 }: any) {
  const a = useRef(new Animated.Value(REDUCE ? 0.6 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    const l = Animated.loop(Animated.sequence([
      Animated.delay(delay),
      Animated.timing(a, { toValue: 1, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      Animated.timing(a, { toValue: 0, duration: dur, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  return <Animated.View style={{ width: w, height: a.interpolate({ inputRange: [0, 1], outputRange: [min, max] }), borderRadius: w / 2, backgroundColor: color, marginHorizontal: 2.5 }} />;
}

function ScanVisual() {
  const scan = useLoop(1500);
  const corner = (vv: 'top' | 'bottom', hh: 'left' | 'right') => ({
    position: 'absolute' as const, [vv]: 0, [hh]: 0, width: 20, height: 20, borderColor: C.lime,
    [vv === 'top' ? 'borderTopWidth' : 'borderBottomWidth']: 4,
    [hh === 'left' ? 'borderLeftWidth' : 'borderRightWidth']: 4,
    borderRadius: 4,
  } as any);
  return (
    <View style={{ width: 112, height: 112, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 74, height: 74, borderRadius: 37, backgroundColor: C.sand, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ flexDirection: 'row', gap: 5, marginTop: -8 }}>
          {[0, 1, 2].map(i => <View key={i} style={{ width: 9, height: 11, borderRadius: 5, backgroundColor: C.ink }} />)}
        </View>
      </View>
      <Animated.View style={{ position: 'absolute', width: 96, height: 3, borderRadius: 2, backgroundColor: C.lime, transform: [{ translateY: scan.interpolate({ inputRange: [0, 1], outputRange: [-38, 38] }) }] }} />
      <View style={corner('top', 'left')} /><View style={corner('top', 'right')} />
      <View style={corner('bottom', 'left')} /><View style={corner('bottom', 'right')} />
    </View>
  );
}

function SoundVisual() {
  const cfg = [[8, 30, 500], [12, 40, 650], [6, 34, 420], [14, 42, 720], [8, 28, 560], [10, 38, 480], [6, 24, 600]];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 46 }}>
      {cfg.map(([mn, mx, d], i) => <LoopBar key={i} min={mn} max={mx} dur={d} delay={i * 60} color={C.ink} />)}
    </View>
  );
}

function PriceVisual() {
  const cfg = [[10, 18, 700], [16, 26, 800], [14, 34, 650], [22, 46, 900], [28, 56, 760]];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 62 }}>
      {cfg.map(([mn, mx, d], i) => <LoopBar key={i} min={mn} max={mx} dur={d} delay={i * 90} color={i === 4 ? C.lime : C.forest} w={12} />)}
    </View>
  );
}

function TalkVisual() {
  const a = useLoop(1100);
  const b = useLoop(1300, 300);
  const bub = (side: 'left' | 'right', bg: string, anim: any) => (
    <Animated.View style={{
      alignSelf: side === 'left' ? 'flex-start' : 'flex-end', backgroundColor: bg,
      borderRadius: 14, paddingHorizontal: 9, paddingVertical: 6, flexDirection: 'row', gap: 3,
      transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -4] }) }],
    }}>
      {[0, 1, 2].map(i => <View key={i} style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: C.ink }} />)}
    </Animated.View>
  );
  return <View style={{ width: 84, gap: 6 }}>{bub('left', C.cream, a)}{bub('right', C.lime, b)}</View>;
}

/* ════════════════════════════════════════════════════════════════════════════
   TOOL CARD – one big "featured" version, and a compact row version
   ════════════════════════════════════════════════════════════════════════════ */
function ToolCard({ t, big, height, style, radius, onPress }: any) {
  const fg = t.fg;
  if (big) {
    return (
      <Surface onPress={onPress} bg={t.bg} radius={radius} style={style} label={`${t.title}. ${t.desc}`} innerStyle={{ padding: 22, height }}>
        <FloatingLeaf style={{ top: 14, right: 16 }} size={70} color={C.moss} opacity={0.55} tilt={6} />
        <View style={[styles.toolIcon, { backgroundColor: t.iconBg, width: 52, height: 52, borderRadius: 26 }]}>
          <Ionicons name={t.icon} size={26} color={fg} />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{t.visual}</View>
        <Txt style={[DISPLAY, { fontSize: 28, lineHeight: 32, color: fg }]}>{t.title}</Txt>
        <Txt style={{ fontSize: 17, lineHeight: 24, fontWeight: '600', color: fg, opacity: 0.92, marginTop: 4 }}>{t.desc}</Txt>
        <View style={[styles.cta, { backgroundColor: C.cream, marginTop: 14 }]}>
          <Txt style={{ fontSize: 17, fontWeight: '900', color: C.ink }}>{t.cta}</Txt>
          <Ionicons name="arrow-forward" size={20} color={C.ink} />
        </View>
      </Surface>
    );
  }
  return (
    <Surface onPress={onPress} bg={t.bg} radius={radius} style={style} label={`${t.title}. ${t.desc}`}
      innerStyle={{ padding: 16, minHeight: 112, flexDirection: 'row', alignItems: 'center', gap: 14 }}>
      <View style={[styles.toolIcon, { backgroundColor: t.iconBg }]}>
        <Ionicons name={t.icon} size={24} color={fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Txt style={[DISPLAY, { fontSize: 21, lineHeight: 25, color: fg }]}>{t.title}</Txt>
        <Txt style={{ fontSize: 15, lineHeight: 21, fontWeight: '600', color: fg, opacity: 0.9, marginTop: 2 }}>{t.desc}</Txt>
      </View>
      <View style={{ width: 62, height: 62, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ transform: [{ scale: 0.72 }] }}>{t.visual}</View>
      </View>
    </Surface>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   POST CARD
   ════════════════════════════════════════════════════════════════════════════ */
function PostCard({ item, index, width }: any) {
  const when = item.timestamp ? new Date(item.timestamp).toLocaleDateString() : 'Just now';
  const likes = item.likes?.length || 0;
  const comments = item.comments?.length || 0;
  return (
    <Pop index={index} style={{ width }}>
      <Surface
        onPress={() => router.push({ pathname: '/(tabs)/public/[postId]', params: { postId: item._id } })}
        bg={C.paper} radius={ORGANIC[index % 3]} label={`Read post: ${item.title}`}
      >
        <View style={styles.postTop}>
          {item.author?.profileImage ? (
            <Image source={{ uri: item.author.profileImage }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: C.forest, alignItems: 'center', justifyContent: 'center' }]}>
              <Txt style={{ color: C.cream, fontWeight: '900', fontSize: 18 }}>{item.author?.name?.charAt(0) || 'U'}</Txt>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <Txt style={{ fontWeight: '800', fontSize: 16, color: C.ink }} numberOfLines={1}>{item.author?.name || 'Anonymous'}</Txt>
            <Txt style={{ fontSize: 14, color: C.body, fontWeight: '600' }}>{when}</Txt>
          </View>
        </View>
        <View style={{ padding: 18 }}>
          <Txt style={[DISPLAY, { fontSize: 21, lineHeight: 26, color: C.ink }]} numberOfLines={2}>{item.title}</Txt>
          <Txt style={{ fontSize: 16, lineHeight: 23, color: C.body, marginTop: 8, fontWeight: '500' }} numberOfLines={2}>{item.description}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 16, gap: 10 }}>
            <View style={styles.stat}>
              <Ionicons name="heart" size={16} color={C.moss} />
              <Txt style={styles.statText}>{likes} {likes === 1 ? 'like' : 'likes'}</Txt>
            </View>
            <View style={styles.stat}>
              <Ionicons name="chatbubble" size={15} color={C.moss} />
              <Txt style={styles.statText}>{comments}</Txt>
            </View>
            <View style={{ flex: 1 }} />
            <View style={styles.readBtn}>
              <Txt style={{ color: C.cream, fontWeight: '900', fontSize: 15 }}>Read</Txt>
              <Ionicons name="arrow-forward" size={16} color={C.cream} />
            </View>
          </View>
        </View>
      </Surface>
    </Pop>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   SCREEN
   ════════════════════════════════════════════════════════════════════════════ */
export default function FeedScreen() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const pad = isWeb ? 32 : 18;
  const maxW = 1180;
  const innerW = Math.floor(Math.min(width, maxW) - pad * 2);
  const wide = width >= 900;
  const sidePad = Math.max(pad, (width - maxW) / 2 + pad);
  const wrap: any = { width: '100%', maxWidth: maxW, alignSelf: 'center', paddingHorizontal: pad };

  const [posts, setPosts] = useState<any[]>([]);
  const [filteredPosts, setFilteredPosts] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [filterType, setFilterType] = useState<'all' | 'recent' | 'popular'>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [user, setUser] = useState<any>(null);
  const [newsArticles, setNewsArticles] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const [slide, setSlide] = useState(0);
  const [imgW, setImgW] = useState(wide ? innerW / 2 : innerW);
  const [showTop, setShowTop] = useState(false);
  const [segW, setSegW] = useState(0);
  const [step, setStep] = useState(0);

  const postsPerPage = 6;
  const scrollRef = useRef<ScrollView | null>(null);
  const heroRef = useRef<ScrollView | null>(null);
  const newsRef = useRef<ScrollView | null>(null);
  const newsX = useRef(0);
  const showTopRef = useRef(false);
  const segX = useRef(new Animated.Value(0)).current;
  const heroIn = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  const stepProg = useRef(new Animated.Value(0)).current;
  const pulse = useLoop(900);
  const wiggle = useLoop(600);

  const heroImgH = wide ? 440 : 280;

  /* ── data ── */
  const fetchNews = async () => {
    try {
      setNewsLoading(true);
      const res = await fetch(`${NGROK_URL}/news/coconut`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
      const data = await res.json();
      const sorted = (data.articles || []).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setNewsArticles(sorted);
    } catch (e) {
      console.error('News fetch error:', e);
      setNewsArticles([]);
    } finally {
      setNewsLoading(false);
    }
  };

  const fetchPosts = async () => {
    try {
      const res = await fetch(`${NGROK_URL}/posts/all`, { headers: { 'ngrok-skip-browser-warning': 'true' } });
      setPosts(await res.json());
    } catch (e) {
      console.error('Feed Error:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const loadUserData = async () => {
    try {
      const saved = Platform.OS === 'web' ? localStorage.getItem('user_session') : await SecureStore.getItemAsync('user_session');
      if (saved) setUser(JSON.parse(saved));
    } catch (e) {
      console.error('Error loading user data', e);
    }
  };

  const formatNewsDate = (s: string) => {
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const days = Math.floor(Math.abs(Date.now() - d.getTime()) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days} days ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' });
  };

  useEffect(() => {
    fetchPosts(); loadUserData(); fetchNews();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      (async () => { setRefreshing(true); await loadUserData(); await fetchPosts(); })();
    }, [])
  );

  const onRefresh = () => { setRefreshing(true); fetchPosts(); fetchNews(); };

  /* ── search / filter ── */
  useEffect(() => {
    let list = [...posts];
    if (filterType === 'recent') {
      list.sort((a, b) => new Date(b.timestamp || b.createdAt || 0).getTime() - new Date(a.timestamp || a.createdAt || 0).getTime());
    } else if (filterType === 'popular') {
      list.sort((a, b) => (b.likes?.length || 0) - (a.likes?.length || 0));
    }
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(p =>
        p.title?.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.author?.name?.toLowerCase().includes(q));
    }
    setFilteredPosts(list);
    setCurrentPage(1);
  }, [searchQuery, posts, filterType]);

  /* ── hero carousel ── */
  const goTo = (n: number) => {
    const i = (n + SLIDES.length) % SLIDES.length;
    setSlide(i);
    heroRef.current?.scrollTo({ x: i * imgW, animated: true });
  };
  useEffect(() => {
    if (REDUCE) return;
    const t = setTimeout(() => goTo(slide + 1), 6000);
    return () => clearTimeout(t);
  }, [slide, imgW]);

  useEffect(() => {
    if (!loading && !REDUCE) {
      Animated.spring(heroIn, { toValue: 1, friction: 8, tension: 40, useNativeDriver: ND }).start();
    }
  }, [loading]);

  /* ── "how it works" auto-advances, tap to jump ── */
  useEffect(() => {
    stepProg.setValue(REDUCE ? 1 : 0);
    if (REDUCE) return;
    const anim = Animated.timing(stepProg, { toValue: 1, duration: 5000, easing: Easing.linear, useNativeDriver: false });
    anim.start(({ finished }) => { if (finished) setStep(s => (s + 1) % STEPS.length); });
    return () => anim.stop();
  }, [step]);

  /* ── segmented control ── */
  const filterKeys: Array<'all' | 'recent' | 'popular'> = ['all', 'recent', 'popular'];
  const filterLabels = { all: 'All posts', recent: 'Newest', popular: 'Most liked' };
  const segItemW = segW ? (segW - 8) / 3 : 0;
  useEffect(() => {
    Animated.spring(segX, { toValue: filterKeys.indexOf(filterType) * segItemW, friction: 8, tension: 120, useNativeDriver: ND }).start();
  }, [filterType, segItemW]);

  /* ── derived ── */
  const totalPages = Math.max(1, Math.ceil(filteredPosts.length / postsPerPage));
  const pagePosts = filteredPosts.slice((currentPage - 1) * postsPerPage, currentPage * postsPerPage);
  const cols = width > 1000 ? 3 : width > 640 ? 2 : 1;
  const gap = 18;
  const cardW = Math.floor((innerW - gap * (cols - 1)) / cols);
  const newsCardW = isWeb ? 370 : Math.min(width * 0.82, 340);
  const firstName = user?.name ? String(user.name).split(' ')[0] : null;
  const goPage = (p: number) => setCurrentPage(Math.min(totalPages, Math.max(1, p)));
  const hour = new Date().getHours();
  const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const nudgeNews = (d: number) => newsRef.current?.scrollTo({ x: Math.max(0, newsX.current + d * (newsCardW + 16)), animated: true });

  const onScroll = (e: any) => {
    const show = e.nativeEvent.contentOffset.y > 700;
    if (show !== showTopRef.current) { showTopRef.current = show; setShowTop(show); }
  };

  const tools: any = useMemo(() => ({
    image: { title: 'Scan a coconut', desc: 'Take a photo to receive the grade.', cta: 'Open camera', bg: C.forest, fg: C.cream, iconBg: 'rgba(245,230,211,0.16)', icon: 'camera', route: '/(tabs)/public/classify', visual: <ScanVisual /> },
    acoustic: { title: 'Sound analysis', desc: 'Tap the coconut to assess ripeness by sound.', bg: C.lime, fg: C.ink, iconBg: 'rgba(31,48,18,0.12)', icon: 'mic', route: '/(tabs)/public/acoustic', visual: <SoundVisual /> },
    price: { title: 'Market prices', desc: 'View current market prices and trends.', bg: C.paper, fg: C.ink, iconBg: C.leaf, icon: 'trending-up', route: '/(tabs)/public/prediction', visual: <PriceVisual /> },
    blog: { title: 'Community', desc: 'Ask questions and share information with other farmers.', bg: C.moss, fg: C.cream, iconBg: 'rgba(245,230,211,0.16)', icon: 'chatbubbles', route: '/(tabs)/public/post', visual: <TalkVisual /> },
  }), []);
  const go = (k: string) => router.push(tools[k].route);

  /* ── loading ── */
  if (loading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: C.forest }]}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={C.cream} />
          <Text style={[DISPLAY, { color: C.cream, fontSize: 22, marginTop: 16 }]}>Loading content…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={64}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.forest} colors={[C.forest]} />}
      >
        {/* soft organic background shape */}
        <View pointerEvents="none" style={{ position: 'absolute', top: 620, left: -110, width: 260, height: 220, borderTopRightRadius: 130, borderBottomRightRadius: 80, borderTopLeftRadius: 50, borderBottomLeftRadius: 110, backgroundColor: C.sand, opacity: 0.7 }} />

        {/* ───────── Header ───────── */}
        <View style={[wrap, { paddingTop: 12, paddingBottom: 12 }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Image
              source={require('../../assets/images/logo.png')}
              style={styles.headerLogo}
              resizeMode="contain"
              accessibilityLabel="CocoVision"
            />
          </View>
        </View>

          {/* ───────── Greeting ───────── */}
          <View style={[wrap, { paddingBottom: 18, paddingTop: 4 }]}>
            <Txt style={[DISPLAY, { fontSize: isWeb ? 36 : 28, lineHeight: isWeb ? 40 : 32, color: C.forest }]}>
              {greet}{firstName ? `, ${firstName}` : ''}
            </Txt>
            <Txt style={{ fontSize: 18, lineHeight: 25, color: C.body, fontWeight: '600', marginTop: 4 }}>
              Select a service to begin.
            </Txt>
          </View>

          {/* ───────── Hero ───────── */}
          <Animated.View style={[wrap, {
            opacity: heroIn,
            transform: [{ translateY: heroIn.interpolate({ inputRange: [0, 1], outputRange: [36, 0] }) }],
          }]}>
            <View style={{ marginBottom: 56 }}>
              <Surface isStatic bg={C.forest} radius={{ borderTopLeftRadius: 48, borderTopRightRadius: 48, borderBottomRightRadius: 48, borderBottomLeftRadius: 14 }}
                innerStyle={{ flexDirection: wide ? 'row' : 'column' }}>
                {/* photo carousel */}
                <View
                  onLayout={(e) => setImgW(e.nativeEvent.layout.width)}
                  style={wide
                    ? { flex: 1, height: heroImgH, margin: 14, overflow: 'hidden', borderTopLeftRadius: 150, borderBottomLeftRadius: 40, borderTopRightRadius: 36, borderBottomRightRadius: 36, order: 2 } as any
                    : { height: heroImgH, overflow: 'hidden' }}
                >
                  <ScrollView
                    ref={heroRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={StyleSheet.absoluteFill}
                    onMomentumScrollEnd={(e) => setSlide(Math.round(e.nativeEvent.contentOffset.x / imgW))}
                  >
                    {SLIDES.map((img, i) => <Image key={i} source={img} style={{ width: imgW, height: heroImgH }} resizeMode="cover" accessibilityLabel={`Farm photo ${i + 1} of ${SLIDES.length}`} />)}
                  </ScrollView>
                  <SlideArrow dir="left" label="Previous photo" onPress={() => goTo(slide - 1)} style={{ left: 12 }} />
                  <SlideArrow dir="right" label="Next photo" onPress={() => goTo(slide + 1)} style={{ right: 12 }} />
                  <View pointerEvents="box-none" style={[styles.dotsWrap, { bottom: wide ? 16 : 40 }]}>
                    <View style={styles.dots}>
                      {SLIDES.map((_, i) => (
                        <Pressable key={i} onPress={() => goTo(i)} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Show photo ${i + 1}`}
                          style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : undefined}>
                          <View style={{ height: 10, width: i === slide ? 28 : 10, borderRadius: 5, backgroundColor: i === slide ? C.forest : C.moss, opacity: i === slide ? 1 : 0.4 }} />
                        </Pressable>
                      ))}
                    </View>
                  </View>
                  {!wide && (
                    <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: -1 }}>
                      <BushEdge color={C.forest} width={innerW} height={38} />
                    </View>
                  )}
                </View>

                {/* words */}
                <View style={{ flex: wide ? 1 : undefined, padding: wide ? 44 : 22, paddingTop: wide ? 44 : 6, paddingBottom: wide ? 44 : 50, justifyContent: 'center', order: 1 } as any}>
                  <FloatingLeaf style={{ top: 18, right: wide ? 20 : 14 }} size={wide ? 90 : 60} color={C.moss} opacity={0.7} tilt={6} />
                  <View style={styles.liveChip}>
                    <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.moss, transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1.3] }) }] }} />
                    <Txt style={{ color: C.ink, fontWeight: '800', fontSize: 14 }}>AI for coconut farmers</Txt>
                  </View>
                  <Txt style={[DISPLAY, { color: C.cream, fontSize: isWeb ? 54 : 36, lineHeight: isWeb ? 58 : 40, marginTop: 14 }]}>
                    Coconut grading{'\n'}by image and sound.
                  </Txt>
                  <Txt style={{ color: C.cream, opacity: 0.94, fontWeight: '600', fontSize: 18, lineHeight: 26, marginTop: 12, maxWidth: 460 }}>
                    Grade coconuts from a photo or a tap, view current market prices, and share information with other farmers.
                  </Txt>
                  <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 18, marginTop: 22 }}>
                    <Surface onPress={() => go('image')} bg={C.cream} radius={30} label="Start scanning a coconut"
                      innerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 22, minHeight: 56 }}>
                      <Ionicons name="camera" size={22} color={C.ink} />
                      <Txt style={[DISPLAY, { fontSize: 18, color: C.ink }]}>Start scanning</Txt>
                      <Animated.View style={{ transform: [{ translateX: wiggle.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }) }] }}>
                        <Ionicons name="arrow-forward" size={20} color={C.ink} />
                      </Animated.View>
                    </Surface>
                  </View>
                </View>
              </Surface>
            </View>
          </Animated.View>

          {/* ───────── Tools ───────── */}
          <View style={[wrap, { marginTop: 10 }]}>
            <SectionHead title="Services" sub="Four tools available in CocoVision" />
            {wide ? (
              <View style={{ flexDirection: 'row', gap: 18, alignItems: 'flex-start' }}>
                <ToolCard big t={tools.image} height={3 * 112 + 2 * 18} radius={ORGANIC[0]} style={{ flex: 1.2 }} onPress={() => go('image')} />
                <View style={{ flex: 1, gap: 18 }}>
                  <ToolCard t={tools.acoustic} radius={ORGANIC[1]} onPress={() => go('acoustic')} />
                  <ToolCard t={tools.price} radius={ORGANIC[2]} onPress={() => go('price')} />
                  <ToolCard t={tools.blog} radius={ORGANIC[1]} onPress={() => go('blog')} />
                </View>
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                <ToolCard big t={tools.image} height={330} radius={ORGANIC[0]} onPress={() => go('image')} />
                <ToolCard t={tools.acoustic} radius={ORGANIC[1]} onPress={() => go('acoustic')} />
                <ToolCard t={tools.price} radius={ORGANIC[2]} onPress={() => go('price')} />
                <ToolCard t={tools.blog} radius={ORGANIC[1]} onPress={() => go('blog')} />
              </View>
            )}
          </View>

          {/* ───────── How it works ───────── */}
          <View style={[wrap, { marginTop: 56 }]}>
            <SectionHead title="How it works" sub="Select a step for details" />
            <View style={{ flexDirection: wide ? 'row' : 'column', gap: 14, alignItems: wide ? 'flex-start' : 'stretch' }}>
              {STEPS.map((s, i) => {
                const active = step === i;
                return (
                  <Surface
                    key={s.title} onPress={() => setStep(i)} bg={active ? C.forest : C.paper} radius={ORGANIC[i % 3]}
                    style={{ flex: wide ? 1 : undefined }} label={`Step ${i + 1}: ${s.title}`}
                    innerStyle={{ padding: 20 }}
                  >
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      <View style={[styles.stepNum, { backgroundColor: active ? C.lime : C.leaf }]}>
                        <Txt style={[DISPLAY, { fontSize: 22, color: C.ink }]}>{i + 1}</Txt>
                      </View>
                      <Txt style={[DISPLAY, { fontSize: 21, lineHeight: 26, color: active ? C.cream : C.ink, flex: 1 }]}>{s.title}</Txt>
                      <Ionicons name={s.icon as any} size={28} color={active ? C.leaf : C.moss} />
                    </View>
                    {active && (
                      <View>
                        <Txt style={{ fontSize: 17, lineHeight: 25, color: C.cream, opacity: 0.95, fontWeight: '600', marginTop: 12 }}>{s.body}</Txt>
                        <View style={{ height: 5, borderRadius: 3, backgroundColor: 'rgba(245,230,211,0.22)', marginTop: 16, overflow: 'hidden' }}>
                          <Animated.View style={{ height: 5, borderRadius: 3, backgroundColor: C.lime, width: stepProg.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
                        </View>
                      </View>
                    )}
                  </Surface>
                );
              })}
            </View>
          </View>

          {/* ───────── News ───────── */}
          <View style={{ marginTop: 56 }}>
            <View style={wrap}>
              <SectionHead
                title="Industry news" sub="Latest coconut industry updates"
                right={newsLoading ? <ActivityIndicator size="small" color={C.moss} /> : (isWeb && newsArticles.length > 0 ? (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <Pressable onPress={() => nudgeNews(-1)} accessibilityRole="button" accessibilityLabel="Earlier stories" style={styles.navBtn}>
                      <Ionicons name="arrow-back" size={22} color={C.cream} />
                    </Pressable>
                    <Pressable onPress={() => nudgeNews(1)} accessibilityRole="button" accessibilityLabel="More stories" style={styles.navBtn}>
                      <Ionicons name="arrow-forward" size={22} color={C.cream} />
                    </Pressable>
                  </View>
                ) : null)}
              />
            </View>
            {newsArticles.length === 0 ? (
              <View style={[wrap, { flexDirection: 'row', alignItems: 'center', gap: 16 }]}>
                <Ionicons name="newspaper-outline" size={32} color={C.body} />
                <Txt style={{ color: C.body, fontWeight: '700', fontSize: 17, flex: 1 }}>
                  {newsLoading ? 'Loading the latest news…' : 'No news available. Pull down to refresh.'}
                </Txt>
              </View>
            ) : (
              <ScrollView
                ref={newsRef} horizontal showsHorizontalScrollIndicator={isWeb} snapToInterval={newsCardW + 16} decelerationRate="fast"
                onScroll={(e) => { newsX.current = e.nativeEvent.contentOffset.x; }} scrollEventThrottle={32}
                contentContainerStyle={{ paddingHorizontal: sidePad, paddingTop: 6, paddingBottom: 34 }}
              >
                {newsArticles.map((a, i) => {
                  const cat = CATEGORY[a.category] || CATEGORY.News;
                  return (
                    <Surface
                      key={a.id ?? i}
                      onPress={() => a.link && Linking.openURL(a.link)}
                      bg={C.paper} radius={ORGANIC[i % 3]} label={`Open story: ${a.title}`}
                      style={{ width: newsCardW, marginRight: 16 }}
                      innerStyle={{ height: 320 }}
                    >
                      <View style={{ backgroundColor: cat.bg, paddingHorizontal: 16, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Txt style={{ fontSize: 14, fontWeight: '900', color: cat.fg }}>{a.category || 'News'}</Txt>
                        <Txt style={{ fontSize: 14, fontWeight: '700', color: cat.fg, opacity: 0.85 }}>{formatNewsDate(a.date)}</Txt>
                      </View>
                      <View style={{ flex: 1, padding: 18, justifyContent: 'space-between' }}>
                        <View>
                          <Txt style={[DISPLAY, { fontSize: 21, lineHeight: 26, color: C.ink }]} numberOfLines={3}>{a.title}</Txt>
                          <Txt style={{ fontSize: 16, lineHeight: 23, color: C.body, marginTop: 8, fontWeight: '500' }} numberOfLines={3}>{a.excerpt}</Txt>
                        </View>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                          <Txt style={{ fontSize: 14, fontWeight: '800', color: C.moss, flex: 1 }} numberOfLines={1}>{a.source || 'Read article'}</Txt>
                          <View style={styles.readBtn}>
                            <Txt style={{ color: C.cream, fontWeight: '900', fontSize: 15 }}>Read</Txt>
                            <Ionicons name="arrow-forward" size={16} color={C.cream} />
                          </View>
                        </View>
                      </View>
                    </Surface>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* ───────── Community (forest) ───────── */}
          <View style={{ marginTop: 34 }}>
            <BushEdge color={C.forest} width={width} />
            <View style={{ backgroundColor: C.forest, paddingTop: 14, paddingBottom: 60, overflow: 'hidden' }}>
              <FloatingLeaf style={{ top: 24, right: 24 }} size={70} color={C.moss} opacity={0.8} tilt={6} />
              <FloatingLeaf style={{ top: 330, left: -6 }} size={56} color={C.moss} opacity={0.8} delay={700} tilt={6} />
              <View style={wrap}>
                <SectionHead
                  title="Community" sub="Share your experience from the field"
                  color={C.cream} subColor={C.leaf} size={isWeb ? 40 : 31}
                  right={
                    <Surface onPress={() => router.push('/(tabs)/public/post')} bg={C.lime} radius={26} label="Write a post"
                      innerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, minHeight: 52 }}>
                      <Ionicons name="add" size={22} color={C.ink} />
                      <Txt style={{ fontWeight: '900', color: C.ink, fontSize: 16 }}>New post</Txt>
                    </Surface>
                  }
                />

                {/* search */}
                <Surface isStatic bg={searchFocused ? C.paper : C.cream} radius={28}
                  innerStyle={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: Platform.OS === 'web' ? 14 : 10, gap: 12 }}>
                  <Ionicons name="search" size={22} color={C.moss} />
                  <TextInput
                    style={[styles.searchInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
                    placeholder="Search by title, topic, or author"
                    placeholderTextColor="#6f7f62"
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    onFocus={() => setSearchFocused(true)}
                    onBlur={() => setSearchFocused(false)}
                    accessibilityLabel="Search posts"
                  />
                  {searchQuery ? (
                    <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={10} accessibilityLabel="Clear search">
                      <Ionicons name="close-circle" size={24} color={C.moss} />
                    </TouchableOpacity>
                  ) : null}
                </Surface>

                {/* sliding segmented filter */}
                <View style={{ marginTop: 18, width: isWeb ? 460 : '100%', maxWidth: '100%' }}>
                  <View style={styles.segTrack} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
                    {segW > 0 && <Animated.View style={[styles.segThumb, { width: segItemW, transform: [{ translateX: segX }] }]} />}
                    {filterKeys.map(k => (
                      <Pressable key={k} style={styles.segItem} onPress={() => setFilterType(k)} accessibilityRole="button" accessibilityLabel={filterLabels[k]}>
                        <Txt style={{ fontWeight: '900', fontSize: 15, color: filterType === k ? C.ink : C.cream }}>{filterLabels[k]}</Txt>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 18, marginBottom: 20, gap: 10, flexWrap: 'wrap' }}>
                  <Txt style={{ color: C.leaf, fontWeight: '700', fontSize: 16, flexShrink: 1 }}>
                    {filteredPosts.length} {filteredPosts.length === 1 ? 'post' : 'posts'}{searchQuery ? ` for “${searchQuery}”` : ''}
                  </Txt>
                  {(searchQuery || filterType !== 'all') && (
                    <HoverScale onPress={() => { setSearchQuery(''); setFilterType('all'); }} style={styles.resetChip} label="Clear filters">
                      <Ionicons name="refresh" size={16} color={C.ink} />
                      <Txt style={{ fontWeight: '800', color: C.ink, fontSize: 14 }}>Clear filters</Txt>
                    </HoverScale>
                  )}
                </View>

                {/* grid – re-keyed on page / filter so cards pop in again */}
                {pagePosts.length === 0 ? (
                  <View style={{ alignItems: 'center', paddingVertical: 36 }}>
                    <Ionicons name="chatbubbles-outline" size={56} color={C.cream} />
                    <Txt style={[DISPLAY, { color: C.cream, fontSize: 26, marginTop: 16, textAlign: 'center' }]}>
                      {searchQuery ? 'No matching posts' : 'No posts available'}
                    </Txt>
                    <Txt style={{ color: C.leaf, fontWeight: '600', fontSize: 17, lineHeight: 24, marginTop: 6, textAlign: 'center', maxWidth: 320 }}>
                      {searchQuery ? 'Try a different keyword or clear the filters.' : 'Be the first to share information.'}
                    </Txt>
                    {!searchQuery && (
                      <Surface onPress={() => router.push('/(tabs)/public/post')} bg={C.lime} radius={28} label="Create the first post"
                        style={{ marginTop: 20 }} innerStyle={{ paddingHorizontal: 24, minHeight: 54, justifyContent: 'center' }}>
                        <Txt style={{ fontWeight: '900', color: C.ink, fontSize: 17 }}>Create the first post</Txt>
                      </Surface>
                    )}
                  </View>
                ) : (
                  <View key={`${currentPage}-${filterType}-${searchQuery}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
                    {pagePosts.map((p, i) => <PostCard key={p._id} item={p} index={i} width={cardW} />)}
                  </View>
                )}

                {/* pagination */}
                {filteredPosts.length > postsPerPage && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 32, flexWrap: 'wrap' }}>
                    <Surface onPress={() => goPage(currentPage - 1)} disabled={currentPage === 1} bg={C.cream} radius={26} label="Previous page"
                      innerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 52 }}>
                      <Ionicons name="arrow-back" size={20} color={C.ink} />
                      <Txt style={{ fontWeight: '900', color: C.ink, fontSize: 15 }}>Back</Txt>
                    </Surface>
                    {totalPages <= 7 ? (
                      Array.from({ length: totalPages }).map((_, i) => (
                        <HoverScale key={i} onPress={() => goPage(i + 1)} label={`Page ${i + 1}`} style={[styles.pageDot, currentPage === i + 1 && { backgroundColor: C.lime }]}>
                          <Txt style={{ fontWeight: '900', fontSize: 17, color: currentPage === i + 1 ? C.ink : C.cream }}>{i + 1}</Txt>
                        </HoverScale>
                      ))
                    ) : (
                      <Txt style={[DISPLAY, { color: C.cream, fontSize: 20, paddingHorizontal: 8 }]}>{currentPage} / {totalPages}</Txt>
                    )}
                    <Surface onPress={() => goPage(currentPage + 1)} disabled={currentPage === totalPages} bg={C.cream} radius={26} label="Next page"
                      innerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, minHeight: 52 }}>
                      <Txt style={{ fontWeight: '900', color: C.ink, fontSize: 15 }}>Next</Txt>
                      <Ionicons name="arrow-forward" size={20} color={C.ink} />
                    </Surface>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* ───────── Footer (web) ───────── */}
          {isWeb ? (
            <View style={{ marginTop: 60 }}>
              <BushEdge color={C.forest} width={width} />
              <View style={{ backgroundColor: C.forest, paddingTop: 20, paddingBottom: 36 }}>
                <View style={wrap}>
                  <Txt style={[DISPLAY, { color: C.cream, fontSize: 84, lineHeight: 84, opacity: 0.95 }]}>CocoVision</Txt>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 40, marginTop: 28 }}>
                    <View style={{ flex: 1, minWidth: 240 }}>
                      <Txt style={{ color: C.leaf, fontWeight: '600', fontSize: 16, lineHeight: 24, maxWidth: 340 }}>
                        AI-driven coconut classification and analytics for a sustainable future.
                      </Txt>
                    </View>
                    <View style={{ minWidth: 160 }}>
                      <Txt style={{ color: C.lime, fontWeight: '900', fontSize: 16, marginBottom: 12 }}>Explore</Txt>
                      {[['About us', '/(tabs)/public/about-us'], ['Scan a coconut', '/(tabs)/public/classify'], ['Blog', '/(tabs)']].map(([l, r]) => (
                        <HoverScale key={l} to={1.05} label={l} onPress={() => router.push(r as any)} style={{ marginBottom: 10, alignSelf: 'flex-start' }}>
                          <Txt style={{ color: C.cream, fontSize: 16, fontWeight: '600' }}>{l}</Txt>
                        </HoverScale>
                      ))}
                    </View>
                    <View>
                      <Txt style={{ color: C.lime, fontWeight: '900', fontSize: 16, marginBottom: 12 }}>Follow us</Txt>
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        {(['logo-facebook', 'logo-twitter', 'logo-instagram', 'logo-linkedin'] as const).map((n, i) => (
                          <HoverScale key={n} to={1.15} label={n.replace('logo-', '')} style={[styles.social, { backgroundColor: [C.cream, C.leaf, C.lime, C.sand][i] }]}>
                            <Ionicons name={n} size={22} color={C.ink} />
                          </HoverScale>
                        ))}
                      </View>
                    </View>
                  </View>
                  <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(245,230,211,0.25)', marginTop: 32, paddingTop: 18, flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                    <Txt style={{ color: C.leaf, fontSize: 14 }}>© 2026 CocoVision. All rights reserved.</Txt>
                    <Txt style={{ color: C.leaf, fontSize: 14 }}>Privacy Policy  ·  Terms of Service</Txt>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            <View style={{ height: 40 }} />
          )}
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
      </SafeAreaView>
  );
}


/* ════════════════════════════════════════════════════════════════════════════
   STYLES
   ════════════════════════════════════════════════════════════════════════════ */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.cream },
  headerLogo: {
    width: 84,
    height: 56,
  },
  logoBadge: {
    width: 42, height: 42, borderRadius: 15, backgroundColor: C.forest, alignItems: 'center', justifyContent: 'center',
    transform: [{ rotate: '-6deg' }],
  },
  liveChip: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.cream, borderRadius: 18,
    paddingHorizontal: 14, paddingVertical: 8, alignSelf: 'flex-start',
  },
  arrowWrap: {
    position: 'absolute', top: '50%', marginTop: -26, width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
  },
  arrow: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: C.cream, alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: 'rgba(47,74,30,0.18)', ...SOFT_SHADOW,
  },
  dotsWrap: {
    position: 'absolute', left: 0, right: 0, alignItems: 'center',
  },
  dots: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.cream, borderRadius: 18, paddingHorizontal: 16, paddingVertical: 11,
    borderWidth: 2, borderColor: 'rgba(47,74,30,0.18)', ...SOFT_SHADOW,
  },
  toolIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  cta: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    borderRadius: 26, paddingHorizontal: 20, minHeight: 52,
  },
  stepNum: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  navBtn: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.forest, alignItems: 'center', justifyContent: 'center' },
  postTop: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: C.leaf,
  },
  avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, borderColor: C.paper },
  stat: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.leaf, borderRadius: 14,
    paddingHorizontal: 12, paddingVertical: 7,
  },
  statText: { fontSize: 14, fontWeight: '800', color: C.ink },
  readBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.forest, borderRadius: 22,
    paddingHorizontal: 16, minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: 17, color: C.ink, fontWeight: '600', paddingVertical: 6, minHeight: 40 },
  segTrack: { flexDirection: 'row', backgroundColor: C.moss, borderRadius: 30, padding: 4 },
  segThumb: { position: 'absolute', left: 4, top: 4, bottom: 4, backgroundColor: C.cream, borderRadius: 26 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, minHeight: 52 },
  resetChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.lime, borderRadius: 20,
    paddingHorizontal: 14, minHeight: 44,
  },
  pageDot: {
    width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(245,230,211,0.14)',
  },
  social: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
});