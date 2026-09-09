import { useEffect } from "react";
import { bootstrapConnectivity } from "../store/connectivityStore";

export function ConnectivityBootstrap() {
  useEffect(() => {
    bootstrapConnectivity();
  }, []);
  return null;
}
