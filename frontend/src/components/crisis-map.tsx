// Native tactical map (iOS/Android via Expo Go) — react-native-maps.
// Metro swaps in crisis-map.web.tsx on web builds.
import { StyleSheet, View } from "react-native";
import MapView, { Marker } from "react-native-maps";

import { useTheme } from "@/src/theme";
import { computeRegion, CrisisMapProps, markerColor } from "./crisis-map-utils";

// Google Maps dark style (Android); Apple Maps follows userInterfaceStyle="dark".
// These literals are third-party map styling and must stay identical in both themes.
const darkMapStyle = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#181818" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "road", elementType: "geometry.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
  { featureType: "transit", elementType: "geometry", stylers: [{ color: "#2f3948" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
];

export function CrisisMap({ markers, height = 220, testID }: CrisisMapProps) {
  const { colors } = useTheme();
  return (
    <View testID={testID} style={[styles.frame, { height, borderColor: colors.border, backgroundColor: colors.surfaceSecondary }]}>
      <MapView
        style={StyleSheet.absoluteFill}
        initialRegion={computeRegion(markers)}
        customMapStyle={darkMapStyle}
        userInterfaceStyle="dark"
        pitchEnabled={false}
        toolbarEnabled={false}
      >
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            coordinate={{ latitude: marker.latitude, longitude: marker.longitude }}
            title={marker.label}
            pinColor={markerColor(marker.kind, colors)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderWidth: 1, borderRadius: 17, overflow: "hidden" },
});
