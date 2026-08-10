import { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { resolveApiBaseUrl } from "../api/client";

type UserAvatarProps = {
  name?: string | null;
  initials?: string | null;
  profilePhotoUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  imageStyle?: StyleProp<ImageStyle>;
};

export const resolveProfilePhotoUrl = (url?: string | null): string | null => {
  const value = (url || "").trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value) || value.startsWith("data:") || value.startsWith("file:")) {
    return value;
  }
  const base = resolveApiBaseUrl().replace(/\/+$/, "");
  return `${base}${value.startsWith("/") ? value : `/${value}`}`;
};

const initialsForName = (name?: string | null): string => {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export const UserAvatar = ({ name, initials, profilePhotoUrl, size, style, textStyle, imageStyle }: UserAvatarProps) => {
  const photoUrl = resolveProfilePhotoUrl(profilePhotoUrl);
  const [imageFailed, setImageFailed] = useState(false);
  const dimensionStyle = size ? { width: size, height: size, borderRadius: size / 2 } : null;
  const showPhoto = Boolean(photoUrl) && !imageFailed;

  useEffect(() => {
    setImageFailed(false);
  }, [photoUrl]);

  return (
    <View style={[styles.container, dimensionStyle, style]}>
      {showPhoto ? (
        <Image
          source={{ uri: photoUrl! }}
          style={[styles.image, imageStyle]}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
        />
      ) : null}
      {!showPhoto ? <Text style={textStyle}>{initials || initialsForName(name)}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
});
