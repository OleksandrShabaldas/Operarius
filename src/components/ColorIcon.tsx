import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { Feather } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { C } from '../theme';
import { Appear, Tappable } from './anim';

// HSL (h in degrees, s/l in 0..100) → #rrggbb.
export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const a = sN * Math.min(lN, 1 - lN);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const color = lN - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

// Perceived brightness — picks a dark or light glyph on top of a colour.
export function isLightColor(hex: string): boolean {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return false;
  const n = parseInt(m[1], 16);
  return 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 165;
}

const sameColor = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const isHex = (v: string) => /^#[0-9a-fA-F]{6}$/.test(v);
const SPRING = { damping: 17, stiffness: 260, mass: 0.7 };

// ---------------------------------------------------------------------------
// SlotGrid — items in exactly `cols` equal columns, row by row. Cell content
// is sized to its column (capped at `maxSize`), so rows are always full-width
// and never wrap unevenly, whatever the screen width.
// ---------------------------------------------------------------------------
export function SlotGrid<T>({
  items,
  cols,
  maxSize,
  gutter = 6,
  rowGap = 8,
  renderCell,
}: {
  items: T[];
  cols: number;
  maxSize: number;
  gutter?: number;
  rowGap?: number;
  renderCell: (item: T, index: number, size: number) => React.ReactNode;
}) {
  const [w, setW] = useState(0);
  const size = w > 0 ? Math.max(20, Math.min(maxSize, Math.floor(w / cols - gutter))) : maxSize;
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  return (
    <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ gap: rowGap }}>
      {rows.map((row, r) => (
        <View key={r} style={styles.slotRow}>
          {row.map((it, c) => (
            <View key={c} style={styles.slotCell}>
              {renderCell(it, r * cols + c, size)}
            </View>
          ))}
          {Array.from({ length: cols - row.length }, (_, k) => (
            <View key={`pad${k}`} style={styles.slotCell} />
          ))}
        </View>
      ))}
    </View>
  );
}

// A round colour swatch. Selecting it draws a ring at its edge while the fill
// springs inward, leaving a gap (so the footprint never grows into neighbours).
export function ColorSwatch({
  color,
  size,
  selected,
  onPress,
  delay = 0,
  children,
}: {
  color: string;
  size: number;
  selected: boolean;
  onPress: () => void;
  delay?: number;
  children?: React.ReactNode; // custom fill content (e.g. the spectrum "+")
}) {
  const sel = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const gap = Math.max(4, Math.round(size * 0.14));
  const fill = useAnimatedStyle(() => ({ transform: [{ scale: 1 - sel.value * ((gap * 2) / size) }] }));
  const ring = useAnimatedStyle(() => ({ opacity: sel.value, transform: [{ scale: 0.82 + 0.18 * sel.value }] }));
  return (
    <Appear delay={delay}>
      <Tappable onPress={onPress} scaleTo={0.86} hitSlop={3} style={{ width: size, height: size }}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: size / 2, borderWidth: 2, borderColor: color }, ring]} />
        <Animated.View style={[styles.swatchFill, { width: size, height: size, borderRadius: size / 2, backgroundColor: color }, fill]}>{children}</Animated.View>
      </Tappable>
    </Appear>
  );
}

// A square icon tile; the selected one lifts with a brighter plate and rim.
export function IconCell({
  glyph,
  size,
  selected,
  onPress,
  delay = 0,
  restBg = 'rgba(255,255,255,0.045)',
  children,
}: {
  glyph?: string;
  size: number;
  selected: boolean;
  onPress: () => void;
  delay?: number;
  restBg?: string;
  children?: React.ReactNode;
}) {
  const sel = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    sel.value = withSpring(selected ? 1 : 0, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);
  const plate = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [restBg, 'rgba(255,255,255,0.13)']),
    borderColor: interpolateColor(sel.value, [0, 1], ['rgba(255,255,255,0)', 'rgba(255,255,255,0.45)']),
  }));
  const g = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.12 * sel.value }] }));
  return (
    <Appear delay={delay}>
      <Tappable onPress={onPress} scaleTo={0.86} hitSlop={2}>
        <Animated.View style={[styles.iconPlate, { width: size, height: size, borderRadius: Math.round(size * 0.3) }, plate]}>
          {children ?? <Animated.Text style={[{ fontSize: Math.round(size * 0.46) }, g]}>{glyph}</Animated.Text>}
        </Animated.View>
      </Tappable>
    </Appear>
  );
}

const SPECTRUM = ['#F8677A', '#F2C14E', '#5FD08A', '#5B9DF9', '#B57CF0'] as const;

// Exactly one full row: the palette's colours + the custom swatch. When the
// current colour isn't in the palette, the custom swatch wears it (selected).
export function PaletteRow({
  colors,
  value,
  onPick,
  onCustom,
  baseDelay = 70,
}: {
  colors: string[];
  value: string;
  onPick: (c: string) => void;
  onCustom: () => void;
  baseDelay?: number;
}) {
  const isCustom = !colors.some((c) => sameColor(c, value));
  const items: (string | null)[] = [...colors, null];
  return (
    <SlotGrid
      items={items}
      cols={items.length}
      maxSize={36}
      gutter={5}
      renderCell={(c, i, size) =>
        c ? (
          <ColorSwatch color={c} size={size} selected={sameColor(c, value)} onPress={() => onPick(c)} delay={baseDelay + i * 22} />
        ) : isCustom ? (
          <ColorSwatch color={value} size={size} selected onPress={onCustom} delay={baseDelay + i * 22}>
            <Feather name="edit-2" size={Math.round(size * 0.36)} color={isLightColor(value) ? '#0b0b0d' : '#fff'} />
          </ColorSwatch>
        ) : (
          <ColorSwatch color="rgba(255,255,255,0.5)" size={size} selected={false} onPress={onCustom} delay={baseDelay + i * 22}>
            <LinearGradient colors={SPECTRUM} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
            <Feather name="plus" size={Math.round(size * 0.45)} color="#0b0b0d" />
          </ColorSwatch>
        )
      }
    />
  );
}

// Exactly two full rows of 7: the icon set + the custom icon tile. When the
// current icon isn't in the set, the custom tile shows it (selected).
export function IconGrid({
  icons,
  value,
  onPick,
  onCustom,
  baseDelay = 120,
}: {
  icons: string[];
  value: string;
  onPick: (e: string) => void;
  onCustom: () => void;
  baseDelay?: number;
}) {
  const isCustom = !icons.includes(value);
  const items: (string | null)[] = [...icons, null];
  const cols = Math.ceil(items.length / 2);
  return (
    <SlotGrid
      items={items}
      cols={cols}
      maxSize={42}
      gutter={5}
      renderCell={(e, i, size) =>
        e ? (
          <IconCell glyph={e} size={size} selected={e === value} onPress={() => onPick(e)} delay={baseDelay + i * 16} />
        ) : isCustom ? (
          <IconCell size={size} selected onPress={onCustom} delay={baseDelay + i * 16}>
            <Text style={{ fontSize: Math.round(size * 0.46) }}>{value}</Text>
            <View style={styles.cornerPen}>
              <Feather name="edit-2" size={8} color={C.accentB} />
            </View>
          </IconCell>
        ) : (
          <IconCell size={size} selected={false} onPress={onCustom} delay={baseDelay + i * 16} restBg="rgba(79,209,197,0.13)">
            <Feather name="edit-3" size={Math.round(size * 0.4)} color={C.accentB} />
          </IconCell>
        )
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Custom colour: a contiguous spectrum grid (hue columns × shade rows + a grey
// ramp) with a selection ring that glides between cells, plus a HEX field.
// ---------------------------------------------------------------------------
const HUES = [0, 20, 40, 55, 90, 140, 165, 185, 205, 225, 260, 290, 320, 345];
const SHADES: [number, number][] = [
  [92, 84],
  [84, 72],
  [76, 60],
  [68, 48],
  [60, 36],
];
const GRID_COLS = HUES.length;
const GRID: string[][] = [
  ...SHADES.map(([s, l]) => HUES.map((h) => hslToHex(h, s, l))),
  Array.from({ length: GRID_COLS }, (_, i) => hslToHex(0, 0, Math.round(100 - (i * 95) / (GRID_COLS - 1)))),
];

export function CustomColorGrid({ value, onPick }: { value: string; onPick: (hex: string) => void }) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  const [w, setW] = useState(0);
  const cell = w / GRID_COLS;

  const sel = useMemo(() => {
    for (let r = 0; r < GRID.length; r++) {
      const c = GRID[r].findIndex((x) => sameColor(x, value));
      if (c >= 0) return { r, c };
    }
    return null;
  }, [value]);

  const rx = useSharedValue(0);
  const ry = useSharedValue(0);
  const ro = useSharedValue(0);
  const placed = useRef(false);
  useEffect(() => {
    if (!cell) return;
    if (!sel) {
      ro.value = withTiming(0, { duration: 140 });
      placed.current = false;
      return;
    }
    const x = sel.c * cell;
    const y = sel.r * cell;
    if (!placed.current) {
      rx.value = x;
      ry.value = y;
      placed.current = true;
    } else {
      rx.value = withSpring(x, SPRING);
      ry.value = withSpring(y, SPRING);
    }
    ro.value = withSpring(1, SPRING);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.r, sel?.c, cell]);
  const ring = useAnimatedStyle(() => ({
    opacity: ro.value,
    transform: [{ translateX: rx.value }, { translateY: ry.value }, { scale: 0.7 + 0.3 * ro.value }],
  }));

  // A soft pulse on the preview each time the colour changes.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = 0.94;
    pulse.value = withSpring(1, { damping: 12, stiffness: 320 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));

  const shown = isHex(hex) ? hex : value;
  return (
    <View>
      <Animated.View style={[styles.preview, { backgroundColor: shown }, pulseStyle]}>
        <Text style={[styles.previewHex, { color: isLightColor(shown) ? 'rgba(11,11,13,0.75)' : 'rgba(255,255,255,0.85)' }]}>{shown.toUpperCase()}</Text>
      </Animated.View>
      <Appear from="up" delay={40}>
        <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={styles.gridBox}>
          {GRID.map((row, r) => (
            <View key={r} style={styles.gridRow}>
              {row.map((c, ci) => (
                <Pressable
                  key={ci}
                  onPress={() => {
                    setHex(c);
                    onPick(c);
                  }}
                  style={{ flex: 1, height: cell || 21, backgroundColor: c }}
                />
              ))}
            </View>
          ))}
          {cell > 0 && <Animated.View pointerEvents="none" style={[styles.gridRing, { width: cell, height: cell }, ring]} />}
        </View>
      </Appear>
      <Appear from="up" delay={90}>
        <View style={styles.hexRow}>
          <Text style={styles.hexLabel}>HEX</Text>
          <TextInput
            value={hex}
            onChangeText={(t) => {
              const v = (t.startsWith('#') ? t : `#${t}`).slice(0, 7);
              setHex(v);
              if (isHex(v)) onPick(v);
            }}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="#7c7cf0"
            placeholderTextColor={C.faint}
            style={[styles.hexInput, !isHex(hex) && hex.length >= 7 && styles.hexBad]}
          />
        </View>
      </Appear>
    </View>
  );
}

// Free-text icon entry: up to two characters or a pasted emoji.
export function CustomIconInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = 0.88;
    pulse.value = withSpring(1, { damping: 11, stiffness: 320 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const pulseStyle = useAnimatedStyle(() => ({ transform: [{ scale: pulse.value }] }));
  return (
    <View style={styles.iconWrap}>
      <Animated.View style={[styles.iconPreview, pulseStyle]}>
        <Text style={styles.iconPreviewTxt}>{value || '·'}</Text>
      </Animated.View>
      <TextInput
        value={value}
        onChangeText={(t) => onChange([...t].slice(0, 2).join(''))}
        autoFocus
        placeholder="🙂 or AB"
        placeholderTextColor={C.faint}
        style={styles.iconInput}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  slotRow: { flexDirection: 'row' },
  slotCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  swatchFill: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  iconPlate: { borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  cornerPen: { position: 'absolute', right: 2, bottom: 2, width: 14, height: 14, borderRadius: 7, backgroundColor: C.sheet, alignItems: 'center', justifyContent: 'center' },

  preview: { height: 46, borderRadius: 13, marginBottom: 14, alignItems: 'center', justifyContent: 'center', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' },
  previewHex: { fontSize: 13, fontWeight: '700', letterSpacing: 1, fontVariant: ['tabular-nums'] },
  gridBox: { borderRadius: 12, overflow: 'hidden', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08)' },
  gridRow: { flexDirection: 'row' },
  gridRing: { position: 'absolute', left: 0, top: 0, borderRadius: 5, borderWidth: 2.5, borderColor: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 4px 10px rgba(0,0,0,0.45)' },
  hexRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 },
  hexLabel: { fontSize: 12, fontWeight: '700', color: C.muted },
  // Transparent rim by default so the error rim below is replaced, not left behind.
  hexInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 11, color: C.text, fontSize: 15, fontVariant: ['tabular-nums'], boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0)' },
  hexBad: { boxShadow: `inset 0 0 0 1px ${C.danger}` },
  iconWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconPreview: { width: 56, height: 56, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.06)', alignItems: 'center', justifyContent: 'center' },
  iconPreviewTxt: { fontSize: 26 },
  iconInput: { flex: 1, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: C.text, fontSize: 18 },
});
