import { useState } from "react";
import axios from "axios";
import type { TextInputProps } from "react-native";
import { ActivityIndicator, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { firebaseLogin, signup, syncPasswordFromFirebase } from "../api/auth";
import { resolveApiBaseUrl } from "../api/client";
import { AppInput } from "../components/AppInput";
import { PasswordRequirementsChecklist } from "../components/PasswordRequirementsChecklist";
import {
  sendPasswordReset,
  signIn as firebaseSignIn,
  signOutFirebaseOnly,
  signUp as firebaseSignUp,
} from "../services/authService";
import { PASSWORD_MAX_LEN, PASSWORD_MIN_LEN, isPasswordPolicySatisfied } from "../utils/passwordPolicy";

type Props = { onAuth: (token: string, mode: "login" | "signup") => Promise<void> };

const GREEN = "#0F6E56";
const GREEN_LIGHT = "#E8F5EE";
const ORANGE = "#D85A30";
const ORANGE_LIGHT = "#FFF1EE";
const BG = "#F7F6F3";
const WHITE = "#FFFFFF";
const TEXT = "#1A1A18";
const MUTED = "#BBBBBB";
const TRACK = "#E5E4E0";
const BORDER = "#ECEAE5";

const detailFromAxios = (error: unknown, t: TFunction): string => {
  if (axios.isAxiosError(error)) {
    const d = error.response?.data?.detail;
    if (typeof d === "string") return d;
    if (!error.response) {
      const base = resolveApiBaseUrl();
      return t("auth.errors.apiUnreachable", { base });
    }
  }
  return t("auth.errors.tryAgain");
};

/** After Firebase succeeds, 401 from our API means the fitness DB user/password does not match. */
const mapBackendLoginError = (error: unknown, t: TFunction): string => {
  const raw = detailFromAxios(error, t);
  if (raw === "Invalid credentials") {
    return t("auth.errors.backendLoginMismatch");
  }
  return raw;
};

export const AuthScreen = ({ onAuth }: Props) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [forgotOpen, setForgotOpen] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetNotice, setResetNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  const resetForm = () => {
    setName("");
    setEmail("");
    setPassword("");
    setConfirm("");
    setErrorMsg("");
  };

  const setModeAndReset = (next: "login" | "signup") => {
    setMode(next);
    resetForm();
    setForgotOpen(false);
    setResetNotice(null);
  };

  const openForgotModal = () => {
    setResetEmail(email.trim());
    setResetNotice(null);
    setForgotOpen(true);
  };

  const submitPasswordResetEmail = async () => {
    const em = resetEmail.trim();
    if (!em) {
      setResetNotice({ ok: false, text: t("auth.errors.enterEmail") });
      return;
    }
    setResetLoading(true);
    setResetNotice(null);
    const { error } = await sendPasswordReset(em);
    setResetLoading(false);
    if (error) {
      setResetNotice({ ok: false, text: error });
      return;
    }
    setResetNotice({
      ok: true,
      text: t("auth.resetSubmitted"),
    });
  };

  const onSubmit = async () => {
    setErrorMsg("");
    const emailTrim = email.trim();
    const nameTrim = name.trim();

    if (!emailTrim || !password || (mode === "signup" && !nameTrim)) {
      setErrorMsg(t("auth.errors.fillFields"));
      return;
    }
    if (mode === "signup") {
      if (!isPasswordPolicySatisfied(password)) {
        setErrorMsg(t("auth.errors.passwordPolicy", { min: PASSWORD_MIN_LEN, max: PASSWORD_MAX_LEN }));
        return;
      }
    }
    if (mode === "signup" && password !== confirm) {
      setErrorMsg(t("auth.errors.passwordMismatch"));
      return;
    }

    setLoading(true);
    Keyboard.dismiss();

    try {
      if (mode === "login") {
        const fb = await firebaseSignIn(emailTrim, password);
        if (fb.error) {
          setErrorMsg(fb.error);
          return;
        }
        if (!fb.user) {
          setErrorMsg(t("auth.errors.generic"));
          return;
        }
        try {
          const idToken = await fb.user.getIdToken(true);
          const data = await firebaseLogin({
            id_token: idToken,
            password,
          });
          const accessToken = data?.access_token;
          if (!accessToken || typeof accessToken !== "string") {
            await signOutFirebaseOnly();
            setErrorMsg(t("auth.errors.unexpectedServer"));
            return;
          }
          await onAuth(accessToken, "login");
        } catch (e) {
          await signOutFirebaseOnly();
          setErrorMsg(detailFromAxios(e, t));
        }
        return;
      }

      const fb = await firebaseSignUp(nameTrim, emailTrim, password);
      if (fb.error) {
        setErrorMsg(fb.error);
        return;
      }
      try {
        const data = await signup({ name: nameTrim, email: emailTrim, password });
        const accessToken = data?.access_token;
        if (!accessToken || typeof accessToken !== "string") {
          await signOutFirebaseOnly();
          setErrorMsg(t("auth.errors.unexpectedServer"));
          return;
        }
        await onAuth(accessToken, "signup");
      } catch (e) {
        const msg = detailFromAxios(e, t);
        if (msg.includes("Email already registered") || msg.toLowerCase().includes("already")) {
          try {
            let firebaseUser = fb.user;
            if (!firebaseUser) {
              const signIn = await firebaseSignIn(emailTrim, password);
              if (signIn.error || !signIn.user) {
                await signOutFirebaseOnly();
                setErrorMsg(signIn.error ?? t("auth.errors.couldNotSignIn"));
                return;
              }
              firebaseUser = signIn.user;
            }
            const idToken = await firebaseUser.getIdToken(true);
            const data = await firebaseLogin({
              id_token: idToken,
              password,
              name: nameTrim,
            });
            const accessToken = data?.access_token;
            if (!accessToken || typeof accessToken !== "string") {
              await signOutFirebaseOnly();
              setErrorMsg(t("auth.errors.unexpectedServer"));
              return;
            }
            await onAuth(accessToken, "login");
          } catch (e2) {
            await signOutFirebaseOnly();
            setErrorMsg(mapBackendLoginError(e2, t));
          }
        } else {
          await signOutFirebaseOnly();
          setErrorMsg(msg);
        }
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, mode === "signup" && styles.heroSignup]}>
          <View style={styles.heroCircleLarge} />
          <View style={styles.heroCircleSmall} />
          <View style={styles.brandPill}>
            <Text style={styles.brandEmoji}>💪</Text>
            <Text style={styles.brandText}>{t("app.name")}</Text>
          </View>
          {mode === "login" ? (
            <>
              <Text style={styles.heroTitle}>{t("auth.brandTitle")}</Text>
              <Text style={styles.heroSubtitle}>{t("auth.brandSubtitle")}</Text>
            </>
          ) : (
            <>
              <Text style={styles.heroTitleSignup}>{t("auth.signupTitle")}</Text>
              <Text style={styles.heroSubtitleSignup}>{t("auth.signupSubtitle")}</Text>
            </>
          )}
        </View>

        <View style={styles.formSection}>
        <View style={styles.tabsRow}>
          <Pressable
            style={[
              styles.tab,
              mode === "login" ? styles.tabActive : styles.tabInactive,
            ]}
            onPress={() => setModeAndReset("login")}
          >
            <Text
              style={[
                styles.tabText,
                mode === "login" ? styles.tabTextActive : styles.tabTextInactive,
              ]}
            >
              {t("auth.loginTab")}
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.tab,
              mode === "signup" ? styles.tabActive : styles.tabInactive,
            ]}
            onPress={() => setModeAndReset("signup")}
          >
            <Text
              style={[
                styles.tabText,
                mode === "signup" ? styles.tabTextActive : styles.tabTextInactive,
              ]}
            >
              {t("auth.signupTab")}
            </Text>
          </Pressable>
        </View>

        {mode === "signup" && (
          <AuthField
            label={t("auth.fullName")}
            icon="person-outline"
            value={name}
            onChangeText={setName}
            placeholder={t("auth.namePlaceholder")}
            autoCapitalize="words"
            focused={focusedField === "name"}
            onFocus={() => setFocusedField("name")}
            onBlur={() => setFocusedField(null)}
          />
        )}
        <AuthField
          label={t("auth.email")}
          icon="mail-outline"
          placeholder={t("auth.emailPlaceholder")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
          focused={focusedField === "email"}
          onFocus={() => setFocusedField("email")}
          onBlur={() => setFocusedField(null)}
        />
        <AuthField
          label={t("auth.password")}
          icon="lock-closed-outline"
          placeholder={t("auth.passwordPlaceholder")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry={!showPassword}
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          textContentType="password"
          focused={focusedField === "password"}
          onFocus={() => setFocusedField("password")}
          onBlur={() => setFocusedField(null)}
          showEye
          eyeOpen={showPassword}
          onEyePress={() => setShowPassword((v) => !v)}
        />
        {mode === "signup" ? <PasswordRequirementsChecklist password={password} /> : null}
        {mode === "login" ? (
          <Pressable onPress={openForgotModal} style={styles.forgotWrap}>
            <Text style={styles.forgotLink}>{t("auth.forgotPassword")}</Text>
          </Pressable>
        ) : null}
        {mode === "signup" && (
          <AuthField
            label={t("auth.confirmPassword")}
            icon="lock-closed-outline"
            placeholder={t("auth.confirmPasswordPlaceholder")}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!showConfirm}
            focused={focusedField === "confirm"}
            onFocus={() => setFocusedField("confirm")}
            onBlur={() => setFocusedField(null)}
            showEye
            eyeOpen={showConfirm}
            onEyePress={() => setShowConfirm((v) => !v)}
          />
        )}

        {errorMsg ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite">
            {errorMsg}
          </Text>
        ) : null}

        <Pressable
          style={[styles.submitButton, loading && styles.submitButtonDisabled]}
          onPress={onSubmit}
          disabled={loading || (mode === "signup" && !isPasswordPolicySatisfied(password))}
        >
          {loading ? (
            <ActivityIndicator color={WHITE} />
          ) : (
            <Text style={styles.submitText}>{mode === "login" ? t("auth.signIn") : t("auth.createAccount")}</Text>
          )}
        </Pressable>

        <View style={styles.crossLinkRow}>
          <Text style={styles.crossLinkText}>
            {mode === "login" ? t("auth.noAccountPrompt") : t("auth.hasAccountPrompt")}
          </Text>
          <Pressable onPress={() => setModeAndReset(mode === "login" ? "signup" : "login")}>
            <Text style={styles.crossLinkAction}>{mode === "login" ? t("auth.signUpLink") : t("auth.logInLink")}</Text>
          </Pressable>
        </View>
        </View>

      <Modal visible={forgotOpen} transparent animationType="fade" onRequestClose={() => setForgotOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setForgotOpen(false)}>
          <Pressable style={styles.modalCard} onPress={(ev) => ev.stopPropagation()}>
            <Text style={styles.modalTitle}>{t("auth.resetTitle")}</Text>
            <Text style={styles.modalHint}>{t("auth.resetHint")}</Text>
            <AuthField
              label={t("auth.email")}
              icon="mail-outline"
              placeholder={t("auth.emailPlaceholder")}
              value={resetEmail}
              onChangeText={setResetEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              focused={focusedField === "resetEmail"}
              onFocus={() => setFocusedField("resetEmail")}
              onBlur={() => setFocusedField(null)}
            />
            {resetNotice ? (
              <Text
                style={[
                  styles.modalNotice,
                  resetNotice.ok ? styles.modalNoticeOk : styles.modalNoticeError,
                ]}
              >
                {resetNotice.text}
              </Text>
            ) : null}
            <Pressable
              style={[styles.modalSubmitButton, resetLoading && styles.submitButtonDisabled]}
              onPress={() => void submitPasswordResetEmail()}
              disabled={resetLoading}
            >
              {resetLoading ? <ActivityIndicator color={WHITE} /> : <Text style={styles.modalSubmitText}>{t("auth.sendResetEmail")}</Text>}
            </Pressable>
            <Pressable onPress={() => setForgotOpen(false)} style={styles.modalCancel}>
              <Text style={styles.modalCancelText}>{t("common.cancel")}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: WHITE },
  scroll: { flex: 1, backgroundColor: WHITE },
  content: { flexGrow: 1, backgroundColor: WHITE },
  hero: {
    backgroundColor: GREEN,
    paddingHorizontal: 22,
    paddingTop: 28,
    paddingBottom: 32,
    position: "relative",
    overflow: "hidden",
  },
  heroSignup: { paddingBottom: 24 },
  heroCircleLarge: {
    position: "absolute",
    width: 180,
    height: 180,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.06)",
    top: -72,
    right: -62,
  },
  heroCircleSmall: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.06)",
    bottom: -42,
    left: -28,
  },
  brandPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginBottom: 14,
  },
  brandEmoji: { fontSize: 12 },
  brandText: { color: WHITE, fontSize: 12, fontWeight: "900" },
  heroTitle: { color: WHITE, fontSize: 24, fontWeight: "900", lineHeight: 30 },
  heroSubtitle: { color: "rgba(255,255,255,0.6)", fontSize: 12, fontWeight: "700", marginTop: 8 },
  heroTitleSignup: { color: WHITE, fontSize: 20, fontWeight: "900" },
  heroSubtitleSignup: { color: "rgba(255,255,255,0.6)", fontSize: 11, fontWeight: "700", marginTop: 7 },
  formSection: { backgroundColor: WHITE, paddingHorizontal: 18, paddingTop: 20, paddingBottom: 24 },
  tabsRow: {
    flexDirection: "row",
    gap: 4,
    marginBottom: 20,
    backgroundColor: BG,
    borderRadius: 14,
    padding: 4,
  },
  tab: {
    flex: 1,
    borderRadius: 11,
    paddingVertical: 11,
    alignItems: "center",
  },
  tabActive: { backgroundColor: GREEN },
  tabInactive: { backgroundColor: "transparent" },
  tabText: { fontSize: 13 },
  tabTextActive: { color: WHITE, fontWeight: "900" },
  tabTextInactive: { color: MUTED, fontWeight: "700" },
  fieldWrap: { marginBottom: 12 },
  fieldLabel: { color: TEXT, fontSize: 12, fontWeight: "900", marginBottom: 5 },
  inputShell: {
    backgroundColor: BG,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: BORDER,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    minHeight: 50,
  },
  inputShellFocused: { borderColor: GREEN },
  embeddedInputWrap: { flex: 1, marginBottom: 0 },
  embeddedInput: {
    flex: 1,
    borderWidth: 0,
    outlineWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 13,
    color: TEXT,
    fontSize: 14,
  },
  eyeButton: { width: 26, height: 26, alignItems: "center", justifyContent: "center" },
  errorText: {
    backgroundColor: ORANGE_LIGHT,
    color: ORANGE,
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 12,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    lineHeight: 17,
  },
  forgotWrap: { alignSelf: "flex-end", marginBottom: 8, marginTop: -4 },
  forgotLink: { color: GREEN, fontSize: 12, fontWeight: "900" },
  submitButton: {
    width: "100%",
    backgroundColor: GREEN,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 52,
  },
  submitButtonDisabled: { opacity: 0.6 },
  submitText: { color: WHITE, fontSize: 15, fontWeight: "900" },
  crossLinkRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 14 },
  crossLinkText: { color: MUTED, fontSize: 11, fontWeight: "700" },
  crossLinkAction: { color: GREEN, fontSize: 11, fontWeight: "900" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    backgroundColor: WHITE,
    borderRadius: 20,
    padding: 24,
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
  },
  modalTitle: { color: TEXT, fontSize: 18, fontWeight: "900", marginBottom: 8 },
  modalHint: { color: MUTED, fontSize: 12, marginBottom: 16, lineHeight: 18 },
  modalNotice: { fontSize: 12, marginBottom: 12, lineHeight: 18, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontWeight: "700" },
  modalNoticeOk: { backgroundColor: GREEN_LIGHT, color: GREEN },
  modalNoticeError: { backgroundColor: ORANGE_LIGHT, color: ORANGE },
  modalSubmitButton: { backgroundColor: GREEN, borderRadius: 12, paddingVertical: 14, alignItems: "center", justifyContent: "center", minHeight: 48 },
  modalSubmitText: { color: WHITE, fontSize: 14, fontWeight: "900" },
  modalCancel: { alignItems: "center", paddingVertical: 12 },
  modalCancelText: { color: MUTED, fontSize: 12, fontWeight: "800" },
});

type AuthFieldProps = TextInputProps & {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  focused: boolean;
  showEye?: boolean;
  eyeOpen?: boolean;
  onEyePress?: () => void;
};

const AuthField = ({ label, icon, focused, showEye, eyeOpen, onEyePress, ...props }: AuthFieldProps) => (
  <View style={styles.fieldWrap}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <View style={[styles.inputShell, focused && styles.inputShellFocused]}>
      <Ionicons name={icon} size={18} color={focused ? GREEN : MUTED} />
      <AppInput
        {...props}
        placeholderTextColor={MUTED}
        wrapperStyle={styles.embeddedInputWrap}
        style={styles.embeddedInput}
      />
      {showEye ? (
        <Pressable onPress={onEyePress} style={styles.eyeButton} hitSlop={8}>
          <Ionicons name={eyeOpen ? "eye-outline" : "eye-off-outline"} size={16} color={MUTED} />
        </Pressable>
      ) : null}
    </View>
  </View>
);
