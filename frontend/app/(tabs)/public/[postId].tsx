// frontend/app/(tabs)/public/[postId].tsx
// Full post, laid out like a normal social post:
//   author row -> text -> edge-to-edge photos -> counts -> Like / Comment / Share -> comments -> pinned comment box.
// Backend (unchanged):
//   GET    /posts/{id}
//   POST   /posts/{id}/like                 -> { action, like_count, user_liked }
//   POST   /posts/{id}/comment  { text }    -> { comment, comment_count }
//   DELETE /posts/{id}/comment/{commentId}
//   PUT    /posts/{id}  { title, description }   (owner only)
//   DELETE /posts/{id}                      (owner only)

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TextInput, StyleSheet, Platform, ScrollView, Image, Share,
  ActivityIndicator, Alert, KeyboardAvoidingView, Animated, Easing, Pressable, AccessibilityInfo,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { router, useLocalSearchParams } from 'expo-router';
import { useFocusEffect } from 'expo-router/react-navigation';
import { NGROK_URL } from '../../../constants/config';
import { authHeaders as sessionHeaders } from '../../../constants/session';

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
  line: '#E3CFB2',
};
const HEART = '#D1362B';
const ND = Platform.OS !== 'web';

// Serif for headings (feels like a printed farm almanac), plain system font for body text.
const SERIF = Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Times New Roman", serif' }) as string;
const DISPLAY: any = { fontFamily: SERIF, fontWeight: '700', letterSpacing: -0.2 };

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

const HEADERS = { 'ngrok-skip-browser-warning': 'true' };
const QUICK_REPLIES = ['Thank you for sharing', 'Very helpful', 'Where can I find this?'];
const BURST = Array.from({ length: 8 }, (_, i) => (i * Math.PI * 2) / 8);

// ───────────────────────── helpers ─────────────────────────
async function getUserId(): Promise<string | null> {
  try {
    const raw = Platform.OS === 'web'
      ? localStorage.getItem('user_session')
      : await SecureStore.getItemAsync('user_session');
    if (!raw) return null;
    const u = JSON.parse(raw);
    const id = u.id ?? u._id ?? u.user_id ?? u.userId;
    if (!id) console.log('[postId] session has no id field. keys:', Object.keys(u));
    return id ? String(id) : null;
  } catch { return null; }
}

async function readJson(res: Response) {
  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }
  if (!res.ok) {
    const d = data?.detail;
    throw new Error(typeof d === 'string' ? d : `HTTP ${res.status}`);
  }
  return data;
}

// Backend sends naive ISO strings. Comments and likes use utcnow(), posts use local now().
function parseTs(ts: any, utc: boolean): Date | null {
  if (!ts) return null;
  let s = String(ts).replace(/(\.\d{3})\d+/, '$1');
  if (utc && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function ago(d: Date | null): string {
  if (!d) return '';
  const sec = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return 'Just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} hr ago`;
  if (sec < 604800) return `${Math.floor(sec / 86400)} days ago`;
  return d.toLocaleDateString();
}

// ───────────────────────── small components ─────────────────────────
function useLoop(duration = 1400) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (REDUCE) return;
    const l = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(v, { toValue: 0, duration, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  return v;
}

// Entrance for things that appear because the person did something (a new comment, the menu).
function Pop({ children, style, from = 14 }: any) {
  const a = useRef(new Animated.Value(REDUCE ? 1 : 0)).current;
  useEffect(() => {
    if (REDUCE) return;
    Animated.spring(a, { toValue: 1, friction: 8, tension: 70, useNativeDriver: ND }).start();
  }, []);
  return (
    <Animated.View style={[style, {
      opacity: a,
      transform: [
        { translateY: a.interpolate({ inputRange: [0, 1], outputRange: [from, 0] }) },
        { scale: a.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
      ],
    }]}>
      {children}
    </Animated.View>
  );
}

// Used for the main call-to-action buttons only. Presses down like a key.
function PressBtn({ label, icon, onPress, disabled = false, tone = 'primary', style, busy = false }: any) {
  const tones: any = {
    primary: { bg: C.moss, edge: C.forest, fg: C.cream },
    light: { bg: C.paper, edge: '#CDB48E', fg: C.ink },
    leaf: { bg: C.leaf, edge: '#A3B168', fg: C.ink },
  };
  const t = tones[tone];
  const y = useRef(new Animated.Value(0)).current;
  const to = (v: number) => Animated.timing(y, { toValue: v, duration: 90, useNativeDriver: ND }).start();
  return (
    <Pressable
      onPress={onPress} disabled={disabled} accessibilityRole="button" accessibilityLabel={label}
      onPressIn={() => to(3)} onPressOut={() => to(0)}
      style={[{ opacity: disabled ? 0.5 : 1 }, style, Platform.OS === 'web' ? ({ cursor: disabled ? 'default' : 'pointer' } as any) : null]}
    >
      <View style={{ paddingBottom: 5 }}>
        <View style={{ position: 'absolute', left: 0, right: 0, top: 5, bottom: 0, backgroundColor: t.edge, borderRadius: 18 }} />
        <Animated.View style={{
          backgroundColor: t.bg, borderRadius: 18, minHeight: 54, flexDirection: 'row', alignItems: 'center',
          justifyContent: 'center', gap: 10, paddingHorizontal: 16, transform: [{ translateY: y }],
        }}>
          {busy ? <ActivityIndicator color={t.fg} /> : icon ? <Ionicons name={icon} size={22} color={t.fg} /> : null}
          <Text style={{ color: t.fg, fontSize: 17, fontWeight: '800', flexShrink: 1 }}>{label}</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

function Avatar({ uri, name, size = 48, tone = C.forest }: { uri?: string | null; name?: string; size?: number; tone?: string }) {
  const r = size / 2;
  if (uri) return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: r, backgroundColor: C.sand }} />;
  return (
    <View style={{ width: size, height: size, borderRadius: r, backgroundColor: tone, justifyContent: 'center', alignItems: 'center' }}>
      <Text style={{ color: C.cream, fontFamily: SERIF, fontWeight: '700', fontSize: size * 0.44 }}>{(name || 'U').charAt(0).toUpperCase()}</Text>
    </View>
  );
}

function SlideArrow({ dir, onPress, label }: any) {
  const sc = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress} accessibilityRole="button" accessibilityLabel={label} hitSlop={8}
      onPressIn={() => go(0.9)} onPressOut={() => go(1)}
      style={[{ position: 'absolute', top: '50%', marginTop: -26, width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
        dir === 'left' ? { left: 6 } : { right: 6 }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
    >
      <Animated.View style={[s.arrow, { transform: [{ scale: sc }] }]}>
        <Ionicons name={dir === 'left' ? 'chevron-back' : 'chevron-forward'} size={26} color={C.forest} />
      </Animated.View>
    </Pressable>
  );
}

// Post-shaped placeholder while loading.
function SkeletonPost() {
  const v = useLoop(800);
  const op = v.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  const bar = (w: any, h = 14) => <Animated.View style={{ width: w, height: h, borderRadius: h / 2, backgroundColor: C.leaf, opacity: op }} />;
  return (
    <View style={[s.post, { padding: 16, gap: 14 }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Animated.View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: C.leaf, opacity: op }} />
        <View style={{ gap: 8, flex: 1 }}>{bar('45%', 16)}{bar('28%', 12)}</View>
      </View>
      {bar('70%', 24)}
      {bar('100%')}
      {bar('90%')}
      <Animated.View style={{ height: 220, borderRadius: 4, backgroundColor: C.leaf, opacity: op, marginHorizontal: -16 }} />
    </View>
  );
}

// Like / Comment / Share. Flat buttons in a row, like a normal social post.
function ActionBtn({ icon, label, onPress, active, activeColor = C.forest, disabled, children }: any) {
  const sc = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(sc, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 8 }).start();
  return (
    <Animated.View style={{ flex: 1, transform: [{ scale: sc }] }}>
      <Pressable
        onPress={onPress} disabled={disabled} onPressIn={() => go(0.94)} onPressOut={() => go(1)}
        accessibilityRole="button" accessibilityLabel={label}
        style={[s.actionBtn, active && { backgroundColor: '#FBE3E0' }, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
      >
        {children || <Ionicons name={icon} size={26} color={active ? activeColor : C.forest} />}
        <Text style={[s.actionText, active && { color: activeColor }]}>{label}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ───────────────────────── screen ─────────────────────────
export default function PostDetailScreen() {
  const params = useLocalSearchParams<{ postId: string }>();
  const id = Array.isArray(params.postId) ? params.postId[0] : params.postId;

  const [post, setPost] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [liking, setLiking] = useState(false);

  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [commentError, setCommentError] = useState('');
  const [inputFocus, setInputFocus] = useState(false);
  const [newId, setNewId] = useState('');

  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  const [galleryW, setGalleryW] = useState(0);
  const [imgIndex, setImgIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const firstLoad = useRef(true);

  const scrollRef = useRef<any>(null);
  const galleryRef = useRef<ScrollView | null>(null);
  const inputRef = useRef<TextInput | null>(null);
  const commentsY = useRef(0);
  const lastTap = useRef(0);

  const scrollY = useRef(new Animated.Value(0)).current;
  const heart = useRef(new Animated.Value(1)).current;
  const burst = useRef(new Animated.Value(0)).current;
  const bigHeart = useRef(new Animated.Value(0)).current;
  const countBump = useRef(new Animated.Value(1)).current;

  const load = useCallback(async () => {
    if (!id) { setLoadError('This post link is missing.'); setLoading(false); return; }
    if (firstLoad.current) setLoading(true);
    try {
      const uid = await getUserId();
      setUserId(uid);

      const res = await fetch(`${NGROK_URL}/posts/${id}`, { headers: HEADERS });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); }
      catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }

      // main.py returns errors as [{ error }, 400] with HTTP 200, so check the body too.
      if (!res.ok || Array.isArray(data) || data?.error) throw new Error('This post could not be found. It may have been removed.');

      setPost(data);
      setLikeCount((data.likes || []).length);
      setLiked(!!uid && (data.likes || []).some((l: any) => l.user_id === uid));
      setComments(data.comments || []);
      setLoadError('');
      firstLoad.current = false;
    } catch (e: any) {
      setLoadError(e?.message || 'Could not load this post. Check your internet and try again.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const needLogin = (what: string) =>
    Alert.alert('Please log in', `You need to log in to ${what}.`, [
      { text: 'Not now', style: 'cancel' },
      { text: 'Log in', onPress: () => router.push('/(auth)/login') },
    ]);

  const authHeaders = async () => ({ ...HEADERS, ...(await sessionHeaders()) });

  // The heart pops, a ring of little dots flies outward, and the number bounces.
  const celebrateLike = () => {
    if (REDUCE) return;
    heart.setValue(0.5);
    Animated.spring(heart, { toValue: 1, friction: 3, tension: 130, useNativeDriver: ND }).start();
    burst.setValue(0);
    Animated.timing(burst, { toValue: 1, duration: 520, easing: Easing.out(Easing.cubic), useNativeDriver: ND }).start();
  };

  const bumpCount = () => {
    if (REDUCE) return;
    countBump.setValue(1.25);
    Animated.spring(countBump, { toValue: 1, friction: 4, tension: 140, useNativeDriver: ND }).start();
  };

  const showBigHeart = () => {
    if (REDUCE) return;
    bigHeart.setValue(0);
    Animated.sequence([
      Animated.spring(bigHeart, { toValue: 1, friction: 5, tension: 120, useNativeDriver: ND }),
      Animated.delay(300),
      Animated.timing(bigHeart, { toValue: 2, duration: 280, useNativeDriver: ND }),
    ]).start();
  };

  // ── like ──
  const toggleLike = async () => {
    if (!userId) return needLogin('like posts');
    if (liking) return;
    setLiking(true);
    if (!liked) celebrateLike();
    bumpCount();
    const prevLiked = liked, prevCount = likeCount;
    setLiked(!prevLiked);
    setLikeCount(prevCount + (prevLiked ? -1 : 1));
    try {
      const data = await readJson(await fetch(`${NGROK_URL}/posts/${id}/like`, {
        method: 'POST', headers: await authHeaders(),
      }));
      setLiked(!!data.user_liked);
      if (typeof data.like_count === 'number') setLikeCount(data.like_count);
    } catch (e: any) {
      setLiked(prevLiked);
      setLikeCount(prevCount);
      setActionError(e?.message || 'Could not update your like.');
    } finally {
      setLiking(false);
    }
  };

  // double tap on a photo = like
  const onPhotoTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      lastTap.current = 0;
      if (!userId) { needLogin('like posts'); return; }
      showBigHeart();
      if (!liked) toggleLike();
    } else {
      lastTap.current = now;
    }
  };

  const sharePost = async () => {
    try {
      await Share.share({ message: `${post?.title || ''}\n\n${post?.description || ''}`.trim() });
    } catch {}
  };

  // ── comments ──
  const sendComment = async () => {
    const text = commentText.trim();
    if (!text || sending) return;
    if (!userId) return needLogin('comment');
    setSending(true);
    setCommentError('');
    try {
      const data = await readJson(await fetch(`${NGROK_URL}/posts/${id}/comment`, {
        method: 'POST',
        headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      }));
      if (data.comment) {
        setComments((prev) => [...prev, data.comment]);
        setNewId(String(data.comment.id));
        setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 200);
      }
      setCommentText('');
    } catch (e: any) {
      setCommentError(e?.message || 'Could not post your comment.');
    } finally {
      setSending(false);
    }
  };

  const deleteComment = (commentId: string) => {
    Alert.alert('Delete comment', 'Do you want to remove your comment?', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          try {
            await readJson(await fetch(`${NGROK_URL}/posts/${id}/comment/${commentId}`, {
              method: 'DELETE', headers: await authHeaders(),
            }));
            setComments((prev) => prev.filter((c) => c.id !== commentId));
          } catch (e: any) {
            setCommentError(e?.message || 'Could not delete your comment.');
          }
        },
      },
    ]);
  };

  const goComments = () => {
    scrollRef.current?.scrollTo({ y: Math.max(0, commentsY.current - 12), animated: true });
    setTimeout(() => inputRef.current?.focus(), 350);
  };

  // ── owner actions ──
  const startEdit = () => {
    setEditTitle(post?.title || '');
    setEditDesc(post?.description || '');
    setActionError('');
    setMenuOpen(false);
    setEditing(true);
  };

  const saveEdit = async () => {
    if (!editTitle.trim() || !editDesc.trim() || busy) return;
    setBusy(true);
    setActionError('');
    try {
      await readJson(await fetch(`${NGROK_URL}/posts/${id}`, {
        method: 'PUT',
        headers: { ...(await sessionHeaders()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim(), description: editDesc.trim() }),
      }));
      setPost((p: any) => ({ ...p, title: editTitle.trim(), description: editDesc.trim() }));
      setEditing(false);
    } catch (e: any) {
      setActionError(e?.message || 'Could not save your changes.');
    } finally {
      setBusy(false);
    }
  };

  const deletePost = () => {
    setMenuOpen(false);
    Alert.alert('Delete post', 'This cannot be undone. Delete this post?', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await readJson(await fetch(`${NGROK_URL}/posts/${id}`, {
              method: 'DELETE', headers: await authHeaders(),
            }));
            router.replace('/(tabs)');
          } catch (e: any) {
            setActionError(e?.message || 'Could not delete this post.');
            setBusy(false);
          }
        },
      },
    ]);
  };

  const goBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)');
  };

  // ── gallery ──
  const images: string[] = post?.image_urls?.length ? post.image_urls : post?.image ? [post.image] : [];
  const goImg = (n: number) => {
    if (!images.length || !galleryW) return;
    const i = (n + images.length) % images.length;
    setImgIndex(i);
    galleryRef.current?.scrollTo({ x: i * galleryW, animated: true });
  };

  const isOwner = !!userId && post?.author?.id === userId;
  const canEditSave = !!editTitle.trim() && !!editDesc.trim() && !busy;
  const canSend = !!commentText.trim() && !sending;
  const longDesc = (post?.description || '').length > 260;

  // header title crossfade: "Post" at the top, author's name once you scroll past the header of the post
  const postTitleOp = scrollY.interpolate({ inputRange: [0, 70], outputRange: [1, 0], extrapolate: 'clamp' });
  const authorTitleOp = scrollY.interpolate({ inputRange: [50, 120], outputRange: [0, 1], extrapolate: 'clamp' });
  const authorTitleY = scrollY.interpolate({ inputRange: [50, 120], outputRange: [10, 0], extrapolate: 'clamp' });

  // ───────────────────────── render ─────────────────────────
  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      {/* top bar */}
      <View style={s.topBar}>
        <Pressable onPress={goBack} accessibilityRole="button" accessibilityLabel="Go back" style={s.roundBtn}>
          <Ionicons name="arrow-back" size={26} color={C.cream} />
        </Pressable>
        <View style={s.topCenter} pointerEvents="none">
          <Animated.Text style={[DISPLAY, s.topTitle, { opacity: postTitleOp, position: 'absolute' }]}>Post</Animated.Text>
          <Animated.Text numberOfLines={1} style={[DISPLAY, s.topTitle, { opacity: authorTitleOp, transform: [{ translateY: authorTitleY }] }]}>
            {post?.author?.name || 'Post'}
          </Animated.Text>
        </View>
        {isOwner && !editing ? (
          <Pressable onPress={() => setMenuOpen((o) => !o)} accessibilityRole="button" accessibilityLabel="Post options"
            style={[s.roundBtn, menuOpen && { backgroundColor: C.lime }]}>
            <Ionicons name="ellipsis-horizontal" size={26} color={menuOpen ? C.ink : C.cream} />
          </Pressable>
        ) : <View style={{ width: 50 }} />}
      </View>

      <KeyboardAvoidingView style={{ flex: 1, backgroundColor: C.cream }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Animated.ScrollView
          ref={scrollRef}
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          scrollEventThrottle={16}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: ND })}
        >
          {loading ? (
            <View style={[s.wrap, { marginTop: 14 }]}>
              <SkeletonPost />
            </View>
          ) : loadError || !post ? (
            <View style={[s.wrap, { marginTop: 24 }]}>
              <View style={s.errorCard}>
                <View style={s.errorIcon}><Ionicons name="leaf" size={34} color={C.forest} /></View>
                <Text style={[DISPLAY, s.errorTitle]}>We could not open this post</Text>
                <Text style={s.errorBody}>{loadError || 'This post could not be found.'}</Text>
                <PressBtn tone="primary" icon="refresh" label="Try again" onPress={() => { firstLoad.current = true; load(); }} style={{ marginTop: 20, alignSelf: 'stretch' }} />
                <PressBtn tone="light" icon="home" label="Go to home" onPress={() => router.replace('/(tabs)')} style={{ marginTop: 8, alignSelf: 'stretch' }} />
              </View>
            </View>
          ) : (
            <View style={s.wrap}>
              {/* owner menu: a small popover, not a stack of big buttons */}
              {menuOpen && isOwner && (
                <Pop style={s.menuWrap} from={-8}>
                  <View style={s.menu}>
                    <Pressable onPress={startEdit} accessibilityRole="button" accessibilityLabel="Edit post" style={s.menuItem}>
                      <Ionicons name="create-outline" size={24} color={C.forest} />
                      <Text style={s.menuText}>Edit post</Text>
                    </Pressable>
                    <View style={s.menuDivider} />
                    <Pressable onPress={deletePost} disabled={busy} accessibilityRole="button" accessibilityLabel="Delete post" style={s.menuItem}>
                      <Ionicons name="trash-outline" size={24} color="#9A2B14" />
                      <Text style={[s.menuText, { color: '#9A2B14' }]}>Delete post</Text>
                    </Pressable>
                  </View>
                </Pop>
              )}

              {/* the post */}
              <View style={s.post}>
                <View style={s.authorRow}>
                  <Avatar uri={post.author?.profileImage} name={post.author?.name} size={52} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.authorName} numberOfLines={1}>{post.author?.name || 'Anonymous'}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name="time-outline" size={16} color={C.body} />
                      <Text style={s.timeText}>{ago(parseTs(post.timestamp, false))}</Text>
                    </View>
                  </View>
                </View>

                {editing ? (
                  <View style={s.editBox}>
                    <Text style={s.fieldLabel}>Title</Text>
                    <TextInput style={s.input} value={editTitle} onChangeText={setEditTitle} maxLength={120}
                      placeholder="Title" placeholderTextColor="#7d8870" accessibilityLabel="Post title" />
                    <Text style={s.fieldLabel}>Description</Text>
                    <TextInput
                      style={[s.input, { minHeight: 150 }]}
                      value={editDesc} onChangeText={setEditDesc} multiline textAlignVertical="top" maxLength={2000}
                      placeholder="Description" placeholderTextColor="#7d8870" accessibilityLabel="Post description"
                    />
                    <View style={{ flexDirection: 'row', gap: 12 }}>
                      <PressBtn style={{ flex: 1 }} tone="light" icon="close" label="Cancel" onPress={() => setEditing(false)} />
                      <PressBtn style={{ flex: 1 }} tone="primary" icon="checkmark" label="Save" onPress={saveEdit} disabled={!canEditSave} busy={busy} />
                    </View>
                  </View>
                ) : (
                  <View style={s.textBlock}>
                    <Text style={[DISPLAY, s.title]}>{post.title}</Text>
                    <Text style={s.desc} numberOfLines={longDesc && !expanded ? 6 : undefined}>{post.description}</Text>
                    {longDesc && (
                      <Pressable onPress={() => setExpanded((e) => !e)} accessibilityRole="button" hitSlop={8}
                        accessibilityLabel={expanded ? 'Show less' : 'Read more'} style={s.moreLink}>
                        <Text style={s.moreText}>{expanded ? 'Show less' : 'Read more'}</Text>
                        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={C.moss} />
                      </Pressable>
                    )}
                  </View>
                )}

                {!!actionError && (
                  <View style={[s.errorBox, { marginHorizontal: 16, marginBottom: 14 }]}>
                    <Ionicons name="warning" size={22} color="#9A1B12" />
                    <Text style={s.errorText}>{actionError}</Text>
                  </View>
                )}

                {/* photos run edge to edge, like a normal post */}
                {images.length > 0 && (
                  <View onLayout={(e) => setGalleryW(e.nativeEvent.layout.width)} style={s.gallery}>
                    {galleryW > 0 && (
                      <ScrollView
                        ref={galleryRef} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
                        onMomentumScrollEnd={(e) => setImgIndex(Math.round(e.nativeEvent.contentOffset.x / galleryW))}
                      >
                        {images.map((uri, i) => (
                          <Pressable key={`${uri}-${i}`} onPress={onPhotoTap} accessibilityLabel={`Photo ${i + 1} of ${images.length}. Double tap to like.`}>
                            <Image source={{ uri }} style={{ width: galleryW, height: galleryW * 0.85 }} resizeMode="cover" />
                          </Pressable>
                        ))}
                      </ScrollView>
                    )}
                    {images.length > 1 && (
                      <>
                        <SlideArrow dir="left" label="Previous photo" onPress={() => goImg(imgIndex - 1)} />
                        <SlideArrow dir="right" label="Next photo" onPress={() => goImg(imgIndex + 1)} />
                        <View pointerEvents="none" style={s.counter}>
                          <Ionicons name="images" size={16} color={C.cream} />
                          <Text style={s.counterText}>{imgIndex + 1} of {images.length}</Text>
                        </View>
                        <View pointerEvents="box-none" style={s.dotsWrap}>
                          <View style={s.dots}>
                            {images.map((_, i) => (
                              <Pressable key={i} onPress={() => goImg(i)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Show photo ${i + 1}`}>
                                <View style={{ height: 9, width: i === imgIndex ? 26 : 9, borderRadius: 5, backgroundColor: i === imgIndex ? C.forest : C.moss, opacity: i === imgIndex ? 1 : 0.35 }} />
                              </Pressable>
                            ))}
                          </View>
                        </View>
                      </>
                    )}
                    <Animated.View pointerEvents="none" style={[s.bigHeart, {
                      opacity: bigHeart.interpolate({ inputRange: [0, 0.2, 1, 2], outputRange: [0, 1, 1, 0] }),
                      transform: [{ scale: bigHeart.interpolate({ inputRange: [0, 1, 2], outputRange: [0.4, 1.1, 1.4] }) }],
                    }]}>
                      <Ionicons name="heart" size={110} color="#fff" />
                    </Animated.View>
                  </View>
                )}

                {/* counts */}
                <View style={s.statsRow}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={[s.statHeart, !likeCount && { backgroundColor: C.sand }]}>
                      <Ionicons name="heart" size={15} color={likeCount ? '#fff' : C.body} />
                    </View>
                    <Animated.Text style={[s.statText, { transform: [{ scale: countBump }] }]}>
                      {likeCount} {likeCount === 1 ? 'like' : 'likes'}
                    </Animated.Text>
                  </View>
                  <Pressable onPress={goComments} accessibilityRole="button" accessibilityLabel="Go to comments" hitSlop={8}>
                    <Text style={s.statText}>{comments.length} {comments.length === 1 ? 'comment' : 'comments'}</Text>
                  </Pressable>
                </View>

                {/* action bar */}
                <View style={s.actionBar}>
                  <ActionBtn label={liked ? 'Liked' : 'Like'} active={liked} activeColor={HEART} onPress={toggleLike} disabled={liking}>
                    <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                      {BURST.map((a, i) => (
                        <Animated.View key={i} pointerEvents="none" style={{
                          position: 'absolute', width: 7, height: 7, borderRadius: 4,
                          backgroundColor: i % 2 ? C.lime : HEART,
                          opacity: burst.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 1, 0] }),
                          transform: [
                            { translateX: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.cos(a) * 34] }) },
                            { translateY: burst.interpolate({ inputRange: [0, 1], outputRange: [0, Math.sin(a) * 34] }) },
                            { scale: burst.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.4, 1.2, 0.3] }) },
                          ],
                        }} />
                      ))}
                      <Animated.View style={{ transform: [{ scale: heart }] }}>
                        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={28} color={liked ? HEART : C.forest} />
                      </Animated.View>
                    </View>
                  </ActionBtn>
                  <ActionBtn icon="chatbubble-ellipses-outline" label="Comment" onPress={goComments} />
                  <ActionBtn icon="share-social-outline" label="Share" onPress={sharePost} />
                </View>
              </View>

              {/* comments */}
              <View style={{ marginTop: 26, paddingHorizontal: 14 }} onLayout={(e) => { commentsY.current = e.nativeEvent.layout.y; }}>
                <Text style={[DISPLAY, s.sectionTitle]}>
                  {comments.length > 0 ? `${comments.length} ${comments.length === 1 ? 'comment' : 'comments'}` : 'Comments'}
                </Text>

                {/* write a comment */}
                <View style={s.composer}>
                  {!!commentError && (
                    <View style={[s.errorBox, { marginBottom: 10 }]}>
                      <Ionicons name="warning" size={22} color="#9A1B12" />
                      <Text style={s.errorText}>{commentError}</Text>
                    </View>
                  )}
                  {userId ? (
                    <>
                      {inputFocus && !commentText && (
                        <Pop from={8}>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled"
                            contentContainerStyle={{ gap: 8, paddingBottom: 10 }}>
                            {QUICK_REPLIES.map((q) => (
                              <Pressable key={q} onPress={() => setCommentText(q)} accessibilityRole="button" accessibilityLabel={`Use reply: ${q}`} style={s.chip}>
                                <Text style={s.chipText}>{q}</Text>
                              </Pressable>
                            ))}
                          </ScrollView>
                        </Pop>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10 }}>
                        <View style={[s.composeBox, inputFocus && { backgroundColor: '#fff', borderColor: C.moss }]}>
                          <TextInput
                            ref={inputRef}
                            style={[s.commentInput, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
                            placeholder="Write a comment…"
                            placeholderTextColor="#7d8870"
                            value={commentText}
                            onChangeText={setCommentText}
                            onFocus={() => setInputFocus(true)}
                            onBlur={() => setInputFocus(false)}
                            multiline
                            maxLength={500}
                            accessibilityLabel="Write a comment"
                          />
                          {commentText.length >= 400 && <Text style={s.counterSmall}>{commentText.length} / 500</Text>}
                        </View>
                        <Pressable
                          onPress={sendComment} disabled={!canSend} accessibilityRole="button" accessibilityLabel="Post comment"
                          style={[s.sendBtn, { opacity: canSend ? 1 : 0.4 }]}
                        >
                          {sending ? <ActivityIndicator color={C.cream} /> : <Ionicons name="send" size={24} color={C.cream} />}
                        </Pressable>
                      </View>
                    </>
                  ) : (
                    <PressBtn tone="primary" icon="log-in" label="Log in to like and comment" onPress={() => router.push('/(auth)/login')} />
                  )}
                </View>

                {comments.length === 0 && (
                  <View style={s.emptyBox}>
                    <Ionicons name="leaf-outline" size={34} color={C.moss} />
                    <Text style={s.emptyText}>No comments yet. Be the first to share your thoughts!</Text>
                  </View>
                )}

                <View style={{ gap: 18, marginTop: 14 }}>
                  {comments.map((c) => {
                    const mine = !!userId && c.user_id === userId;
                    const inner = (
                      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
                        <Avatar uri={c.profile_image} name={c.author} size={44} tone={C.moss} />
                        <View style={{ flex: 1 }}>
                          <View style={[s.bubble, mine && { backgroundColor: C.leaf }]}>
                            <Text style={s.commentAuthor} numberOfLines={1}>{c.author || 'Anonymous'}{mine ? ' (you)' : ''}</Text>
                            <Text style={s.commentText}>{c.text}</Text>
                          </View>
                          <View style={s.commentMeta}>
                            <Text style={s.timeText}>{ago(parseTs(c.timestamp, true))}</Text>
                            {mine && (
                              <Pressable onPress={() => deleteComment(c.id)} accessibilityRole="button" accessibilityLabel="Delete my comment"
                                hitSlop={8} style={[s.delLink, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}>
                                <Ionicons name="trash-outline" size={18} color="#9A1B12" />
                                <Text style={s.delLinkText}>Delete</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      </View>
                    );
                    return String(c.id) === newId
                      ? <Pop key={c.id}>{inner}</Pop>
                      : <View key={c.id}>{inner}</View>;
                  })}
                </View>
              </View>
            </View>
          )}

          <View style={{ height: 120 }} />
        </Animated.ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ───────────────────────── styles ─────────────────────────
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.forest },
  scroll: { alignItems: 'center' },
  wrap: { width: '100%', maxWidth: 680 },

  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: C.forest, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 14,
  },
  topCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 30, paddingHorizontal: 10 },
  topTitle: { color: C.cream, fontSize: 22 },
  roundBtn: { width: 50, height: 50, borderRadius: 25, backgroundColor: 'rgba(245,230,211,0.16)', alignItems: 'center', justifyContent: 'center' },

  menuWrap: { position: 'absolute', top: 8, right: 12, zIndex: 20 },
  menu: {
    backgroundColor: C.paper, borderRadius: 18, borderWidth: 2, borderColor: C.sand, minWidth: 210, overflow: 'hidden',
    ...Platform.select({
      ios: { shadowColor: '#2F4A1E', shadowOpacity: 0.25, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
      android: { elevation: 8 },
      default: { boxShadow: '0 8px 24px rgba(47,74,30,0.25)' } as any,
    }),
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, minHeight: 58 },
  menuText: { fontSize: 18, fontWeight: '800', color: C.ink },
  menuDivider: { height: 2, backgroundColor: C.sand },

  // the post is one wide sheet with a rounded, uneven bottom edge
  post: {
    backgroundColor: C.paper, overflow: 'hidden',
    borderBottomLeftRadius: 30, borderBottomRightRadius: 12, borderBottomWidth: 2, borderColor: C.sand,
  },
  authorRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10 },
  authorName: { fontSize: 20, fontWeight: '800', color: C.ink },
  timeText: { fontSize: 15, color: C.body, fontWeight: '600' },
  textBlock: { paddingHorizontal: 16, paddingBottom: 14 },
  title: { fontSize: 27, lineHeight: 33, color: C.forest },
  desc: { fontSize: 19, color: C.ink, lineHeight: 29, fontWeight: '400', marginTop: 8 },
  moreLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8, minHeight: 44, alignSelf: 'flex-start' },
  moreText: { fontSize: 18, fontWeight: '800', color: C.moss },

  editBox: { gap: 12, paddingHorizontal: 16, paddingBottom: 16 },

  gallery: { backgroundColor: C.ink, overflow: 'hidden' },
  arrow: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: 'rgba(245,230,211,0.94)', alignItems: 'center', justifyContent: 'center',
  },
  counter: {
    position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(31,48,18,0.8)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16,
  },
  counterText: { color: C.cream, fontWeight: '800', fontSize: 14 },
  dotsWrap: { position: 'absolute', bottom: 12, left: 0, right: 0, alignItems: 'center' },
  dots: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(245,230,211,0.92)', borderRadius: 16,
    paddingHorizontal: 14, paddingVertical: 9,
  },
  bigHeart: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' },

  statsRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
  },
  statHeart: { width: 26, height: 26, borderRadius: 13, backgroundColor: HEART, alignItems: 'center', justifyContent: 'center' },
  statText: { fontSize: 17, fontWeight: '700', color: C.body },

  actionBar: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 8, paddingVertical: 8, borderTopWidth: 2, borderTopColor: C.sand,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: 58,
    borderRadius: 16,
  },
  actionText: { fontSize: 17, fontWeight: '800', color: C.forest },

  sectionTitle: { fontSize: 25, lineHeight: 30, color: C.forest },
  emptyBox: {
    flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: C.leaf, padding: 18, marginTop: 14,
    borderTopLeftRadius: 26, borderTopRightRadius: 10, borderBottomRightRadius: 26, borderBottomLeftRadius: 10,
  },
  emptyText: { flex: 1, fontSize: 18, lineHeight: 26, fontWeight: '600', color: C.ink },

  bubble: {
    backgroundColor: C.sand, paddingHorizontal: 16, paddingVertical: 12,
    borderTopLeftRadius: 6, borderTopRightRadius: 22, borderBottomRightRadius: 22, borderBottomLeftRadius: 22,
  },
  commentAuthor: { fontSize: 17, fontWeight: '800', color: C.ink },
  commentText: { fontSize: 18, color: C.ink, lineHeight: 26, fontWeight: '400', marginTop: 4 },
  commentMeta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 4, paddingLeft: 6, minHeight: 36 },
  delLink: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#FBE3E0', borderRadius: 18,
    paddingHorizontal: 12, minHeight: 40,
  },
  delLinkText: { color: '#9A1B12', fontWeight: '800', fontSize: 15 },

  fieldLabel: { fontSize: 17, fontWeight: '800', color: C.forest, marginBottom: -4 },
  input: {
    backgroundColor: C.cream, borderWidth: 2, borderColor: C.sand, borderRadius: 16,
    paddingHorizontal: 16, paddingVertical: 14, fontSize: 18, color: C.ink, fontWeight: '500', minHeight: 56,
  },

  composer: {
    backgroundColor: C.cream, borderRadius: 24, borderWidth: 2, borderColor: C.sand,
    padding: 12, marginTop: 14, marginBottom: 18,
  },
  chip: {
    backgroundColor: C.leaf, borderRadius: 20, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center',
  },
  chipText: { fontSize: 16, fontWeight: '700', color: C.forest },
  composeBox: {
    flex: 1, backgroundColor: C.paper, borderRadius: 22, borderWidth: 2, borderColor: C.sand,
    paddingHorizontal: 16, paddingVertical: 4, justifyContent: 'center',
  },
  commentInput: { fontSize: 18, color: C.ink, fontWeight: '500', minHeight: 48, maxHeight: 120, paddingVertical: 10 },
  counterSmall: { fontSize: 14, color: C.body, fontWeight: '700', textAlign: 'right', paddingBottom: 6 },
  sendBtn: { width: 56, height: 56, borderRadius: 28, backgroundColor: C.moss, alignItems: 'center', justifyContent: 'center' },

  errorCard: {
    backgroundColor: C.paper, borderWidth: 2, borderColor: C.sand, padding: 24, alignItems: 'center',
    borderTopLeftRadius: 34, borderTopRightRadius: 12, borderBottomRightRadius: 34, borderBottomLeftRadius: 12,
    marginHorizontal: 14,
  },
  errorIcon: { width: 64, height: 64, borderRadius: 32, backgroundColor: C.leaf, alignItems: 'center', justifyContent: 'center' },
  errorTitle: { color: C.forest, fontSize: 24, lineHeight: 30, marginTop: 14, textAlign: 'center' },
  errorBody: { color: C.body, fontSize: 18, lineHeight: 26, marginTop: 8, textAlign: 'center', fontWeight: '500' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FDE7E4', borderWidth: 2, borderColor: '#F3B7B0', borderRadius: 16, padding: 14,
  },
  errorText: { flex: 1, color: '#9A1B12', fontSize: 16, fontWeight: '700', lineHeight: 22 },
});