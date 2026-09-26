import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { C } from '../theme';
import { RepeatScope } from '../types';
import { hexA, shortDate } from '../utils';
import { CenterPopup } from './Overlay';
import { Appear, Tappable } from './anim';

type Icon = keyof typeof Feather.glyphMap;
type Action = 'edit' | 'delete' | 'move';

const TITLE: Record<Action, string> = { edit: 'Edit a repeating task', delete: 'Delete a repeating task', move: 'Move a repeating task' };

// Editing, deleting or moving one day of a repeating task: just that day, it
// and the days after it, or all of them. (From its first day, "this and
// following" would be all of it — so it isn't offered.)
export function RepeatScopePopup({
  open,
  action,
  date,
  first,
  onPick,
  onClose,
}: {
  open: boolean;
  action: Action;
  date: string | null;
  first: boolean;
  onPick: (s: RepeatScope) => void;
  onClose: () => void;
}) {
  const danger = action === 'delete';
  const tint = danger ? C.danger : C.accentB;
  const day = date ? shortDate(date) : '';
  const opts: { id: RepeatScope; icon: Icon; title: string; sub: string }[] = [
    { id: 'one', icon: 'square', title: 'This task', sub: `Only ${day}` },
    ...(first ? [] : [{ id: 'following' as const, icon: 'chevrons-right' as const, title: 'This and following tasks', sub: `${day} and after` }]),
    { id: 'all', icon: 'repeat', title: 'All tasks', sub: first ? 'The whole series' : 'The whole series, earlier days too' },
  ];
  const pick = (s: RepeatScope) => {
    Haptics.selectionAsync().catch(() => {});
    onPick(s);
  };
  return (
    <CenterPopup open={open} onClose={onClose}>
      <Appear from="pop" style={[styles.icon, { backgroundColor: hexA(tint, 0.14) }]}>
        <Feather name={danger ? 'trash-2' : action === 'move' ? 'move' : 'edit-2'} size={21} color={tint} />
      </Appear>
      <Text style={styles.title}>{TITLE[action]}</Text>
      <Text style={styles.sub}>Which days should change?</Text>
      <View style={styles.list}>
        {opts.map((o, i) => (
          <Appear key={o.id} from="up" delay={50 + i * 45} distance={8}>
            <Tappable onPress={() => pick(o.id)} scaleTo={0.97} style={styles.opt}>
              <View style={[styles.optIcon, { backgroundColor: hexA(tint, 0.12) }]}>
                <Feather name={o.icon} size={15} color={tint} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.optTitle, danger && { color: C.danger }]}>{o.title}</Text>
                <Text style={styles.optSub}>{o.sub}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={C.faint} />
            </Tappable>
          </Appear>
        ))}
      </View>
      <Appear from="up" delay={50 + opts.length * 45} distance={8}>
        <Tappable onPress={onClose} style={styles.cancel}>
          <Text style={styles.cancelTxt}>Cancel</Text>
        </Tappable>
      </Appear>
    </CenterPopup>
  );
}

const styles = StyleSheet.create({
  icon: { alignSelf: 'center', width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 17, fontWeight: '800', color: C.text, textAlign: 'center' },
  sub: { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 4, marginBottom: 14 },
  list: { gap: 8 },
  opt: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.045)',
    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.05)',
  },
  optIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  optTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  optSub: { fontSize: 12.5, color: C.muted, marginTop: 2 },
  cancel: { marginTop: 14, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.07)', alignItems: 'center', justifyContent: 'center' },
  cancelTxt: { fontSize: 15, fontWeight: '700', color: C.text },
});
