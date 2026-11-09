import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity, Pressable,
  FlatList, KeyboardAvoidingView, Platform, Modal, Animated, Easing, Image,
  useWindowDimensions, AccessibilityInfo,
} from 'react-native';
import { usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path, Circle, Ellipse } from 'react-native-svg';
import * as SecureStore from 'expo-secure-store';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NGROK_URL } from '../constants/config';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

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
  body: '#4A5A3C',
};
const DISPLAY: any = { fontWeight: '900', letterSpacing: -0.3 };

const BTN = 68;
// Space the tab bar takes on mobile (bar 68 + seed rising 36 + padding) so the button sits above it.
// Button sits just above the tab bar body. On the Profile tab the raised circle is right under it, so it hops up.
const TAB_BAR_CLEARANCE = 92;
const PROFILE_LIFT = 44;

const ORGANIC_WINDOW = { borderTopLeftRadius: 34, borderTopRightRadius: 14, borderBottomRightRadius: 34, borderBottomLeftRadius: 14 };
const ORGANIC_AI = { borderTopLeftRadius: 6, borderTopRightRadius: 22, borderBottomRightRadius: 22, borderBottomLeftRadius: 22 };
const ORGANIC_USER = { borderTopLeftRadius: 22, borderTopRightRadius: 22, borderBottomRightRadius: 6, borderBottomLeftRadius: 22 };

const SUGGESTIONS = [
  { icon: 'search', text: 'How do I know a coconut is mature?' },
  { icon: 'trending-up', text: 'What affects coconut prices?' },
  { icon: 'camera', text: 'How do I scan a coconut?' },
  { icon: 'leaf', text: 'What can I do with coconut waste?' },
];

const SOFT_SHADOW: any = Platform.OS === 'web'
  ? { boxShadow: '0 12px 28px rgba(31, 48, 18, 0.22), 0 2px 6px rgba(31, 48, 18, 0.10)' }
  : { shadowColor: '#1F3012', shadowOpacity: 0.22, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 8 };

// ─── Coconut art (unchanged) ──────────────────────────────────────────────────

const CoconutIcon = ({ size = 28 }: { size?: number }) => (
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

const MASCOT = require('../assets/images/chatboticon.png');

// ─── Small pieces ─────────────────────────────────────────────────────────────

/** Scalloped leafy edge under the header, same idea as the bush edge on Home. */
function LeafEdge() {
  const sizes = [34, 44, 30, 40, 36];
  return (
    <View pointerEvents="none" style={{ height: 16, overflow: 'hidden', backgroundColor: C.paper }}>
      {Array.from({ length: 20 }).map((_, i) => {
        const s = sizes[i % sizes.length];
        const vis = 10 + (i % 3) * 3;
        return (
          <View key={i} style={{ position: 'absolute', left: i * 22 - 10, top: vis - s, width: s, height: s, borderRadius: s / 2, backgroundColor: C.forest }} />
        );
      })}
      <View style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 6, backgroundColor: C.forest }} />
    </View>
  );
}

/** Three bouncing dots while the assistant is thinking. */
function TypingDots({ reduce }: { reduce: boolean }) {
  const dots = useRef([0, 1, 2].map(() => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduce) return;
    const loops = dots.map((v, i) =>
      Animated.loop(Animated.sequence([
        Animated.delay(i * 140),
        Animated.timing(v, { toValue: 1, duration: 320, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(v, { toValue: 0, duration: 320, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        Animated.delay(420 - i * 140),
      ]))
    );
    loops.forEach(l => l.start());
    return () => loops.forEach(l => l.stop());
  }, [reduce]);
  return (
    <View style={[styles.msgBlock, { borderLeftColor: C.forest }]}>
      <Text style={styles.msgLabel}>Helper</Text>
      <View style={{ flexDirection: 'row', gap: 7, paddingVertical: 8 }}>
        {dots.map((v, i) => (
          <Animated.View key={i} style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: C.moss, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [0, -6] }) }] }} />
        ))}
      </View>
    </View>
  );
}

/** One chat message: plain full-width text with a coloured side line, no bubble. */
function Bubble({ item, reduce }: { item: Message; reduce: boolean; maxW?: number }) {
  const a = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.spring(a, { toValue: 1, friction: 8, tension: 70, useNativeDriver: true }).start();
  }, []);
  const isUser = item.sender === 'user';
  return (
    <Animated.View
      style={[styles.msgBlock, {
        borderLeftColor: isUser ? C.lime : C.forest,
        opacity: a,
        transform: [{ translateY: a.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }],
      }]}
    >
      <Text style={styles.msgLabel}>{isUser ? 'You' : 'Helper'}</Text>
      <Text style={styles.messageText}>{item.text}</Text>
    </Animated.View>
  );
}

/** Suggestion chip with a little press feedback. */
function Chip({ icon, text, onPress, index, reduce }: any) {
  const pop = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  const press = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.spring(pop, { toValue: 1, delay: 120 + index * 90, friction: 7, tension: 70, useNativeDriver: true }).start();
  }, []);
  const go = (v: number) => Animated.spring(press, { toValue: v, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  return (
    <Animated.View style={{ opacity: pop, transform: [{ translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }, { scale: press }] }}>
      <Pressable
        onPress={onPress} onPressIn={() => go(0.96)} onPressOut={() => go(1)}
        accessibilityRole="button" accessibilityLabel={text}
        style={[styles.chip, Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : null]}
      >
        <View style={styles.chipIcon}><Ionicons name={icon} size={18} color={C.cream} /></View>
        <Text style={styles.chipText}>{text}</Text>
      </Pressable>
    </Animated.View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FloatingChatbot() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isNative = Platform.OS !== 'web';

  const [isOpen, setIsOpen] = useState(false);
  const [isChatVisible, setIsChatVisible] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [reduce, setReduce] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const textRef = useRef('');  // always holds the latest typed text, even mid-keyboard-suggestion
  const scaleAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;
  const hoverScaleAnim = useRef(new Animated.Value(1)).current;
  const crackAnim = useRef(new Animated.Value(0)).current;
  const hintAnim = useRef(new Animated.Value(0)).current;
  const sendPress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.().then(v => setReduce(!!v)).catch(() => {});
  }, []);

  /* open / close */
  useEffect(() => {
    if (isOpen) {
      setIsChatVisible(true);
      Animated.spring(scaleAnim, { toValue: 1, friction: 7, tension: 60, useNativeDriver: true }).start();
    } else {
      Animated.spring(scaleAnim, { toValue: 0, friction: 6, tension: 80, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setIsChatVisible(false);
      });
    }
  }, [isOpen]);

  const chatOpacity = scaleAnim.interpolate({ inputRange: [0, 0.3], outputRange: [0, 1], extrapolate: 'clamp' });

  useEffect(() => {
    Animated.spring(crackAnim, { toValue: isOpen ? 1 : 0, friction: 4, tension: 80, useNativeDriver: true }).start();
  }, [isOpen]);

  const mascotRotate = crackAnim.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '-14deg'] });
  const mascotScale = crackAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 0.92] });

  /* hop up when the Profile tab's raised circle would be underneath (mobile only) */
  const pathname = usePathname();
  const lift = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const onProfile = isNative && String(pathname).includes('profile');
    Animated.spring(lift, { toValue: onProfile ? -PROFILE_LIFT : 0, friction: 8, tension: 70, useNativeDriver: true }).start();
  }, [pathname]);

  /* gentle bob */
  useEffect(() => {
    if (reduce) return;
    const float = Animated.loop(Animated.sequence([
      Animated.timing(floatAnim, { toValue: -6, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      Animated.timing(floatAnim, { toValue: 0, duration: 1700, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
    ]));
    float.start();
    return () => float.stop();
  }, [reduce]);

  /* "Ask me" hint: appears once after a moment, then tucks away */
  useEffect(() => {
    const t1 = setTimeout(() => {
      setShowHint(true);
      Animated.spring(hintAnim, { toValue: 1, friction: 7, tension: 70, useNativeDriver: true }).start();
    }, 1500);
    const t2 = setTimeout(() => {
      Animated.timing(hintAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => setShowHint(false));
    }, 9000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  const handleHoverIn = () => Animated.spring(hoverScaleAnim, { toValue: 1.1, friction: 5, useNativeDriver: true }).start();
  const handleHoverOut = () => Animated.spring(hoverScaleAnim, { toValue: 1, friction: 5, useNativeDriver: true }).start();

  const toggle = () => {
    if (showHint) { hintAnim.setValue(0); setShowHint(false); }
    setIsOpen(v => !v);
  };

  /* user */
  useEffect(() => {
    const checkUser = async () => {
      try {
        const savedUser = Platform.OS === 'web'
          ? localStorage.getItem('user_session')
          : await SecureStore.getItemAsync('user_session');
        if (savedUser) setUser(JSON.parse(savedUser));
      } catch (error) {
        console.log('Error loading session', error);
      }
    };
    checkUser();
  }, []);

  /* sending */
  const sendMessage = async (override?: string) => {
    const userMsgText = (override ?? textRef.current ?? inputText).trim();
    if (!userMsgText || loading) return;

    const newMessage: Message = { id: Date.now().toString(), text: userMsgText, sender: 'user', timestamp: new Date() };
    setMessages(prev => [...prev, newMessage]);
    textRef.current = '';
    setInputText('');
    setLoading(true);

    try {
      const userId = (user && (user.id || user._id || user.user_id)) || null;

      const response = await fetch(`${NGROK_URL}/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ message: userMsgText, user_id: userId }),
      });

      const contentType = response.headers.get('content-type') || '';
      let data: any = null;
      let rawText: string | null = null;

      if (contentType.includes('application/json')) {
        data = await response.json();
      } else {
        rawText = await response.text();
      }

      if (!response.ok) {
        const detail = (data && (data.detail || data.message)) || (rawText && rawText.trim().slice(0, 200)) || `Request failed (${response.status})`;
        throw new Error(detail);
      }

      const replyText =
        (data && typeof data.response === 'string' && data.response) ||
        (rawText && rawText.trim()) ||
        "I couldn't answer that just now. Please try again.";

      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: replyText, sender: 'ai', timestamp: new Date() }]);
    } catch (error) {
      console.error('Chat Error:', error);
      setMessages(prev => [...prev, { id: (Date.now() + 1).toString(), text: "I can't connect right now. Check your internet and try again.", sender: 'ai', timestamp: new Date() }]);
    } finally {
      setLoading(false);
    }
  };

  const firstName = user ? String(user.username || user.fullName || user.name || '').split(' ')[0] : '';
  const canSend = !!inputText.trim() && !loading;

  const listInnerW = (isNative ? Math.min(width - 24, 420) : 390) - 32; // window width minus list padding

  const scrollToLatest = () => {
    if (!messages.length) return;
    const last = messages.length - 1;
    if (messages[last].sender === 'ai') {
      // show the START of a new reply so long answers aren't cut off at the top
      flatListRef.current?.scrollToIndex({ index: last, viewPosition: 0, animated: true });
    } else {
      flatListRef.current?.scrollToEnd({ animated: true });
    }
  };

  const renderChatContent = () => (
    <View style={styles.chatWindowContent} pointerEvents="auto">
      {/* header */}
      <View style={styles.chatHeader}>
        <View style={styles.headerIconContainer}>
          <Image source={MASCOT} style={{ width: 38, height: 38 }} resizeMode="contain" accessibilityLabel="CocoVision helper" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[DISPLAY, { fontSize: 20, color: C.cream }]} numberOfLines={1}>CocoVision Helper</Text>
          <Text style={{ fontSize: 14, color: C.leaf, fontWeight: '600', marginTop: 1 }} numberOfLines={1}>
            {firstName ? `Hello, ${firstName}` : 'Ask about your coconuts'}
          </Text>
        </View>
        {messages.length > 0 && (
          <Pressable onPress={() => setMessages([])} accessibilityRole="button" accessibilityLabel="Start a new chat" style={styles.headerPill}>
            <Ionicons name="refresh" size={16} color={C.ink} />
            <Text style={{ color: C.ink, fontWeight: '800', fontSize: 14 }}>New</Text>
          </Pressable>
        )}
        <Pressable onPress={() => setIsOpen(false)} accessibilityRole="button" accessibilityLabel="Close chat" style={styles.closeBtn}>
          <Ionicons name="close" size={24} color={C.cream} />
        </Pressable>
      </View>
      <LeafEdge />

      {/* messages */}
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={({ item }) => <Bubble item={item} reduce={reduce} maxW={listInnerW} />}
        contentContainerStyle={[styles.chatArea, messages.length === 0 && { flexGrow: 1, justifyContent: 'center' }]}
        onContentSizeChange={scrollToLatest}
        onScrollToIndexFailed={() => flatListRef.current?.scrollToEnd({ animated: true })}
        style={styles.messagesList}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bounces={Platform.OS === 'ios'}
        overScrollMode="never"
        ListEmptyComponent={
          <View style={{ alignItems: 'center' }}>
            <Text style={[DISPLAY, { fontSize: 24, lineHeight: 28, color: C.forest, textAlign: 'center' }]}>How can I help?</Text>
            <Text style={{ fontSize: 16, lineHeight: 23, color: C.body, fontWeight: '600', textAlign: 'center', marginTop: 6, marginBottom: 16 }}>
              Tap a question, or type your own below.
            </Text>
            <View style={{ alignSelf: 'stretch', gap: 10 }}>
              {SUGGESTIONS.map((s, i) => (
                <Chip key={s.text} icon={s.icon} text={s.text} index={i} reduce={reduce} onPress={() => sendMessage(s.text)} />
              ))}
            </View>
          </View>
        }
        ListFooterComponent={loading ? <TypingDots reduce={reduce} /> : null}
      />

      {/* input */}
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
        <View style={styles.inputContainer}>
          <TextInput
            style={[styles.input, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : null]}
            placeholder={loading ? 'Thinking…' : 'Type your question'}
            placeholderTextColor="#6f7f62"
            value={inputText}
            onChangeText={(t) => { textRef.current = t; setInputText(t); }}
            multiline
            maxLength={2000}
            autoCorrect={false}
            spellCheck={false}
            autoComplete="off"
            textAlignVertical="center"
            editable={!loading}
            accessibilityLabel="Type your question"
            onKeyPress={(e: any) => {
              if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
                e.preventDefault?.();
                sendMessage();
              }
            }}
          />
          <Animated.View style={{ transform: [{ scale: sendPress }] }}>
            <Pressable
              // wait one tick so the keyboard can hand over its last typed word first
              onPress={() => setTimeout(() => sendMessage(), 60)}
              onPressIn={() => Animated.spring(sendPress, { toValue: 0.9, useNativeDriver: true, speed: 40 }).start()}
              onPressOut={() => Animated.spring(sendPress, { toValue: 1, useNativeDriver: true, speed: 40, bounciness: 8 }).start()}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel="Send"
              style={[styles.sendButton, !canSend && styles.disabledButton]}
            >
              <Ionicons name="send" size={22} color={canSend ? C.ink : '#8d826f'} />
            </Pressable>
          </Animated.View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );

  // mobile: sits above the tab bar (and the seed that rises out of it)
  const containerBottom = Platform.OS === 'web' ? 20 : insets.bottom + TAB_BAR_CLEARANCE;
  const winW = Math.min(width - 24, 420);
  const winH = Math.min(height * 0.74, 600);

  return (
    <Animated.View style={[styles.container, { bottom: containerBottom, transform: [{ translateY: lift }] }]} pointerEvents="box-none">
      {/* hint label */}
      {showHint && !isOpen && (
        <Animated.View
          pointerEvents="none"
          style={[styles.hint, {
            opacity: hintAnim,
            transform: [{ translateX: hintAnim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }, { scale: hintAnim.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
          }]}
        >
          <Text style={{ color: C.ink, fontWeight: '800', fontSize: 16 }}>Ask me anything</Text>
        </Animated.View>
      )}

      {/* floating coconut button */}
      <Animated.View style={[styles.chatButtonWrapper, { transform: [{ translateY: floatAnim }, { scale: hoverScaleAnim }] }]}>
        <Pressable
          style={({ pressed }) => [styles.chatButton, pressed && styles.chatButtonPressed]}
          onPress={toggle}
          accessibilityRole="button"
          accessibilityLabel={isOpen ? 'Close helper chat' : 'Open helper chat'}
          // @ts-ignore – web-only hover events
          onHoverIn={handleHoverIn}
          onHoverOut={handleHoverOut}
        >
          <Animated.Image
            source={MASCOT}
            resizeMode="contain"
            accessibilityLabel="CocoVision helper"
            style={{ width: BTN, height: BTN, transform: [{ rotate: mascotRotate }, { scale: mascotScale }] }}
          />
        </Pressable>
      </Animated.View>

      {/* chat window: Modal on mobile, inline on web */}
      {isNative ? (
        <Modal visible={isOpen} transparent animationType="none" onRequestClose={() => setIsOpen(false)} statusBarTranslucent>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <View style={[styles.modalOverlay, { paddingBottom: insets.bottom + 14 }]}>
              <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsOpen(false)} accessibilityLabel="Close chat" />
              <Animated.View style={[styles.chatWindow, ORGANIC_WINDOW, { width: winW, height: winH, opacity: scaleAnim, transform: [{ scale: scaleAnim }] }]}>
                {renderChatContent()}
              </Animated.View>
            </View>
          </KeyboardAvoidingView>
        </Modal>
      ) : (
        isChatVisible && (
          <Animated.View
            style={[
              styles.chatWindow, ORGANIC_WINDOW, styles.chatWindowWeb,
              {
                transform: [{ scale: scaleAnim }],
                opacity: chatOpacity,
                // @ts-ignore – web only
                transformOrigin: 'bottom right',
              },
            ]}
          >
            {renderChatContent()}
          </Animated.View>
        )
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: Platform.OS === 'web' ? 20 : 16,
    zIndex: 1000,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(31,48,18,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },

  /* button */
  chatButtonWrapper: { alignSelf: 'flex-end' },
  chatButton: {
    width: BTN, height: BTN,
    justifyContent: 'center', alignItems: 'center',
    ...Platform.select({ web: { cursor: 'pointer' } as any }),
  },
  chatButtonPressed: { opacity: 0.8 },
  hint: {
    position: 'absolute', right: BTN + 12, top: (BTN - 46) / 2,
    backgroundColor: C.cream, borderRadius: 24,
    borderTopRightRadius: 8,
    paddingHorizontal: 18, height: 46, justifyContent: 'center',
    borderWidth: 2, borderColor: C.lime,
    ...SOFT_SHADOW,
  },

  /* window */
  chatWindow: {
    backgroundColor: C.paper,
    overflow: 'hidden',
    ...SOFT_SHADOW,
  },
  chatWindowWeb: { position: 'absolute', bottom: 0, right: BTN + 14, width: 390, height: 560 } as any,
  chatWindowContent: { flex: 1, width: '100%', height: '100%' },

  chatHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 10,
    backgroundColor: C.forest,
  },
  headerIconContainer: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: C.lime, justifyContent: 'center', alignItems: 'center',
    transform: [{ rotate: '-6deg' }],
  },
  headerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: C.lime, borderRadius: 20, paddingHorizontal: 12, minHeight: 40,
  },
  closeBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(245,230,211,0.16)',
    alignItems: 'center', justifyContent: 'center',
  },

  messagesList: { flex: 1, backgroundColor: C.paper },
  chatArea: { padding: 16, paddingBottom: 24 },

  msgBlock: {
    alignSelf: 'stretch', marginBottom: 18,
    borderLeftWidth: 5, paddingLeft: 14,
  },
  msgLabel: { fontSize: 14, fontWeight: '900', color: C.moss, marginBottom: 3 },
  messageText: {
    fontSize: 17, lineHeight: 25, fontWeight: '500', color: C.ink, alignSelf: 'stretch',
    ...Platform.select({ web: { wordBreak: 'break-word', overflowWrap: 'anywhere' } as any }),
  },

  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.cream, borderRadius: 20, borderTopLeftRadius: 8,
    paddingHorizontal: 12, paddingVertical: 10, minHeight: 56,
    borderWidth: 2, borderColor: C.sand,
  },
  chipIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.moss,
    alignItems: 'center', justifyContent: 'center',
  },
  chipText: { flex: 1, fontSize: 16, lineHeight: 21, color: C.ink, fontWeight: '700' },

  inputContainer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 10,
    paddingHorizontal: 12, paddingVertical: 12,
    backgroundColor: C.cream,
  },
  input: {
    flex: 1, backgroundColor: C.paper,
    borderRadius: 26, paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14,
    minHeight: 52, maxHeight: 110, fontSize: 17, color: C.ink, fontWeight: '600',
    borderWidth: 2, borderColor: C.sand,
  },
  sendButton: {
    width: 52, height: 52, borderRadius: 26,
    backgroundColor: C.lime, alignItems: 'center', justifyContent: 'center',
  },
  disabledButton: { backgroundColor: C.sand },
});