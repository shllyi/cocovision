import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Image, Pressable, StyleSheet, Animated, Easing,
  Platform, AccessibilityInfo,
} from 'react-native';
import { router, Redirect } from 'expo-router';
import { getSession } from '../constants/session';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  useFonts, Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold,
} from '@expo-google-fonts/fredoka';

/* ════════════════════════════════════════════════════════════════════════════
   WELCOME SCREEN  →  save as  app/welcome.tsx

   FIRST, install the rounded "cutesy" font (one time):
       npx expo install expo-font @expo-google-fonts/fredoka

   Layout: painted field + palms on top; a paper sign with a scalloped
   (leafy) top edge and a stitched inner border rises from the bottom.
   Big, high-contrast text for outdoor use and older eyes. Honors
   "Reduce motion".
   ════════════════════════════════════════════════════════════════════════════ */

const C = {
  forest: '#2F4A1E',
  moss: '#46652A',
  lime: '#8A9F27',
  cream: '#F5E6D3',
  paper: '#FBF4EA',
  ink: '#1F3012',
  leaf: '#DDE5B5',
  stitch: '#B9C783',
  body: '#3F5230',
  husk: '#6E4A2B',
};

// Fonts (Fredoka is rounded and friendly, but still easy to read)
const F = {
  medium: 'Fredoka_500Medium',
  semi: 'Fredoka_600SemiBold',
  bold: 'Fredoka_700Bold',
};

// Set to false to always play animations (e.g. when testing on a PC/emulator
// where the system "reduce motion" setting is on)
const RESPECT_REDUCE_MOTION = true;

// How soft the painted background is (0 = sharp)
const BG_BLUR = 3;

// Timeline (ms). Scenery first, then the sign, then the words, then the button.
const GRASS_START = 850;
const GRASS_MS = 900;
const PANEL_AT = 1250;
const TITLE_AT = 1900;
const BODY_AT = 2200;
const FEATURES_AT = 2500;
const BUTTON_AT = 2900;

// Where the "Get started" button goes
const NEXT_ROUTE = '/(tabs)';

// Largest the text may grow when the phone's font size is turned up
const MAX_FONT = 1.3;

// Scalloped edge of the sign
const SCALLOP_D = 44;      // bump size
const SCALLOP_STEP = 34;   // distance between bumps (smaller = more overlap)
const SCALLOP_TOP = 4;     // room above the bumps for the green outline

// Adjust the path if this file lives somewhere other than app/welcome.tsx
const IMG = {
  bg: require('../assets/images/background.jpg'),
  cloud: require('../assets/images/cloud.jpg'),
  treeLeft: require('../assets/images/treeleft.png'),
  treeRight: require('../assets/images/treeright.png'),
  grass: require('../assets/images/grass.png'),
  logo: require('../assets/images/logo.png'),
  mascot: require('../assets/images/mascot.png'),
};

const SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 8px 18px rgba(31, 48, 18, 0.30)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.3, shadowRadius: 10, shadowOffset: { width: 0, height: 5 }, elevation: 6 };

const FEATURES: { icon: any; label: string; tint: string }[] = [
  { icon: 'scan-outline', label: 'Scan', tint: '#DDE5B5' },
  { icon: 'pricetags-outline', label: 'Market', tint: '#F3DDBA' },
  { icon: 'people-outline', label: 'Community', tint: '#CFE3A4' },
];

/* ───────────────────────── small helpers ───────────────────────── */

function useVal(start = 0) {
  return useRef(new Animated.Value(start)).current;
}

/** Plays `n` back-and-forth cycles, then rests at 0. This is the "stop after a while". */
function playCycles(v: Animated.Value, ms: number, n: number) {
  Animated.loop(
    Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(v, { toValue: 0, duration: ms, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]),
    { iterations: n },
  ).start();
}

/* ───────────────────────── reveal (fade + small rise) ───────────────────────── */

function Reveal({ delay, calm, children, rise = 10, duration = 650, style }: any) {
  const v = useVal(calm ? 1 : 0);
  useEffect(() => {
    if (calm) return;
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(v, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);
  return (
    <Animated.View style={[style, { opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [rise, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}

/* ───────────────────────── cloud ───────────────────────── */

function Cloud({ w, top, left, from, delay, drift, dir, calm }: any) {
  const enter = useVal(calm ? 1 : 0);
  useEffect(() => {
    if (calm) return;
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(enter, { toValue: 1, duration: 800, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, []);
  const style: any = {
    position: 'absolute', top, left, width: w, height: w / 1.5,
    opacity: enter.interpolate({ inputRange: [0, 0.02, 0.35, 1], outputRange: [0, 0, 0.95, 0.95], extrapolate: 'clamp' }),
    transform: [
      { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) },
      { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [0, 16 * dir] }) },
    ],
  };
  return (
    <Animated.View pointerEvents="none" style={style}>
      <Image source={IMG.cloud} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
    </Animated.View>
  );
}

/* ───────────────────────── falling coconut ───────────────────────── */

function FallingCoconut({ left, top, fall, trigger }: any) {
  const t = useVal(0);
  const op = useVal(0);
  useEffect(() => {
    if (!trigger) return;
    t.setValue(0);
    op.setValue(1);
    Animated.sequence([
      Animated.timing(t, { toValue: 1, duration: 800, easing: Easing.bounce, useNativeDriver: true }),
      Animated.delay(600),
      Animated.timing(op, { toValue: 0, duration: 350, useNativeDriver: true }),
    ]).start();
  }, [trigger]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute', left, top, width: 28, height: 28, borderRadius: 14, backgroundColor: C.husk,
        alignItems: 'center', justifyContent: 'center', opacity: op,
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [0, fall] }) },
          { rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '300deg'] }) },
        ],
      }}
    >
      <View style={{ position: 'absolute', top: 4, left: 6, width: 8, height: 5, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.28)' }} />
      <View style={{ flexDirection: 'row', gap: 3, marginTop: 6 }}>
        {[0, 1, 2].map((i) => <View key={i} style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#2A1A0C' }} />)}
      </View>
    </Animated.View>
  );
}

/* ───────────────────────── feature: leaf icon with its label underneath ───────────────────────── */

function Feature({ icon, label, tint, flip }: { icon: any; label: string; tint: string; flip: boolean }) {
  // Alternating leaf shapes + tints so the row feels hand-made, not stamped
  const leaf = flip
    ? { borderTopRightRadius: 28, borderBottomLeftRadius: 28, borderTopLeftRadius: 8, borderBottomRightRadius: 8 }
    : { borderTopLeftRadius: 28, borderBottomRightRadius: 28, borderTopRightRadius: 8, borderBottomLeftRadius: 8 };
  return (
    <View style={styles.feature}>
      <View style={[styles.leafIcon, leaf, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={28} color={C.forest} />
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT} style={styles.featureText}>{label}</Text>
    </View>
  );
}


/* ───────────────────────── scalloped top edge ───────────────────────── */

function Scallops({ cw, d, color }: { cw: number; d: number; color: string }) {
  const n = Math.ceil(cw / SCALLOP_STEP) + 2;
  const start = (cw - (n - 1) * SCALLOP_STEP) / 2;
  const cy = SCALLOP_TOP + SCALLOP_D / 2;
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <View
          key={i}
          style={{
            position: 'absolute', width: d, height: d, borderRadius: d / 2, backgroundColor: color,
            left: start + i * SCALLOP_STEP - d / 2, top: cy - d / 2,
          }}
        />
      ))}
    </>
  );
}

/* ───────────────────────── the animated scene ───────────────────────── */

function Scene({ cw, ch, calm, insets }: { cw: number; ch: number; calm: boolean; insets: { top: number; bottom: number } }) {
  // The sign measures itself, so the palms always stand on its edge,
  // however big the person's text size is.
  const [panelH, setPanelH] = useState(400);
  const panelTop = ch - panelH;
  const ground = panelTop + 26;

  // Logo: top left, no box, big. The left palm is sized to fit in the sky beneath it.
  const logoH = Math.min(88, cw * 0.22);
  const skyTop = insets.top + 8 + logoH + 2;
  const lwBase = cw * 0.52, lhBase = (lwBase * 1024) / 497;
  const lScale = Math.max(0.6, Math.min(1, (ground - skyTop) / lhBase));
  const lw = lwBase * lScale, lh = lhBase * lScale;
  const lLeft = -cw * 0.05, lTop = ground - lh;
  // right palm has free sky, so it can be much bigger
  const rwBase = cw * 0.62, rhBase = (rwBase * 1024) / 927;
  const rScale = Math.max(0.6, Math.min(1, (ground - (insets.top + 24)) / rhBase));
  const rw = rwBase * rScale, rh = rhBase * rScale;
  const rLeft = cw - rw + cw * 0.04, rTop = ground - rh;
  // grass: half of it above the sign
  const gw = cw * 1.25, gh = gw / 1.53;
  const gTop = 300 - gh / 2; // centred on the sign's edge: half above, half hidden

  // mascot hangs over the sign's edge by its hands
  const mSrc: any = Image.resolveAssetSource ? Image.resolveAssetSource(IMG.mascot) : null;
  const mRatio = mSrc?.width && mSrc?.height ? mSrc.width / mSrc.height : 1.05;
  const mw = Math.min(150, cw * 0.36), mh = mw / mRatio;
  const mTop = SCALLOP_TOP + 12 - mh * 0.64; // arms land on the scalloped edge

  const logoSrc: any = Image.resolveAssetSource ? Image.resolveAssetSource(IMG.logo) : null;
  const logoW = logoH * (logoSrc?.width && logoSrc?.height ? logoSrc.width / logoSrc.height : 1.5);

  // entrance values
  const treeL = useVal(calm ? 1 : 0);
  const treeR = useVal(calm ? 1 : 0);
  const grass = useVal(calm ? 1 : 0);
  const panel = useVal(calm ? 1 : 0);
  const btn = useVal(calm ? 1 : 0);
  const mascot = useVal(calm ? 1 : 0);
  // idle values
  const drift = useVal(0);
  const sway = useVal(0);
  // interaction values
  const shakeL = useVal(0);
  const shakeR = useVal(0);
  const [dropL, setDropL] = useState(0);
  const [dropR, setDropR] = useState(0);

  useEffect(() => {
    if (calm) return;
    const bounce = Easing.out(Easing.back(2));
    const go = (v: Animated.Value, delay: number, duration: number, easing: any, done?: () => void) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, { toValue: 1, duration, easing, useNativeDriver: true }),
      ]).start(done);

    go(treeL, 700, 750, bounce);
    go(treeR, 800, 850, bounce);
    go(grass, GRASS_START, GRASS_MS, bounce, () => {
      playCycles(drift, 3200, 3);
      playCycles(sway, 2200, 4);
    });
    go(panel, PANEL_AT, 950, Easing.out(Easing.cubic));
    go(btn, BUTTON_AT, 900, Easing.out(Easing.back(1.4)));
    go(mascot, PANEL_AT + 700, 700, Easing.out(Easing.back(1.8)));
  }, []);

  const shake = (v: Animated.Value) => {
    if (calm) return;
    v.setValue(0);
    Animated.sequence([1, -1, 0.6, -0.6, 0.25, 0].map((x) =>
      Animated.timing(v, { toValue: x, duration: 95, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    )).start();
  };

  const tap = (side: 'l' | 'r') => {
    if (side === 'l') { shake(shakeL); setDropL((n) => n + 1); } else { shake(shakeR); setDropR((n) => n + 1); }
  };

  const treeStyle = (enter: Animated.Value, side: 'l' | 'r', shakeV: Animated.Value): any => {
    const angle = Animated.add(
      sway.interpolate({ inputRange: [0, 1], outputRange: side === 'l' ? [-1.6, 1.6] : [1.6, -1.6] }),
      shakeV.interpolate({ inputRange: [-1, 1], outputRange: [-7, 7] }),
    );
    return {
      opacity: enter.interpolate({ inputRange: [0, 0.02, 0.3, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' }),
      transformOrigin: 'bottom',
      transform: [
        { translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [side === 'l' ? -cw : cw, 0] }) },
        { rotate: angle.interpolate({ inputRange: [-10, 10], outputRange: ['-10deg', '10deg'] }) },
      ],
    };
  };

  return (
    <>
      {/* clouds: two from the left, one from the right */}
      <Cloud w={cw * 0.55} top={ch * 0.03} left={cw * 0.45} from={cw} delay={300} drift={drift} dir={-1} calm={calm} />
      <Cloud w={cw * 0.4} top={ch * 0.19} left={-cw * 0.08} from={-cw} delay={900} drift={drift} dir={1} calm={calm} />
      <Cloud w={cw * 0.3} top={ch * 0.24} left={cw * 0.66} from={cw} delay={1500} drift={drift} dir={-1} calm={calm} />

      {/* grass: half of it shows above the sign, and the palms stand in front of it */}
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', left: -cw * 0.1, top: gTop, width: gw, height: gh,
          opacity: grass.interpolate({ inputRange: [0, 0.02, 0.3, 1], outputRange: [0, 0, 1, 1], extrapolate: 'clamp' }),
          transform: [{ translateY: grass.interpolate({ inputRange: [0, 1], outputRange: [gh, 0] }) }],
        }}
      >
        <Image source={IMG.grass} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
      </Animated.View>

      {/* palms */}
      <Animated.View style={[{ position: 'absolute', left: lLeft, top: lTop, width: lw, height: lh }, treeStyle(treeL, 'l', shakeL)]}>
        <Pressable
          onPress={() => tap('l')} accessibilityRole="button" accessibilityLabel="Palm tree. Tap to shake down a coconut."
          style={{ width: '100%', height: '100%' }}
        >
          <Image source={IMG.treeLeft} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        </Pressable>
      </Animated.View>
      <Animated.View style={[{ position: 'absolute', left: rLeft, top: rTop, width: rw, height: rh }, treeStyle(treeR, 'r', shakeR)]}>
        <Pressable
          onPress={() => tap('r')} accessibilityRole="button" accessibilityLabel="Palm tree. Tap to shake down a coconut."
          style={{ width: '100%', height: '100%' }}
        >
          <Image source={IMG.treeRight} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
        </Pressable>
      </Animated.View>

      <FallingCoconut left={lLeft + lw * 0.52} top={lTop + lh * 0.46} fall={ground - (lTop + lh * 0.46) - 30} trigger={dropL} />
      <FallingCoconut left={rLeft + rw * 0.4} top={rTop + rh * 0.38} fall={ground - (rTop + rh * 0.38) - 20} trigger={dropR} />

      {/* logo, top left */}
      <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + 8, left: 14 }}>
        <Reveal delay={1000} calm={calm}>
          <Image source={IMG.logo} style={{ width: logoW, height: logoH }} resizeMode="contain" accessibilityLabel="CocoVision logo" />
        </Reveal>
      </View>

      {/* ── the sign ── */}
      <Animated.View
        onLayout={(e) => setPanelH(Math.round(e.nativeEvent.layout.height))}
        style={{
          position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: SCALLOP_TOP,
          transform: [{ translateY: panel.interpolate({ inputRange: [0, 1], outputRange: [panelH + 60, 0] }) }],
        }}
      >
        {/* mascot: drawn first, so the leafy edge covers its lower half and it seems to hang on by its hands */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', top: mTop, left: (cw - mw) / 2, width: mw, height: mh,
            opacity: mascot.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
            transform: [{ translateY: mascot.interpolate({ inputRange: [0, 1], outputRange: [mh * 0.8, 0] }) }],
          }}
        >
          <Image source={IMG.mascot} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel="CocoVision mascot" />
        </Animated.View>

        {/* green outline of the scalloped edge (sits behind) */}
        <Scallops cw={cw} d={SCALLOP_D + 8} color={C.lime} />

        {/* paper body */}
        <View style={[styles.sheet, { marginTop: SCALLOP_D / 2, paddingBottom: Math.max(insets.bottom, 12) + 10 }]}>
          {/* stitched inner border */}
          <View style={styles.stitch}>
            <Reveal delay={TITLE_AT} calm={calm}>
              <Text maxFontSizeMultiplier={MAX_FONT} accessibilityRole="header" style={styles.title}>
                {'Welcome to\nCocoVision'}
              </Text>
            </Reveal>

            <Reveal delay={BODY_AT} calm={calm}>
              <Text maxFontSizeMultiplier={MAX_FONT} style={styles.bodyText}>
                Your helper in the coconut farm
              </Text>
            </Reveal>

            <Reveal delay={FEATURES_AT} calm={calm} style={styles.featureRow}>
              {FEATURES.map((f, i) => <Feature key={f.icon} icon={f.icon} label={f.label} tint={f.tint} flip={i === 1} />)}
            </Reveal>

            <Animated.View
              style={{
                alignSelf: 'stretch', marginTop: 16,
                opacity: btn.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 1, 1], extrapolate: 'clamp' }),
                transform: [
                  { translateY: btn.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) },
                  { scale: btn.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                ],
              }}
            >
              <Pressable
                onPress={() => router.replace(NEXT_ROUTE as any)}
                accessibilityRole="button" accessibilityLabel="Get started"
                style={({ pressed }) => [styles.cta, SHADOW, pressed && { transform: [{ scale: 0.97 }], backgroundColor: C.ink }]}
              >
                <Text maxFontSizeMultiplier={MAX_FONT} style={styles.ctaText}>Get started</Text>
                <View style={styles.ctaIcon}>
                  <Ionicons name="arrow-forward" size={24} color={C.ink} />
                </View>
              </Pressable>

            </Animated.View>
          </View>
        </View>

        {/* paper bumps drawn last, so they blend into the body */}
        <Scallops cw={cw} d={SCALLOP_D} color={C.paper} />

        {/* the mascot's hands, in front of the edge */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', left: 0, top: 0, width: cw, height: 1,
            opacity: mascot.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1], extrapolate: 'clamp' }),
          }}
        >
        </Animated.View>
      </Animated.View>
    </>
  );
}

/* ───────────────────────── screen ───────────────────────── */

function NativeWelcome() {
  const insets = useSafeAreaInsets();
  const [fontsLoaded, fontError] = useFonts({ Fredoka_500Medium, Fredoka_600SemiBold, Fredoka_700Bold });
  const [loggedIn, setLoggedIn] = useState(false);
  const [calm, setCalm] = useState<boolean | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);

  useEffect(() => {
    let alive = true;
    getSession().then((s) => {
      if (alive && s && (s.id || s._id || s.user_id || s.token || s.email || s.username || Object.keys(s).length > 0)) {
        setLoggedIn(true);
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((v) => alive && setCalm(RESPECT_REDUCE_MOTION && !!v))
      .catch(() => alive && setCalm(false));
    return () => { alive = false; };
  }, []);

  if (loggedIn) {
    return <Redirect href="/(tabs)" />;
  }

  // Size the painting by hand ("cover", anchored to the bottom so the fields always show)
  const src: any = Image.resolveAssetSource ? Image.resolveAssetSource(IMG.bg) : null;
  const ratio = src?.width && src?.height ? src.width / src.height : 816 / 1456;
  const bgH = size ? Math.max(size.h, size.w / ratio) * 1.05 : 0;
  const bgW = bgH * ratio;
  const ready = size && calm !== null && (fontsLoaded || fontError);

  return (
    <View
      style={styles.screen}
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      {/* static painted background */}
      {size && (
        <Image
          source={IMG.bg}
          resizeMode="stretch"
          blurRadius={BG_BLUR}
          style={[
            { position: 'absolute', width: bgW, height: bgH, left: (size.w - bgW) / 2, bottom: -bgH * 0.02 },
            (Platform.OS as string) === 'web' ? ({ filter: `blur(${BG_BLUR}px)` } as any) : null,
          ]}
        />
      )}
      {ready ? <Scene cw={size!.w} ch={size!.h} calm={!!calm} insets={insets} /> : null}
    </View>
  );
}

export default function WelcomeScreen() {
  if (Platform.OS === 'web') {
    return <Redirect href="/(tabs)" />;
  }
  return <NativeWelcome />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, overflow: 'hidden', backgroundColor: '#FDFCF3' },

  sheet: { backgroundColor: C.paper, paddingHorizontal: 16, paddingTop: 8 },
  stitch: {
    borderWidth: 2, borderStyle: 'dashed', borderColor: C.stitch, borderRadius: 30,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 16, alignItems: 'center',
  },

  title: { fontFamily: F.bold, fontSize: 36, lineHeight: 42, color: C.forest, textAlign: 'center' },
  bodyText: { marginTop: 4, fontFamily: F.medium, fontSize: 19, lineHeight: 25, color: C.body, textAlign: 'center' },

  featureRow: { flexDirection: 'row', gap: 10, marginTop: 14, alignSelf: 'stretch' },
  feature: { flex: 1, alignItems: 'center', gap: 6 },
  leafIcon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  featureText: { fontFamily: F.semi, fontSize: 17, lineHeight: 21, color: C.ink, textAlign: 'center' },

  cta: {
    minHeight: 68, borderRadius: 34, backgroundColor: C.forest, flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', paddingLeft: 30, paddingRight: 9,
    borderBottomWidth: 4, borderBottomColor: C.ink,
  },
  ctaText: { color: C.cream, fontFamily: F.bold, fontSize: 24 },
  ctaIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },

});