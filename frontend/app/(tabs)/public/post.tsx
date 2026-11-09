// frontend/app/(tabs)/public/post.tsx
// Create a community post. Backend: POST /posts/create (multipart)
//   fields: title, description, user_id, files (images optional)
// Laid out like a normal social "Create post" screen:
//   top bar -> who is posting -> title + message -> photos -> pinned bar with what is still missing and the Post button.

import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Platform, ScrollView,
  Image, ActivityIndicator, Alert, Animated, Easing, Pressable, AccessibilityInfo, KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import axios from 'axios';
import { NGROK_URL } from '../../../constants/config';

// ───────────────────────── design tokens ─────────────────────────
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
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }) as string;
const DISPLAY: any = { fontFamily: SERIF, fontWeight: '700', letterSpacing: -0.2 };

const CORNERS = [
  { borderTopLeftRadius: 28, borderTopRightRadius: 10, borderBottomRightRadius: 28, borderBottomLeftRadius: 10 },
  { borderTopLeftRadius: 10, borderTopRightRadius: 28, borderBottomRightRadius: 10, borderBottomLeftRadius: 28 },
];

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

const MAX_IMAGES = 5;
const HEADERS = { 'ngrok-skip-browser-warning': 'true' };

// The message box suggests things to write about, one at a time.
const PROMPTS = [
  'Share a farming tip you have learned…',
  'Ask the community a question…',
  'Show your harvest and tell us about it…',
  'Describe a problem with your crops…',
];

// ───────────────────────── helpers ─────────────────────────
async function getUserId(): Promise<string | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    if (!raw) return null;
    const u = JSON.parse(raw);
    const id = u.id ?? u._id ?? u.user_id ?? u.userId;
    if (!id) console.log('[post] session has no id field. keys:', Object.keys(u));
    return id ? String(id) : null;
  } catch { return null; }
}

// Display only: name and photo for the composer header. Reads the same saved session.
async function getProfile(): Promise<{ name: string; image: string | null }> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    if (!raw) return { name: '', image: null };
    const u = JSON.parse(raw);
    return { name: String(u.name ?? u.username ?? ''), image: u.profileImage ?? u.profile_image ?? null };
  } catch { return { name: '', image: null }; }
}

// FastAPI errors come as a string, a list, or an object with "message".
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

// ───────────────────────── small components ─────────────────────────
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

// Springs in when it first appears (screen content, a newly added photo).
function Pop({ children, style, from = 18, delay = 0 }: any) {
  const a = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    Animated.spring(a, { toValue: 1, delay, friction: 8, tension: 65, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: a,
      transform: [
        { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) },
        { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
      ],
    }]}>
      {children}
    </Animated.View>
  );
}

// Main button. Presses down like a key.
function PressBtn({ label, icon, onPress, disabled = false, tone = 'primary', style, busy = false }: any) {
  const tones: any = {
    primary: { bg: C.moss, edge: C.forest, fg: C.cream },
    light: { bg: C.paper, edge: '#CDB48E', fg: C.ink },
    lime: { bg: C.lime, edge: '#6B7C16', fg: C.ink },
  };
  const t = tones[tone];
  const y = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.timing(y, { toValue: v, duration: 90, useNativeDriver: ND }).start();
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      onPressIn={() => to(3)} onPressOut={() => to(0)}
      style={[{ opacity: disabled ? 0.45 : 1 }, style, Platform.OS === 'web' ? ({ cursor: disabled ? 'default' : 'pointer' } as any) : null]}
    >
      <View style={{ paddingBottom: 5 }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 5, bottom: 0, backgroundColor: t.edge, borderRadius: 20 }} />
        <Animated.View style={{
          backgroundColor: t.bg, borderRadius: 20, minHeight: 58, flexDirection: 'row', alignItems: 'center',
          justifyContent: 'center', gap: 10, paddingHorizontal: 18, transform: [{ translateY: y }],
        }}>
          {busy ? <ActivityIndicator color={t.fg} /> : icon ? <Ionicons name={icon} size={24} color={t.fg} /> : null}
          <Text style={{ color: t.fg, fontSize: 19, fontWeight: '800', flexShrink: 1 }}>{label}</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

function Avatar({ uri, name, size = 56 }: { uri?: string | null; name?: string; size?: number }) {
  const r = size / 2;
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r, backgroundColor: C.sand }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: C.forest, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: C.cream, fontFamily: SERIF, fontWeight: '700', fontSize: size * 0.44 }}>{(name || 'U').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

// ───────────────────────── screen ─────────────────────────
export default function CreatePostScreen() {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<{ name: string; image: string | null }>({ name: '', image: null });
  const [checked, setChecked] = useState(false);
  const [posting, setPosting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [focusField, setFocusField] = useState('');
  const [promptIdx, setPromptIdx] = useState(0);

  const tipY = useLoop(1100);
  const successA = useRef(new Animated.Value(0)).current;

  // re-check login every time the screen is shown
  useFocusEffect(
    React.useCallback(() => {
      getUserId().then((id) => { setUserId(id); setChecked(true); });
      getProfile().then(setProfile);
    }, [])
  );

  // rotate the message placeholder while it is empty
  useEffect(() => {
    if (description) return;
    const t = setInterval(() => setPromptIdx((i) => (i + 1) % PROMPTS.length), 3800);
    return () => clearInterval(t);
  }, [description]);

  const pickImages = async () => {
    const room = MAX_IMAGES - images.length;
    if (room <= 0) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: room,
      quality: 0.7,
    });
    if (res.canceled) return;
    setImages((prev) => [...prev, ...res.assets].slice(0, MAX_IMAGES));
    setError('');
  };

  const removeImage = (i: number) => setImages((prev) => prev.filter((_, idx) => idx !== i));

  const hasTitle = title.trim().length > 0;
  const hasDesc = description.trim().length > 0;
  const hasPhoto = images.length > 0;
  const canPost = !!userId && hasTitle && hasDesc && !posting;
  const dirty = hasTitle || hasDesc || hasPhoto;

  const close = () => {
    const leave = () => { if (router.canGoBack()) router.back(); else router.replace('/(tabs)'); };
    if (!dirty || posting) return leave();
    Alert.alert('Leave without posting?', 'What you wrote will be lost.', [
      { text: 'Keep writing', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: leave },
    ]);
  };

  const submit = async () => {
    if (!canPost || !userId) return;
    setPosting(true);
    setError('');
    try {
      const form = new FormData();
      form.append('title', title.trim());
      form.append('description', description.trim());
      form.append('user_id', userId);

      for (let i = 0; i < images.length; i++) {
        const a = images[i];
        const name = a.fileName || `photo_${i}.jpg`;
        const type = a.mimeType || 'image/jpeg';
        if (Platform.OS === 'web') {
          const blob = await (await fetch(a.uri)).blob();
          form.append('files', blob, name);
        } else {
          form.append('files', { uri: a.uri, name, type } as any);
        }
      }

      // axios (XHR) accepts { uri, name, type } parts; Expo's fetch does not.
      const res = await axios.post(`${NGROK_URL}/posts/create`, form, {
        headers: { ...HEADERS, 'Content-Type': 'multipart/form-data' },
        transformRequest: (d) => d,
        validateStatus: () => true,
        timeout: 60000,
      });

      if (res.status < 200 || res.status >= 300) {
        throw new Error(errorText(res.data, res.status));
      }

      setTitle('');
      setDescription('');
      setImages([]);
      setDone(true);
      if (REDUCE) successA.setValue(1);
      else Animated.spring(successA, { toValue: 1, friction: 6, tension: 80, useNativeDriver: ND }).start();
      setTimeout(() => router.replace('/(tabs)'), 1400);
    } catch (e: any) {
      setError(e?.message || 'Could not create your post. Please try again.');
    } finally {
      setPosting(false);
    }
  };

  const single = images.length === 1;
  const descPct = Math.min(1, description.length / 2000);
  const nearLimit = description.length >= 1800;

  // ───────────────────────── render ─────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* top bar */}
      <View style={s.topBar}>
        <Pressable onPress={close} accessibilityRole="button" accessibilityLabel="Close" style={s.roundBtn}>
          <Ionicons name="close" size={28} color={C.cream} />
        </Pressable>
        <Text style={[DISPLAY, s.topTitle]}>Create post</Text>
        <View style={{ width: 50 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {!checked ? (
            <View style={{ alignItems: 'center', marginTop: 60, gap: 12 }}>
              <ActivityIndicator color={C.moss} size="large" />
              <Text style={{ color: C.body, fontWeight: '700', fontSize: 18 }}>Just a moment…</Text>
            </View>
          ) : !userId ? (
            <Pop style={[s.wrap, { marginTop: 24 }]}>
              <View style={[s.loginCard, CORNERS[0]]}>
                <View style={s.lockIcon}><Ionicons name="lock-closed" size={30} color={C.ink} /></View>
                <Text style={[DISPLAY, s.loginTitle]}>Please log in first</Text>
                <Text style={s.loginBody}>You need an account to post in the community.</Text>
                <PressBtn tone="lime" icon="log-in" label="Go to login" onPress={() => router.push('/(auth)/login')} style={{ marginTop: 20, alignSelf: 'stretch' }} />
              </View>
            </Pop>
          ) : (
            <Pop style={s.wrap}>
              {/* who is posting */}
              <View style={s.whoRow}>
                <Avatar uri={profile.image} name={profile.name} />
                <View style={{ flex: 1 }}>
                  <Text style={s.whoName} numberOfLines={1}>{profile.name || 'You'}</Text>
                  <View style={s.whoPill}>
                    <Ionicons name="people" size={16} color={C.forest} />
                    <Text style={s.whoPillText}>Posting to the community</Text>
                  </View>
                </View>
              </View>

              {/* writing area */}
              <View style={s.sheet}>
                <TextInput
                  style={[s.titleInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
                  placeholder="Give your post a title"
                  placeholderTextColor="#7d8870"
                  value={title}
                  onChangeText={setTitle}
                  onFocus={() => setFocusField('title')}
                  onBlur={() => setFocusField('')}
                  maxLength={120}
                  accessibilityLabel="Post title"
                />
                <View style={[s.underline, focusField === 'title' && { backgroundColor: C.lime, height: 4 }]} />

                <TextInput
                  style={[s.bodyInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
                  placeholder={PROMPTS[promptIdx]}
                  placeholderTextColor="#7d8870"
                  value={description}
                  onChangeText={setDescription}
                  onFocus={() => setFocusField('desc')}
                  onBlur={() => setFocusField('')}
                  multiline
                  textAlignVertical="top"
                  maxLength={2000}
                  accessibilityLabel="Post message"
                />
                <View style={s.lengthTrack}>
                  <View style={[s.lengthFill, { width: `${descPct * 100}%`, backgroundColor: nearLimit ? '#C4631A' : C.lime }]} />
                </View>
                {description.length >= 1500 && (
                  <Text style={[s.counter, nearLimit && { color: '#9A4A10' }]}>{description.length} of 2000 letters</Text>
                )}
              </View>

              {/* photos */}
              {images.length === 0 ? (
                <Pressable onPress={pickImages} accessibilityRole="button" accessibilityLabel="Add photos from your gallery"
                  style={[s.dropZone, CORNERS[1], Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}>
                  <Animated.View style={[s.dropIcon, { transform: [{ translateY: tipY.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }] }]}>
                    <Ionicons name="images" size={34} color={C.ink} />
                  </Animated.View>
                  <Text style={[DISPLAY, s.dropTitle]}>Add photos (optional)</Text>
                  <Text style={s.dropSub}>Tap here to choose up to {MAX_IMAGES} pictures from your gallery.</Text>
                </Pressable>
              ) : (
                <View style={s.photoGrid}>
                  {images.map((a, i) => (
                    <Pop key={`${a.uri}-${i}`} from={12} style={[s.photoCell, single && { width: '100%' }]}>
                      <View style={[s.photoFrame, CORNERS[i % 2], { aspectRatio: single ? 4 / 3 : 1 }]}>
                        <Image source={{ uri: a.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        <Pressable
                          onPress={() => removeImage(i)} accessibilityRole="button" accessibilityLabel={`Remove photo ${i + 1}`}
                          hitSlop={6} style={[s.xBtn, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
                        >
                          <Ionicons name="close" size={24} color="#fff" />
                        </Pressable>
                      </View>
                    </Pop>
                  ))}
                  {images.length < MAX_IMAGES && (
                    <Pressable onPress={pickImages} accessibilityRole="button" accessibilityLabel="Add more photos"
                      style={[s.photoCell, s.addTile, single && { aspectRatio: undefined, minHeight: 72 }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}>
                      <Ionicons name="add-circle" size={34} color={C.moss} />
                      <Text style={s.addTileText}>Add more</Text>
                      <Text style={s.addTileSub}>{images.length} of {MAX_IMAGES}</Text>
                    </Pressable>
                  )}
                </View>
              )}

              {/* Post button */}
              <PressBtn
                tone="primary" icon="paper-plane" label={posting ? 'Posting…' : 'Post to community'}
                onPress={submit} disabled={!canPost} busy={posting} style={{ marginTop: 22 }}
              />

              {!!error && (
                <Pop from={8} style={[s.errorBox, { marginTop: 16 }]}>
                  <Ionicons name="warning" size={24} color="#9A1B12" />
                  <Text style={s.errorText}>{error}</Text>
                </Pop>
              )}
            </Pop>
          )}
          <View style={{ height: 120 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* success */}
      {done && (
        <View style={s.overlay} pointerEvents="auto">
          <Animated.View style={[s.successCard, CORNERS[0], {
            opacity: successA,
            transform: [{ scale: successA.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1] }) }],
          }]}>
            <View style={s.successIcon}><Ionicons name="checkmark" size={44} color={C.cream} /></View>
            <Text style={[DISPLAY, s.successTitle]}>Your post is live</Text>
            <Text style={s.successBody}>Taking you back to the community feed…</Text>
          </Animated.View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ───────────────────────── styles ─────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.forest },
  scroll: { alignItems: 'center' },
  wrap: { width: '92%', maxWidth: 620, paddingTop: 16 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.forest, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 14,
  },
  topTitle: { color: C.cream, fontSize: 22 },
  roundBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(245,230,211,0.16)', alignItems: 'center', justifyContent: 'center' },

  loginCard: { backgroundColor: C.forest, padding: 24, alignItems: 'center' },
  lockIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },
  loginTitle: { color: C.cream, fontSize: 26, lineHeight: 32, marginTop: 14, textAlign: 'center' },
  loginBody: { color: C.leaf, fontWeight: '500', fontSize: 18, lineHeight: 26, marginTop: 8, textAlign: 'center' },

  whoRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  whoName: { fontSize: 20, fontWeight: '800', color: C.ink },
  whoPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', backgroundColor: C.leaf,
    borderRadius: 14, paddingHorizontal: 10, paddingVertical: 4, marginTop: 4,
  },
  whoPillText: { fontSize: 15, fontWeight: '700', color: C.forest },

  sheet: {
    backgroundColor: C.paper, borderWidth: 2, borderColor: C.sand, marginTop: 16, padding: 16,
    borderTopLeftRadius: 28, borderTopRightRadius: 10, borderBottomRightRadius: 28, borderBottomLeftRadius: 10,
  },
  titleInput: {
    fontFamily: SERIF, fontSize: 26, lineHeight: 32, fontWeight: '700', color: C.forest,
    paddingVertical: 8, minHeight: 52,
  },
  underline: { height: 3, borderRadius: 2, backgroundColor: C.sand },
  bodyInput: {
    fontSize: 20, lineHeight: 29, fontWeight: '400', color: C.ink, marginTop: 12, minHeight: 150, paddingVertical: 8,
    textAlignVertical: 'top',
  },
  lengthTrack: { height: 4, borderRadius: 2, backgroundColor: C.sand, overflow: 'hidden', marginTop: 8 },
  lengthFill: { height: 4, borderRadius: 2 },
  counter: { alignSelf: 'flex-end', fontSize: 15, fontWeight: '700', color: C.body, marginTop: 6 },

  dropZone: {
    marginTop: 16, alignItems: 'center', paddingVertical: 28, paddingHorizontal: 20,
    borderWidth: 3, borderStyle: 'dashed', borderColor: C.moss, backgroundColor: 'rgba(221,229,181,0.45)',
  },
  dropIcon: { width: 68, height: 68, borderRadius: 34, backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center' },
  dropTitle: { fontSize: 24, color: C.forest, marginTop: 12 },
  dropSub: { fontSize: 18, lineHeight: 26, color: C.body, fontWeight: '500', textAlign: 'center', marginTop: 6 },

  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, marginTop: 16 },
  photoCell: { width: '49%' },
  photoFrame: { width: '100%', backgroundColor: C.sand, overflow: 'hidden', borderWidth: 2, borderColor: C.sand },
  xBtn: {
    position: 'absolute', top: 8, right: 8, width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(31,48,18,0.82)', alignItems: 'center', justifyContent: 'center',
  },
  addTile: {
    aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 2,
    borderWidth: 3, borderStyle: 'dashed', borderColor: C.moss, borderRadius: 20, backgroundColor: 'rgba(221,229,181,0.45)',
  },
  addTileText: { fontSize: 18, fontWeight: '800', color: C.forest },
  addTileSub: { fontSize: 15, fontWeight: '600', color: C.body },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FDE7E4', borderWidth: 2, borderColor: '#F3B7B0', borderRadius: 16, padding: 14,
  },
  errorText: { flex: 1, color: '#9A1B12', fontSize: 17, fontWeight: '700', lineHeight: 24 },

  overlay: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: 'rgba(31,48,18,0.72)',
    alignItems: 'center', justifyContent: 'center', padding: 24,
  },
  successCard: { backgroundColor: C.paper, padding: 28, alignItems: 'center', width: '100%', maxWidth: 380 },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.moss, alignItems: 'center', justifyContent: 'center' },
  successTitle: { fontSize: 26, color: C.forest, marginTop: 16, textAlign: 'center' },
  successBody: { fontSize: 18, lineHeight: 26, color: C.body, fontWeight: '500', marginTop: 6, textAlign: 'center' },
});