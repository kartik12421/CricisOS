// Shared types + helpers for the platform-split CrisisMap
// (crisis-map.tsx on native, crisis-map.web.tsx on web).
import { ThemeColors } from "@/src/theme";

export type CrisisMapMarkerKind = "incident" | "responder" | "self";

export type CrisisMapMarker = {
  id: string;
  latitude: number;
  longitude: number;
  kind: CrisisMapMarkerKind;
  label: string;
  critical?: boolean;
};

export type CrisisMapProps = {
  markers: CrisisMapMarker[];
  height?: number;
  testID?: string;
};

export type MapRegion = { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number };

export function computeRegion(markers: CrisisMapMarker[]): MapRegion {
  if (markers.length === 0) return { latitude: 20, longitude: 0, latitudeDelta: 60, longitudeDelta: 60 };
  const lats = markers.map((m) => m.latitude);
  const lngs = markers.map((m) => m.longitude);
  const minLat = Math.min(...lats); const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs); const maxLng = Math.max(...lngs);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max((maxLat - minLat) * 1.6, 0.02),
    longitudeDelta: Math.max((maxLng - minLng) * 1.6, 0.02),
  };
}

export function markerColor(kind: CrisisMapMarkerKind, colors: ThemeColors): string {
  return kind === "incident" ? colors.error : kind === "self" ? colors.success : colors.info;
}
