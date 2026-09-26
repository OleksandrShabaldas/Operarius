import React from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { Tag } from '../types';
import { hexA } from '../utils';
import { ms } from '../motion';
import { BottomSheet } from './Overlay';
import { NoneRow, PickEmpty, PickFooter, PickHead, PickRow } from './PickList';
import { Appear } from './anim';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

// The task's tag: each tag as a coloured card with its sub-tags branching
// beneath it, how much each is used, and the choice springing in. Picking one
// closes the sheet a beat later, once the choice has visibly landed.
export function TagSelectPopup({
  visible,
  tags,
  selectedId,
  usage,
  taskTitle,
  taskColor,
  onSelect,
  onClose,
}: {
  visible: boolean;
  tags: Tag[];
  selectedId: string | null;
  usage: Record<string, number>; // tasks per tag id
  taskTitle: string;
  taskColor: string;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  const { height: winH } = useWindowDimensions();
  const tops = tags.filter((t) => !t.parentId);

  const pick = (id: string | null) => {
    Haptics.selectionAsync().catch(() => {});
    onSelect(id);
    setTimeout(onClose, ms(280));
  };

  return (
    <BottomSheet open={visible} onClose={onClose}>
      <ScrollView style={{ maxHeight: winH * 0.78 }} showsVerticalScrollIndicator={false} bounces={false}>
        <PickHead title="Tag" color={taskColor} context={taskTitle.trim() || 'New task'} />

        <Appear from="up" delay={20} distance={8}>
          <NoneRow on={selectedId == null} label="No tag" onPress={() => pick(null)} />
        </Appear>

        {tops.length === 0 ? (
          <PickEmpty icon="tag" title="No tags yet" text="Create tags in Settings → Tags to group and colour your tasks." />
        ) : (
          tops.map((top, i) => {
            const subs = tags.filter((t) => t.parentId === top.id);
            const total = (usage[top.id] ?? 0) + subs.reduce((n, s) => n + (usage[s.id] ?? 0), 0);
            const meta = [subs.length ? plural(subs.length, 'sub-tag') : null, total ? plural(total, 'task') : null].filter(Boolean).join('  ·  ');
            return (
              <Appear key={top.id} from="up" delay={60 + i * 45} distance={10} style={styles.group}>
                <PickRow on={selectedId === top.id} tint={top.color} onPress={() => pick(top.id)} left={<Swatch color={top.color} icon={top.icon} />} title={top.name} sub={meta || null} />
                {subs.map((sub, j) => {
                  const n = usage[sub.id] ?? 0;
                  return (
                    <View key={sub.id} style={styles.subWrap}>
                      <Branch color={top.color} last={j === subs.length - 1} />
                      <PickRow
                        style={styles.subRow}
                        on={selectedId === sub.id}
                        tint={sub.color}
                        onPress={() => pick(sub.id)}
                        left={<SubIcon tag={sub} color={sub.color} />}
                        title={sub.name}
                        sub={n ? plural(n, 'task') : null}
                      />
                    </View>
                  );
                })}
              </Appear>
            );
          })
        )}

        <PickFooter hint="Tags are managed in Settings → Tags" onDone={onClose} />
      </ScrollView>
    </BottomSheet>
  );
}

// A top-level tag's colour, as a glossy tile (with its icon, when it has one).
function Swatch({ color, icon }: { color: string; icon?: string }) {
  return (
    <LinearGradient colors={[color, hexA(color, 0.7)]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={[styles.swatch, { boxShadow: `0 5px 14px -5px ${hexA(color, 0.85)}` }]}>
      {icon ? <Text style={styles.swatchIcon}>{icon}</Text> : <Feather name="tag" size={15} color="#0b0b0d" />}
    </LinearGradient>
  );
}

// A sub-tag's own icon (emoji / letters), or a dot of its colour (its own, or the family's).
function SubIcon({ tag, color }: { tag: Tag; color: string }) {
  return <View style={[styles.subIcon, { backgroundColor: hexA(color, 0.16) }]}>{tag.icon ? <Text style={styles.subIconTxt}>{tag.icon}</Text> : <View style={[styles.subDot, { backgroundColor: color }]} />}</View>;
}

// The line joining sub-tags to their parent's tile.
function Branch({ color, last }: { color: string; last: boolean }) {
  const c = hexA(color, 0.35);
  return (
    <View style={styles.branch}>
      <View style={[styles.branchLine, { backgroundColor: c }, last && styles.branchLineLast]} />
      <View style={[styles.branchElbow, { backgroundColor: c }]} />
    </View>
  );
}

const TILE_X = 10 + 17; // centre of the parent tile inside the group (row padding + half the tile)

const styles = StyleSheet.create({
  group: { marginTop: 8, borderRadius: 18, padding: 3, backgroundColor: 'rgba(255,255,255,0.03)' },
  swatch: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  swatchIcon: { fontSize: 16 },
  subWrap: { flexDirection: 'row', alignItems: 'stretch' },
  subRow: { flex: 1 },
  branch: { width: 38 },
  branchLine: { position: 'absolute', left: TILE_X - 0.75, top: 0, bottom: 0, width: 1.5, borderRadius: 1 },
  branchLineLast: { bottom: '50%' },
  branchElbow: { position: 'absolute', left: TILE_X - 0.75, top: '50%', width: 16, height: 1.5, borderRadius: 1 },
  subIcon: { width: 28, height: 28, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  subIconTxt: { fontSize: 13, fontWeight: '800', color: '#fff' },
  subDot: { width: 7, height: 7, borderRadius: 4 },
});
