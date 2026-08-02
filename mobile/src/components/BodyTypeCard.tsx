import React from "react";
import { TouchableOpacity, View, Text, Image, StyleSheet } from "react-native";
import { BodyTypeItem, BodyGender, SlotCategory, slotKey } from "../data/bodyTypeData";
import { BodyFigureSVG } from "./BodyFigureSVG";

interface Props {
  item: BodyTypeItem;
  gender: BodyGender;
  category: SlotCategory;
  selected: boolean;
  onPress: () => void;
  customImageUrl: string | null;
  figureWidth: number;
  /** Optional height cap — used by compact modal grids to avoid scrolling */
  figureHeight?: number;
}

export function BodyTypeCard({
  item,
  gender,
  category,
  selected,
  onPress,
  customImageUrl,
  figureWidth,
  figureHeight,
}: Props) {
  const key = slotKey(gender, category, item.id);
  const figH = figureHeight ?? Math.round((figureWidth * 150) / 80);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85} style={[s.card, selected && s.cardSel]}>
      <View style={[s.imgBox, { height: figH }]}>
        {customImageUrl ? (
          <Image source={{ uri: customImageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        ) : (
          <BodyFigureSVG params={item.params} gender={gender} uid={key} width={figureWidth} />
        )}
      </View>
      <Text style={[s.label, selected && s.labelSel]} numberOfLines={1}>
        {item.label}
      </Text>
      {selected && (
        <View style={s.check}>
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>✓</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  card: {
    width: "100%",
    borderWidth: 2,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#FAFAFA",
    position: "relative",
  },
  cardSel: { borderColor: "#0F6E56", backgroundColor: "#E1F5EE" },
  imgBox: {
    backgroundColor: "#F3F4F6",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingTop: 4,
    overflow: "hidden",
  },
  label: {
    textAlign: "center",
    fontSize: 10,
    fontWeight: "700",
    color: "#374151",
    paddingVertical: 4,
    backgroundColor: "#fff",
  },
  labelSel: { color: "#085041" },
  check: {
    position: "absolute",
    top: 5,
    right: 5,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: "#0F6E56",
    alignItems: "center",
    justifyContent: "center",
  },
});
