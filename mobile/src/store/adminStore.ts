import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

type AdminState = {
  token: string | null;
  role: string | null;
  adminName: string | null;
  setAuth: (token: string, role: string, name: string) => void;
  logout: () => void;
};

export const useAdminStore = create<AdminState>()(
  persist(
    (set) => ({
      token: null,
      role: null,
      adminName: null,
      setAuth: (token, role, adminName) => set({ token, role, adminName }),
      logout: () => set({ token: null, role: null, adminName: null }),
    }),
    { name: "admin-auth", storage: createJSONStorage(() => AsyncStorage) }
  )
);
