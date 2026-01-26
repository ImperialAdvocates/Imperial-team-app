import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.imperialadvocates.portal",
  appName: "Imperial Advocates",
  webDir: "out",
  server: {
    url: "https://imperial-advocates-app-qt8i.vercel.app",
    cleartext: true,
  },
};

export default config;