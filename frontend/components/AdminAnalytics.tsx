// frontend/components/AdminAnalytics.tsx
// Admin analytics tab. Backend: GET /analytics/admin/stats  (Authorization: Bearer <admin user id>)
// Shape: { summary, charts, leaderboards, recent_activity, model_comparison, ... }

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { NGROK_URL } from '../constants/config';
import { authHeaders } from '../constants/session';

const HEADERS = { 'ngrok-skip-browser-warning': 'true' };

const EXPORTS = [
  { fmt: 'pdf', label: 'PDF', icon: 'document-text', mime: 'application/pdf' },
  { fmt: 'xlsx', label: 'Excel', icon: 'grid', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  { fmt: 'docx', label: 'Word', icon: 'document', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  { fmt: 'csv', label: 'CSV', icon: 'list', mime: 'text/csv' },
] as const;
const STAGE_COLORS: Record<string, string> = { malauhog: '#0ea5e9', malakanin: '#f59e0b', niyog: '#16a34a' };

const num = (n: any, d = 0) => (typeof n === 'number' && isFinite(n) ? n.toFixed(d) : '0');
const pct = (n: any) => `${num(n, 1)}%`;

function Tile({ icon, label, value, sub }: { icon: any; label: string; value: string; sub?: string }) {
  return (
    <View style={s.tile}>
      <Ionicons name={icon} size={18} color="#16a34a" />
      <Text style={s.tileValue}>{value}</Text>
      <Text style={s.tileLabel}>{label}</Text>
      {!!sub && <Text style={s.tileSub}>{sub}</Text>}
    </View>
  );
}

function Bars({ data, color = '#16a34a', labelEvery = 3 }: { data: { label: string; value: number }[]; color?: string; labelEvery?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0) return <Text style={s.empty}>No data yet.</Text>;
  return (
    <View>
      <View style={s.barsRow}>
        {data.map((d, i) => (
          <View key={`${d.label}-${i}`} style={s.barCol}>
            <View style={[s.bar, { height: Math.max(2, (d.value / max) * 90), backgroundColor: color }]} />
          </View>
        ))}
      </View>
      <View style={s.barsRow}>
        {data.map((d, i) => (
          <View key={`l-${i}`} style={s.barCol}>
            <Text style={s.barLabel}>{i % labelEvery === 0 ? d.label : ''}</Text>
          </View>
        ))}
      </View>
      <Text style={s.meta}>Peak: {max}</Text>
    </View>
  );
}

function StageBars({ rows }: { rows: { stage: string; count: number; confidence?: number }[] }) {
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  if (!rows.length) return <Text style={s.empty}>No scans yet.</Text>;
  return (
    <View style={{ gap: 8 }}>
      {rows.map((r) => (
        <View key={r.stage}>
          <View style={s.rowBetween}>
            <Text style={s.rowLabel}>{r.stage}</Text>
            <Text style={s.rowLabel}>{r.count} ({Math.round((r.count / total) * 100)}%){typeof r.confidence === 'number' ? `  ·  ${r.confidence}% conf` : ''}</Text>
          </View>
          <View style={s.track}>
            <View style={[s.fill, { width: `${Math.round((r.count / total) * 100)}%`, backgroundColor: STAGE_COLORS[r.stage?.toLowerCase()] ?? '#64748b' }]} />
          </View>
        </View>
      ))}
    </View>
  );
}

export default function AdminAnalytics({ uid }: { uid: string }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [series, setSeries] = useState<'scans' | 'users' | 'posts'>('scans');
  const [exporting, setExporting] = useState('');
  const [exportMsg, setExportMsg] = useState('');

  const exportReport = async (fmt: string, mime: string) => {
    if (exporting) return;
    setExporting(fmt);
    setExportMsg('');
    try {
      const url = `${NGROK_URL}/analytics/admin/export?format=${fmt}`;
      const headers = { ...HEADERS, ...(await authHeaders()) };
      const name = `cocovision-analytics-${new Date().toISOString().slice(0, 10)}.${fmt}`;

      if (Platform.OS === 'web') {
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Export failed (HTTP ${res.status}).`);
        const blob = await res.blob();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
        setExportMsg(`Downloaded ${name}`);
      } else {
        const target = new File(Paths.cache, name);
        if (target.exists) target.delete();
        const file = await File.downloadFileAsync(url, target, { headers });
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(file.uri, { mimeType: mime, dialogTitle: 'Save analytics report' });
          setExportMsg(`Ready: ${name}`);
        } else {
          Alert.alert('Saved', `File saved to the app cache as ${name}, but sharing is not available on this device.`);
        }
      }
    } catch (e: any) {
      setExportMsg(e?.message || 'Export failed.');
    } finally {
      setExporting('');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${NGROK_URL}/analytics/admin/stats`, {
        headers: { ...HEADERS, ...(await authHeaders()) },
      });
      const text = await res.text();
      let d: any;
      try { d = JSON.parse(text); } catch { throw new Error(`Server replied: ${text.slice(0, 80)}`); }
      if (!res.ok) throw new Error(typeof d?.detail === 'string' ? d.detail : `HTTP ${res.status}`);
      setData(d);
    } catch (e: any) {
      setError(e?.message || 'Could not load analytics.');
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { if (uid) load(); }, [uid, load]);

  if (loading) return <ActivityIndicator style={{ marginTop: 30 }} size="large" color="#16a34a" />;
  if (error || !data) {
    return (
      <View style={s.card}>
        <Text style={s.errorText}>{error || 'No data.'}</Text>
        <TouchableOpacity style={s.retry} onPress={load} activeOpacity={0.85}>
          <Text style={s.retryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const sm = data.summary || {};
  const ch = data.charts || {};
  const lb = data.leaderboards || {};
  const mc = data.model_comparison || {};

  const seriesRows: any[] = ch[`${series}_per_day`] || [];
  const bars = seriesRows.slice(-14).map((r) => ({ label: String(r.date).slice(5), value: r.count }));

  const byHour: Record<number, number> = {};
  (ch.scans_by_hour || []).forEach((r: any) => { byHour[r.hour] = r.count; });
  // note: backend hours are UTC. Shift to Manila (UTC+8) for display.
  const hourBars = Array.from({ length: 24 }, (_, h) => ({ label: `${h}`, value: byHour[(h - 8 + 24) % 24] ?? 0 }));

  const growth = (g: any) => `${g > 0 ? '+' : ''}${num(g, 1)}% this week`;

  return (
    <View style={{ gap: 12 }}>
      {/* export */}
      <View style={s.card}>
        <Text style={s.title}>Download report</Text>
        <View style={s.grid}>
          {EXPORTS.map((x) => (
            <TouchableOpacity
              key={x.fmt}
              style={[s.exportBtn, !!exporting && exporting !== x.fmt && { opacity: 0.5 }]}
              onPress={() => exportReport(x.fmt, x.mime)}
              disabled={!!exporting}
              activeOpacity={0.85}
            >
              {exporting === x.fmt
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name={x.icon} size={16} color="#fff" />}
              <Text style={s.exportText}>{x.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {!!exportMsg && <Text style={s.meta}>{exportMsg}</Text>}
      </View>

      {/* summary */}
      <View style={s.grid}>
        <Tile icon="people" label="Users" value={String(sm.total_users ?? 0)} sub={growth(sm.user_growth)} />
        <Tile icon="newspaper" label="Posts" value={String(sm.total_posts ?? 0)} sub={growth(sm.post_growth)} />
        <Tile icon="scan" label="Scans" value={String(sm.total_scans ?? 0)} sub={growth(sm.scan_growth)} />
        <Tile icon="leaf" label="Coconuts found" value={String(sm.total_coconuts ?? 0)} />
        <Tile icon="heart" label="Likes" value={String(sm.total_likes ?? 0)} />
        <Tile icon="chatbubble" label="Comments" value={String(sm.total_comments ?? 0)} />
      </View>

      {/* activity chart */}
      <View style={s.card}>
        <View style={s.rowBetween}>
          <Text style={s.title}>Last 14 days</Text>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            {(['scans', 'users', 'posts'] as const).map((k) => (
              <TouchableOpacity key={k} style={[s.chip, series === k && s.chipOn]} onPress={() => setSeries(k)} activeOpacity={0.85}>
                <Text style={[s.chipText, series === k && s.chipTextOn]}>{k}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
        <Bars data={bars} labelEvery={2} />
      </View>

      {/* engagement */}
      <View style={s.card}>
        <Text style={s.title}>Engagement</Text>
        <View style={s.grid}>
          <Tile icon="pulse" label="Active today" value={String(sm.dau ?? 0)} />
          <Tile icon="repeat" label="7-day retention" value={pct(sm.retention_rate)} />
          <Tile icon="person-add" label="New (7 days)" value={String(sm.new_signups_7d ?? 0)} />
          <Tile icon="flame" label="Engagement" value={pct(sm.engagement_rate)} />
        </View>
      </View>

      {/* AI performance */}
      <View style={s.card}>
        <Text style={s.title}>AI scans</Text>
        <View style={s.grid}>
          <Tile icon="checkmark-circle" label="Success rate" value={pct(sm.scan_success_rate)} />
          <Tile icon="eye-off" label="No detection" value={pct(sm.no_detection_rate)} />
          <Tile icon="speedometer" label="Avg confidence" value={pct(sm.avg_confidence)} />
          <Tile icon="timer" label="Avg time" value={`${num(sm.avg_inference_time, 2)}s`} />
        </View>

        <Text style={s.sub}>Original model</Text>
        <Text style={s.meta}>
          {pct(mc.original?.avg_confidence)} confidence  ·  {pct(mc.original?.success_rate)} success  ·  {num(mc.original?.avg_inference_time, 2)}s
        </Text>
        <StageBars rows={ch.original_model_distribution || []} />

        <Text style={[s.sub, { marginTop: 8 }]}>Custom model</Text>
        <Text style={s.meta}>
          {pct(mc.custom?.avg_confidence)} confidence  ·  {pct(mc.custom?.success_rate)} success  ·  {num(mc.custom?.avg_inference_time, 2)}s
        </Text>
        <StageBars rows={ch.custom_model_distribution || []} />
      </View>

      {/* scans by hour */}
      <View style={s.card}>
        <Text style={s.title}>Scans by hour (Manila time)</Text>
        <Bars data={hourBars} color="#0ea5e9" labelEvery={4} />
      </View>

      {/* leaderboards */}
      <View style={s.card}>
        <Text style={s.title}>Top posters</Text>
        {(lb.top_posters || []).length === 0 && <Text style={s.empty}>No posts yet.</Text>}
        {(lb.top_posters || []).map((p: any, i: number) => (
          <View key={`${p._id}-${i}`} style={s.rowBetween}>
            <Text style={s.rowLabel}>{i + 1}. {p.name || 'Unknown'}</Text>
            <Text style={s.rowLabel}>{p.post_count} post{p.post_count === 1 ? '' : 's'}</Text>
          </View>
        ))}
        <Text style={[s.title, { marginTop: 8 }]}>Top scanners</Text>
        {(lb.top_scanners || []).length === 0 && <Text style={s.empty}>No scans yet.</Text>}
        {(lb.top_scanners || []).map((p: any, i: number) => (
          <View key={`${p._id}-${i}`} style={s.rowBetween}>
            <Text style={s.rowLabel}>{i + 1}. {p.name || 'Unknown'}</Text>
            <Text style={s.rowLabel}>{p.scan_count} scans · {p.total_detected ?? 0} coconuts</Text>
          </View>
        ))}
      </View>

      {/* recent activity */}
      <View style={s.card}>
        <Text style={s.title}>Recent activity</Text>
        {(data.recent_activity || []).length === 0 && <Text style={s.empty}>Nothing yet.</Text>}
        {(data.recent_activity || []).map((a: any, i: number) => (
          <View key={i} style={s.activity}>
            <Ionicons name={a.type === 'scan' ? 'scan' : 'newspaper'} size={16} color="#16a34a" />
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel} numberOfLines={1}>{a.title}</Text>
              <Text style={s.meta}>{a.author}{a.timestamp ? `  ·  ${new Date(a.timestamp).toLocaleString()}` : ''}</Text>
            </View>
          </View>
        ))}
      </View>

      {!!sm.flagged_posts && (
        <Text style={s.errorText}>{sm.flagged_posts} flagged post{sm.flagged_posts === 1 ? '' : 's'} need review.</Text>
      )}
      <TouchableOpacity style={s.retry} onPress={load} activeOpacity={0.85}>
        <Ionicons name="refresh" size={16} color="#16a34a" />
        <Text style={s.retryText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#e2e8f0', padding: 14, gap: 8 },
  title: { fontSize: 15, fontWeight: '800', color: '#166534' },
  sub: { fontSize: 13, fontWeight: '800', color: '#0f172a' },
  meta: { fontSize: 11, color: '#94a3b8' },
  empty: { fontSize: 13, color: '#94a3b8' },
  errorText: { color: '#b91c1c', fontSize: 12 },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: {
    flexGrow: 1, flexBasis: '30%', minWidth: 96, backgroundColor: '#f0fdf4', borderRadius: 12,
    padding: 10, gap: 2, alignItems: 'flex-start',
  },
  tileValue: { fontSize: 20, fontWeight: '900', color: '#166534' },
  tileLabel: { fontSize: 11, color: '#475569', fontWeight: '600' },
  tileSub: { fontSize: 10, color: '#94a3b8' },

  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  rowLabel: { fontSize: 12, color: '#334155', fontWeight: '600', flexShrink: 1 },
  track: { height: 8, borderRadius: 4, backgroundColor: '#e2e8f0', overflow: 'hidden', marginTop: 3 },
  fill: { height: '100%', borderRadius: 4 },

  barsRow: { flexDirection: 'row', alignItems: 'flex-end', height: undefined },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', minHeight: 14 },
  bar: { width: '65%', borderRadius: 3 },
  barLabel: { fontSize: 9, color: '#94a3b8' },

  chip: { paddingHorizontal: 10, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: '#bbf7d0', backgroundColor: '#fff', justifyContent: 'center' },
  chipOn: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 11, fontWeight: '700', color: '#166534' },
  chipTextOn: { color: '#fff' },

  exportBtn: {
    flexGrow: 1, flexBasis: '22%', minWidth: 72, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, height: 42, borderRadius: 21, backgroundColor: '#16a34a',
  },
  exportText: { color: '#fff', fontWeight: '800', fontSize: 13 },

  activity: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  retry: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 42,
    borderRadius: 21, borderWidth: 1.5, borderColor: '#16a34a', backgroundColor: '#fff',
  },
  retryText: { color: '#16a34a', fontWeight: '800', fontSize: 13 },
});