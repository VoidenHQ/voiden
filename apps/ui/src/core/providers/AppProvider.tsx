import { useGetAppState } from "@/core/state/hooks";

export const AppProvider = ({ children }: { children: React.ReactNode }) => {
  const { data } = useGetAppState();

  if (!data) {
    return null;
  }

  return children;
};
