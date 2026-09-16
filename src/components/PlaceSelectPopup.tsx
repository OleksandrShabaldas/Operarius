import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { C } from '../theme';
import { Place, Tag } from '../types';
import { findTag } from '../utils';
import { CenterPopup } from './Overlay';
import { PlaceIcon } from './PlaceIcon';
import { Tappable } from './anim';

export function PlaceSelectPopup({
  visible,
  places,
  tags,
  selectedId,
  taskTagId,
  onSelect,
  onClose,
}: {
  visible: boolean;
  places: Place[];
  tags: Tag[];
  selectedId: string | null;
  taskTagId: string | null;
  onSelect: (id: string | null) => void;
  onClose: () => void;
}) {
  // Resolve the task's top-level tag (places are filed under top-level tags).
  const selTag = findTag(tags, taskTagId);
  const topTag = selTag ? (selTag.parentId ? findTag(tags, selTag.parentId) : selTag) : null;

  const [tab, setTab] = useState<'untagged' | 'tag'>(topTag ? 'tag' : 'untagged');
  React.useEffect(() => {
    if (visible) setTab(topTag ? 'tag' : 'untagged');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, taskTagId]);

  const tagLabel = topTag ? topTag.name : 'Tagged';
  const list =
    tab === 'untagged'
      ? places.filter((p) => !p.tagId)
      : places.filter((p) => (topTag ? p.tagId === topTag.id : !!p.tagId));

  return (
    <CenterPopup open={visible} onClose={onClose}>
      <Text style={styles.title}>Select place</Text>

      <View style={styles.tabs}>
        <Tappable onPress={() => setTab('untagged')} style={[styles.tab, tab === 'untagged' && styles.tabOn]}>
          <Text style={[styles.tabTxt, { color: tab === 'untagged' ? '#0b0b0d' : C.textDim }]}>Untagged</Text>
        </Tappable>
        <Tappable onPress={() => setTab('tag')} style={[styles.tab, tab === 'tag' && styles.tabOn]}>
          <Text style={[styles.tabTxt, { color: tab === 'tag' ? '#0b0b0d' : C.textDim }]} numberOfLines={1}>
            {tagLabel}
          </Text>
        </Tappable>
      </View>

      <ScrollView style={{ maxHeight: 300 }} showsVerticalScrollIndicator={false}>
        <Tappable onPress={() => onSelect(null)} style={[styles.row, selectedId == null && styles.rowOn]}>
          <Text style={[styles.rowTxt, { color: C.muted }]}>None</Text>
          {selectedId == null && <Text style={styles.check}>✓</Text>}
        </Tappable>
        {list.length === 0 ? (
          <Text style={styles.empty}>No places here — add some in Settings → Places.</Text>
        ) : (
          list.map((p) => {
            const on = p.id === selectedId;
            return (
              <Tappable key={p.id} onPress={() => onSelect(p.id)} style={[styles.row, on && styles.rowOn]}>
                <PlaceIcon size={14} color={on ? C.accentB : C.muted} />
                <Text style={[styles.rowTxt, { flex: 1 }]}>{p.name}</Text>
                {on && <Text style={styles.check}>✓</Text>}
              </Tappable>
            );
          })
        )}
      </ScrollView>
    </CenterPopup>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 17, fontWeight: '700', color: C.text, marginBottom: 14 },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { flex: 1, height: 40, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.05)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  tabOn: { backgroundColor: C.accentB },
  tabTxt: { fontSize: 13.5, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 13, paddingHorizontal: 14, borderRadius: 12, marginBottom: 4 },
  rowOn: { backgroundColor: 'rgba(79,209,197,0.14)' },
  rowTxt: { fontSize: 15, fontWeight: '600', color: C.text },
  check: { fontSize: 16, fontWeight: '700', color: C.accentB },
  empty: { color: C.faint, fontSize: 13, paddingVertical: 12, textAlign: 'center' },
});
