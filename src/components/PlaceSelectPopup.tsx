import React from 'react';
import { Image, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { C } from '../theme';
import { Place, Tag } from '../types';
import { findTag, hexA } from '../utils';
import { hasLocation } from '../maps';
import { ms } from '../motion';
import { BottomSheet } from './Overlay';
import { PlaceIcon } from './PlaceIcon';
import { NoneRow, PickEmpty, PickFooter, PickHead, PickRow, PickSection } from './PickList';
import { Appear } from './anim';

type Group = { key: string; label: string; color: string | null; list: Place[] };

// The task's place: every saved place, grouped by tag — the task's own tag
// first (suggested), then untagged ones, then the rest — each with its photo
// and where it is. Picking one closes the sheet a beat later.
export function PlaceSelectPopup({
  visible,
  places,
  tags,
  selectedId,
  taskTagId,
  taskTitle,
  taskColor,
  onSelect,
  onClose,
}: {
  visible: boolean;
  places: Place[];
  tags: Tag[];
  selectedId: string | null;
  taskTagId: string | null;
  taskTitle: string;
  taskColor: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const { height: winH } = useWindowDimensions();
  // Places are filed under top-level tags.
  const selTag = findTag(tags, taskTagId);
  const topTag = selTag ? (selTag.parentId ? findTag(tags, selTag.parentId) : selTag) : null;
  const tops = tags.filter((t) => !t.parentId);
  const known = new Set(tops.map((t) => t.id));

  const groups: Group[] = [];
  if (topTag) groups.push({ key: topTag.id, label: `${topTag.name.toUpperCase()}  ·  SUGGESTED`, color: topTag.color, list: places.filter((p) => p.tagId === topTag.id) });
  groups.push({ key: 'untagged', label: 'UNTAGGED', color: null, list: places.filter((p) => !p.tagId || !known.has(p.tagId)) });
  tops.filter((t) => t.id !== topTag?.id).forEach((t) => groups.push({ key: t.id, label: t.name.toUpperCase(), color: t.color, list: places.filter((p) => p.tagId === t.id) }));
  const shown = groups.filter((g) => g.list.length > 0);

  const pick = (id: string | null) => {
    Haptics.selectionAsync().catch(() => {});
    onSelect(id);
    setTimeout(onClose, ms(280));
  };

  let row = 0; // running index for the cascade
  return (
    <BottomSheet open={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: winH * 0.78 }} showsVerticalScrollIndicator={false} bounces={false}>
        <PickHead title="Place" color={taskColor} context={[taskTitle.trim() || 'New task', selTag?.name].filter(Boolean).join('  ·  ')} />

        <Appear from="up" delay={20} distance={8}>
          <NoneRow on={selectedId == null} label="No place" onPress={() => pick(null)} />
        </Appear>

        {places.length === 0 ? (
          <PickEmpty icon="map-pin" title="No places yet" text="Add places in Settings → Places — pick the spot on Google Maps and give it a photo." />
        ) : (
          shown.map((g) => {
            const tint = g.color ?? C.accentB;
            return (
              <View key={g.key}>
                <PickSection text={g.label} dot={g.color ?? undefined} icon={g.color ? undefined : 'map-pin'} delay={40 + row * 35} />
                {g.list.map((p) => {
                  const i = row++;
                  return (
                    <Appear key={p.id} from="up" delay={60 + i * 35} distance={8}>
                      <PickRow
                        on={selectedId === p.id}
                        tint={tint}
                        onPress={() => pick(p.id)}
                        left={<Thumb place={p} color={tint} />}
                        title={p.name}
                        sub={p.address || (hasLocation(p) ? 'Pinned on Google Maps' : 'No location picked yet')}
                      />
                    </Appear>
                  );
                })}
              </View>
            );
          })
        )}

        <PickFooter hint="Places are managed in Settings → Places" onDone={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

// The place's photo, or a pin in its tag's colour.
function Thumb({ place, color }: { place: Place; color: string }) {
  if (place.photoUri) {
    return (
      <View style={styles.thumb}>
        <Image source={{ uri: place.photoUri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        <View pointerEvents="none" style={[styles.thumbRing, { borderColor: hexA(color, 0.35) }]} />
      </View>
    );
  }
  return (
    <View style={[styles.thumb, { backgroundColor: hexA(color, 0.14) }]}>
      <PlaceIcon size={16} color={color} />
    </View>
  );
}

const styles = StyleSheet.create({
  thumb: { width: 40, height: 40, borderRadius: 12, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  thumbRing: { ...StyleSheet.absoluteFill, borderRadius: 12, borderWidth: 1 },
});
