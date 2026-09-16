import React from 'react';
import { Alert, Image, Linking, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Directory, File, Paths } from 'expo-file-system';
import { C } from '../theme';
import { Place, Tag } from '../types';
import { genId } from '../utils';
import { CenterPopup } from './Overlay';
import { Tappable } from './anim';

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

export function PlaceEditorPopup({
  visible,
  place,
  tags,
  onRename,
  onSetTag,
  onSetLink,
  onSetPhoto,
  onDelete,
  onClose,
}: {
  visible: boolean;
  place: Place | null;
  tags: Tag[];
  onRename: (name: string) => void;
  onSetTag: (tagId: string | null) => void;
  onSetLink: (link: string) => void;
  onSetPhoto: (uri: string | null) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const topTags = tags.filter((t) => !t.parentId);

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

  const openMaps = () => {
    if (!place) return;
    const q = encodeURIComponent(place.link || place.name);
    // A saved link opens directly; otherwise search the place name on Google Maps.
    const url = place.link.startsWith('http') ? place.link : `https://www.google.com/maps/search/?api=1&query=${q}`;
    Linking.openURL(url).catch(() => {});
  };

  return (
    <CenterPopup open={visible} onClose={onClose}>
      {place && (
        <>
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

          <Text style={styles.label}>LINK</Text>
          <TextInput
            value={place.link}
            onChangeText={onSetLink}
            placeholder="Paste a Google Maps / web link"
            placeholderTextColor={C.faint}
            autoCapitalize="none"
            style={styles.input}
          />
          <Tappable onPress={openMaps} style={styles.mapsBtn}>
            <Feather name="map-pin" size={14} color={C.accentB} />
            <Text style={styles.mapsTxt}>{place.link ? 'Open link' : 'Find on Google Maps'}</Text>
          </Tappable>

          <Text style={styles.label}>PHOTO</Text>
          {place.photoUri ? (
            <View style={styles.photoRow}>
              <Image source={{ uri: place.photoUri }} style={styles.photo} />
              <Tappable onPress={() => onSetPhoto(null)} style={styles.removePhoto}>
                <Feather name="trash-2" size={16} color={C.danger} />
                <Text style={styles.removeTxt}>Remove</Text>
              </Tappable>
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
        </>
      )}
    </CenterPopup>
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
  mapsBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 10, alignSelf: 'flex-start' },
  mapsTxt: { fontSize: 13.5, fontWeight: '600', color: C.accentB },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  photo: { width: 72, height: 72, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.05)' },
  removePhoto: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  removeTxt: { fontSize: 14, fontWeight: '600', color: C.danger },
  addPhoto: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(124,124,240,0.12)', borderRadius: 12, paddingVertical: 13, justifyContent: 'center' },
  addPhotoTxt: { fontSize: 14, fontWeight: '700', color: C.accentA },
  actions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  delete: { width: 52, height: 50, borderRadius: 14, backgroundColor: 'rgba(248,103,122,0.14)', alignItems: 'center', justifyContent: 'center' },
  done: { flex: 1, height: 50, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  doneTxt: { fontSize: 15, fontWeight: '700', color: C.text },
});
