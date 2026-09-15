import React, { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ZoomIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { cleanNotes, downloadAndInstall, openApkInBrowser, ReleaseInfo } from '../updater';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function UpdateModal({
  release,
  currentVersion,
  onClose,
}: {
  release: ReleaseInfo | null;
  currentVersion: string;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const visible = !!release;

  const onUpdate = async () => {
    if (!release) return;
    setError(null);
    if (!release.apkUrl) {
      Linking.openURL(release.htmlUrl).catch(() => {});
      onClose();
      return;
    }
    setBusy(true);
    setProgress(0);
    try {
      await downloadAndInstall(release, setProgress);
      onClose();
    } catch {
      setBusy(false);
      setError("Download couldn't finish over this connection. Try the browser download below.");
    }
  };

  const notes = release ? cleanNotes(release.notes) : '';
  const pct = Math.round(progress * 100);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={busy ? undefined : onClose} statusBarTranslucent>
      {release && (
        <View style={styles.root}>
          <AnimatedPressable style={styles.backdrop} entering={FadeIn.duration(160)} onPress={busy ? undefined : onClose} />
          <Animated.View entering={ZoomIn.duration(220)} style={styles.card}>
            <View style={styles.badge}>
              <Text style={styles.badgeTxt}>UPDATE AVAILABLE</Text>
            </View>
            <Text style={styles.title}>{release.name}</Text>
            <Text style={styles.versions}>
              v{currentVersion} → <Text style={styles.newV}>v{release.version}</Text>
            </Text>

            {!!notes ? (
              <ScrollView style={styles.notes} contentContainerStyle={{ paddingVertical: 8 }}>
                <Text style={styles.notesTxt}>{notes}</Text>
              </ScrollView>
            ) : (
              <Text style={styles.noNotes}>No release notes.</Text>
            )}

            {busy && (
              <View style={styles.progressWrap}>
                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={[C.accentA, C.accentB]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.progressFill, { width: `${Math.max(4, pct)}%` }]}
                  />
                </View>
                <Text style={styles.progressTxt}>{pct > 0 ? `Downloading… ${pct}%` : 'Starting download…'}</Text>
              </View>
            )}

            {!!error && <Text style={styles.error}>{error}</Text>}

            <View style={styles.actions}>
              <Pressable onPress={onClose} disabled={busy} style={[styles.later, busy && styles.dim]}>
                <Text style={styles.laterTxt}>Later</Text>
              </Pressable>
              <Pressable onPress={onUpdate} disabled={busy} style={[styles.updateWrap, busy && styles.dim]}>
                <LinearGradient colors={[C.accentA, C.accentB]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.update}>
                  <Text style={styles.updateTxt}>{busy ? 'Working…' : release.apkUrl ? 'Update now' : 'View release'}</Text>
                </LinearGradient>
              </Pressable>
            </View>

            {!!release.apkUrl && (
              <Pressable
                onPress={() => {
                  openApkInBrowser(release);
                  onClose();
                }}
                style={styles.browserBtn}>
                <Text style={[styles.browserTxt, error ? styles.browserTxtHi : null]}>Download in browser instead</Text>
              </Pressable>
            )}
          </Animated.View>
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.sheet,
    borderRadius: 24,
    padding: 22,
    boxShadow: '0 24px 70px -20px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(255,255,255,0.07)',
  },
  badge: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, backgroundColor: 'rgba(124,124,240,0.16)', boxShadow: 'inset 0 0 0 1px rgba(124,124,240,0.4)', marginBottom: 12 },
  badgeTxt: { fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6, color: C.accentA },
  title: { fontSize: 20, fontWeight: '700', color: C.text, marginBottom: 4 },
  versions: { fontSize: 14, color: C.muted, fontVariant: ['tabular-nums'] },
  newV: { color: C.accentB, fontWeight: '700' },
  notes: { maxHeight: 200, marginTop: 14, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 12, paddingHorizontal: 14 },
  notesTxt: { fontSize: 13, lineHeight: 20, color: C.textDim },
  noNotes: { marginTop: 14, fontSize: 13, color: C.faint },
  progressWrap: { marginTop: 16 },
  progressTrack: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4 },
  progressTxt: { marginTop: 8, fontSize: 12.5, color: C.muted, fontVariant: ['tabular-nums'] },
  error: { marginTop: 12, color: C.danger, fontSize: 12.5, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  later: { flex: 1, height: 50, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  laterTxt: { fontSize: 15, fontWeight: '600', color: C.textDim },
  dim: { opacity: 0.5 },
  updateWrap: { flex: 1.4, borderRadius: 15, overflow: 'hidden' },
  update: { height: 50, alignItems: 'center', justifyContent: 'center' },
  updateTxt: { fontSize: 15, fontWeight: '700', color: '#0b0b0d' },
  browserBtn: { alignItems: 'center', paddingTop: 14, paddingBottom: 2 },
  browserTxt: { fontSize: 13, fontWeight: '600', color: C.muted },
  browserTxtHi: { color: C.accentB },
});
