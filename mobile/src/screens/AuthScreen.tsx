import { useState } from "react";
import axios from "axios";
import { Keyboard, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { firebaseLogin, signup, syncPasswordFromFirebase } from "../api/auth";
import { resolveApiBaseUrl } from "../api/client";
import { AppButton } from "../components/AppButton";
import { AppCard } from "../components/AppCard";
import { AppInput } from "../components/AppInput";
import { HeroHeader } from "../components/HeroHeader";
import { PasswordRequirementsChecklist } from "../components/PasswordRequirementsChecklist";
import { ScreenContainer } from "../components/ScreenContainer";
import {
  sendPasswordReset,
  signIn as firebaseSignIn,
  signOutFirebaseOnly,
  signUp as firebaseSignUp,
} from "../services/authService";
import { useAppTheme } from "../theme";
import { getPasswordPolicySummaryError, isPasswordPolicySatisfied } from "../utils/passwordPolicy";

type Props = { onAuth: (token: string, mode: "login" | "signup") => Promise<void> };

const detailFromAxios = (error: unknown): string => {
  if (axios.isAxiosError(error)) {
    const d = error.response?.data?.detail;
    if (typeof d === "string") return d;
    if (!error.response) {
      const base = resolveApiBaseUrl();
      return `Cannot reach the API at ${base}. Start the server: cd server && .venv/bin/python3 -m uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload`;
    }
  }
  return "Please try again.";
};

/** After Firebase succeeds, 401 from our API means the fitness DB user/password does not match. */
const mapBackendLoginError = (error: unknown): string => {
  const raw = detailFromAxios(error);
  if (raw === "Invalid credentials") {
    return "This email or password is not on the fitness server. Open Signup to create an account, or use the password you set when you registered in this app.";
  }
  return raw;
};

export const AuthScreen = ({ onAuth }: Props) => {
  const { colors } = useAppTheme();
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
      setResetNotice({ ok: false, text: "Enter your email address." });
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
      text: "Request submitted. Check inbox and spam (wait a few minutes). The email must match a Firebase user with Email/Password. For Expo web, add localhost under Firebase → Authentication → Settings → Authorized domains.",
    });
  };

  const onSubmit = async () => {
    setErrorMsg("");
    const emailTrim = email.trim();
    const nameTrim = name.trim();

    if (!emailTrim || !password || (mode === "signup" && !nameTrim)) {
      setErrorMsg("Please fill in all fields.");
      return;
    }
    if (mode === "signup") {
      const policyErr = getPasswordPolicySummaryError(password);
      if (policyErr) {
        setErrorMsg(policyErr);
        return;
      }
    }
    if (mode === "signup" && password !== confirm) {
      setErrorMsg("Passwords do not match.");
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
          setErrorMsg("Something went wrong. Please try again.");
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
            setErrorMsg("Unexpected server response.");
            return;
          }
          await onAuth(accessToken, "login");
        } catch (e) {
          await signOutFirebaseOnly();
          setErrorMsg(detailFromAxios(e));
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
          setErrorMsg("Unexpected server response.");
          return;
        }
        await onAuth(accessToken, "signup");
      } catch (e) {
        const msg = detailFromAxios(e);
        if (msg.includes("Email already registered") || msg.toLowerCase().includes("already")) {
          try {
            let firebaseUser = fb.user;
            if (!firebaseUser) {
              const signIn = await firebaseSignIn(emailTrim, password);
              if (signIn.error || !signIn.user) {
                await signOutFirebaseOnly();
                setErrorMsg(signIn.error ?? "Could not sign in with this email.");
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
              setErrorMsg("Unexpected server response.");
              return;
            }
            await onAuth(accessToken, "login");
          } catch (e2) {
            await signOutFirebaseOnly();
            setErrorMsg(mapBackendLoginError(e2));
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
    <ScreenContainer>
      <HeroHeader title="Calm Fitness" subtitle="Track better. Train smarter. Stay consistent." />
      <AppCard>
        <View style={styles.tabsRow}>
          <Pressable
            style={[
              styles.tab,
              { borderColor: colors.border, backgroundColor: colors.tabInactive },
              mode === "login" && {
                backgroundColor: "transparent",
                borderColor: colors.authBorderGreen,
              },
            ]}
            onPress={() => setModeAndReset("login")}
          >
            <Text
              style={[
                styles.tabText,
                { color: colors.muted },
                mode === "login" && { color: colors.authBorderGreen },
              ]}
            >
              Login
            </Text>
          </Pressable>
          <Pressable
            style={[
              styles.tab,
              { borderColor: colors.border, backgroundColor: colors.tabInactive },
              mode === "signup" && {
                backgroundColor: "transparent",
                borderColor: colors.authBorderOrange,
              },
            ]}
            onPress={() => setModeAndReset("signup")}
          >
            <Text
              style={[
                styles.tabText,
                { color: colors.muted },
                mode === "signup" && { color: colors.authBorderGreen },
              ]}
            >
              Signup
            </Text>
          </Pressable>
        </View>

        {mode === "signup" && (
          <AppInput label="Name" placeholder="Enter your name" value={name} onChangeText={setName} autoCapitalize="words" />
        )}
        <AppInput
          label="Email"
          placeholder="you@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="emailAddress"
        />
        <AppInput
          label="Password"
          placeholder="Enter password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          textContentType="password"
        />
        {mode === "signup" ? <PasswordRequirementsChecklist password={password} /> : null}
        {mode === "login" ? (
          <Pressable onPress={openForgotModal} style={styles.forgotWrap}>
            <Text style={[styles.forgotLink, { color: colors.authBorderGreen }]}>Forgot password?</Text>
          </Pressable>
        ) : null}
        {mode === "signup" && (
          <AppInput label="Confirm Password" placeholder="Re-enter password" value={confirm} onChangeText={setConfirm} secureTextEntry />
        )}

        {errorMsg ? (
          <Text style={[styles.errorText, { color: colors.errorInline }]} accessibilityLiveRegion="polite">
            {errorMsg}
          </Text>
        ) : null}

        <AppButton
          label={mode === "login" ? "Sign In" : "Create Account"}
          onPress={onSubmit}
          loading={loading}
          disabled={mode === "signup" && !isPasswordPolicySatisfied(password)}
        />
      </AppCard>

      <Modal visible={forgotOpen} transparent animationType="fade" onRequestClose={() => setForgotOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setForgotOpen(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]} onPress={(ev) => ev.stopPropagation()}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>Reset password</Text>
            <Text style={[styles.modalHint, { color: colors.muted }]}>
              We&apos;ll email you a Firebase reset link. Use the same email you use for this app.
            </Text>
            <AppInput
              label="Email"
              placeholder="you@example.com"
              value={resetEmail}
              onChangeText={setResetEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {resetNotice ? (
              <Text
                style={[
                  styles.modalNotice,
                  { color: resetNotice.ok ? colors.authBorderGreen : colors.errorInline },
                ]}
              >
                {resetNotice.text}
              </Text>
            ) : null}
            <AppButton label="Send reset email" onPress={() => void submitPasswordResetEmail()} loading={resetLoading} />
            <Pressable onPress={() => setForgotOpen(false)} style={styles.modalCancel}>
              <Text style={{ color: colors.muted, fontWeight: "600" }}>Close</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </ScreenContainer>
  );
};

const styles = StyleSheet.create({
  tabsRow: { flexDirection: "row", gap: 10, marginBottom: 14 },
  tab: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabText: { fontWeight: "700" },
  errorText: { fontSize: 14, marginBottom: 10, textAlign: "center" },
  forgotWrap: { alignSelf: "flex-end", marginBottom: 8, marginTop: -4 },
  forgotLink: { fontSize: 14, fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
  },
  modalTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  modalHint: { fontSize: 14, marginBottom: 14, lineHeight: 20 },
  modalNotice: { fontSize: 14, marginBottom: 12, lineHeight: 20 },
  modalCancel: { alignItems: "center", paddingVertical: 12 },
});
