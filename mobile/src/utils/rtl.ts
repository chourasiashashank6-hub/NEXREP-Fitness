import { I18nManager } from "react-native";
import type { FlexStyle, TextStyle } from "react-native";

export const isRTL = I18nManager.isRTL;

export const logicalRow: FlexStyle["flexDirection"] = isRTL ? "row-reverse" : "row";

export const textAlignStart: TextStyle["textAlign"] = isRTL ? "right" : "left";
export const textAlignEnd: TextStyle["textAlign"] = isRTL ? "left" : "right";
