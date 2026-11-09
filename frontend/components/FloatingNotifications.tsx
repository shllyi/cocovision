// frontend/components/FloatingNotifications.tsx
// Same props and behaviour as before (controlled / standalone, polling, mark read, mark all, view all).
//
// Look: Green Houze (forest / moss / lime / cream) like the home page.
//   notif-normal.png  = the bell as it normally sits (sways gently when there is something new)
//   notif-opened.png  = shown once it has been clicked (bell button while open, and the panel header)
//
// Layout: the newest message is a big featured card, other new messages are medium cards, and
// already-read ones shrink to a quiet single line. Tap any card to open it in place.
// On phones (and narrow browser windows) the panel opens centered on the screen.

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  Platform,
  ActivityIndicator,
  Modal,
  Animated,
  Easing,
  Pressable,
  LayoutAnimation,
  AccessibilityInfo,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { NGROK_URL } from '../constants/config';
import { authHeaders } from '../constants/session';

/* ── tokens (same as the home page) ── */
const C = {
  forest: '#2F4A1E', moss: '#46652A', lime: '#8A9F27', cream: '#F5E6D3', paper: '#FBF4EA',
  ink: '#1F3012', leaf: '#DDE5B5', sand: '#EBD7BC', body: '#4A5A3C', brick: '#B3412B',
};
const ND = Platform.OS !== 'web';
const DISPLAY: any = { fontWeight: '900', letterSpacing: -0.4 };
const EDGE_H = 26;

const IMG_NORMAL = require('../assets/images/notif-normal.png');
const IMG_OPENED = require('../assets/images/notif-opened.png');
const MASCOT = require('../assets/images/mascot.png');

let REDUCE = false;
try { AccessibilityInfo.isReduceMotionEnabled?.().then((v) => { REDUCE = !!v; }).catch(() => {}); } catch (e) {}

// ── Type config ──────────────────────────────────────────────────────────────
type Cfg = { tag: string; icon: string; bg: string; fg: string; action?: string; route?: string };
const TYPE_CONFIG: Record<string, Cfg> = {
  like:           { tag: 'Like',         icon: 'heart',            bg: C.brick,  fg: '#fff',  action: 'Open the post' },
  comment:        { tag: 'Comment',      icon: 'chatbubble',       bg: C.moss,   fg: C.cream, action: 'Open the post' },
  new_post:       { tag: 'New post',     icon: 'newspaper',        bg: C.forest, fg: C.cream, action: 'Read the post' },
  copra_price:    { tag: 'Copra price',  icon: 'cash',             bg: C.lime,   fg: C.ink,   action: 'See market prices', route: '/(tabs)/public/prediction' },
  price_update:   { tag: 'Market price', icon: 'trending-up',      bg: C.lime,   fg: C.ink,   action: 'See market prices', route: '/(tabs)/public/prediction' },
  waste_price:    { tag: 'Waste price',  icon: 'leaf',             bg: C.leaf,   fg: C.ink,   action: 'See waste solutions', route: '/(tabs)/public/waste-solutions' },
  profile_update: { tag: 'Profile',      icon: 'person-circle',    bg: C.moss,   fg: C.cream, action: 'Open my profile', route: '/(tabs)/user/profile' },
  login_device:   { tag: 'Security',     icon: 'shield-checkmark', bg: C.brick,  fg: '#fff' },
  role_change:    { tag: 'Account role', icon: 'ribbon',           bg: C.forest, fg: C.cream, action: 'Open my profile', route: '/(tabs)/user/profile' },
  default:        { tag: 'Notice',       icon: 'notifications',    bg: C.sand,   fg: C.ink },
};

interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

const isPostType = (t: string) => t === 'like' || t === 'comment' || t === 'new_post';

function timeAgo(isoDate: string): string {
  // If the server omitted a timezone designator, treat the string as UTC
  // (prevents a phantom offset equal to the local UTC offset, e.g. +8 h in PH)
  const normalized = /[Z+\-]\d*$/.test(isoDate.trim()) ? isoDate : isoDate + 'Z';
  const diff = Math.max(0, Math.floor((Date.now() - new Date(normalized).getTime()) / 1000));
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  return `${Math.floor(diff / 86400)} days ago`;
}

/* ═════════ small animated pieces ═════════ */

// The bell picture, drawn on its own (no circle behind it).
// Closed = notif-normal (sways if `sway`), opened = notif-opened (pops in).
function BellImage({ opened, size, sway = false }: { opened: boolean; size: number; sway?: boolean }) {
  const loop = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);

  useEffect(() => {
    if (!sway || opened || REDUCE) { loop.setValue(0); return; }
    const l = Animated.loop(Animated.sequence([
      Animated.delay(900),
      Animated.timing(loop, { toValue: 1, duration: 140, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(loop, { toValue: -1, duration: 280, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(loop, { toValue: 0.6, duration: 220, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(loop, { toValue: 0, duration: 200, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    l.start();
    return () => l.stop();
  }, [sway, opened]);

  useEffect(() => {
    if (first.current) { first.current = false; if (!opened) return; }
    if (REDUCE) return;
    pop.setValue(0.55);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 110, useNativeDriver: ND }).start();
  }, [opened]);

  return (
    <Animated.View style={{ transform: [{ scale: pop }, { rotate: loop.interpolate({ inputRange: [-1, 1], outputRange: ['-14deg', '14deg'] }) }] }}>
      <Image source={opened ? IMG_OPENED : IMG_NORMAL} style={{ width: size, height: size }} resizeMode="contain" accessibilityLabel={opened ? 'Opened mailbox' : 'Mailbox'} />
    </Animated.View>
  );
}

// Round type icon. Springs when the message flips from new to read.
function TypeBubble({ cfg, read, size = 44 }: { cfg: Cfg; read: boolean; size?: number }) {
  const pop = useRef(new Animated.Value(1)).current;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    if (REDUCE) return;
    pop.setValue(0.6);
    Animated.spring(pop, { toValue: 1, friction: 4, tension: 120, useNativeDriver: ND }).start();
  }, [read]);
  return (
    <Animated.View style={{
      width: size, height: size, borderRadius: size / 2, backgroundColor: cfg.bg, alignItems: 'center', justifyContent: 'center',
      opacity: read ? 0.75 : 1, transform: [{ scale: pop }],
    }}>
      <Ionicons name={cfg.icon as any} size={Math.round(size * 0.5)} color={cfg.fg} />
    </Animated.View>
  );
}

function FloatingLeaf({ style, size = 60, color = C.moss, opacity = 0.7 }: any) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (REDUCE) return;
    const l = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
      Animated.timing(v, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: ND }),
    ]));
    l.start();
    return () => l.stop();
  }, []);
  return (
    <Animated.View pointerEvents="none" style={[{ position: 'absolute', opacity }, style, {
      transform: [
        { rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['-8deg', '8deg'] }) },
        { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
      ],
    }]}>
      <Ionicons name="leaf" size={size} color={color} />
    </Animated.View>
  );
}

// Bushy edge that hangs BELOW the header. It is clipped to its own strip, so the bumps
// can never run up over the header or down over the content.
function LeafEdge({ width }: { width: number }) {
  const bumps = useMemo(() => {
    const sizes = [64, 92, 58, 80, 104, 70, 88];
    const out: { x: number; d: number; vis: number }[] = [];
    let x = -30, i = 0;
    while (x < width + 60) {
      const d = sizes[i % sizes.length];
      out.push({ x, d, vis: 10 + ((i * 7) % 4) * 5 });   // how far each bump hangs down: 10 to 25px
      x += d * 0.6; i++;
    }
    return out;
  }, [width]);
  return (
    <View pointerEvents="none" style={styles.edge}>
      <View style={styles.edgeBar} />
      {bumps.map((b, i) => (
        <View key={i} style={{ position: 'absolute', left: b.x, top: b.vis - b.d, width: b.d, height: b.d, borderRadius: b.d / 2, backgroundColor: C.forest }} />
      ))}
    </View>
  );
}

// Press feedback wrapper: sinks slightly on press.
function Press({ onPress, style, children, label }: any) {
  const s = useRef(new Animated.Value(1)).current;
  const go = (v: number) => Animated.spring(s, { toValue: v, useNativeDriver: ND, speed: 30, bounciness: 6 }).start();
  return (
    <Pressable
      onPress={onPress} onPressIn={() => go(0.975)} onPressOut={() => go(1)}
      accessibilityRole="button" accessibilityLabel={label}
      style={Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : undefined}
    >
      <Animated.View style={[style, { transform: [{ scale: s }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

/* ═════════ main component ═════════ */
interface FloatingNotificationsProps {
  /**
   * Controlled mode — the parent owns the open/close state.
   * When true, the component does NOT render its own bell trigger button;
   * the panel is shown/hidden based on `isOpen`.
   */
  controlled?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  /** Called whenever the local unread count changes so the parent can display a badge. */
  onUnreadCountChange?: (count: number) => void;
  /**
   * 'top'    — panel opens downward from the top-right (use when bell is in the header).
   * 'bottom' — panel opens upward from a bottom-right trigger (legacy standalone).
   * Default: 'bottom'
   * (Only used on wide web screens. On phones the panel opens centered.)
   */
  panelAnchor?: 'top' | 'bottom';
}

export default function FloatingNotifications({
  controlled = false,
  isOpen: externalOpen,
  onToggle,
  onUnreadCountChange,
  panelAnchor = 'bottom',
}: FloatingNotificationsProps) {
  const { width: winW, height: winH } = useWindowDimensions();
  // Phones and narrow browser windows: centered popup. Wide web: panel hangs off the bell.
  const centered = Platform.OS !== 'web' || winW < 520;
  const panelW = centered ? Math.min(winW - 32, 380) : 390;
  const panelH = centered ? Math.min(winH - 120, 560) : 580;
  const size = { width: panelW, height: panelH };

  const [internalOpen, setInternalOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading]     = useState(false);
  const [userId, setUserId]       = useState<string | null>(null);
  const [localUnreadCount, setLocalUnreadCount] = useState(0); // badge in standalone mode
  const [filter, setFilter] = useState<'all' | 'new'>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const [segW, setSegW] = useState(0);
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const segX = useRef(new Animated.Value(0)).current;

  // Resolve open state & toggle
  const isOpen = controlled ? (externalOpen ?? false) : internalOpen;
  const toggle = controlled
    ? (onToggle ?? (() => {}))
    : () => setInternalOpen(v => !v);

  // Panel entrance
  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: isOpen ? 1 : 0,
      friction: 8,
      tension: 40,
      useNativeDriver: true,
    }).start();
    if (!isOpen) setOpenId(null);
  }, [isOpen]);

  // Load user session
  useEffect(() => {
    (async () => {
      try {
        const raw =
          Platform.OS === 'web'
            ? localStorage.getItem('user_session')
            : await SecureStore.getItemAsync('user_session');
        if (raw) {
          const u = JSON.parse(raw);
          const id = u.id ?? u._id ?? u.user_id ?? u.userId;
          if (id) setUserId(String(id));
        }
      } catch {}
    })();
  }, []);

  // ── Fetch notifications ──────────────────────────────────────────────────
  const fetchNotifications = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`${NGROK_URL}/notifications`, {
        headers: await authHeaders(),
      });
      if (res.ok) {
        const json = await res.json();
        const notifs: Notification[] = json.notifications || [];
        setNotifications(notifs);
        setFeaturedId(notifs.find(n => !n.is_read)?.id ?? null);   // newest unread becomes the big card
        // keep standalone badge in sync with real data
        if (!controlled) setLocalUnreadCount(notifs.filter(n => !n.is_read).length);
      }
    } catch {}
    setLoading(false);
  }, [userId]);

  // Fetch when panel opens or userId becomes available
  useEffect(() => {
    if (userId && isOpen) fetchNotifications();
  }, [userId, isOpen, fetchNotifications]);

  // Poll unread count every 30 s (even when panel is closed)
  useEffect(() => {
    if (!userId) return;
    const pollCount = async () => {
      try {
        const res = await fetch(`${NGROK_URL}/notifications/unread-count`, {
          headers: await authHeaders(),
        });
        if (res.ok) {
          const json = await res.json();
          const count = json.count ?? 0;
          onUnreadCountChange?.(count);
          if (!controlled) setLocalUnreadCount(count); // update standalone badge
        }
      } catch {}
    };
    pollCount();
    const id = setInterval(pollCount, 30000);
    return () => clearInterval(id);
  }, [userId, onUnreadCountChange]);

  const unreadCount = controlled
    ? notifications.filter(n => !n.is_read).length  // controlled: panel-derived count
    : localUnreadCount;                              // standalone: poll-derived count (shows badge before panel opens)

  // sliding filter thumb
  const segItemW = segW ? (segW - 8) / 2 : 0;
  useEffect(() => {
    Animated.spring(segX, { toValue: filter === 'all' ? 0 : segItemW, friction: 8, tension: 120, useNativeDriver: true }).start();
  }, [filter, segItemW]);

  const animate = () => { if (!REDUCE) LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut); };

  const syncCounts = (list: Notification[]) => {
    const c = list.filter(n => !n.is_read).length;
    onUnreadCountChange?.(c);
    if (!controlled) setLocalUnreadCount(c);
  };

  // ── Mark single read (optimistic, reverts if the server says no) ──────────
  const markRead = async (notifId: string) => {
    if (!userId) return;
    setNotifications(prev => { const u = prev.map(n => n.id === notifId ? { ...n, is_read: true } : n); syncCounts(u); return u; });
    try {
      const res = await fetch(`${NGROK_URL}/notifications/${notifId}/read`, {
        method: 'PUT',
        headers: await authHeaders(),
      });
      if (!res.ok) throw new Error('fail');
    } catch {
      setNotifications(prev => { const u = prev.map(n => n.id === notifId ? { ...n, is_read: false } : n); syncCounts(u); return u; });
    }
  };

  // ── Mark all read ───────────────────────────────────────────────────────
  const markAllRead = async () => {
    if (!userId) return;
    try {
      await fetch(`${NGROK_URL}/notifications/read-all`, {
        method: 'PUT',
        headers: await authHeaders(),
      });
      animate();
      setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      onUnreadCountChange?.(0);
      if (!controlled) setLocalUnreadCount(0);
    } catch {}
  };

  // Tap a card: open it in place and mark it read.
  const handlePress = (item: Notification) => {
    animate();
    setOpenId(cur => (cur === item.id ? null : item.id));
    if (!item.is_read) markRead(item.id);
  };

  const canGo = (item: Notification) =>
    !!(TYPE_CONFIG[item.type]?.action && (isPostType(item.type) ? item.data?.post_id : TYPE_CONFIG[item.type]?.route));

  const goTo = (item: Notification) => {
    if (isPostType(item.type) && item.data?.post_id) {
      toggle();
      router.push(`/(tabs)/public/${item.data.post_id}` as any);
      return;
    }
    const r = TYPE_CONFIG[item.type]?.route;
    if (r) { toggle(); router.push(r as any); }
  };

  const openFullScreen = () => {
    toggle();
    router.push('/(tabs)/user/notifications' as any);
  };

  // ── Lists ────────────────────────────────────────────────────────────────
  const visible = filter === 'new'
    ? notifications.filter(n => !n.is_read || n.id === openId || n.id === featuredId)
    : notifications;
  const firstReadId = visible.find(n => n.is_read && n.id !== featuredId)?.id;
  const hasNewAbove = visible.some(n => !n.is_read || n.id === featuredId);

  const renderAction = (item: Notification, light = false) => {
    const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.default;
    if (!canGo(item)) return null;
    return (
      <TouchableOpacity
        onPress={() => goTo(item)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={cfg.action}
        style={[styles.actionBtn, { backgroundColor: light ? C.cream : C.forest }]}
      >
        <Text style={{ color: light ? C.ink : C.cream, fontWeight: '900', fontSize: 15 }}>{cfg.action}</Text>
        <Ionicons name="arrow-forward" size={18} color={light ? C.ink : C.cream} />
      </TouchableOpacity>
    );
  };

  // ── Render item ─────────────────────────────────────────────────────────
  const renderItem = ({ item, index }: { item: Notification; index: number }) => {
    const cfg = TYPE_CONFIG[item.type] || TYPE_CONFIG.default;
    const read = !!item.is_read;
    const open = openId === item.id;
    const featured = item.id === featuredId;

    const divider = item.id === firstReadId && hasNewAbove ? (
      <View style={styles.divider}>
        <Ionicons name="leaf" size={16} color={C.lime} style={{ transform: [{ rotate: '-20deg' }] }} />
        <Text style={styles.dividerText}>Already read</Text>
        <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: C.sand }} />
      </View>
    ) : null;

    // 1) Featured: the latest new message, big and dark
    if (featured) {
      return (
        <View>
          <Press onPress={() => handlePress(item)} label={`Latest message. ${item.title}`} style={styles.featured}>
            {/* small leaf, tucked in the empty top-right corner so it never sits under text */}
            <FloatingLeaf style={{ top: 10, right: 14 }} size={40} color={C.moss} opacity={0.6} />
            <View style={styles.latestChip}>
              <Text style={{ color: C.ink, fontWeight: '900', fontSize: 13 }}>Latest</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
              <TypeBubble cfg={{ ...cfg, bg: C.cream, fg: C.forest }} read={read} size={44} />
              <Text style={{ flex: 1, color: C.leaf, fontWeight: '800', fontSize: 13 }}>{cfg.tag}  ·  {timeAgo(item.created_at)}</Text>
            </View>
            <Text style={[DISPLAY, { color: C.cream, fontSize: 20, lineHeight: 25, marginTop: 10 }]} numberOfLines={open ? undefined : 2}>
              {item.title}
            </Text>
            <Text style={{ color: C.cream, opacity: 0.92, fontSize: 15, lineHeight: 21, fontWeight: '600', marginTop: 6 }} numberOfLines={open ? undefined : 3}>
              {item.message}
            </Text>
            {open ? renderAction(item, true) : (
              <Text style={{ color: C.lime, fontWeight: '900', fontSize: 14, marginTop: 10 }}>Tap to read more</Text>
            )}
          </Press>
          {divider}
        </View>
      );
    }

    // 2) Other new messages: medium paper card with lime stripe
    if (!read) {
      const flip = index % 2 === 0;
      return (
        <View>
          {divider}
          <Press
            onPress={() => handlePress(item)} label={`Unread. ${item.title}`}
            style={[styles.card, flip ? styles.shapeA : styles.shapeB]}
          >
            <View style={styles.stripe} />
            <TypeBubble cfg={cfg} read={read} />
            <View style={{ flex: 1 }}>
              <Text style={{ color: C.moss, fontWeight: '800', fontSize: 13 }}>{cfg.tag}  ·  {timeAgo(item.created_at)}</Text>
              <Text style={[DISPLAY, { color: C.ink, fontSize: 17, lineHeight: 22, marginTop: 3 }]} numberOfLines={open ? undefined : 2}>{item.title}</Text>
              <Text style={{ color: C.body, fontSize: 15, lineHeight: 21, fontWeight: '500', marginTop: 2 }} numberOfLines={open ? undefined : 2}>{item.message}</Text>
              {open && renderAction(item)}
            </View>
          </Press>
        </View>
      );
    }

    // 3) Read: quiet, compact row on sand. Expands if tapped.
    return (
      <View>
        {divider}
        <Press onPress={() => handlePress(item)} label={`Read. ${item.title}`} style={styles.readRow}>
          <TypeBubble cfg={cfg} read size={34} />
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.ink, fontWeight: '800', fontSize: 15, lineHeight: 20 }} numberOfLines={open ? undefined : 1}>{item.title}</Text>
            {open ? (
              <View>
                <Text style={{ color: C.body, fontSize: 15, lineHeight: 21, fontWeight: '500', marginTop: 3 }}>{item.message}</Text>
                {renderAction(item)}
              </View>
            ) : (
              <Text style={{ color: C.body, fontSize: 13, fontWeight: '600', marginTop: 1 }}>{timeAgo(item.created_at)}</Text>
            )}
          </View>
          <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={C.moss} />
        </Press>
      </View>
    );
  };

  // ── Panel content ────────────────────────────────────────────────────────
  const renderPanel = () => (
    <View style={styles.panelContent}>
      {/* Header: slim, just the picture, the title and a close button */}
      <View style={styles.panelHeader}>
        <BellImage opened={isOpen} size={52} />
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Your mailbox</Text>
          <Text style={styles.headerSub}>
            {unreadCount > 0 ? `${unreadCount} new ${unreadCount === 1 ? 'message' : 'messages'}` : 'You are all caught up'}
          </Text>
        </View>
        <TouchableOpacity onPress={toggle} style={styles.closeBtn} activeOpacity={0.8} accessibilityRole="button" accessibilityLabel="Close">
          <Ionicons name="close" size={24} color={C.ink} />
        </TouchableOpacity>
      </View>

      {/* Leafy edge: hangs under the header, clipped to its own strip */}
      <LeafEdge width={panelW} />

      {/* Controls sit on the cream area, clear of the header and the edge */}
      <View style={styles.controls}>
        <View style={styles.segTrack} onLayout={(e) => setSegW(e.nativeEvent.layout.width)}>
          {segW > 0 && <Animated.View style={[styles.segThumb, { width: segItemW, transform: [{ translateX: segX }] }]} />}
          {([['all', 'All'], ['new', unreadCount > 0 ? `New (${unreadCount})` : 'New']] as const).map(([k, lab]) => (
            <Pressable key={k} style={styles.segItem} onPress={() => { animate(); setFilter(k); }} accessibilityRole="button" accessibilityLabel={lab}>
              <Text style={{ fontWeight: '900', fontSize: 15, color: filter === k ? C.cream : C.ink }}>{lab}</Text>
            </Pressable>
          ))}
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity style={styles.readAll} onPress={markAllRead} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="Mark all as read">
            <Ionicons name="checkmark-done" size={20} color={C.ink} />
            <Text style={{ fontWeight: '900', fontSize: 14, color: C.ink }}>Read all</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Body */}
      {loading && notifications.length === 0 ? (
        <View style={{ alignItems: 'center', marginTop: 50 }}>
          <ActivityIndicator size="large" color={C.moss} />
          <Text style={styles.loadingText}>Opening your mailbox…</Text>
        </View>
      ) : visible.length === 0 ? (
        <View style={styles.empty}>
          <Image source={MASCOT} style={{ width: 88, height: 96 }} resizeMode="contain" />
          <Text style={styles.emptyTitle}>{filter === 'new' ? 'Nothing new' : 'Your mailbox is empty'}</Text>
          <Text style={styles.emptySub}>
            {filter === 'new'
              ? 'You have read everything. Check back later.'
              : 'Likes, comments, price updates and account news will show up here.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={item => item.id}
          renderItem={renderItem}
          extraData={[openId, featuredId, filter]}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          showsVerticalScrollIndicator
          bounces={Platform.OS === 'ios'}
          style={{ flex: 1 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={fetchNotifications} tintColor={C.forest} colors={[C.forest]} />}
        />
      )}

      <View style={styles.footer}>
        <TouchableOpacity style={styles.viewAll} onPress={openFullScreen} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="See all messages">
          <Text style={styles.viewAllText}>See all messages</Text>
          <Ionicons name="arrow-forward" size={18} color={C.cream} />
        </TouchableOpacity>
      </View>
    </View>
  );

  const panelAnim = {
    opacity: scaleAnim,
    transform: [
      { translateY: scaleAnim.interpolate({ inputRange: [0, 1], outputRange: [centered ? 16 : -24, 0] }) },
      { scale: scaleAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
    ],
  };

  // Centered popup used on phones and narrow windows (dimmed screen, panel in the middle)
  const centeredPopup = (
    <Modal visible={isOpen} transparent animationType="none" onRequestClose={toggle} statusBarTranslucent>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={toggle} accessibilityLabel="Close messages" />
        <Animated.View style={[styles.panel, size, panelAnim]}>
          {renderPanel()}
        </Animated.View>
      </View>
    </Modal>
  );

  // ── Controlled mode: only render the panel (parent provides the bell) ─────
  if (controlled) {
    if (centered) return centeredPopup;
    if (!isOpen) return null;
    return (
      <>
        {/* Transparent backdrop to close when clicking outside */}
        <TouchableOpacity style={styles.backdrop} onPress={toggle} activeOpacity={1} />
        <Animated.View
          style={[styles.panel, styles.panelFloat, panelAnchor === 'top' ? styles.panelTop : styles.panelBottom, size, panelAnim]}
        >
          {renderPanel()}
        </Animated.View>
      </>
    );
  }

  // ── Standalone mode ────────────────────────────────────────────────────────
  return (
    <View style={styles.container} pointerEvents="box-none">
      {/* Bell button: notif-normal when idle, notif-opened once clicked */}
      <TouchableOpacity
        style={[styles.bellButton, centered && styles.bellPlain]}
        onPress={toggle}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityLabel={unreadCount > 0 ? `Messages, ${unreadCount} new` : 'Messages'}
      >
        <BellImage opened={isOpen} size={centered ? 56 : 42} sway={unreadCount > 0} />
        {!isOpen && unreadCount > 0 && (
          <View style={styles.bellBadge}>
            <Text style={styles.bellBadgeText}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>

      {centered ? centeredPopup : (
        isOpen && (
          <Animated.View style={[styles.panel, styles.panelFloat, styles.panelBottom, size, panelAnim]}>
            {renderPanel()}
          </Animated.View>
        )
      )}
    </View>
  );
}

const SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 14px 34px rgba(31, 48, 18, 0.28), 0 2px 8px rgba(31, 48, 18, 0.12)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.28, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 10 };
const SOFT: any = Platform.OS === 'web'
  ? { boxShadow: '0 6px 16px rgba(31, 48, 18, 0.14), 0 1px 4px rgba(31, 48, 18, 0.08)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 };

const styles = StyleSheet.create({
  // Bell sits at top-right (away from the AI chat button at bottom-right)
  container: {
    position: 'absolute',
    top: Platform.OS === 'web' ? 20 : 50,
    right: Platform.OS === 'web' ? 20 : 15,
    zIndex: 999,
  },
  // Phones / narrow windows: dim the screen and center the panel
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(31,48,18,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  bellButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.forest,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: C.cream,
    ...SHADOW,
  },
  // Mobile: just the picture, no circle, border or shadow behind it
  bellPlain: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderRadius: 0,
    elevation: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    ...(Platform.OS === 'web' ? ({ boxShadow: 'none' } as any) : {}),
  },
  bellBadge: {
    position: 'absolute',
    top: -6,
    right: -6,
    minWidth: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: C.lime,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: C.cream,
  },
  bellBadgeText: { color: C.ink, fontSize: 13, fontWeight: '900' },

  // ── Controlled mode backdrop (wide web) ──────────────────────────────────
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 998,
    ...(Platform.OS === 'web' ? ({ position: 'fixed' } as any) : {}),
  },

  // ── Panel base (size comes from the component) ───────────────────────────
  panel: {
    backgroundColor: C.cream,
    borderTopLeftRadius: 36,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 36,
    borderBottomLeftRadius: 14,
    overflow: 'hidden',
    zIndex: 1000,
    ...SHADOW,
  },
  // Wide web only: the panel hangs off the bell
  panelFloat:  { position: 'absolute' },
  panelTop:    { top: 0, right: 0 },
  panelBottom: { bottom: 70, right: 0 },

  panelContent: { flex: 1, width: '100%', height: '100%' },

  // ── Header (slim) ────────────────────────────────────────────────────────
  panelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    backgroundColor: C.forest,
    zIndex: 3,
  },
  headerTitle: { ...DISPLAY, fontSize: 22, color: C.cream },
  headerSub:   { fontSize: 15, color: C.leaf, fontWeight: '700', marginTop: 1 },
  closeBtn: {
    width: 46, height: 46, borderRadius: 23, backgroundColor: C.cream, alignItems: 'center', justifyContent: 'center',
  },

  // bushy edge strip: clipped, sits under the header
  edge: { height: EDGE_H, width: '100%', overflow: 'hidden', zIndex: 1, marginTop: -1 },
  edgeBar: { position: 'absolute', left: 0, right: 0, top: 0, height: 6, backgroundColor: C.forest },

  // ── Controls ─────────────────────────────────────────────────────────────
  controls: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 4 },
  segTrack: { flex: 1, flexDirection: 'row', backgroundColor: C.sand, borderRadius: 26, padding: 4 },
  segThumb: { position: 'absolute', left: 4, top: 4, bottom: 4, backgroundColor: C.forest, borderRadius: 22 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 40 },
  readAll: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.lime, borderRadius: 24,
    paddingHorizontal: 14, minHeight: 48,
  },

  // ── List ─────────────────────────────────────────────────────────────────
  list: { padding: 12, paddingBottom: 14 },

  featured: {
    backgroundColor: C.forest,
    padding: 16,
    overflow: 'hidden',
    borderTopLeftRadius: 38,
    borderTopRightRadius: 14,
    borderBottomRightRadius: 38,
    borderBottomLeftRadius: 14,
    ...SOFT,
  },
  latestChip: {
    alignSelf: 'flex-start', backgroundColor: C.lime, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 4,
  },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, alignSelf: 'stretch',
    borderRadius: 26, paddingHorizontal: 18, minHeight: 48, marginTop: 12,
  },

  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: C.paper,
    padding: 14,
    paddingLeft: 18,
    gap: 12,
    overflow: 'hidden',
    ...SOFT,
  },
  shapeA: { borderTopLeftRadius: 24, borderTopRightRadius: 10, borderBottomRightRadius: 24, borderBottomLeftRadius: 10 },
  shapeB: { borderTopLeftRadius: 10, borderTopRightRadius: 24, borderBottomRightRadius: 10, borderBottomLeftRadius: 24 },
  stripe: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 6, backgroundColor: C.lime },

  readRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.sand,
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 10,
    minHeight: 54,
  },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 10 },
  dividerText: { ...DISPLAY, fontSize: 16, color: C.forest },

  // ── Footer ───────────────────────────────────────────────────────────────
  footer: { padding: 12, paddingTop: 4 },
  viewAll: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    minHeight: 52,
    borderRadius: 26,
    backgroundColor: C.forest,
  },
  viewAllText: { fontSize: 16, fontWeight: '900', color: C.cream },

  // ── Empty / loading ──────────────────────────────────────────────────────
  loadingText: { color: C.body, fontWeight: '700', fontSize: 16, marginTop: 10 },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 28,
    gap: 8,
  },
  emptyTitle: { ...DISPLAY, fontSize: 22, color: C.forest, textAlign: 'center' },
  emptySub:   { fontSize: 16, color: C.body, textAlign: 'center', lineHeight: 23, fontWeight: '600' },
});