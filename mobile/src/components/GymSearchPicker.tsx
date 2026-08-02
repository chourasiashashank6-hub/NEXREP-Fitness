import * as Location from "expo-location";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { searchGymPlaces, type GymPlace } from "../api/places";
import { useAppTheme } from "../theme";

type Coordinates = {
  lat: number;
  lng: number;
};

type Props = {
  value?: GymPlace | null;
  onSelect: (gym: GymPlace) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  useCurrentLocation?: boolean;
};

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;
const PRIMARY = "#0F6E56";
const TEXT = "#17261F";
const SECONDARY = "#5D6B63";
const TERTIARY = "#8A958E";
const BORDER = "#DCE7DF";
const CARD = "#FFFFFF";
const INPUT_BG = "#F7FBF8";
const ERROR = "#B42318";

export default function GymSearchPicker({
  value,
  onSelect,
  label,
  placeholder,
  disabled = false,
  style,
  useCurrentLocation = true,
}: Props) {
  const { t } = useTranslation();
  const { radius } = useAppTheme();
  const [query, setQuery] = useState(value?.name ?? "");
  const [results, setResults] = useState<GymPlace[]>([]);
  const [coords, setCoords] = useState<Coordinates | null>(null);
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    setQuery(value?.name ?? "");
  }, [value?.name]);

  const requestLocation = async () => {
    if (!useCurrentLocation || coords) return;
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== Location.PermissionStatus.GRANTED) return;
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    setCoords({
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    });
  };

  useEffect(() => {
    const trimmed = query.trim();
    if (!focused || trimmed.length < MIN_QUERY_LENGTH || trimmed === value?.name) {
      setResults([]);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      searchGymPlaces({
        q: trimmed,
        lat: coords?.lat,
        lng: coords?.lng,
      })
        .then((items) => {
          if (requestId === requestIdRef.current) {
            setResults(items);
          }
        })
        .catch(() => {
          if (requestId === requestIdRef.current) {
            setResults([]);
            setError(t("gymSearchPicker.searchFailed", { defaultValue: "Could not search gyms. Try again." }));
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) {
            setLoading(false);
          }
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [coords?.lat, coords?.lng, focused, query, t, value?.name]);

  const showDropdown = focused && !disabled && (loading || error || results.length > 0 || query.trim().length >= MIN_QUERY_LENGTH);

  const handleFocus = () => {
    setFocused(true);
    void requestLocation().catch(() => undefined);
  };

  const handleSelect = (gym: GymPlace) => {
    setQuery(gym.name);
    setResults([]);
    setError(null);
    setFocused(false);
    onSelect(gym);
  };

  const handleChangeText = (text: string) => {
    setQuery(text);
  };

  return (
    <View style={[styles.wrap, style]}>
      <Text style={styles.label}>
        {label ?? t("gymSearchPicker.label", { defaultValue: "Gym" })}
      </Text>
      <TextInput
        value={query}
        editable={!disabled}
        onChangeText={handleChangeText}
        onFocus={handleFocus}
        placeholder={placeholder ?? t("gymSearchPicker.placeholder", { defaultValue: "Search gym by name or location" })}
        placeholderTextColor={TERTIARY}
        returnKeyType="search"
        autoCorrect={false}
        style={[styles.input, { borderRadius: radius.md }]}
      />

      {showDropdown ? (
        <View style={[styles.dropdown, { borderRadius: radius.md }]}>
          {loading ? (
            <View style={styles.statusRow}>
              <ActivityIndicator color={PRIMARY} size="small" />
              <Text style={styles.statusText}>
                {t("gymSearchPicker.searching", { defaultValue: "Searching gyms..." })}
              </Text>
            </View>
          ) : null}
          {!loading && error ? <Text style={styles.errorText}>{error}</Text> : null}
          {!loading && !error && results.length === 0 && query.trim().length >= MIN_QUERY_LENGTH ? (
            <Text style={styles.statusText}>{t("gymSearchPicker.noResults", { defaultValue: "No gyms found" })}</Text>
          ) : null}
          {!loading && !error
            ? results.map((gym) => (
                <Pressable
                  key={gym.place_id}
                  accessibilityRole="button"
                  style={styles.resultRow}
                  onPress={() => handleSelect(gym)}
                >
                  <View style={styles.pin}>
                    <Text style={styles.pinText}>•</Text>
                  </View>
                  <View style={styles.resultTextWrap}>
                    <Text style={styles.resultName} numberOfLines={1}>
                      {gym.name}
                    </Text>
                    <Text style={styles.resultAddress} numberOfLines={2}>
                      {gym.formatted_address}
                    </Text>
                  </View>
                </Pressable>
              ))
            : null}
        </View>
      ) : null}
    </View>
  );
}

export type { GymPlace };

const styles = StyleSheet.create({
  wrap: {
    position: "relative",
    zIndex: 10,
  },
  label: {
    color: TEXT,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: 6,
  },
  input: {
    backgroundColor: INPUT_BG,
    borderColor: BORDER,
    borderWidth: 1,
    color: TEXT,
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  dropdown: {
    backgroundColor: CARD,
    borderColor: BORDER,
    borderWidth: 1,
    marginTop: 8,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  statusRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  statusText: {
    color: SECONDARY,
    fontSize: 13,
    padding: 14,
  },
  errorText: {
    color: ERROR,
    fontSize: 13,
    padding: 14,
  },
  resultRow: {
    alignItems: "center",
    borderBottomColor: "#EEF3EF",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  pin: {
    alignItems: "center",
    backgroundColor: "#EAF6EF",
    borderRadius: 14,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  pinText: {
    color: PRIMARY,
    fontSize: 18,
    fontWeight: "700",
    lineHeight: 18,
  },
  resultTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  resultName: {
    color: TEXT,
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 3,
  },
  resultAddress: {
    color: SECONDARY,
    fontSize: 12,
    lineHeight: 16,
  },
});
