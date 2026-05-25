import { apiClient } from "./client";

export const signup = async (payload: {
  name: string;
  email: string;
  password: string;
}) => {
  const { data } = await apiClient.post("/signup", payload);
  return data;
};

export const login = async (payload: { email: string; password: string }) => {
  const { data } = await apiClient.post("/login", payload);
  return data;
};

/** Login with Firebase ID token — creates local account if missing. */
export const firebaseLogin = async (payload: {
  id_token: string;
  password: string;
  name?: string;
}) => {
  const { data } = await apiClient.post("/auth/firebase-login", payload);
  return data;
};

/** Sync fitness API password with Firebase after reset (requires valid Firebase ID token). */
export const syncPasswordFromFirebase = async (payload: {
  id_token: string;
  new_password: string;
}) => {
  const { data } = await apiClient.post("/auth/sync-password", payload);
  return data;
};
