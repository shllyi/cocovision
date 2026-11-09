import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

// Temporary placeholder shown until the real screen is rebuilt.
export default function ComingSoon({ title, icon = 'construct-outline' }: { title: string; icon?: any }) {
  return (
    <SafeAreaView style={s.safe}>
      <View style={s.box}>
        <View style={s.circle}>
          <Ionicons name={icon} size={40} color="#16a34a" />
        </View>
        <Text style={s.title}>{title}</Text>
        <Text style={s.text}>This screen is being rebuilt. Please check back soon.</Text>
        <TouchableOpacity style={s.btn} onPress={() => router.replace('/(tabs)')} activeOpacity={0.85}>
          <Ionicons name="home" size={18} color="#fff" />
          <Text style={s.btnText}>Back to Home</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f0fdf4' },
  box: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  circle: {
    width: 88, height: 88, borderRadius: 44, backgroundColor: '#dcfce7',
    justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#16a34a',
  },
  title: { fontSize: 22, fontWeight: '800', color: '#166534', textAlign: 'center' },
  text: { fontSize: 14, color: '#64748b', textAlign: 'center', maxWidth: 300, lineHeight: 20 },
  btn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#16a34a',
    paddingHorizontal: 22, height: 46, borderRadius: 23, marginTop: 8,
  },
  btnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
