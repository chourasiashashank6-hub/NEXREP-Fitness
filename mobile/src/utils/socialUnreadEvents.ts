type Listener = () => void;

const listeners = new Set<Listener>();

export const subscribeToSocialUnreadChanges = (listener: Listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const notifySocialUnreadChanged = () => {
  listeners.forEach((listener) => listener());
};
