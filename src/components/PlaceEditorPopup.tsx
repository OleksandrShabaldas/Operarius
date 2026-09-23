import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Image, Linking, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { C } from '../theme';
import { Place, PlaceLocation, Tag } from '../types';
import { genId } from '../utils';
import { fmtCoords, hasLocation, isMapsUrl, mapsUrlFor, resolveMapsText } from '../maps';
import { CenterPopup } from './Overlay';
import { Appear, Tappable } from './anim';

// Persist a picked image into the app's document dir so it survives restarts.
async function persistPhoto(uri: string): Promise<string> {
  try {
    const dir = new Directory(Paths.document, 'places');
    if (!dir.exists) dir.create();
    const ext = (uri.split('.').pop() || 'jpg').split('?')[0].slice(0, 5) || 'jpg';
    const dest = new File(dir, `${genId()}.${ext}`);
    new File(uri).copy(dest);
    return dest.uri;
  } catch {
    return uri; // fall back to the picked uri
  }
}

type Pick = 'idle' | 'waiting' | 'reading' | 'none' | 'found';

export function PlaceEditorPopup({
  visible,
  place,
  tags,
  onRename,
  onSetTag,
  onSetLocation,
  onSetPhoto,
  onDelete,
  onClose,
}: {
  visible: boolean;
  place: Place | null;
  tags: Tag[];
  onRename: (name: string) => void;
  onSetTag: (tagId: string | null) => void;
  onSetLocation: (loc: PlaceLocation | null) => void;
  onSetPhoto: (uri: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const topTags = tags.filter((t) => !t.parentId);
  const { height: winH } = useWindowDimensions();
  const [pick, setPick] = useState<Pick>('idle');
  const pickRef = useRef<Pick>('idle');
  pickRef.current = pick;

  useEffect(() => {
    if (!visible) setPick('idle');
  }, [visible, place?.id]);

  // Read the clipboard for a Google Maps link and save it as the location.
  const readClipboard = async (auto: boolean) => {
    if (!place) return;
    setPick('reading');
    let text = '';
    try {
      text = await Clipboard.getStringAsync();
    } catch {
      /* no access */
    }
    const loc = text ? await resolveMapsText(text) : null;
    // Coming back without having copied a new spot: keep waiting quietly.
    if (!loc || (auto && loc.link === place.link)) {
      setPick(auto ? 'waiting' : 'none');
      if (!auto) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
      return;
    }
    onSetLocation(loc);
    setPick('found');
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  };

  // Back from Google Maps → pick the copied link up automatically.
  useEffect(() => {
    if (pick !== 'waiting') return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && pickRef.current === 'waiting') readClipboard(true);
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick, place?.id]);

  const pickOnMaps = () => {
    if (!place) return;
    setPick('waiting');
    // Start Maps near the current pin, or on a search for the place's name.
    const url =
      place.lat != null && place.lng != null
        ? `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name)}`;
    Linking.openURL(url).catch(() => Alert.alert('Google Maps', "Couldn't open Google Maps on this device."));
  };

  const pickPhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Photos', 'Allow photo access to attach an image.');
      return;
    }
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (!res.canceled && res.assets[0]) {
      const uri = await persistPhoto(res.assets[0].uri);
      onSetPhoto(uri);
    }
  };

  const located = !!place && hasLocation(place);
  const legacyLink = !!place && !!place.link && !isMapsUrl(place.link);

  return (
    <CenterPopup open={visible} onClose={onClose}>
      {place && (
        <ScrollView style={{ maxHeight: winH * 0.8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" bounces={false}>
          <Text style={styles.title}>Edit place</Text>

          <Text style={styles.label}>NAME</Text>
          <TextInput value={place.name} onChangeText={onRename} placeholder="Place name" placeholderTextColor={C.faint} style={styles.input} />

          <Text style={styles.label}>TAG</Text>
          <View style={styles.chipWrap}>
            <Tappable onPress={() => onSetTag(null)} style={[styles.chip, !place.tagId && styles.chipOn]}>
              <Text style={[styles.chipTxt, { color: !place.tagId ? '#0b0b0d' : C.textDim }]}>Untagged</Text>
            </Tappable>
            {topTags.map((t) => {
              const on = place.tagId === t.id;
              return (
                <Tappable key={t.id} onPress={() => onSetTag(t.id)} style={[styles.chip, on && { backgroundColor: t.color }]}>
                  <Text style={[styles.chipTxt, { color: on ? '#0b0b0d' : C.textDim }]}>{t.name}</Text>
                </Tappable>
              );
            })}
          </View>

          <Text style={styles.label}>LOCATION</Text>
          {pick === 'waiting' || pick === 'reading' || pick === 'none' ? (
            <Appear key="wait" from="up" distance={8} style={styles.waitCard}>
              <View style={styles.waitHead}>
                {pick === 'reading' ? <ActivityIndicator size="small" color={C.accentB} /> : <Feather name="map" size={16} color={C.accentB} />}
                <Text style={styles.waitTitle}>{pick === 'reading' ? 'Reading the link…' : 'Pick the spot in Google Maps'}</Text>
              </View>
              <Step n={1} text="Tap the place, or long-press to drop a pin" />
              <Step n={2} text="Tap Share → Copy link" />
              <Step n={3} text="Come back — it's picked up automatically" />
              {pick === 'none' && (
                <Appear from="up" distance={6}>
                  <Text style={styles.waitErr}>No Google Maps link in the clipboard yet.</Text>
                </Appear>
              )}
              <View style={styles.waitBtns}>
                <Tappable onPress={() => readClipboard(false)} style={styles.pasteBtn}>
                  <Feather name="clipboard" size={14} color={C.accentB} />
                  <Text style={styles.pasteTxt}>Paste link</Text>
                </Tappable>
                <Tappable onPress={pickOnMaps} style={styles.ghostBtn}>
                  <Text style={styles.ghostTxt}>Open Maps</Text>
                </Tappable>
                <Tappable onPress={() => setPick('idle')} style={styles.ghostBtn}>
                  <Text style={styles.ghostTxt}>Cancel</Text>
                </Tappable>
              </View>
            </Appear>
          ) : located ? (
            <Appear key={`loc-${place.link}-${place.lat}`} from="up" distance={8} style={styles.locCard}>
              <View style={styles.locRow}>
                <LinearGradient colors={['#4fd1c5', '#5b9df9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.locIcon}>
                  <Feather name={pick === 'found' ? 'check' : 'map-pin'} size={16} color="#0b0b0d" />
                </LinearGradient>
                <View style={{ flex: 1 }}>
                  <Text style={styles.locName} numberOfLines={1}>
                    {place.address || 'Pinned location'}
                  </Text>
                  <Text style={styles.locSub} numberOfLines={1}>
                    {place.lat != null && place.lng != null ? fmtCoords(place.lat, place.lng) : 'Saved Google Maps link'}
                  </Text>
                </View>
              </View>
              <View style={styles.locBtns}>
                <Tappable onPress={() => Linking.openURL(mapsUrlFor(place)).catch(() => {})} style={styles.pasteBtn}>
                  <Feather name="navigation" size={13} color={C.accentB} />
                  <Text style={styles.pasteTxt}>Show on Maps</Text>
                </Tappable>
                <Tappable onPress={pickOnMaps} style={styles.ghostBtn}>
                  <Text style={styles.ghostTxt}>Change</Text>
                </Tappable>
                <Tappable onPress={() => onSetLocation(null)} style={styles.ghostBtn}>
                  <Text style={[styles.ghostTxt, { color: C.danger }]}>Remove</Text>
                </Tappable>
              </View>
            </Appear>
          ) : (
            <Appear key="none" from="up" distance={8}>
              <View style={styles.pickRow}>
                <Tappable onPress={pickOnMaps} style={styles.pickWrap}>
                  <LinearGradient colors={['#4fd1c5', '#5b9df9']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.pickBtn}>
                    <Feather name="map-pin" size={15} color="#0b0b0d" />
                    <Text style={styles.pickTxt}>Pick on Google Maps</Text>
                  </LinearGradient>
                </Tappable>
                <Tappable onPress={() => readClipboard(false)} style={styles.pasteSquare}>
                  <Feather name="clipboard" size={17} color={C.accentB} />
                </Tappable>
              </View>
              <Text style={styles.hint}>Choose the exact spot in Google Maps — tapping the place later opens it right there.</Text>
            </Appear>
          )}
          {legacyLink && (
            <Tappable onPress={() => Linking.openURL(place.link).catch(() => {})} style={styles.legacyRow}>
              <Feather name="link" size={13} color={C.muted} />
              <Text style={styles.legacyTxt} numberOfLines={1}>
                {place.link}
              </Text>
              <Feather name="external-link" size={13} color={C.muted} />
            </Tappable>
          )}

          <Text style={styles.label}>PHOTO</Text>
          {place.photoUri ? (
            <View style={styles.photoRow}>
              <Image source={{ uri: place.photoUri }} style={styles.photo} />
              <View style={{ gap: 10 }}>
                <Tappable onPress={pickPhoto} style={styles.photoAct}>
                  <Feather name="image" size={15} color={C.accentA} />
                  <Text style={[styles.removeTxt, { color: C.accentA }]}>Replace</Text>
                </Tappable>
                <Tappable onPress={() => onSetPhoto(null)} style={styles.photoAct}>
                  <Feather name="trash-2" size={15} color={C.danger} />
                  <Text style={styles.removeTxt}>Remove</Text>
                </Tappable>
              </View>
            </View>
          ) : (
            <Tappable onPress={pickPhoto} style={styles.addPhoto}>
              <Feather name="image" size={16} color={C.accentA} />
              <Text style={styles.addPhotoTxt}>Add photo</Text>
            </Tappable>
          )}

          <View style={styles.actions}>
            <Tappable onPress={onDelete} style={styles.delete}>
              <Feather name="trash-2" size={17} color={C.danger} />
            </Tappable>
            <Tappable onPress={onClose} style={styles.done}>
              <Text style={styles.doneTxt}>Done</Text>
            </Tappable>
          </View>
        </ScrollView>
      )}
    </CenterPopup>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumTxt}>{n}</Text>
      </View>
      <Text style={styles.stepTxt}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  label: { fontSize: 11, color: C.muted, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  input: { backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: C.text },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)' },
  chipOn: { backgroundColor: C.accentB },
  chipTxt: { fontSize: 12.5, fontWeight: '700' },
  hint: { fontSize: 12, color: C.muted, lineHeight: 17, marginTop: 8 },

  pickRow: { flexDirection: 'row', gap: 8 },
  pickWrap: { flex: 1, borderRadius: 13, overflow: 'hidden' },
  pickBtn: { height: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  pickTxt: { fontSize: 14.5, fontWeight: '800', color: '#0b0b0d' },
  pasteSquare: { width: 46, height: 46, borderRadius: 13, backgroundColor: 'rgba(79,209,197,0.12)', alignItems: 'center', justifyContent: 'center' },

  waitCard: { borderRadius: 14, padding: 12, backgroundColor: 'rgba(79,209,197,0.07)', boxShadow: 'inset 0 0 0 1px rgba(79,209,197,0.25)', gap: 8 },
  waitHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
  waitTitle: { fontSize: 14, fontWeight: '800', color: C.text },
  waitErr: { fontSize: 12, fontWeight: '700', color: C.danger },
  waitBtns: { flexDirection: 'row', gap: 8, marginTop: 4 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  stepNum: { width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(79,209,197,0.18)', alignItems: 'center', justifyContent: 'center' },
  stepNumTxt: { fontSize: 10.5, fontWeight: '800', color: C.accentB },
  stepTxt: { flex: 1, fontSize: 12.5, color: C.textDim, fontWeight: '600' },

  locCard: { borderRadius: 14, padding: 12, backgroundColor: 'rgba(255,255,255,0.05)', gap: 12 },
  locRow: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  locIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  locName: { fontSize: 14.5, fontWeight: '700', color: C.text },
  locSub: { fontSize: 12, fontWeight: '600', color: C.muted, marginTop: 2, fontVariant: ['tabular-nums'] },
  locBtns: { flexDirection: 'row', gap: 8 },
  pasteBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 36, borderRadius: 10, backgroundColor: 'rgba(79,209,197,0.14)' },
  pasteTxt: { fontSize: 13, fontWeight: '700', color: C.accentB },
  ghostBtn: { paddingHorizontal: 12, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center' },
  ghostTxt: { fontSize: 13, fontWeight: '700', color: C.textDim },
  legacyRow: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 8, paddingVertical: 6 },
  legacyTxt: { flex: 1, fontSize: 12.5, color: C.muted },

  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  photo: { width: 84, height: 84, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.05)' },
  photoAct: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  removeTxt: { fontSize: 14, fontWeight: '600', color: C.danger },
  addPhoto: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(124,124,240,0.12)', borderRadius: 12, paddingVertical: 13, justifyContent: 'center' },
  addPhotoTxt: { fontSize: 14, fontWeight: '700', color: C.accentA },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  delete: { width: 52, height: 50, borderRadius: 14, backgroundColor: 'rgba(248,103,122,0.14)', alignItems: 'center', justifyContent: 'center' },
  done: { flex: 1, height: 50, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
});
