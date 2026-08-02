import { useCallback, useEffect, useState } from "react";
import { FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useTranslation } from "react-i18next";
import {
  adminScreenScroll,
  ErrorText,
  FilterChip,
  LoadingBlock,
  PlanBadge,
  UserAvatar,
} from "../../components/admin/AdminShared";
import { adminApi } from "../../api/adminApi";
import type { AdminStackParamList } from "../../navigation/AdminNavigator";
import { COLORS } from "./adminTheme";

type UserRow = {
  id: number;
  name: string;
  email: string;
  plan_id: string;
  created_at?: string;
  last_active_at?: string;
};

export default function AdminUsersScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<NativeStackNavigationProp<AdminStackParamList>>();
  const [search, setSearch] = useState("");
  const [planFilter, setPlanFilter] = useState<string | null>(null);
  const [items, setItems] = useState<UserRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPage = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (append) setLoadingMore(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await adminApi.listUsers({
          search: search.trim() || undefined,
          plan_id: planFilter || undefined,
          limit: 50,
          offset: nextOffset,
        });
        setTotal(res.total);
        setOffset(nextOffset + res.items.length);
        setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("admin.users.loadFailed"));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [planFilter, search]
  );

  useEffect(() => {
    void loadPage(0, false);
  }, [loadPage]);

  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Text style={styles.headerCount}>{t("admin.common.total", { count: total })}</Text>
      ),
    });
  }, [navigation, total]);

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder={t("admin.users.searchPlaceholder")}
          placeholderTextColor={COLORS.textHint}
          style={styles.search}
          onSubmitEditing={() => void loadPage(0, false)}
          returnKeyType="search"
        />
        <View style={styles.chips}>
          {[
            { label: t("admin.common.all"), value: null },
            { label: t("admin.common.free"), value: "free" },
            { label: t("admin.common.pro"), value: "pro" },
            { label: t("admin.common.elite"), value: "elite" },
          ].map((p) => (
            <FilterChip
              key={p.label}
              label={p.label}
              active={planFilter === p.value}
              onPress={() => setPlanFilter(p.value)}
            />
          ))}
        </View>
        {loading ? <LoadingBlock /> : null}
        {error ? <ErrorText message={error} /> : null}
      </View>

      <FlatList
        style={adminScreenScroll.style}
        contentContainerStyle={[adminScreenScroll.contentContainerStyle, { paddingTop: 0 }]}
        data={items}
        keyExtractor={(u) => String(u.id)}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => navigation.navigate("AdminUserDetail", { userId: item.id })}
            style={styles.row}
            activeOpacity={0.7}
          >
            <UserAvatar name={item.name ?? item.email} />
            <View style={styles.rowBody}>
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowMeta}>
                {item.email} · {t("admin.common.activeDate", {
                  date: item.last_active_at
                    ? new Date(item.last_active_at).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                      })
                    : "—",
                })}
              </Text>
            </View>
            <PlanBadge plan={item.plan_id ?? "free"} />
          </TouchableOpacity>
        )}
        ListFooterComponent={
          items.length < total ? (
            <TouchableOpacity
              style={styles.loadMore}
              disabled={loadingMore}
              onPress={() => void loadPage(offset, true)}
            >
              <Text style={styles.loadMoreText}>{loadingMore ? t("admin.users.loading") : t("admin.users.loadMore")}</Text>
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.bg },
  top: { paddingHorizontal: 16, paddingTop: 8 },
  search: {
    backgroundColor: COLORS.card,
    borderWidth: 0.5,
    borderColor: COLORS.borderMid,
    borderRadius: 10,
    color: COLORS.text,
    padding: 10,
    paddingHorizontal: 14,
    fontSize: 13,
    marginBottom: 12,
  },
  chips: { flexDirection: "row", gap: 6, marginBottom: 16, flexWrap: "wrap" },
  headerCount: { color: COLORS.tealLight, fontSize: 13, fontWeight: "500", marginRight: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 13,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  rowBody: { flex: 1, marginLeft: 12 },
  rowName: { color: COLORS.text, fontSize: 14, fontWeight: "500" },
  rowMeta: { color: COLORS.textHint, fontSize: 11, marginTop: 2 },
  loadMore: { alignItems: "center", paddingVertical: 14 },
  loadMoreText: { color: COLORS.teal, fontWeight: "600" },
});
