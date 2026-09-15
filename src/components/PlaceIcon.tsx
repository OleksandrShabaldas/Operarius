import React from 'react';
import { Feather } from '@expo/vector-icons';

// Real location icon used everywhere a place is shown (not a 📍 emoji).
export function PlaceIcon({ size = 12, color }: { size?: number; color: string }) {
  return <Feather name="map-pin" size={size} color={color} />;
}
