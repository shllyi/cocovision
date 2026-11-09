import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, useWindowDimensions, Image, Animated, Pressable, Easing, AccessibilityInfo } from 'react-native';
import { Tabs, router, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Ellipse } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingNotifications from '../../components/FloatingNotifications';
import FloatingChatbot from '../../components/FloatingChatbot';

/* Same palette as the Home screen */
const C = {
  forest: '#2F4A1E',
  moss: '#46652A',
  lime: '#8A9F27',
  cream: '#F5E6D3',
  paper: '#FBF4EA',
  ink: '#1F3012',
  leaf: '#DDE5B5',
  sand: '#EBD7BC',
};

// Coconut icon for the logo
const CoconutLogo = ({ size = 32 }: { size?: number }) => (
  <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
    <Ellipse cx="32" cy="40" rx="22" ry="20" fill="white" />
    <Path d="M32 22 Q20 10 8 6 Q16 12 22 22" fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" />
    <Path d="M32 22 Q32 8 32 2 Q30 10 30 22" fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" />
    <Path d="M32 22 Q44 10 56 6 Q48 12 42 22" fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" />
    <Path d="M32 22 Q24 12 16 18 Q22 16 28 22" fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" />
    <Path d="M32 22 Q40 12 48 18 Q42 16 36 22" fill="white" stroke="white" strokeWidth="3" strokeLinejoin="round" />
    <Ellipse cx="32" cy="40" rx="20" ry="18" fill="#6B3A2A" />
    <Ellipse cx="26" cy="34" rx="8" ry="6" fill="#7D4A36" />
    <Path d="M14 38 Q32 30 50 38" stroke="#4A2419" strokeWidth="1.5" fill="none" />
    <Path d="M13 44 Q32 36 51 44" stroke="#4A2419" strokeWidth="1.5" fill="none" />
    <Circle cx="26" cy="28" r="2.5" fill="#2D1A0E" />
    <Circle cx="33" cy="26" r="2.5" fill="#2D1A0E" />
    <Circle cx="40" cy="28" r="2.5" fill="#2D1A0E" />
    <Path d="M32 22 Q20 10 8 6 Q16 12 22 22" fill="#16a34a" />
    <Path d="M32 22 Q32 8 32 2 Q30 10 30 22" fill="#15803d" />
    <Path d="M32 22 Q44 10 56 6 Q48 12 42 22" fill="#16a34a" />
    <Path d="M32 22 Q24 12 16 18 Q22 16 28 22" fill="#22c55e" />
    <Path d="M32 22 Q40 12 48 18 Q42 16 36 22" fill="#22c55e" />
    <Path d="M30 22 Q31 26 32 28 Q33 26 34 22" fill="#92400e" />
  </Svg>
);

const HEADER_H = 65;

/* ═══════════════════════════════════════════════════════════════════════════
   MOBILE TAB BAR
   A forest-green bar with a soft bowl cut into the top edge. A cream coconut
   "seed" with a lime ring sits in the bowl over the active tab. When you change
   tabs the bowl and seed glide across with a small bounce, the icon pops in,
   and the raised seed keeps the active tab easy to find.
   Labels are always visible (13px+), icons are 27px, tap targets are 63x68px.
   Motion is skipped when "Reduce Motion" is on.
   ═══════════════════════════════════════════════════════════════════════════ */
const BAR_H = 68;      // visible bar body
const TOP = 44;        // headroom above the bar for the raised seed
const SEED = 64;       // seed diameter
const BOWL_W = 40;     // half-width of the bowl
const BOWL_D = 36;     // depth of the bowl
const TAB_ICONS: Record<string, { off: string; on: string }> = {
  'index': { off: 'home-outline', on: 'home' },
  'public/classify': { off: 'camera-outline', on: 'camera' },
  'public/prediction': { off: 'stats-chart-outline', on: 'stats-chart' },
  'public/waste-solutions': { off: 'leaf-outline', on: 'leaf' },
  'user/profile': { off: 'person-outline', on: 'person' },
};

const TAB_ORDER = ['index', 'public/classify', 'public/prediction', 'public/waste-solutions', 'user/profile'];

// One long, static bar strip with the bowl in its middle. It is never redrawn:
// the strip only slides sideways on the native thread, so bowl and seed move together.
function bowlStrip(len: number) {
  const c = len / 2, nw = BOWL_W, d = BOWL_D;
  return [
    `M0 0 L${c - nw} 0`,
    `C${c - nw * 0.6} 0 ${c - nw * 0.4} ${d} ${c} ${d}`,
    `C${c + nw * 0.4} ${d} ${c + nw * 0.6} 0 ${c + nw} 0`,
    `L${len} 0 L${len} ${BAR_H} L0 ${BAR_H} Z`,
  ].join(' ');
}

function CocoTabBar({ state, descriptors, navigation }: any) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [reduce, setReduce] = useState(false);

  // Only these 5 tabs, in this order.
  const routes = TAB_ORDER
    .map((name) => state.routes.find((r: any) => r.name === name))
    .filter(Boolean);
  const n = routes.length;
  const activeIdx = routes.findIndex((r: any) => r.key === state.routes[state.index]?.key);

  const W = Math.min(width - 24, 520);
  const inset = 14;
  const itemW = (W - inset * 2) / n;
  const cxOf = (i: number) => inset + itemW * (i + 0.5);

  const startX = cxOf(Math.max(activeIdx, 0));
  const startD = activeIdx >= 0 ? 1 : 0;
  // everything below runs on the native thread
  const posN = useRef(new Animated.Value(startX)).current;     // seed x
  const bowlN = useRef(new Animated.Value(activeIdx >= 0 ? startX : -120)).current; // bowl x
  const depthN = useRef(new Animated.Value(startD)).current;   // seed size
  const pop = useRef(new Animated.Value(1)).current;
  const STRIP = W * 3;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => setReduce(!!v)).catch(() => {});
  }, []);

  useEffect(() => {
    const to = activeIdx >= 0 ? cxOf(activeIdx) : null;
    const dep = activeIdx >= 0 ? 1 : 0;
    if (reduce) {
      if (to !== null) { posN.setValue(to); bowlN.setValue(to); } else bowlN.setValue(-120);
      depthN.setValue(dep); pop.setValue(1);
      return;
    }
    const move = { duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: true };
    const list: Animated.CompositeAnimation[] = [
      Animated.timing(depthN, { duration: 200, easing: Easing.out(Easing.cubic), toValue: dep, useNativeDriver: true }),
    ];
    if (to !== null) {
      list.push(
        Animated.timing(posN, { ...move, toValue: to }),
        Animated.timing(bowlN, { ...move, toValue: to }),
      );
      pop.setValue(0);
      list.push(Animated.spring(pop, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }));
    } else {
      list.push(Animated.timing(bowlN, { ...move, toValue: -120 }));
    }
    Animated.parallel(list).start();
  }, [activeIdx, W, reduce]);

  const activeRoute = activeIdx >= 0 ? routes[activeIdx] : null;
  const activeIcon = activeRoute ? (TAB_ICONS[activeRoute.name]?.on ?? 'ellipse') : 'ellipse';
  const seedScale = depthN.interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolateLeft: 'clamp' });

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, alignItems: 'center', paddingBottom: Math.max(insets.bottom, 6) + 4 }}
    >
      <View style={{ width: W, height: TOP + BAR_H + 8 }}>
        <View style={{ position: 'absolute', top: TOP, left: 0, width: W, height: BAR_H, borderRadius: 24, overflow: 'hidden' }} pointerEvents="none">
          <Animated.View style={{ position: 'absolute', top: 0, left: 0, width: STRIP, height: BAR_H, transform: [{ translateX: Animated.subtract(bowlN, STRIP / 2) }] }}>
            <Svg width={STRIP} height={BAR_H}>
              <Path d={bowlStrip(STRIP)} fill={C.forest} />
            </Svg>
          </Animated.View>
        </View>

        {/* seed that sits in the bowl */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute', top: TOP - 4 - SEED / 2, left: 0, width: SEED, height: SEED,
            transform: [{ translateX: Animated.subtract(posN, SEED / 2) }, { scale: seedScale }],
          }}
        >
          <View style={styles.seed}>
            <Animated.View style={{
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
                { rotate: pop.interpolate({ inputRange: [0, 1], outputRange: ['-25deg', '0deg'] }) },
              ],
            }}>
              <Ionicons name={activeIcon as any} size={30} color={C.forest} />
            </Animated.View>
          </View>
        </Animated.View>

        {/* tabs */}
        <View style={{ position: 'absolute', top: TOP, left: inset, right: inset, height: BAR_H, flexDirection: 'row' }}>
          {routes.map((route: any, i: number) => {
            const { options } = descriptors[route.key];
            const focused = i === activeIdx;
            const label = (options.title ?? route.name) as string;
            const icon = TAB_ICONS[route.name]?.off ?? 'ellipse-outline';
            const onPress = () => {
              const e = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
              if (!focused && !e.defaultPrevented) navigation.navigate(route.name, route.params);
            };
            return (
              <Pressable
                key={route.key}
                onPress={onPress}
                accessibilityRole="tab"
                accessibilityState={{ selected: focused }}
                accessibilityLabel={label}
                hitSlop={{ top: 24, bottom: 6 }}
                style={({ pressed, hovered }: any) => [
                  { width: itemW, height: BAR_H, alignItems: 'center', justifyContent: 'center' },
                  pressed && { opacity: 0.7 },
                  hovered && !focused && { opacity: 0.8 },
                  Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null,
                ]}
              >
                <Ionicons name={icon as any} size={27} color={C.leaf} style={{ opacity: focused ? 0 : 0.9 }} />
                <Text
                  numberOfLines={1}
                  style={{
                    marginTop: 4, fontSize: 13, letterSpacing: 0.2,
                    fontWeight: focused ? '900' : '700',
                    color: focused ? C.cream : C.leaf, opacity: focused ? 1 : 0.88,
                  }}
                >
                  {label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

// Right-side floating stack (mobile). The chatbot should sit above the tab bar:
// set FloatingChatbot's mobile `bottom` to about 130 → FAB sits 56 + 14 above it.
const FAB_BOTTOM = 200;

export default function TabsLayout() {
  const { width } = useWindowDimensions();
  const pathname = usePathname();
  const isDesktop = Platform.OS === 'web' && width > 768;

  const [isAdmin, setIsAdmin] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifCount, setNotifCount] = useState(0);
  const [fabOpen, setFabOpen] = useState(false);

  useEffect(() => {
    const checkUserRole = async () => {
      try {
        let savedUser;
        if (Platform.OS === 'web') {
          savedUser = localStorage.getItem('user_session');
        } else {
          savedUser = await SecureStore.getItemAsync('user_session');
        }
        if (savedUser) {
          const userData = JSON.parse(savedUser);
          setUser(userData);
          setIsAdmin(userData.role?.toLowerCase() === 'admin');
        }
      } catch (error) {
        setIsAdmin(false);
      }
    };
    checkUserRole();
  }, [pathname]);

  const checkActive = (path: string) => {
    if (path === '/(tabs)' && (pathname === '/(tabs)' || pathname === '/(tabs)/index')) return true;
    return pathname === path;
  };

  const HeaderItem = ({ name, icon, path }: { name: string; icon: any; path: string }) => {
    const active = checkActive(path);
    const [hovered, setHovered] = useState(false);
    const scaleAnim = React.useRef(new Animated.Value(1)).current;

    const handleMouseEnter = () => {
      setHovered(true);
      if (Platform.OS === 'web') Animated.spring(scaleAnim, { toValue: 1.05, useNativeDriver: true, speed: 20 }).start();
    };
    const handleMouseLeave = () => {
      setHovered(false);
      if (Platform.OS === 'web') Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, speed: 20 }).start();
    };

    const iconColor = active ? '#fff' : hovered ? '#fff' : 'rgba(255,255,255,0.75)';

    return (
      <Animated.View style={{ transform: [{ scale: scaleAnim }] }}>
        <TouchableOpacity
          onPress={() => router.push(path as any)}
          style={[styles.headerItem, active && styles.activeHeaderItem, hovered && !active && styles.hoveredHeaderItem]}
          activeOpacity={0.8}
          {...(Platform.OS === 'web' ? { onMouseEnter: handleMouseEnter, onMouseLeave: handleMouseLeave } : {})}
        >
          <Ionicons name={icon} size={18} color={iconColor} />
          <Text style={[styles.headerText, active && styles.activeHeaderText, hovered && !active && styles.hoveredHeaderText]}>
            {name}
          </Text>
        </TouchableOpacity>
      </Animated.View>
    );
  };

  const Header = () => {
    const bellScale = React.useRef(new Animated.Value(1)).current;
    const profileScale = React.useRef(new Animated.Value(1)).current;
    const loginScale = React.useRef(new Animated.Value(1)).current;
    const logoScale = React.useRef(new Animated.Value(1)).current;

    const spring = (anim: Animated.Value, to: number) =>
      Animated.spring(anim, { toValue: to, useNativeDriver: true, speed: 30, bounciness: 3 }).start();

    const hoverHandlers = (anim: Animated.Value) =>
      Platform.OS === 'web'
        ? { onMouseEnter: () => spring(anim, 1.12), onMouseLeave: () => spring(anim, 1) }
        : {};

    return (
      <LinearGradient
        colors={['#052e16', '#0f4c25', '#166534', '#1a7d3f']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.header}
      >
        <Animated.View style={{ transform: [{ scale: logoScale }] }} {...hoverHandlers(logoScale)}>
          <TouchableOpacity style={styles.logoContainer} onPress={() => router.push('/(tabs)')} activeOpacity={0.85}>
            <CoconutLogo size={34} />
            <Text style={styles.logo}>CocoVision</Text>
          </TouchableOpacity>
        </Animated.View>

        <View style={styles.headerMenu}>
          <HeaderItem name="Home" icon="home-outline" path="/(tabs)" />
          <HeaderItem name="Classify" icon="camera-outline" path="/(tabs)/public/classify" />
          <HeaderItem name="Create" icon="add-circle-outline" path="/(tabs)/public/post" />
          <HeaderItem name="Price" icon="stats-chart-outline" path="/(tabs)/public/prediction" />
          <HeaderItem name="Waste" icon="leaf-outline" path="/(tabs)/public/waste-solutions" />
          <HeaderItem name="About Us" icon="information-circle-outline" path="/(tabs)/public/about-us" />
        </View>

        <View style={styles.headerRight}>
          <Animated.View style={{ transform: [{ scale: bellScale }] }} {...hoverHandlers(bellScale)}>
            <TouchableOpacity
              onPress={() => setNotifOpen(v => !v)}
              style={[styles.headerBellButton, notifOpen && styles.headerBellButtonActive]}
              activeOpacity={0.8}
            >
              <Ionicons name="notifications-outline" size={20} color="#fff" />
              {notifCount > 0 && !notifOpen && (
                <View style={styles.headerBellBadge}>
                  <Text style={styles.headerBellBadgeText}>{notifCount > 99 ? '99+' : notifCount}</Text>
                </View>
              )}
            </TouchableOpacity>
          </Animated.View>

          {user ? (
            <Animated.View style={{ transform: [{ scale: profileScale }] }} {...hoverHandlers(profileScale)}>
              <TouchableOpacity onPress={() => router.push('/(tabs)/user/profile')} style={styles.headerProfileIcon} activeOpacity={0.85}>
                {user.profileImage ? (
                  <Image source={{ uri: user.profileImage }} style={styles.headerProfileImage} />
                ) : (
                  <View style={styles.headerProfileAvatar}>
                    <Text style={styles.headerProfileAvatarText}>{user.fullName?.charAt(0) || 'U'}</Text>
                  </View>
                )}
              </TouchableOpacity>
            </Animated.View>
          ) : (
            <Animated.View style={{ transform: [{ scale: loginScale }] }} {...hoverHandlers(loginScale)}>
              <TouchableOpacity onPress={() => router.push('/(auth)/login')} style={styles.headerLoginButton} activeOpacity={0.85}>
                <Text style={styles.headerLoginText}>Login</Text>
              </TouchableOpacity>
            </Animated.View>
          )}
          {isAdmin && <HeaderItem name="Admin" icon="shield-checkmark" path="/(tabs)/admin/admin" />}
        </View>
      </LinearGradient>
    );
  };

  return (
    <View style={{ flex: 1, flexDirection: 'column' }}>
      {isDesktop && <Header />}

      <View style={{ flex: 1 }}>
        <Tabs
          tabBar={(props) => (isDesktop ? null : <CocoTabBar {...props} />)}
          screenOptions={{ headerShown: false }}
        >
          <Tabs.Screen name="index" options={{ title: 'Home' }} />
          <Tabs.Screen name="public/classify" options={{ title: 'Scan' }} />
          <Tabs.Screen name="public/prediction" options={{ title: 'Price' }} />
          <Tabs.Screen name="public/waste-solutions" options={{ title: 'Waste' }} />
          <Tabs.Screen name="user/profile" options={{ title: 'Profile' }} />
          <Tabs.Screen name="public/post" options={{ href: null }} />
          <Tabs.Screen name="public/about-us" options={{ href: null }} />
          <Tabs.Screen name="public/acoustic" options={{ href: null }} />
          <Tabs.Screen name="public/[postId]" options={{ href: null }} />
          <Tabs.Screen name="admin/admin" options={{ href: null }} />
          <Tabs.Screen name="user/notifications" options={{ href: null }} />
        </Tabs>
      </View>

      {/* ── Desktop: notification panel anchored below header ── */}
      {isDesktop && (
        <View style={styles.notifPanelAnchor} pointerEvents="box-none">
          <FloatingNotifications
            controlled
            isOpen={notifOpen}
            onToggle={() => setNotifOpen(v => !v)}
            onUnreadCountChange={setNotifCount}
            panelAnchor="top"
          />
        </View>
      )}

      {/* ── Desktop: floating chatbot (bottom-right) ── */}
      {isDesktop && <FloatingChatbot />}

      {/* ── Mobile: floating notification bell (top-right, unchanged) ── */}
      {!isDesktop && <FloatingNotifications onUnreadCountChange={setNotifCount} />}

      {/* ── Mobile: right-side floating stack (chatbot + FAB speed-dial) ── */}
      {!isDesktop && (
        <>
          <FloatingChatbot />

          {fabOpen && (
            <TouchableOpacity
              style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 98 }}
              onPress={() => setFabOpen(false)}
              activeOpacity={1}
            />
          )}

          <View pointerEvents="box-none" style={styles.fabContainer}>
            {fabOpen &&
              [
                ...(isAdmin ? [{ name: 'Admin', icon: 'shield-checkmark-outline', path: '/(tabs)/admin/admin' }] : []),
                { name: 'Create Post', icon: 'add-circle-outline', path: '/(tabs)/public/post' },
                { name: 'Sound analysis', icon: 'mic-outline', path: '/(tabs)/public/acoustic' },
              ].map(item => (
                <TouchableOpacity
                  key={item.name}
                  style={styles.fabItem}
                  onPress={() => {
                    router.push(item.path as any);
                    setFabOpen(false);
                  }}
                >
                  <Ionicons name={item.icon as any} size={22} color={C.cream} />
                  <Text style={styles.fabItemLabel}>{item.name}</Text>
                </TouchableOpacity>
              ))}

            <TouchableOpacity style={styles.fabButton} onPress={() => setFabOpen(v => !v)} accessibilityLabel="More actions">
              <Ionicons name={fabOpen ? 'close' : 'add'} size={28} color={C.ink} />
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    ...(Platform.OS === 'web'
      ? { boxShadow: '0 4px 20px rgba(5, 46, 22, 0.35)' }
      : { elevation: 12, shadowColor: '#052e16', shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } }),
  },
  headerMenu: { flexDirection: 'row', gap: 8, flex: 1, justifyContent: 'center' },
  headerRight: { flexDirection: 'row', gap: 10, alignItems: 'center', marginRight: 8 },
  headerItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  activeHeaderItem: { backgroundColor: 'rgba(255,255,255,0.22)', borderColor: 'rgba(255,255,255,0.35)' },
  hoveredHeaderItem: { backgroundColor: 'rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.2)' },
  headerText: { marginLeft: 7, fontSize: 14, color: 'rgba(255,255,255,0.8)', fontWeight: '600' },
  activeHeaderText: { fontWeight: '800', color: '#fff' },
  hoveredHeaderText: { color: '#fff', fontWeight: '700' },
  logo: { fontSize: 22, fontWeight: '900', color: '#fff', marginLeft: 6, letterSpacing: -0.5 },
  logoContainer: { flexDirection: 'row', alignItems: 'center', gap: 6 },

  headerProfileIcon: {
    width: 40, height: 40, borderRadius: 20,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.8)',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  headerProfileImage: { width: 36, height: 36, borderRadius: 18 },
  headerProfileAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.25)',
    justifyContent: 'center', alignItems: 'center',
  },
  headerProfileAvatarText: { color: '#fff', fontSize: 16, fontWeight: '900' },

  headerBellButton: {
    width: 38, height: 38, borderRadius: 19,
    justifyContent: 'center', alignItems: 'center',
    position: 'relative',
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  headerBellButtonActive: { backgroundColor: 'rgba(255,255,255,0.28)', borderColor: 'rgba(255,255,255,0.5)' },
  headerBellBadge: {
    position: 'absolute', top: 4, right: 4,
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: '#ef4444',
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 3, borderWidth: 1.5, borderColor: '#fff',
  },
  headerBellBadgeText: { color: '#fff', fontSize: 9, fontWeight: '800' },

  headerLoginButton: {
    paddingVertical: 8, paddingHorizontal: 18, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.5)',
    justifyContent: 'center', alignItems: 'center',
    ...(Platform.OS === 'web' ? { cursor: 'pointer' as any } : {}),
  },
  headerLoginText: { color: '#fff', fontSize: 14, fontWeight: '700' },

  // ── Tab bar seed ──
  seed: {
    width: SEED, height: SEED, borderRadius: SEED / 2,
    backgroundColor: C.cream,
    borderWidth: 5, borderColor: C.lime,
    alignItems: 'center', justifyContent: 'center',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 6px 14px rgba(31,48,18,0.30)' } as any)
      : { elevation: 8, shadowColor: '#1F3012', shadowOpacity: 0.3, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }),
  },

  // ── FAB (right side, above the chatbot) ──
  fabContainer: {
    position: 'absolute',
    bottom: FAB_BOTTOM,
    right: 16,
    zIndex: 99,
    alignItems: 'flex-end',
  },
  fabButton: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.lime,
    justifyContent: 'center', alignItems: 'center',
    elevation: 8,
    shadowColor: C.ink, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 8,
    borderWidth: 3, borderColor: C.cream,
  },
  fabItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.forest,
    borderRadius: 28,
    paddingHorizontal: 18, paddingVertical: 13,
    marginBottom: 10,
    gap: 10,
    elevation: 6,
    shadowColor: C.ink, shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3, shadowRadius: 6,
    borderWidth: 2, borderColor: C.lime,
  },
  fabItemLabel: { color: C.cream, fontWeight: '800', fontSize: 15 },

  notifPanelAnchor: {
    position: 'absolute',
    top: HEADER_H,
    right: 20,
    zIndex: 1000,
  },
});